# Phase 1.4.7 Report

## 1. Executive Summary

1. GIL_598 的问题不是 Music WAV「坏了」，也不是 Resolver / mixPcm16 / Player 断了；是 **Entrance Combo 把立刻起音的 Voice 叠在仍处于渐强段的 Music 上**。
2. Phase 1.4.6 的「约 121 ms 静音」来自 `audioIntegrity` 默认阈值 **512**。对本期逐窗 PCM：**不是全 0**。
3. 0–40 ms：peak 1–2，近似底噪；40–200 ms：RMS/Peak **单调上升**（9→42→101→178→287→400→593），左右声道同步。这是 **渐入**，不是突然切开的编码器垫。
4. 「121 ms」= 首次 `|sample|>500` 的时刻（121.27 ms），与阈值 512 对齐，不是文件里有 121 ms 的纯零。
5. 40 张已有 Music WAV、24 个扩展包：`firstPeakOver500` 在 100–150 ms 有 4 张，>150 ms 有 11 张。GIL_598 **不是全库孤例**。
6. 样本中存在真正的长前导静音（提里奥 590 ms 全 0、托什雷 854 ms 全 0、乌达斯塔 296 ms 全 0）。**禁止无上限自动裁掉所有 leading silence**。
7. 当前 **没有** per-card timing 配置；`voiceDelayMs` 全局为 0；**没有** `musicDelayMs` / trim / offset。
8. 独立 Music API 听起来正常，因为听者听完整渐入；Combo 听感差，因为 Voice 前 200 ms RMS 6891 盖过 Music 渐入（前 200 ms RMS 315）。
9. **不要** 给 GIL_598 写 `musicTrimStartMs = 121`。
10. **主推荐**：只在 Entrance Preview 做 **有上限的通用起音对齐**（裁/跳过 Music 低能量头，cap 约 120–150 ms），不改 Music API、不改解码器、不写 CardID。

## 2. Scope

本阶段只调查。未修改生产代码、测试、索引、WAV、Mini、Catalog、Resolver、mixPcm16、entranceMixConfig、Player。

## 3. Current Entrance Architecture

```text
cardId
  ↓
AudioService.getVoiceAudio(cardId, 'play')
  → repo.getCardVoice → extractVoice(voiceKey)
  → tmp/audio/{voiceKey}.wav

cardId
  ↓
AudioService.getMusicAudio(cardId)
  → repo.getMusicMeta（clip 名 + prefab GUID + bundle）
  → extractVoice(audioClip, { prefabGuid, prefabBundle })
  → 缓存 tmp/music/{cardId}_MusicStinger.wav
  → GIL_598：索引名 Gilneas_Play_Stinger_6，GUID 命中 Gilneas_Play_Stinger_2

两条 WAV
  ↓
ENTRANCE_MIX（全局，无 cardId）
  musicVolume: 0.7
  voiceVolume: 1
  voiceDelayMs: 0
  leadingPaddingMs: 0
  targetRate: 48000
  ↓
mixPcm16(musicBuf, voiceBuf, ENTRANCE_MIX)
  重采样 → 声道对齐 → 音量
  music 从 padBytes 处整段 copy
  voice 从 padBytes + voiceDelay 处叠加
  ↓
tmp/preview/{cardId}_entrance_v{ENTRANCE_MIX_VERSION}.wav
```

已确认的能力：

| 项 | 现状 |
| --- | --- |
| voiceDelayMs 默认 | **0** |
| musicDelayMs | **不存在** |
| offset / sourceStartOffset | **不存在** |
| trim / skip music 开头 | **不存在**（整段 musicData.copy） |
| silence handling | **无** |
| per-card override | **无**。`entranceMixConfig.js` 注释写明 Do not special-case CardID。测试也禁止 `cardId ===` |
| leadingPaddingMs | 存在，默认 0；给 **两条轨** 前面垫静音，不是裁 Music |
| musicVolume / voiceVolume | 有（0.7 / 1） |

`mixPcm16` 时间轴：只有「两端共同 padding」+「延迟 Voice」。没有「推迟 Music」或「丢掉 Music 前 N 毫秒」。

生产调用 `mixPcm16` 的只有 `EntrancePreviewService`（另有测试与验证脚本）。

## 4. GIL_598 Waveform Analysis

来源：live `GET /api/audio/music/GIL_598`（200，48 kHz stereo PCM16，4812 ms）。左右声道分开统计。

| 窗口 (ms) | RMS | Peak | 非零% | L RMS | R RMS | L Peak | R Peak |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–20 | 0 | 1 | 1.46 | 0 | 0 | 1 | 1 |
| 20–40 | 0 | 2 | 13.91 | 0 | 0 | 2 | 1 |
| 40–60 | 9 | 38 | 90.52 | 8 | 10 | 35 | 38 |
| 60–80 | 42 | 136 | 99.01 | 45 | 40 | 122 | 136 |
| 80–100 | 101 | 289 | 99.69 | 98 | 104 | 228 | 289 |
| 100–120 | 178 | 476 | 99.74 | 169 | 186 | 476 | 450 |
| 120–140 | 287 | 680 | 99.90 | 258 | 314 | 614 | 680 |
| 140–160 | 400 | 943 | 100 | 336 | 455 | 862 | 943 |
| 160–200 | 593 | 1862 | 100 | 448 | 710 | 1598 | 1862 |

有效起音（多阈值）：

| 准则 | 时刻 |
| --- | ---: |
| 第一个非 0 sample | 2.19 ms |
| peak > 100 | 70.96 ms |
| peak > 500 | **121.27 ms** |
| peak > 1500 | 194.92 ms |
| 20 ms 窗 RMS > 200 | 105 ms |
| 20 ms 窗 RMS > 500 | 160 ms |
| 20 ms 窗 RMS > 1500 | 250 ms |

波形连续性：**C. 渐入**（PROVEN）。0–40 ms 接近底噪（peak≤2），不是「121 ms 全 0」。左右声道同相渐强，不是单声道被平均 RMS 掩盖。

Voice（同卡 play）：firstPeakOver500 = **18.81 ms**，前 200 ms RMS **6891** / peak **15360**。

Music−Voice 起音差（peak>500）：**+102 ms**（语音先响）。

## 5. Source Investigation

链（1.4.5 已证，本期不重解）：

```text
Gilneas_Play_Stinger_6（索引名）
  → MusicStinger GUID d7504580b84df004e85650f93b1d14d2
  → SoundDef 字符串 …wav:ab456f99…
  → AudioClip 实名 Gilneas_Play_Stinger_2
  → FSB → convertFsb → wavToPcm16
```

| 说法 | 判定 |
| --- | --- |
| 索引 `delaySec` 对 GIL_598 Music/Voice 均为 0，`timingVerified: false` | **PROVEN**（card-audio-index） |
| SoundDef 解析只有 `Name.wav:guid`，代码未读 delay/trim/start time 字段 | **PROVEN**（`parseSoundDefWavRefs`） |
| AudioClip 读取使用 `m_Resource.m_Offset/m_Size/m_Channels`；项目源码 **没有** 读取 `m_PreviewStart` / `m_Delay` / trim | **PROVEN**（Extractor） |
| `wavToPcm16` / `writePcm16Wav` 不在 PCM 前插入静音 | **PROVEN** |
| 同一解码管线：GIL_692（Stinger_4）peak>500 在 11.5 ms，GIL_598（Stinger_2）在 121 ms | **PROVEN** → 不是「解码器给所有 WAV 垫 121 ms」 |
| Vorbis/FSB 典型 pre-skip（约数百 sample，48 kHz 下数毫秒）导致整段 121 ms 渐入 | **NOT PROVEN**；与 40–200 ms 连续爬升也不吻合 |
| 0–40 ms peak 1–2 是否量化/编码器底噪 | **HYPOTHESIS** |
| 40–200 ms 渐入是否美术设计 | **HYPOTHESIS**（波形像渐入；无官方 delay 字段可证） |
| 无上限裁掉「阈值 512 之前」等于还原炉石官方时序 | **NOT PROVEN**（索引 timing 未验证；配置写明 preview 不是官方 mix） |

## 6. Sample / Library Analysis

- 样本：**40** 张已缓存 `*_MusicStinger.wav`（未为调查重解码全库）。
- 必含：GIL_598、GIL_692、EX1_116。
- 覆盖 24 个 set：GILNEAS、EXPERT1、TGT、GVG、BRM、NAXX、LOE、OG、KARA、BOOMSDAY、DALARAN、DRAGONS、ICECROWN、TROLL、SCHOLOMANCE、STORMWIND、THE_BARRENS、DARKMOON_FAIRE、REVENDRETH、THE_SUNKEN_CITY、ISLAND_VACATION、TITANS、THE_LOST_CITY、LOOTAPALOOZA 等。

`firstPeakOver500Ms` 分布：

| 桶 | 张数 | 含义 |
| --- | ---: | --- |
| 0–20 ms | 7 | 立刻有明显能量（吉恩、索瑞森等） |
| 20–50 ms | 7 | 里诺艾 36.7 ms 在此 |
| 50–100 ms | 11 | 常见 |
| 100–150 ms | **4** | **GIL_598 在此（121 ms）** |
| >150 ms | **11** | 含故意长静音/长渐入 |

`firstNonZeroMs`：33/40 在 0–20 ms。GIL_598 非零出现在 **2.19 ms**。用「是否全 0」看，苔丝 **不属于** 长静音组。

GIL_598 的 121 ms：**不偏离「peak>500」分布的主体右尾**；明显偏离的是「0–20 ms 就很响」的那一档（吉恩、里诺艾属于更早起音，不是苔丝更怪）。

peak>500 且 ≥100 ms 的样本包括：GIL_598 121、NEW1_010 104、SCH_126 101、LOOT_541 113、EX1_002 168、EX1_012 173、TLC_100 189、AT_072 162、AT_027 286、EX1_100 437、TRL_542 405、AT_063t 580、EX1_383 653、GVG_115 1204 等。

## 7. Comparison Cards

| | GIL_598 苔丝 | GIL_692 吉恩 | EX1_116 里诺艾 |
| --- | --- | --- | --- |
| Music 前 20 ms RMS/Peak | 0 / 1 | **194 / 967** | （0–20 已有能量，36.7 ms 过 500） |
| Music peak>500 | 121.27 ms | **11.46 ms** | **36.67 ms** |
| Voice peak>500 | 18.81 ms | 14.54 ms | 87.52 ms |
| Music−Voice | **+102 ms**（语音先） | **−3 ms**（几乎同时） | **−51 ms**（音乐先） |
| Music 前 200 ms RMS | 315 | 3395 | 2876 |
| Combo 听感 | 先语音，渐入后才觉得有 BGM | 一开始就是音乐+语音 | 先音乐床，再语音 |

对照结论（PROVEN）：用户要的「自然结合」在吉恩/里诺艾上表现为 **Music 在 Voice 之前或同时达到可听能量**。苔丝相反。裁掉整段 121 ms 渐入会让苔丝 Combo 的 Music 起音接近吉恩（立刻可听），但会丢掉渐入本身。

## 8. Existing Timing Configuration

全项目（`src/`，不含 node_modules）：

| 符号 | 用途 |
| --- | --- |
| `ENTRANCE_MIX.voiceDelayMs` | 全局 0；延迟 **Voice** |
| `ENTRANCE_MIX.leadingPaddingMs` | 全局 0；两端共同垫头 |
| `ENTRANCE_MIX.musicVolume` / `voiceVolume` | 0.7 / 1 |
| `musicDelayMs` | **不存在** |
| `offsetMs` / `trimStart` | 生产 mix **不存在** |
| 索引 `delaySec` | 写入 card/music 元数据，**恒为 0**，`timingVerified: false`。`unifyVoiceSlot` 写死 0。**没有任何卡牌非 0 delay** |
| `musicAliases` | AudioService 缓存别名，Mini **未传入**，空对象 |
| per-card mix | **禁止**；`test/cardAudioException.test.js` / `entranceAudioIntegrity.test.js` 断言 config 无 CardID 分支 |

验证脚本里有过 50/100 ms `voiceDelayMs` 和 50 ms padding 的 **诊断变体**，不是生产配置。

**结论：没有可复用的 per-card timing 表。不应再发明 CardID 映射。**

## 9. Silence Trimming Risk

本次样本：

| Case | 样本 | 说明 |
| --- | --- | --- |
| A 全 0 后突然开始 | **EX1_383 提里奥**：0–200 ms RMS=0，firstNonZero **590.83 ms**；**GVG_115 托什雷** firstNonZero **854 ms**；**TRL_542 乌达斯塔** 296 ms | 长静音后进入。无上限裁切会把「故意晚进」剪掉 |
| B 安静但渐强 | **GIL_598**：40–200 ms 连续爬升 | 阈值 512 会把渐入当成「静音头」 |
| C 音乐故意晚进 | 与 Case A 重叠（联盟/侏儒 stinger 常见前奏空白） | 无官方 delay 字段；**HYPOTHESIS** 为设计，但裁切风险 **PROVEN** |
| D 低底噪 | GIL_598 0–40 ms peak 1–2 | 删 leading zero 几乎无效果（非零从 2 ms 就开始） |

方案风险：

| 方案 | 正确性 | 通用性 | 误伤 | 复杂度 | 维护 |
| --- | --- | --- | --- | --- | --- |
| A 删所有 leading zero | 苔丝几乎无变化 | 差 | 提里奥/托什雷会被剪掉数百 ms | 低 | 差 |
| B 固定 RMS 阈值裁头 | 苔丝 121 ms 会被剪（渐入） | 表面通用 | 渐入卡 + 长静音卡 | 低 | 阈值难调 |
| C 连续低能量 >X ms 再裁，**必须有 cap** | 可覆盖苔丝短渐入 | 需 cap | 无 cap 则同 B | 中 | cap 要测试钉死 |
| D 只允许 per-card delay | 121 写死 | 差 | 违反 CardID 禁令 | 低 | 每张卡清单 |

## 10. Candidate Solutions

### 方案 A — 解码 / 写 WAV 时裁所有 leading silence

| 指标 | 评分 / 说明 |
| --- | --- |
| 通用性 | 差：改所有 Voice+Music 导出 |
| 正确性 | 差：苔丝不是 zero-pad；提里奥是长静音 |
| 误伤风险 | 高 |
| 硬编码卡牌 | 不需要，但更危险 |
| 影响 Music API | **是** |
| 影响 Resolver | 否（解码层） |
| 影响现有 WAV | **是**（缓存全部失效/被改） |
| 实现复杂度 | 中 |
| 可测试性 | 中 |
| 推荐程度 | **不推荐** |

### 方案 B — Resolver / getMusicAudio 返回前裁

| 指标 | 评分 / 说明 |
| --- | --- |
| 通用性 | 差 |
| 正确性 | 独立 BGM 会被改；用户认为纯 Music 已正常 |
| 误伤风险 | 高 |
| 硬编码卡牌 | 若只对苔丝则是硬编码 |
| 影响 Music API | **是** |
| 影响 Resolver | 若放在 Resolver 则是 |
| 影响现有 WAV | 是 |
| 实现复杂度 | 中 |
| 可测试性 | 中 |
| 推荐程度 | **不推荐** |

### 方案 C — 仅 Entrance Combo：检测并补偿 Music 低能量头（有 cap）

| 指标 | 评分 / 说明 |
| --- | --- |
| 通用性 | **好**：按波形，不写 CardID |
| 正确性 | Combo 听感对齐吉恩/里诺艾；独立 Music 不变。会丢掉 Combo 里的短渐入（preview 优化，与现有注释一致） |
| 误伤风险 | **中低**（必须 cap≈120–150 ms，且只在 Voice 已有能量时跳过） |
| 硬编码卡牌 | **否** |
| 影响 Music API | **否** |
| 影响 Resolver | **否** |
| 影响现有 WAV | 否；只失效 `entrance_v*` 缓存（升 `ENTRANCE_MIX_VERSION`） |
| 实现复杂度 | 中 |
| 可测试性 | 好（苔丝起音、吉恩/里诺艾回归、提里奥仍保留长静音） |
| 推荐程度 | **主推荐** |

实现建议：在 `EntrancePreviewService` 里计算 skip，把 Music PCM **切片后再**交给现有 `mixPcm16`，避免 mixer 自动检测静音。

### 方案 D — `musicTrimStartMs = 121` 只配 GIL_598

| 指标 | 评分 / 说明 |
| --- | --- |
| 通用性 | 无 |
| 正确性 | 数字会过时；121 只是阈值 500 的交点 |
| 误伤风险 | 低（只伤这一张）但对同类渐入卡无修复 |
| 硬编码卡牌 | **是**（项目明确禁止） |
| 影响 Music API | 否 |
| 影响 Resolver | 否 |
| 影响现有 WAV | 否 |
| 实现复杂度 | 低 |
| 可测试性 | 差（特例测试） |
| 推荐程度 | **禁止** |

`musicStartOffsetMs` 语义必须分开：

- **延迟 Music**：Combo 更晚才有 BGM → 加重「先语音」。
- **跳过 Music 开头**：Music 更早进入可听区 → 才是听感补偿。

### 方案 E — 不裁 Music，只改时间轴（延迟 Voice）

`mixPcm16` **已经支持** `voiceDelayMs`。可把 Voice 推迟约 102 ms 去对齐 peak>500。

| 指标 | 评分 / 说明 |
| --- | --- |
| 通用性 | 好 |
| 正确性 | 保留渐入；苔丝前 ~100 ms 仍是很轻的渐入（RMS 仍低），**不一定**让用户听到「有 BGM」 |
| 误伤风险 | 低（吉恩差 −3 ms 不会触发） |
| 硬编码卡牌 | 否 |
| 影响 Music API | 否 |
| 推荐程度 | **保守备选**，作主方案可能不够 |

## 11. Recommended Solution

**主方案：方案 C（Entrance-only、通用、有上限的 Music 起音补偿）。**

- **位置**：`EntrancePreviewService`（检测 + 切片）+ `entranceMixConfig`（全局 cap / 阈值 / 升版本号）。`mixPcm16` 可保持纯混音。
- **通用**：比较 Voice/Music 起音；仅当 Music 可听点晚于 Voice、且待跳过段低能量、且 skip ≤ cap 时跳过 Music 头。
- **不要 per-card**。
- **不影响** `GET /api/audio/music/:id`、Resolver、Catalog、解码、独立 Voice。
- **不误伤** 提里奥/托什雷：其静音头 590–854 ms **超过 cap**，只跳过 cap 长度后仍保留「晚进」；吉恩/里诺艾 skip≈0。
- 升 `ENTRANCE_MIX_VERSION`，使旧 `*_entrance_v2.wav` 失效。

## 12. Alternative Solution

若认为 Combo 必须保留 stinger 渐入：用 **方案 E**，按 `max(0, musicOnset−voiceOnset)` 设置 `voiceDelayMs`（仍全局算法，无 CardID）。预期待验证：苔丝前 100 ms 是否仍嫌「没音乐」。

不建议「不修」：用户问题已定位为 Combo 听感，且架构已声明 preview 不是官方时序。

## 13. Files That Would Need Modification

（仅 1.4.8 预估，本期不改）

| 文件 | 原因 |
| --- | --- |
| `src/services/entrancePreviewService.js` | 起音检测、有 cap 的 Music 切片、再 mix |
| `src/music/entranceMixConfig.js` | 全局阈值/cap、`ENTRANCE_MIX_VERSION`++，仍无 CardID |
| `src/music/mixPcm16.js` | **可选**；若切片在 service 完成则不必改 |
| `test/entranceAudioIntegrity.test.js` 等 | 苔丝起音、对照卡、Music API 不变、长静音卡、无 BGM 404 |

## 14. Test Plan for Phase 1.4.8

TEST 1：GIL_598 Combo 起音改善（mix 前 ~50 ms 应出现可听 Music 能量，且仍含 Voice）。

TEST 2：GIL_692 不回归（skip≈0，SHA1 或起音差与现网接近）。

TEST 3：EX1_116 不回归（仍为音乐先于或接近语音）。

TEST 4：`GET /api/audio/music/GIL_598` 字节/起音与修复前一致。

TEST 5：无 BGM 卡（如 ETC_409）Music/Entrance 仍 404 或既有行为。

TEST 6：仅 Voice 卡 Entrance 仍返回 play，不被 silence 逻辑改写。

TEST 7：EX1_383 / GVG_115 不得被裁掉整段 500–800 ms 静音（cap 生效）。

另：禁止 `if (cardId === 'GIL_598')`；npm test 含上述断言。

## 15. Actual Files Modified

```text
data/card-verification/phase-1.4.7-report.md
```

临时脚本已删除。

## 16. Production Code Changes

0

## 17. Tests

未跑 `npm test`。只读探测脚本 ≠ 回归测试。

## 18. Final Decision

**推荐进入 Phase 1.4.8**（按方案 C 实施，等待人工确认后再改代码）。
