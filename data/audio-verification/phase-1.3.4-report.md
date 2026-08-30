# Phase 1.3.4 报告：微信真机 Audio Player 重构与首字保护

开发阶段局域网方案。本阶段只改小程序播放器生命周期，不改数据层、资源层、Mini API。

## 1. 根因

Phase 1.3.2 已确认 WAV 本身完整，问题在 `InnerAudioContext` 生命周期，而不是 Entrance 混音或 index。

本阶段继续核对后，根因是三件事叠在一起：

1. **全程复用同一个 InnerAudioContext。** 冷启动第一次 `src` 解码时，系统音频会话尚未“热”；先播 Voice 再播 Entrance 时，同一个 context 已被唤醒，所以看起来正常。
2. **只等 `onCanplay` 就 `play()`。** 真机上 `onCanplay` 不等于“解码头已经在 0ms、可以稳定出声”。此时 `currentTime` 可能已经大于 0，直接 `play()` 会从缓冲中间开始，听起来像吞了首字。
3. **session 名存实亡。** 旧代码有 `gen`，但 `onCanplay` / `onPlay` / `onEnded` / `onError` 从不校验。详情页还对 Entrance 做隐藏 preload，和用户第一次点击抢同一个 context，旧回调可以污染新播放。第一次直接点“完整登场”因此不稳定，并可能显示“暂时无法播放”。

手机浏览器能播同一条 LAN WAV，说明资源链没有问题。

## 2. 原播放器生命周期

```
App.onLaunch
  └ wx.createInnerAudioContext()  （整个应用复用这一个）
      bind onCanplay/onPlay/onError/onEnded 一次

详情页 onLoad
  └ preload(entrance) → ctx.src = entranceUrl, autoplay=false

用户点击 play(url)
  └ 若换 src：ctx.src = url, pendingPlay=true
  └ 若同 key loading：只把 pendingPlay=true
  └ 不立刻 play()

onCanplay
  └ startTime=0
  └ 若 pendingPlay → ctx.play()     ← 真机上仍可能过早
  └ 不检查 session / duration / currentTime

onError
  └ 一律 “暂时无法播放”     ← destroy/切换引起的错误也会落到 UI
```

`gen` 在 `loadSrc`/`stop` 时自增，回调里从未使用。

## 3. 新播放器生命周期

状态：`idle → loading → ready → playing → paused | ended | error`，切换时经过 `stopping`（内部 teardown）。

```
play / playAudio({ type, cardId, url })
  └ teardown 旧 context（stop + destroy；旧 session 立即作废）
  └ sessionId += 1
  └ 新建 InnerAudioContext
  └ autoplay=false, obeyMuteSwitch=false, volume=1, startTime=0
  └ 绑定带 session 闭包的事件
  └ ctx.src = url
  └ status=loading

onCanplay（仅 live session）
  └ 记录 duration / currentTime / paused
  └ startTime=0
  └ status=ready
  └ 若 currentTime>0：seek(0)，等 onSeeked
  └ 否则 play()

onSeeked（仅 live session 且正在等待归零）
  └ startTime=0
  └ play()

onPlay → playing
onEnded → ended，destroy 当前 context
onError（仅 live 且非用户停止）→ error，“暂时无法播放”，可重试
用户切换 / stop → 旧 session 作废，不显示错误
```

同一时刻最多一个活的 InnerAudioContext。业务页只调用 `play` / `playAudio`，不碰 src / 事件 / destroy。

## 4. 为什么之前“先播放 Voice 再 Entrance”会表现正常

Voice 把**同一个** InnerAudioContext 和系统音频会话跑热了：解码器已初始化，`onCanplay` 时头已经在 0 附近。随后换 src 播 Entrance，不再是冷启动第一次解码。

这不是 Entrance WAV 变完整了，而是播放器实例被预热了。隐藏 preload、静音预播、先播 Voice 都不能当生产修复。本阶段改为：每次新 src 用新 context + 新 session，并且在真正 `play()` 前把播放头归零。

## 5. 本次具体修改

- 重写 `miniprogram/utils/playerController.js`：状态机、session、按次创建/销毁 context。
- `miniprogram/utils/player.js`：`createContext` 工厂；`wx.setInnerAudioOption({ obeyMuteSwitch: false })`。
- 详情页去掉 Entrance 隐藏 preload。
- 首页 / 详情 / audio-button / mini-player 统一走 `play` / `playAudio`。
- `?debug=1` 时详情页显示最近 20 条 `[AudioPlayer]` 日志。
- 测试：`test/audioPlayer.test.js`、`test/audioPlayerLifecycle.test.js`；扩展原 lifecycle 测试。

未改 Mini API、未改混音、未改 index、未改 `C:\Hearthstone`。

## 6. session / generation 如何防竞态

每次 `loadSrc` 先把 `liveSession` 置 0（作废旧回调），再 `seq++` 得到新 id。所有 `onCanplay` / `onPlay` / `onPause` / `onStop` / `onEnded` / `onError` / `onSeeked` 闭包带创建时的 session。`isLive(session)` 为假则直接 return。

因此：

- session1 Voice 的迟到 `onCanplay` 不会触发 session2 Entrance 的 `play()`
- 旧 `onEnded` / `onError` 不会把新播放打成 ended/error
- 用户主动切换不会弹出“暂时无法播放”

## 7. InnerAudioContext 如何创建、播放、停止、销毁

- **创建：** 每次新 src 调用 `wx.createInnerAudioContext()`。应用内仍是一个逻辑播放器。
- **播放：** `autoplay=false`，代码在 canplay（必要时 seek 到 0）之后调用 `play()`。
- **停止 / 切换：** `stop()` + `destroy()` 旧实例，再创建新实例。
- **结束：** `onEnded` 后 destroy，避免残留解码状态。
- **失败重试：** 重新 `loadSrc`，新 session、新 context。

## 8. onCanplay / onPlay / onError / onEnded 如何处理

| 事件 | 处理 |
|---|---|
| onCanplay | 校验 session 与 src；打日志；进入 ready；归零后 `play()`；重复 canplay 不二次 play |
| onPlay | 校验 session → `playing` |
| onSeeked | 仅当这次是为了归零而 seek → `play()` |
| onError | 校验 session；用户 stop/切换忽略；否则 UI 显示“暂时无法播放”，debug 打 code/message |
| onEnded | 校验 session → `ended` → destroy |
| onWaiting | 不重新开 session，避免把缓冲当成新的 loading 播放 |

## 9. 首字吞音问题最终原因

不是 WAV 缺“团”，也不是混音 delay/padding。

冷启动第一次 `play()` 发生在解码头尚未稳定停在 0ms 时（`onCanplay` 过早，或复用 context 的残留 `currentTime`）。听感上 BOT_548 Entrance 的“团结”变成“结”。

对策：新 context、禁止 src 后立刻 play、canplay 后若 `currentTime>0` 则 `seek(0)` 再 play、`startTime=0`、去掉隐藏 preload。没有给 Voice 加 delay，没有改 Music volume，没有 leading padding。

## 10. BOT_548 验证结果

- API：`GET /api/audio/entrance/BOT_548` Local + LAN 均为 HTTP 200，`audio/wav`，RIFF。未改 WAV。
- 播放器：lifecycle mock 覆盖冷启动直接 Entrance、`currentTime>0` 时 seek(0) 再 play、旧 session 不污染。
- **微信真机听感（“团”是否完整）：本环境未实际点按微信预览，需用户冷启动验收。**

## 11. EX1_116 验证结果

- Voice / Music / Entrance API：Local + LAN 均为 HTTP 200 WAV。
- 播放器 mock：冷启动 Voice、Music、Entrance；Voice→Entrance；Entrance→Voice。
- **开发者工具 / 真机点按：未在本环境实际操作微信。**

## 12. EX1_572 验证结果

- 播放器 mock：Entrance A（EX1_116）立即切到 Entrance B（EX1_572），旧 canplay/ended/error 不影响新 session，最终播放 EX1_572。
- 无 CardID 特判。
- **真机点按未在本环境执行。**

## 13. Voice → Entrance 验证

自动化：先 Voice 未 canplay 即切 Entrance，旧 Voice 事件被忽略，Entrance 一次 `play()`。PASS（mock）。

## 14. Entrance → Voice 验证

自动化：同上反向。PASS（mock）。

## 15. 冷启动验证

自动化覆盖：

- A 直接 Entrance
- B 直接 Voice
- C 直接 Music
- D Entrance → ended → 再 Entrance
- E Entrance A → 立即 Entrance B
- F Voice → 立即 Entrance
- G Entrance → 立即 Voice

均不依赖“之前播过别的音频”。PASS（mock）。

微信真机冷启动需用户在同一 Wi-Fi 下重新编译后验收。详情页 debug：`pages/card/card?id=BOT_548&debug=1`。

## 16. npm test 结果

**PASS**（含 `audioPlayer.test.js`、`audioPlayerLifecycle.test.js`）。

## 17. 是否修改 C:\Hearthstone

NO CHANGE

## 18. 是否修改 index

NO。未改 `card-audio-index.json` / `music-index.json` / `music-assets.json` / `card-voice-index.json` / `audio-index.json`。

## 19. 是否批量导出 WAV

NO

## 20. 是否存在 CardID 特判

NO。播放器不出现 `EX1_116` / `BOT_548` 等分支。

## 21. 是否存在固定延迟 workaround

NO。无 `setTimeout(play)`，无静音预播，无隐藏预播，无先播 Voice 再 Entrance 的生产路径。

---

### API 抽检（本阶段未改协议）

| URL | 127.0.0.1 | 192.168.0.111 |
|---|---|---|
| `/api/audio/voice/EX1_116/play` | 200 WAV | 200 WAV |
| `/api/audio/music/EX1_116` | 200 WAV | 200 WAV |
| `/api/audio/entrance/EX1_116` | 200 WAV | 200 WAV |
| `/api/audio/entrance/BOT_548` | 200 WAV | 200 WAV |

### 真机状态（不要与代码完成混为一谈）

- **代码已支持：** 单实例、session 隔离、canplay 后再 play、必要时 seek(0)、错误可重试、LAN URL 仍走 `getApiBase()`。
- **微信开发者工具实际试听：** 未在本环境操作。
- **微信真机冷启动实际试听：** 未在本环境操作。请重新编译小程序后，冷启动直接点 BOT_548 / EX1_116 / EX1_572「完整登场」验收。
