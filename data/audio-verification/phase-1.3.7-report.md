# Phase 1.3.7 真机最小音频播放诊断报告

本阶段只提供诊断页与日志，**不修复播放器**。本环境没有微信真机实听数据。

## A. API 层

手机浏览器此前已确认：

- `http://192.168.0.111:8767/api/audio/voice/EX1_116/play` 可打开
- `http://192.168.0.111:8767/api/audio/entrance/EX1_116` 可打开

诊断页「检查 API」对 health / voice / music / entrance 做 GET，只记录 status、content-type、content-length，不把 WAV 正文写入页面 data。

## B. WAV 层

Phase 1.3.5 / 1.3.6 已证明 EX1_116、BOT_548 的 Voice / Music / Entrance WAV 完整。本阶段不重做提取、不改 Extractor。

## C. 微信开发者工具层

诊断页已注册，可用开发者工具打开。**本仓库执行环境未运行微信开发者工具实听。** 不得把工具结果写成已完成。

## D. 微信真机层

**真机尚未完成实际验收。** 不得猜测 InnerAudioContext 在手机上的 canplay / 首字 / error。

## E. InnerAudioContext 生命周期

诊断页使用独立 `wx.createInnerAudioContext()`，记录：

create, src, canplay, play, timeUpdate, ended, stop, destroy, error(errCode/errMsg)

并在可获得时附带 currentTime / duration / paused / src。

不调用 `miniprogram/utils/player.js` / `playAudio()`。

## F. Voice

按钮「测试 Voice」→ `/api/audio/voice/:cardId/play`。默认卡 EX1_116，query `id=BOT_548` 可换卡。

## G. Music

按钮「测试 Music」→ `/api/audio/music/:cardId`。同一套诊断播放器。

## H. Entrance

按钮「测试 Entrance」→ `/api/audio/entrance/:cardId`。只播服务端混音 WAV，前端不再混音，不同时开两个 InnerAudioContext。

## I. 冷启动

「A：冷启动直接 Entrance」：打开页后若不先播 Voice/Music，直接播 Entrance，日志 `coldStart` / `attempt = 1`。无 onLoad 自动播放。

## J. Voice → Entrance

「B」先播 Voice；用户再点「测试 Entrance」。日志 sequence = `VOICE → ENTRANCE`（若 Voice 已 started）。不自动接 Entrance。

「C」先播 Voice，等 `ended` 后再点 Entrance。sequence = `VOICE_ENDED → ENTRANCE`。

## K. 第二次 Entrance

「Entrance 再播一次」与「D」：先 destroy，再 new InnerAudioContext。记录 `attempt`。

## 听感

BOT_548 显示「请仔细听第一字：团」。用户可点「记录：正常 / 吞首字 / 无法播放 / 不确定」，以及 FIRST_PLAY_DIFFERENCE / SEQUENCE_DEPENDENT_BEHAVIOR / PLAYER_PLAYED_BUT_INAUDIBLE。不写入生产 index。

## 安全

C:\Hearthstone 未改。生产 index 未改。正式播放器未改。无批量导出。无 CardID 生产特判。

## 真机结论

真机尚未完成实际验收。DevTools 实听亦未在本环境执行。
