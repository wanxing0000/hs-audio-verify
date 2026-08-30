# Phase 1.3.2 Report

Generated: 2026-08-29

`C:\Hearthstone` was not modified. Indexes were not modified. No bulk WAV export.

---

## A. 吞首字根因

**Root Cause B + C**（主因 B：首次解码/播放时序；伴随 C：同一 InnerAudioContext 冷启动生命周期）

证据（不是猜测）：

1. **WAV 本身完整（排除 Root Cause A）**  
   `BOT_548` Voice-only：48 kHz / PCM16 / 4757 ms。前 20–50 ms 接近静音（预卷），**100 ms 峰值 22379**。  
   Entrance mix：`truncated = false`，200 ms 窗口 `mixedDiffersFrames = 12276`，时长不被缩短。  
   语音「团」在文件 58 ms 之后，混音文件里同样存在。

2. **用户对照**  
   冷启动直接点完整登场会吞「团」；先播纯登场语音再播完整登场则不吞。  
   同一 Entrance WAV、同一 HTTP 200。服务端混音/音量无法解释「第二次就好」。

3. **当时播放器代码**  
   `ctx.src = url` 后立刻 `ctx.play()`。`onCanplay` 只把状态标成 playing，并不等待解码完成再 play。  
   这与微信 InnerAudioContext 首次播放丢掉文件开头的已知时序一致。

4. **HTTP 不是瓶颈**  
   已缓存的 Entrance：`BOT_548` 22 ms / 4 ms，RIFF PCM16。首次吞字发生在播放端，不是「第一次生成 WAV」。

没有把 +100 ms leading silence 做成生产修复。诊断文件 `tmp/audio-verification/BOT_548/entrance-padding100.wav` 仅用于对照：padding 后前 100 ms 全 0，那是实验，不是官方时序。

---

## B. A/B/C/D 实验结果

| 实验 | 是否吞首字 | 结论 |
| --- | --- | --- |
| A 冷启动直接 Entrance | 用户复现：会 | src 后立即 play；WAV 完整；HTTP 已缓存仍会吞 |
| B Voice 后 Entrance | 用户复现：不会 | 同一 Context 已被成功解码过；不能当修复（禁止偷偷先播 Voice） |
| C Entrance 预加载（不播放） | 代码：详情页 preload → ready → 点击 play | 不自动播放、不 0 音量预热 |
| D onCanplay 后再 play | 生命周期模拟 **5/5** | `playCount` 在 canplay 之前必须为 0 |

Node 无法驱动微信 InnerAudioContext 听感。`test/entrancePlaybackLifecycle.test.js` 对 BOT_548 URL 做了 5 次冷启动状态机模拟：**5/5** 均为 canplay 之后才 `play()`，`startTime = 0`。

微信开发者工具需重新编译后做听感确认。本阶段没有用「先偷播 Voice」当修复。

---

## C. 最终修复方案

通用播放器状态机（`miniprogram/utils/playerController.js`）：

- `src` 之后 **等待 onCanplay**，再 `startTime = 0` 并 `play()`
- `preload(url)`：只加载到 `ready`，不播放
- 详情页仅对 **当前卡** 的 Entrance 预加载
- 首页/搜索不预加载列表
- 忽略重复 canplay；`ctx.src !== state.src` 的旧回调丢弃
- **CardID 特判 = NO**
- **未再降低 Music volume**
- **未加 Voice delay / 生产 leading padding**

---

## D. BOT_548

- WAV：Voice 完整；Entrance 未截断  
- 生命周期冷启动模拟：**5 / 5**  
- 微信听感 5/5：需开发者工具重编译后由用户确认（本环境不能操作 InnerAudioContext）

---

## E. EX1_116 / EX1_572

同样走统一播放器，无 CardID 分支。Phase 1.3.1 已证明这两张 Voice-only 完整、mix 不截断。EX1_572 语音甚至从 36 ms 就有高峰，更依赖首次 play 时序。

---

## F. 无音频卡诊断（可收藏卡）

`getCardAudioAvailability`（索引层，不扫游戏目录）：

| 分类 | 数量 | 含义 |
| --- | --- | --- |
| full | 1064 | Play+Attack+Death+Music 索引均可用 |
| partial | 3739 | 部分槽位可用（如 ETC_409 有 Play 无 Music） |
| none | 2527 | 标准槽位都没有 |
| special_audio_system | 824 | 英雄等特殊系统且无 Play，不伪装成登场语音 |
| clip_not_indexed | 0 | 有 voiceKey 但 audio-index 无 clip |

验收卡：

- **HERO_01**：`special_audio_system`，Play 无，Entrance 无；提示「该卡使用特殊语音系统…」；Attack/Death 仍显示  
- **CAP_107**：索引有 token 语音；提取失败时 API **404 暂时无法播放**（不是「无语音」）  
- **ETC_409**：Play 有、Music 无、无完整登场  

---

## G. 修改 / 新增 / 删除

**修改**

- `miniprogram/utils/player.js`
- `miniprogram/pages/card/card.js` / `card.wxml` / `card.wxss`
- `miniprogram/components/audio-button/audio-button.js` / `.wxml` / `.wxss`
- `src/miniprogram/catalogAdapter.js`
- `src/miniprogram/miniServer.js`
- `src/validation/audioIntegrity.js`（20/100 ms 窗口）
- `package.json`

**新增**

- `miniprogram/utils/playerController.js`
- `src/miniprogram/audioAvailability.js`
- `test/entrancePlaybackLifecycle.test.js`
- `test/audioAvailabilityDiagnostic.test.js`
- `data/audio-verification/phase-1.3.2-report.md`
- `data/audio-verification/phase-1.3.2-results.json`
- 诊断 WAV：`tmp/audio-verification/BOT_548/entrance-padding100.wav`

**删除**：无

---

## H. 数据索引

- `card-audio-index.json`：**未修改**
- `card-voice-index.json`：**未修改**
- `audio-index.json`：**未修改**
- `music-assets.json`：**未修改**

---

## I. C:\Hearthstone

是否修改：**NO**

---

## J. 音频导出

是否全量导出：**NO**  
继续：按需提取 + `tmp` 缓存。
