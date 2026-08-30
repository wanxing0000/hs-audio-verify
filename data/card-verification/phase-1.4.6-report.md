# Phase 1.4.6 — GIL_598 Entrance Combo Investigation

## 1. 调查目标

定位为什么 `GIL_598`（苔丝·格雷迈恩）的独立登场音乐已经可以播放，但正常页面「登场音乐 + 登场语音」组合听感不正确。

本阶段只调查，不修改生产代码、索引、WAV、Mini、测试。

## 2. 已知事实

- Canonical：`GIL_598` / dbfId `47211` / 苔丝·格雷迈恩 / GILNEAS / collectible。
- `CORE_GIL_598` 已折叠到 `GIL_598`。
- Voice：`VO_GIL_598_Female_Human_Play_01` → `playsound_base_zhcn-d2f4bda7-audio-0.unity3d`。`GET /api/audio/voice/GIL_598/play` = 200 WAV。
- Music 索引名 `Gilneas_Play_Stinger_6`，GUID `d7504580b84df004e85650f93b1d14d2`；真实 AudioClip 名为 `Gilneas_Play_Stinger_2`（Phase 1.4.5 GUID 命中）。`GET /api/audio/music/GIL_598` = 200 WAV。
- 本阶段不再调查「是否有 BGM」。Mini 保持 `http://127.0.0.1:8767`，未重启。

## 3. 正常页面 Entrance 调用链

正常卡牌详情页的「登场」不是双按钮叠加，而是标题为「音乐 + 登场语音」的 **完整登场** 按钮。

```text
miniprogram/pages/card/card.wxml
  bindtap="onEntrance"
    ↓
miniprogram/pages/card/card.js  onEntrance()
    ↓
app.player.playAudio({
  type: 'entrance',
  cardId: card.id,
  url: audio.getEntranceUrl(card),   // {apiBase}/api/audio/entrance/{cardId}
  key: card.id + ':entrance'
})
    ↓
miniprogram/utils/player.js  createPlayer()
    ↓
miniprogram/utils/playerController.js  playAudio() → play() → loadSrc()
    ↓
（iOS）downloadWxAudio(entranceUrl) → tempFilePath → 一个 InnerAudioContext.src
（非 iOS）InnerAudioContext.src = entranceUrl
```

其它入口（同一 Entrance URL，不是另一套组合逻辑）：

| 入口 | 文件 | 行为 |
| --- | --- | --- |
| 详情页完整登场 | `pages/card/card.js` `onEntrance` | `type: 'entrance'` + `getEntranceUrl` |
| 列表快捷播放 | `components/card-item/card-item.js` `onPlay` | `quickPlay.type === 'entrance'` 时同样 `getEntranceUrl` |
| 分轨按钮 | `components/audio-button/audio-button.js` | `play` → `/voice/.../play`；`music` → `/music/...`。**不是 combo** |
| 诊断页 | `pages/audio-test/` | 也会打 entrance URL，不是正常图鉴页 |

**播放模式判定：C（服务端混合 WAV）+ 客户端单轨播放。**

不是 A（先 Music 再 Voice 的客户端序列），不是 B（双 InnerAudioContext 同时播），不是 D（客户端分别请求 Voice/Music 再混音）。

`ENTRANCE_MIX`：`musicVolume 0.7`，`voiceVolume 1`，`voiceDelayMs 0`，`leadingPaddingMs 0`，`targetRate 48000`。

## 4. Voice 播放链

```text
audio-button track="play"
  → GET /api/audio/voice/GIL_598/play
  → AudioService.getVoiceAudio(GIL_598, 'play')
  → VO_GIL_598_Female_Human_Play_01
  → playsound_base_zhcn-d2f4bda7-audio-0.unity3d
  → 200 WAV  199468 bytes  48 kHz mono  2077 ms
```

Live Mini：status 200，sha1 `66a7f60c07ea480c75126b33bf824898dd69d043`。前 200 ms RMS 6891，起音静音 18.8 ms。

## 5. Music 播放链

```text
audio-button track="music"
  → GET /api/audio/music/GIL_598
  → AudioService.getMusicAudio(GIL_598)
  → 索引 clip 名 Gilneas_Play_Stinger_6
  → MusicStinger GUID d7504580b84df004e85650f93b1d14d2
  → prefab initial_base_global-d2f4bda7-prefab-4.unity3d
  → GUID 命中 Gilneas_Play_Stinger_2
  → 200 WAV  923984 bytes  48 kHz stereo  4812 ms
```

Live Mini：status 200，sha1 `fa81027d4c80ba9a8ed5d19b822e734327b85233`。

与对照卡不同的关键包络：

| 窗口 | GIL_598 Music RMS | GIL_692 Music RMS |
| --- | ---: | ---: |
| 0–200 ms | **315** | 3395 |
| 0–500 ms | 3349 | 5420 |
| leadingSilence | **121.3 ms** | 11.5 ms |

苔丝独立 BGM 前 ~120 ms 接近静音；吉恩 stinger 一开始就有能量。

## 6. Entrance Combo 播放链

**客户端不请求 `/api/audio/music/:cardId`，也不请求 `/voice/.../play`。**

```text
GET /api/audio/entrance/GIL_598
  → miniServer：repo.getCard + entrancePreview.available
  → EntrancePreviewService.getEntrancePreview(cardId)
       缓存命中：tmp/preview/{cardId}_entrance_v2.wav
       否则：
         getVoiceAudio(cardId, 'play')     // 与 Voice API 同一函数
         getMusicAudio(cardId)             // 与 Music API 同一函数
         两者都有 → mixPcm16(music, voice, ENTRANCE_MIX) → 写 preview 缓存
         只有 Voice → 直接返回 Voice 文件（source:'play'，不写 preview）
         只有 Music → 直接返回 Music 文件（source:'music'）
  → sendWav 一条 PCM16 WAV
  → PlayerController 把这一条 URL 交给唯一 InnerAudioContext
```

相关 HTTP API（从 `miniServer.js` 确认，未假设）：

| API | 调用者 | 输入 | 输出 | Voice | Music | 混音 |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/audio/voice/:cardId/:type` | audio-button / 诊断页 | cardId + type | WAV | 是 | 否 | 否 |
| `GET /api/audio/music/:cardId` | audio-button / 诊断页 | cardId | WAV | 否 | 是 | 否 |
| `GET /api/audio/entrance/:cardId` | 详情「完整登场」、列表 quickPlay | cardId | WAV | 间接 | 间接 | **服务端 mixPcm16** |
| `GET /api/audio/health` | 健康检查 | 无 | JSON | 否 | 否 | 否 |
| `GET /api/audio-test/tone.wav` | 诊断页 | 无 | 测试音 | 否 | 否 | 否 |

`entrancePreview.available` = `voice.play.available && musicPlayable(raw.music)`。GIL_598 目录接口为 `true`。

## 7. GIL_598 数据链

```text
GIL_598
├── Voice
│   └── VO_GIL_598_Female_Human_Play_01
│       └── playsound_base_zhcn-d2f4bda7-audio-0.unity3d
│       └── delaySec: 0  timingVerified: false
│
├── Music
│   └── 索引名 Gilneas_Play_Stinger_6
│       └── GUID d7504580b84df004e85650f93b1d14d2
│       └── prefab initial_base_global-d2f4bda7-prefab-4.unity3d
│       └── 真实 AudioClip Gilneas_Play_Stinger_2（1.4.5）
│       └── delaySec: 0  volume: 1
│
└── Entrance Combo
    └── 没有独立 clip / 没有独立 GUID / 没有第三份索引
    └── = mixPcm16(getMusicAudio(GIL_598), getVoiceAudio(GIL_598,'play'), ENTRANCE_MIX)
    └── 缓存键 GIL_598_entrance_v2
```

共享同一 Voice+Music 引用（非独立 combo 源）：

- `CORE_GIL_598`：status `shared`，`sourceCardId: GIL_598`
- `Story_06_TessGreymane`：同上

## 8. 对照卡 EX1_116 数据链

```text
EX1_116 火车王里诺艾
├── Voice  VO_EX1_116_Play_01
│   └── playsound_base_zhcn-775a814d-audio-0.unity3d
│   └── 399916 bytes  48 kHz mono  4165 ms  起音静音 87.5 ms
├── Music  Pegasus_Stinger_Leeroy_Jenkins
│   └── GUID c6aaf3440b38a664db44d8870f3864d1
│   └── initial_base_global-775a814d-prefab-1.unity3d
│   └── 753508 bytes  44.1 kHz stereo  4271 ms  起音静音 36.7 ms
│   └── 前 200 ms RMS 2876（音乐先响）
└── Entrance
    └── 同一 mixPcm16
    └── 820140 bytes  48 kHz stereo（音乐被 resample 到 48 kHz，体积大于纯 Music）
    └── 前 200 ms RMS 2626 ≈ 音乐床，voice 尚未起音
```

吉恩 `GIL_692`（同套 GILNEAS stinger，组合听感正常的近亲对照）：

- Voice `VO_GIL_692_Male_Worgen_Play_03`，388396 bytes，4045 ms
- Music `Gilneas_Play_Stinger_4`（名字与 bundle 内 clip 名一致），1243884 bytes，6478 ms
- Entrance 1243884 bytes，SHA1 等于本地 `mixPcm16(music, voice)`
- 前 80 ms：`maxMusicAbs=11429`，`maxVoiceAbs=19451`（两轨同时有能量）

## 9. API 对比

Live Mini `http://127.0.0.1:8767`（未重启）：

| Card | Voice | Music | Entrance |
| --- | --- | --- | --- |
| GIL_598 | 200 / 199468 / WAV | 200 / 923984 / WAV | 200 / 923984 / WAV |
| GIL_692 | 200 / 388396 / WAV | 200 / 1243884 / WAV | 200 / 1243884 / WAV |
| EX1_116 | 200 / 399916 / WAV | 200 / 753508 / WAV | 200 / 820140 / WAV |

全部 `Content-Type: audio/wav`，`Cache-Control: private, max-age=86400`。

GIL_598 Entrance **字节数等于 Music**，但 **SHA1 不等于 Music**（`a4ce91af…` vs `fa81027d…`），也不等于 Voice。字节数相同是因为 mix 长度 = max(music, voice)，音乐更长，叠加写在同一 PCM 缓冲上。

GIL_598 / GIL_692 / EX1_116 的 Entrance SHA1 **全部等于** 用当前 Voice WAV + Music WAV 在本地跑 `mixPcm16(..., ENTRANCE_MIX)` 的结果。Entrance 没有走另一套 Resolver。

## 10. Resolver 对比

| | GIL_598 | EX1_116 |
| --- | --- | --- |
| voice winner | `VO_GIL_598_Female_Human_Play_01` | `VO_EX1_116_Play_01` |
| music winner | GUID → `Gilneas_Play_Stinger_2` | `Pegasus_Stinger_Leeroy_Jenkins` |
| failureClass | 无（Voice/Music/Entrance 皆 200） | 无 |
| Entrance 是否另调 Resolver | 否。`getMusicAudio` / `getVoiceAudio` | 同左 |

1.4.5 的 CLIP_NOT_FOUND 已不在这条链上。Entrance 失败回退（只有 Voice）在 **当前** Mini 上未触发。

## 11. PlayerController 对比

生产播放器只有一套：

- `playAudio` / `play` / `preload` / `pause` / `stop` / `destroy`
- **没有** `playVoice` / `playMusic` / `playEntrance` 三个独立播放函数
- `reuseContext: false`：每次 `loadSrc` 先 `teardown('replace')`（`abortDownload` + `stop` + `destroy`），再 `beginSession()` 换新 `liveSession`
- **同一时刻只有 1 个 InnerAudioContext**（`liveCount` 0 或 1）
- Voice 与 Music **没有** 两个 session 并行；完整登场只有 `key = GIL_598:entrance` 一个 session
- 若用户分别点「登场语音」和「登场音乐」，第二条会 teardown 第一条。这是分轨按钮的互斥，不是完整登场路径

GIL_598 与 EX1_116 的 Player 路径相同：都是单 URL。Player 层没有卡牌分叉。

## 12. iOS Download Adapter 对比

`shouldDownload`：`platform === 'ios' && http(s) URL`。

完整登场时：

```text
Voice 不单独下载
Music 不单独下载
只下载  GET /api/audio/entrance/GIL_598  → 一条 tempFilePath → 一个 InnerAudioContext
```

`downloadWxAudio` 本身可以并发（无全局锁），但 PlayerController 只挂一个 `downloadTask`，`teardown` 会 `abort()` 上一次下载。完整登场不会启动两次 download。

`audio-test` 页另有诊断用 InnerAudioContext，正常图鉴页不用。

## 13. 实际调用顺序

未改生产日志。按代码，点击详情页「🎵 完整登场试听」的顺序是：

```text
点击完整登场
  → playAudio type=entrance
  → teardown 上一会话（若有）
  → session++
  → GET /api/audio/entrance/GIL_598     ← 唯一音频请求
  → （iOS）wx.downloadFile(该 URL)
  → src = tempFilePath 或 http URL
  → canplay → play
```

**不会出现** `voice request` + `music request` 两条客户端请求。

服务端首次未命中 preview 缓存时，进程内顺序为 `getVoiceAudio` → `getMusicAudio` → `mixPcm16`。本次探测时 `tmp/preview/GIL_598_entrance_v2.wav` 在请求后出现（mtime 2026-08-29T06:03:23Z），内容与现场 mix 一致。

## 14. 断点定位

```text
GIL_598
  ↓
详情页「完整登场」
  ↓
GET /api/audio/entrance/GIL_598
  ↓
Voice Resolver / getVoiceAudio     PASS  200  199468
  ↓
Music Resolver / getMusicAudio     PASS  200  923984  （与独立 Music API 同一函数）
  ↓
mixPcm16(voiceDelayMs=0)           PASS  SHA1 与本地 mix 一致；voice 已写入 mix
  ↓
【断点】GIL_598 Music 前 121 ms 近似静音，前 200 ms RMS=315
        Voice 前 200 ms RMS=6891
        mix 前 200 ms RMS=6896 ≈ 纯 Voice
        对照 GIL_692 mix 前 80 ms maxMusicAbs=11429（BGM 一开始就在）
        对照 EX1_116 mix 前 200 ms 是音乐床（voice 还在 87 ms 静音里）
  ↓
PlayerController 单 URL            未分叉；不是双轨互停
  ↓
iOS download（若 iOS）             只下一张 mixed WAV；不是双下载互盖
```

PCM 层：voice **没有** 被截掉（`truncated=false`，前 80 ms `mixedDiffersFrames=5320/5320`）。0.5 s 之后 Music RMS 已到 3349，voice 段（0–2077 ms）Music RMS 4538，voice 结束后 mix RMS 2778 ≈ `3968 × 0.7`。音乐在文件后半段在。

听感断点在 **组合起音**：苔丝 combo 的前 ~200 ms 听起来像「只有语音」；里诺艾/吉恩 combo 的前 ~200 ms 已经能听到 BGM。独立「登场音乐」没有语音抢起音，听完整 stinger 就正常。

历史机制（1.4.5 之前，现已不在 live 响应里）：`getMusicAudio` 失败时 Entrance 直接返回 Voice 文件且 URL 不变，`Cache-Control: max-age=86400`。若真机仍缓存那次 199468 字节的 entrance，会把 combo 听成纯语音。本次对 Mini 的 GET 返回的是 923984 字节 mix，不是那条旧回退。

## 15. 根因分类

**Root Cause: CATEGORY A**

定义对齐：Voice 正确、Music 正确，但「Entrance Combo」并不是第三条独立资源，而是 `delay=0` 把两条轨道叠在一起。GIL_598 实际使用的 stinger（GUID 对应 `Gilneas_Play_Stinger_2`）起音包络与吉恩 `Stinger_4`、里诺艾 Pegasus stinger 不同——前 121 ms 近似静音。Combo 引用的不是「另一张错误卡」，而是 **同一 Music 轨道 + 通用 mix 时序**，在这张卡上造成「组合听感 ≠ 独立 BGM + 独立 Voice」。

排除：

- **CATEGORY B**：`/music/GIL_598` 与 Entrance 内 `getMusicAudio` 同一解析；Entrance SHA1 = `mixPcm16(当前 Voice, 当前 Music)`。无 Resolver 分叉。
- **CATEGORY C**：完整登场只有一条 URL、一个 InnerAudioContext、一个 session。不是 Voice download 被 Music `src=` 盖掉。
- **CATEGORY D**：完整登场只下载 mixed WAV。不存在两条 tempFilePath 互盖。

## 16. 是否涉及 1.3.9

iOS 生产路径（HTTP → `wx.downloadFile` → `wxfile` → InnerAudioContext）适用于 **这一条** entrance URL，与独立 Music 相同。

**不是本问题断点。** 1.3.9 没有为 combo 做双轨下载。

## 17. 是否涉及 Resolver

当前 live：Voice / Music Resolver 均命中，Entrance 复用二者。

**不是本问题断点。** 1.4.5 的 GUID/Name 修复已经让 Music API 与 Entrance 内的 `getMusicAudio` 同时成功。

## 18. 是否涉及 PlayerController

完整登场路径：单实例、单 session、teardown 替换。与 EX1_116 相同。

**不是完整登场路径的断点。**

若用户在详情页先后点「登场语音」和「登场音乐」两个 `audio-button`，第二条会停掉第一条——那是分轨互斥，不是「完整登场」按钮。

## 19. 是否涉及数据源

涉及的是 **Music clip 的时间包络 + 通用 mix 配置**，不是错误 cardId：

- 索引 `delaySec` 全为 0，且 `timingVerified: false`；mix **没有** 读取任何卡牌级 delay。
- 索引 clip 名仍是 `Gilneas_Play_Stinger_6`；实际 PCM 是 `Gilneas_Play_Stinger_2`（1.4.5 已确认这是该 GUID 的真实 clip）。
- 不存在名为 Entrance Combo 的第三份 Hearthstone 资源。

## 20. 修复建议（只描述，不实施）

1. 不要给 `GIL_598` 写 CardID 特判。
2. 若目标是「组合起音也能听到 BGM」：用 **通用** mix 策略处理「音乐 leading silence / 语音抢起音」（例如按音乐起音对齐 voiceDelay，或按两边 RMS 决定 duck/delay），版本号已有 `ENTRANCE_MIX_VERSION`。
3. 若目标是对齐炉石官方时序：先验证 MusicStinger/PlayMaker 的真实 delay（索引 `timingVerified: false`），再让 mix 读取 **通用** delay 字段，而不是写死 0。
4. 若真机仍像纯语音：同一 entrance URL 在 1.4.5 前返回过 Voice-only，`max-age=86400`；换 cache bust 或清微信/iOS 对该 URL 的缓存后再听 live mix。
5. 不要把 combo 改成客户端双 InnerAudioContext 来「修复」本问题；当前架构是服务端一条 WAV。

## 21. 修改文件

本阶段唯一正式新增：

```text
data/card-verification/phase-1.4.6-report.md
```

生产代码 / 测试 / 索引 / 音频：**0 修改**。

临时探测脚本已删除。对 `GET /api/audio/entrance/GIL_598` 会使 Mini 按既有逻辑写入 `tmp/preview/GIL_598_entrance_v2.wav`（运行时缓存，与用户点击完整登场相同）。

本仓库无 `.git`，无法用 `git diff` 证明；调查过程未改任何 `.js` / `.wxml` / `.wxss` / `.json` / Extractor / Resolver / Player / API / Catalog。

## 22. npm test

未跑。本阶段验收标准是定位断点，不是测试变绿，也不能把测试通过解释成 combo 已修复。

---

## 必须验证的关键结论

### Q1

GIL_598 的 Voice 是否正常？

```text
YES
```

### Q2

GIL_598 的独立 Music 是否正常？

```text
YES
```

### Q3

GIL_598 的 Entrance Combo 使用什么 API？

```text
GET /api/audio/entrance/GIL_598
```

服务端 `EntrancePreviewService.getEntrancePreview` → `mixPcm16(getMusicAudio, getVoiceAudio)`。

### Q4

Entrance Combo 是否真正使用了 `/api/audio/music/GIL_598`？

```text
NO
```

客户端不请求该 HTTP。服务端调用同一函数 `AudioService.getMusicAudio('GIL_598')`，与 Music 路由相同。现场 Entrance SHA1 等于用 `/music` 与 `/voice/.../play` 两份 WAV 本地 mix 的结果。

### Q5

Voice 和 Music 是否使用独立 InnerAudioContext？

```text
NO
```

完整登场只有一个 context、一条 mixed URL。`createInnerAudioContext` 生产路径仅 `miniprogram/utils/player.js`（诊断页另有独立实例，正常页不用）。

### Q6

是否存在 session / stop / destroy 互相影响？

```text
YES（单实例替换：新播放 teardown 旧播放）
NO（完整登场内部 Voice 与 Music 各持一个 session 互杀 —— 该路径不存在两条并行播放）
```

### Q7

问题发生在哪一层？

```text
数据（stinger 起音包络）+ API/Mixer（EntrancePreviewService mixPcm16，voiceDelayMs=0）
```

不是 Extractor，不是 Resolver 分叉，不是独立 Music/Voice API，不是 Player 双轨，不是 iOS 双下载。

### Q8

为什么纯 BGM 正常，而登场 BGM + Voice 异常？

独立 Music 没有语音抢前 121 ms 的静音头，听者听到完整 `Gilneas_Play_Stinger_2`。

完整登场把立即起音的 Voice（前 200 ms RMS 6891）叠在仍接近静音的 Music（前 200 ms RMS 315）上，mix 前 200 ms RMS 6896，听感等于「只有语音起音」。吉恩/里诺艾的 Music 在同一窗口已经有高能量，所以组合一开始就像「音乐 + 语音」。PCM 上 Voice 已被写入 mix，并不是 Music API 成功而 Entrance 找不到 BGM。
