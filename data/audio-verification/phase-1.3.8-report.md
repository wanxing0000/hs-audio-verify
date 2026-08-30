# Phase 1.3.8 iOS 真机音频最小链路兼容性实验

## 1. 本阶段目的

回答：iOS 微信 `InnerAudioContext` 直接播 LAN HTTP WAV 失败时，若先 `wx.downloadFile` 到 `tempFilePath` 再播本地文件，是否可以出声。HTTP 直播必须保留为对照。本阶段不修改生产播放器。

## 2. 真机环境（用户已提供，FACT）

- platform = ios
- system / iOS 18.3.2
- 微信 8.0.76
- SDKVersion = 3.17.1
- iPhone 14
- Wi-Fi
- API `http://192.168.0.111:8767`

## 3. HTTP API 验证（用户已提供，FACT）

health / Voice / Music / Entrance = HTTP 200，`content-type = audio/wav`。手机浏览器可直接打开 WAV。

## 4. TEST A 结果

**FACT（1.3.7 真机 InnerAudioContext，HTTP Voice）：**

- canplay，currentTime = 0，duration = 0，paused = true
- 随后 error errCode = **10002**，errMsg = `INNERERRCODE:-11850, ERRMSG:操作已停止`
- 无有效 onPlay / timeUpdate
- 分类：**PLAY_NEVER_STARTED**
- 真机无声音

1.3.8 页面可用「A HTTP Voice」复测同一路径。本仓库执行时**未再采集新的 A 日志**。

## 5. TEST B 结果

**FACT（1.3.7 真机，HTTP Entrance / Music 同类）：** 三种 WAV 均相同 10002 / -11850。分类 **PLAY_NEVER_STARTED**。

1.3.8「B HTTP Entrance」用于复测。新日志 **UNKNOWN（本环境未跑）**。

## 6. TEST C 结果

downloadFile → tempFilePath → Voice：**真机尚未执行 1.3.8 C。UNKNOWN。**

## 7. TEST D 结果

downloadFile → Entrance：**UNKNOWN（真机尚未执行）。**

## 8. TEST E 结果

本地 stat：**UNKNOWN（真机尚未执行）。** API 不支持时页面记 NOT_SUPPORTED，不伪造。

## 9. TEST F1 结果

HTTP 基准 WAV `/api/audio-test/tone.wav`：**UNKNOWN（真机尚未执行）。**

## 10. TEST F2 结果

downloadFile → 基准 WAV：**UNKNOWN（真机尚未执行）。**

## 11. BOT_548 音频格式（只读已有 WAV，未重新生成）

Voice `VO_BOT_548_Male_Mech_Play_02.wav` / `tmp/audio-verification/BOT_548_voice.wav`：

- RIFF PCM（audioFormat = 1）
- 48000 Hz，mono，16-bit
- data size 456654，duration ≈ 4.757 s

Entrance `BOT_548_entrance_v2.wav`：

- RIFF PCM
- 48000 Hz，stereo，16-bit
- data size 1255284，duration ≈ 6.538 s

## 12. 基准 WAV 格式

`test/assets/test-tone-44100-mono.wav`：PCM 16-bit，44100 Hz，mono，440 Hz 正弦，1.5 s，132344 bytes。诊断专用，非炉石资源。

## 13. PLAY_NEVER_STARTED / PLAY_STARTED / PLAYING_CONFIRMED

已实现于 `classifyPlayVerdict`。已有真机 HTTP 直播证据 = **PLAY_NEVER_STARTED**。C/D/F 无真机事件，不能标 PLAY_STARTED。

## 14. 错误码

已观测（HTTP 直播）：**10002** / INNERERRCODE **-11850** / 操作已停止。download 路径错误码 UNKNOWN。

## 15. 实验矩阵

| 测试 | 来源 | 播放方式 | 真机 1.3.8 |
|---|---|---|---|
| A | HS Voice | HTTP URL | 沿用 1.3.7：失败 10002（FACT） |
| B | HS Entrance | HTTP URL | 沿用 1.3.7：失败 10002（FACT） |
| C | HS Voice | downloadFile → temp | UNKNOWN |
| D | HS Entrance | downloadFile → temp | UNKNOWN |
| F1 | 440Hz test tone | HTTP URL | UNKNOWN |
| F2 | 440Hz test tone | downloadFile → temp | UNKNOWN |

## 16. FACT

- LAN API 200 + 浏览器可播 WAV。
- iOS 微信 InnerAudioContext **HTTP src** 对 Voice/Music/Entrance 均 canplay(duration=0) 后 10002，无声音。
- HS WAV 为标准 PCM16（Voice 48k mono，Entrance 48k stereo）。
- 生产播放器本阶段未改。

## 17. HYPOTHESIS（未证实）

若 C/D 成功而 A/B 仍失败：可能是 **InnerAudioContext 播 LAN HTTP WAV** 的兼容问题，而非文件损坏。若 F1/F2 成功而 C/D 失败：可能与 48 kHz / stereo HS WAV 有关。若 F1/F2 也失败：问题更底层（基础库 / iOS 音频会话）。**均未用 1.3.8 按钮跑完，不得当作结论。**

## 18. UNKNOWN

C/D/E/F1/F2 真机结果；downloadFile statusCode 与 temp 文件 size；本地播放是否 onPlay/timeUpdate；HTTP 直播失败的微信内部原因。

## 19. npm test

见执行记录。要求 PASS。

## 20. 修改文件

- `miniprogram/pages/audio-test/*`
- `src/miniprogram/miniServer.js`（仅新增 `/api/audio-test/tone.wav`）
- `test/audioDiagnostic.test.js`（默认卡与按钮文案）
- `test/audioDiagnostic138.test.js`
- `package.json` test 脚本
- `test/generate-test-tone.js`、`test/assets/test-tone-44100-mono.wav`
- `data/audio-verification/phase-1.3.8-report.md`

## 21. 未修改文件

player.js、playerController.js、audio.js（URL 助手未改）、index/card 生产播放、catalogAdapter、audioService、Extractor、Resolver、全部生产 index、混音、C:\Hearthstone。

## 22. C:\Hearthstone

UNCHANGED

## 23. 是否修改生产播放器

NO
