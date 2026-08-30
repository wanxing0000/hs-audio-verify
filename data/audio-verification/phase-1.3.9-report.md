# Phase 1.3.9 iOS Audio Playback Path Fix

## 1. 本阶段目的

把 1.3.8 真机已确认的路径接入生产播放器：iOS 上 remote HTTP 不再直接交给 InnerAudioContext，改为 `downloadFile → tempFilePath → src → play`。非 iOS 保持原 HTTP 直播。

自动化测试只验证调用顺序与 session 防护。真机验证：**NOT YET VERIFIED / MANUAL REQUIRED**。

## 2. 生产播放链路（修改前分析）

1. remote URL 来自 `miniprogram/utils/audio.js`（`getVoiceUrl` / `getMusicUrl` / `getEntranceUrl` / `getQuickPlayUrl`）。首页 `card-item`、详情 `audio-button` / `card.js` 调用 `app.player.playAudio({ url, key, type, cardId })`。
2. 真正设置 `InnerAudioContext.src` 与 `play()` 的位置在 `playerController.js`：`loadSrc` 赋值 src，`canplay` 之后 `actuallyPlay` → `ctx.play()`。
3. 职责：`audio.js` 只拼 URL；`player.js` 是微信适配（创建 InnerAudioContext）；`playerController.js` 是状态机 / session token。
4. iOS download fallback 放在播放抽象层：`player.js` 提供 `wx.downloadFile`，`playerController.js` 按 platform 决定是否下载，并用已有 session 丢弃过期结果。
5. 已有：session token、stop/destroy teardown、单实例 context。没有生产 downloadFile，没有音频缓存。

## 3. 修改后播放架构

iOS + remote HTTP：

```
remote URL → wx.downloadFile → tempFilePath → InnerAudioContext.src → canplay → play()
```

Non-iOS：

```
remote URL → InnerAudioContext.src → canplay → play()
```

业务层仍只调用 `playAudio` / `play` / `stop` / `destroy`。

## 4. 自动化测试

`npm test`：**PASS**

新增 `test/audioPlayerIosDownload.test.js`，覆盖至少 TEST 1–7（iOS 走 download、non-iOS 直播、success 设 tempFilePath、download fail → error、过期 download 不得覆盖、stop 后不得自动播放、切换播放时旧 download 不得覆盖）。

## 5. 真机状态

**NOT YET VERIFIED**

## 6. 不要进入 1.4

代码完成但真机尚未验证。停在 Phase 1.3.9。
