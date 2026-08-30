# Phase 1.4.8 Report

## 1. 修改文件

| 文件 | 修改内容 | 原因 |
| --- | --- | --- |
| `src/music/entranceMixConfig.js` | `ENTRANCE_MIX_VERSION` 2→**3**；新增 `MAX_MUSIC_START_COMPENSATION_MS=150`、`MUSIC_START_WINDOW_MS=10`、`MUSIC_START_PEAK_THRESHOLD=500`、`MUSIC_START_RMS_THRESHOLD=200`、`MUSIC_START_CONSECUTIVE_WINDOWS=2` | 全局配置；缓存失效；禁止魔法数字散落 |
| `src/music/findMusicStartCompensation.js` | **新增**纯函数：有限窗口检测 + cap + stereo frame 切片 | Entrance Combo 专用补偿，无 CardID、无 IO |
| `src/services/entrancePreviewService.js` | Voice+Music mix 前对 Music **拷贝切片**；失败则用原 Music | 只影响 Entrance；不写回 Music 缓存 |
| `test/musicStartCompensation.test.js` | **新增** TEST 1–10 | 算法、cap、回归、Music 不被污染 |
| `test/entranceAudioIntegrity.test.js` | 要求 version ≥ 3 且 cap=150 | 回归 mix 配置 |
| `test/cardAudioException.test.js` | helper/config 禁止 CardID / GIL_598 | 防特判回归 |
| `package.json` | 接入 `test/musicStartCompensation.test.js` | 纳入 `npm test` |

未改 `mixPcm16.js`：切片后仍调用原 `mixPcm16(slicedWav, voiceWav, ENTRANCE_MIX)`。`voiceDelayMs` 仍为 0。

## 2. 未修改的重要文件

- Music API / `AudioService.getMusicAudio`（调用路径未改）
- Voice API
- Resolver / Extractor / 索引 / Catalog / UI
- Player / PlayerController / iOS download
- 独立 Music WAV 文件（`tmp/music/GIL_598_MusicStinger.wav` SHA1 未变）

## 3. 补偿算法

仅分析 Music PCM 的 **[0, 150 ms]**，禁止继续往后扫。

- 窗口：`MUSIC_START_WINDOW_MS` = **10 ms**（hop = 窗口长）
- 声道：按 **frame** 扫全部声道的 peak / RMS（stereo 不拆开裁）
- 窗口“可听”：`peak ≥ 500` **或** `RMS ≥ 200`
- 持续：连续 **2** 个可听窗口后，补偿起点 = 该连续段的 **第一个窗口起点**
- 找不到则 **compensation = 0**（长静音不裁到 590 ms，也不强制裁满 150 ms）
- 解析失败 / 非 PCM16 / 异常 format：**fallback，不补偿，不抛错**
- 切片：`skipFrames * channels * 2` 字节，`Buffer.from` 新 WAV；**不修改**入参 buffer，**不写回** Music 缓存

## 4. GIL_598 实际结果

通用算法（不是 CardID、不是固定 121）：

```text
compensationMs = 110
compensationFrames = 5280
compensationBytes = 21120
sampleRate = 48000
channels = 2
maxCompensationMs = 150
fallback = false
```

110 ms 是 10 ms 窗口 + 连续 2 窗的交点，不是调查时 peak>500 的 121.27 ms。

源码路径 Entrance mix SHA1 `0d49c58f…` ≠ Voice `66a7f60c…` ≠ Music `fa81027d…`。仍是 Combo。

## 5. 正常卡回归

| 卡 | compensationMs | Entrance |
| --- | ---: | --- |
| GIL_692 | **10**（≤40，未大面积删前奏） | mix 成功 |
| EX1_116 | **30** | mix 成功，48 kHz WAV |

## 6. 长静音保护

构造 590 ms / 800 ms 静音后再出声：onset 在 cap 之外 → **compensationMs = 0**（≤150，且不是裁掉 590）。测试覆盖 TEST 2/3。

## 7. 独立 Music 验证

- `GET /api/audio/music/GIL_598` 行为未改代码。
- 磁盘 `GIL_598_MusicStinger.wav` SHA1 在 Entrance 生成前后均为 `fa81027d4c80ba9a8ed5d19b822e734327b85233`（与 1.4.6 相同）。
- `applyMusicStartCompensation` 不 mutate 原 buffer。

## 8. 缓存

`ENTRANCE_MIX_VERSION`：**2 → 3**

key：`{cardId}_entrance_v3`。旧 `*_entrance_v2.wav` 不再命中。

当前运行中的 Mini（若未重启）仍可能是旧 bundle + v2 缓存；源码与 `npm test` 已用 v3。**需重新 `npm run mini` 后 HTTP 才返回新 Combo。**

## 9. npm test

**PASS**

## 10. 真机状态

```text
NOT YET VERIFIED
MANUAL REQUIRED
```

未在手机上听。自动测试 ≠ 真机听感。

HTTP 抽查（未重启 Mini）：Voice/Music/Entrance 对 GIL_598、GIL_692、EX1_116 均为 200；ETC_409 Music/Entrance 404。该进程的 Entrance 体积仍等于旧 Music（923984），说明 **8767 尚未加载 v3**。源码 in-process mix 已补偿。

---

验收清单：

- [x] GIL_598 Entrance Combo 仍能生成
- [x] GIL_598 Music 独立播放不变
- [x] 没有 CardID 特判
- [x] 没有固定 121ms 特判
- [x] 补偿有严格 MAX 上限 150
- [x] 长静音不会被无限裁切
- [x] GIL_692 正常
- [x] EX1_116 正常
- [x] ETC_409 行为不变（404）
- [x] PCM stereo frame 对齐
- [x] Entrance 缓存版本升级 v3
- [x] npm test PASS
- [x] 不把自动测试当成真机听感验证
- [x] 停止在 Phase 1.4.8
