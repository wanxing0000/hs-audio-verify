# Phase 1.3.5 音频链路诊断报告

## 1. Executive Summary

现在真正有 **两个已证明的问题**，外加一个 **未在真机上证明的播放器问题**：

1. **格罗玛什 / 暴龙王随从：有索引、有 UI 按钮，但 FSB→WAV 提取失败，因此 Mini API 404。** 用户点按钮会「暂时无法播放」。断点在 **Extractor（读到非音频/错误 bundle 的 FSB 指针越界）**，并伴随 **audio-index 缺少 zhcnBundles**（`indexMismatch`，本阶段不修索引）。
2. **奇利亚斯「团」已经在 Voice / Entrance WAV 里。** 首字不是文件被截断。先 Voice 再 Entrance 变正常，与微信 InnerAudioContext 冷启动更吻合，**真机仍要实验页才能定性**。
3. **Phase 1.3.4 对真机吞字：INCONCLUSIVE。** HTTP 200 ≠ 微信真机可播完整首字。

PRODUCTION CHANGES = 0。未改 index。未改 C:\Hearthstone。未全量导出。

## 2. 格罗玛什

主卡 **EX1_414**（随从，dbfId=338）。CORE_EX1_414 / VAN_EX1_414 共用同一 VoiceKey / MusicClip。

| Layer | Play | Music | Entrance |
|---|---|---|---|
| CardDef / Index | FOUND `VO_EX1_414_Play_01` | FOUND `Pegasus_Stinger_Horde1` guid `8a14ada1…` | FOUND（UI 需要 Play+Music） |
| AudioClip 索引 | FOUND，**zhcnBundles=[]** | FOUND | — |
| Bundle 文件 | FOUND `essential_base_global-prefab-0.unity3d` 等 | FOUND 同上类 prefab | — |
| FSB→WAV | **FAILED** `End position (184546655) out of boundary (11514864)` | **FAILED** 同类越界 | FAILED（依赖 Play+Music） |
| Mini API | 404 | 404 | 404 |
| UI 按钮 | **显示** | **显示** | **显示** |

分类：Audio Exists but Extraction Failed。  
失败点：**Extractor**（API 404 是提取失败的结果，不是独立协议 bug）。  
`indexMismatch = true`：对比火车王 Play 有 `playsound_base_zhcn-…-audio-0.unity3d`，格罗玛什 Play 的 zhcnBundles 为空，索引指向 prefab/content 包，提取器按 FSB 去读会越界。本阶段 **不修索引**。

不要和 **HERO_01 加尔鲁什·地狱咆哮** 混为一谈：那是英雄表情系统，没有随从 Play。若用户搜「地狱咆哮」打开英雄卡，那是另一条「No Audio Data / special_audio_system」路径。

## 3. 暴龙王

名称检索 `暴龙王克鲁什` 得到（未猜测 CardID），主随从：

- **EX1_543** dbfId=1144 MINION LEGENDARY
- **CORE_EX1_543** dbfId=69601
- **VAN_EX1_543** dbfId=69968
- 以及英雄/佣兵等同名卡（如 `HERO_05am_KingKrush_h`：Play/Music/Entrance 均为 No Audio Data / special）

随从 EX1_543：

| Layer | Play | Music | Entrance |
|---|---|---|---|
| Index | FOUND `SFX_EX1_543_EnterPlay` | FOUND `Pegasus_Stinger_Beast_Villain` | FOUND |
| zhcnBundles | **[]** | 以 prefab 为主 | — |
| FSB→WAV | FAILED 越界 `End position (104000058) out of boundary (900972)` | FAILED 越界 | FAILED |
| API | 404 | 404 | 404 |
| UI 按钮 | 显示 | 显示 | 显示 |

失败点：**Extractor**（同样有 indexMismatch：无可用 zhcn audio bundle 却去解 prefab 中的 FSB 指针）。

## 4. 奇利亚斯

**BOT_548**（及 CORE_BOT_548 共享；TOY_330 为豪华版 3000 型，独立 VoiceKey）。

| Layer | Play | Music | Entrance |
|---|---|---|---|
| Index | FOUND `VO_BOT_548_Male_Mech_Play_02` | FOUND `Zilliax_Play_Stinger` | FOUND |
| Extract | SUCCESS | SUCCESS | SUCCESS |
| API | 200 WAV | 200 WAV | 200 WAV |
| UI | 显示 | 显示 | 显示 |

分类：Successfully Playable（仅表示文件+API+按钮；**不是真机听感验收**）。

保存：`tmp/audio-verification/BOT_548_voice.wav` / `_music.wav` / `_entrance.wav`（从缓存复制，未改生产提取逻辑）。

## 5. 火车王

Positive control **EX1_116**：Play/Music/Entrance 全链路 SUCCESS，API 200。  
Play 命中 bundle：`playsound_base_zhcn-775a814d-audio-0.unity3d`（有 zhcnBundles）。

## 6. 伊瑟拉

Positive control **EX1_572**：Play/Music/Entrance SUCCESS，API 200。

## 7. 随机样本

由 `card-audio-index.json` 按 CardID 排序等距抽取（非人工点名）：

- 10 张有 Play+Music+Entrance 的传说
- 10 张有 Play 无 Music
- 10 张 `extraction_failed` 诊断（若不足则较少）

详见 `phase-1.3.5-results.json` 的 `random`。

## 8. Voice Failure Classification

对本阶段样本合计：

| 分类 | 数量 |
|---|---|
| No Audio Data | 3 |
| Audio Exists but Extraction Failed | 12 |
| API Failed | 1 |
| UI Hidden | 0 |
| Player Failed | 0（Node 不能判微信播放器） |
| Successfully Playable | 24 |

格罗玛什/暴龙王随从属于 **有按钮 + 提取失败**，不是 UI Hidden。

## 9. Music Failure Classification

No Audio Data 16；Extraction Failed 9；Successfully Playable 15。

## 10. Entrance Failure Classification

No Audio Data 16；Extraction Failed 9；Successfully Playable 15。Entrance 失败随 Play/Music 提取失败。

## 11. 首字实验

程序测量（不是只靠听）：

- BOT_548 Voice first energy = **57.9 ms**，peak100ms = 22379（「团」在 Voice WAV 前部：**YES**）
- BOT_548 Entrance first energy（含 Music 起音）= **50.4 ms**
- compareVoiceStartInMix：`truncated = false`，`voicePresentInWindow = true`  
  Entrance WAV 里 Voice 起始能量在：**YES**

TEST A 直接 Entrance / TEST B Voice→Entrance / TEST C canplay+seek(0)：Node **不能**跑 InnerAudioContext。必须在真机实验页记录 currentTime 日志。

## 12. 真机实验页面

1. 电脑 `npm run mini`，手机同一 Wi-Fi。
2. 微信开发者工具编译本项目（`urlCheck: false`）。
3. 打开：`pages/audio-test/audio-test?id=BOT_548`（可改 id）。
4. 页面用 `getApiBase()`，真机走 LAN，**不要写死 192.168.0.111**。
5. 按钮：播放 Voice / Music / Entrance；直接 Entrance（TEST A）；Voice → Entrance（TEST B）；TEST C canplay+seek0。

这是开发实验页，不是正式首页。

## 13. Phase 1.3.4 是否有效

**INCONCLUSIVE**

WAV 完整不能推出真机第一次 Entrance 已修好。未在本环境用微信真机跑 TEST A/B/C。

## 14. Root Cause

已用证据证明：

1. 格罗玛什/暴龙王随从 **不是**「没有资源索引」。Index + UI 都有。失败在 **从错误/非 zhcn-audio bundle 解析 FSB 时指针越界**，故 WAV 未生成，API 404。
2. 奇利亚斯 **不是** Entrance WAV 缺「团」。Voice 57.9ms 起有能量，混音窗口未截断 voice。
3. 先 Voice 再 Entrance：WAV 不变，只可能是播放器/解码会话；**真机日志未收集，不能写成已证明的 decoder warm-up。**

## 15. Recommended Fix

在后续阶段（非本阶段）才应做：

1. 为 classic `VO_*` / stinger 补全或纠正 **zhcn audio bundle** 索引（本阶段只记 mismatch）。
2. Extractor：跳过明显非 audio 的 prefab bundle，避免把越界当唯一尝试。
3. 真机用 audio-test 页跑 A/B/C，再决定是否改播放器。

本阶段 **不修改** 提取器、API、index、播放器生产逻辑。
