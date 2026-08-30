# Phase 0.8 Full Card Voice Index

未导出音频。未修改 `C:\Hearthstone`。未开发网站 / API / 数据库 / 用户系统。

## 版本

- extractor: `0.8`
- game: Hearthstone **36.4.0.250339**
- build: `250339`（从 `.product.db` 读取，不是硬编码）
- Unity Player: `6000.3.11f1 (3000ef702840)`
- build-guid: `a356d4f6b5bd47d2a6e25f73d2b66d02`（`boot.config`）
- locale: zhCN

## 卡牌数量

- 总卡牌（`cards.json` 去重后）: **35807**
- collectible: **8154**
- non-collectible: **27653**
- 有 CardDef GameObject: 35723
- 无 CardDef: 84（槽位记 `no_voice`，不是失败）

| type | count |
|---|---:|
| MINION | 11608 |
| ENCHANTMENT | 6636 |
| SPELL | 6591 |
| LETTUCE_ABILITY | 4438 |
| HERO | 2952 |
| HERO_POWER | 2159 |
| WEAPON | 489 |
| BATTLEGROUND_TRINKET | 390 |
| BATTLEGROUND_SPELL | 205 |
| BATTLEGROUND_ANOMALY | 112 |
| LOCATION | 98 |
| BATTLEGROUND_QUEST_REWARD | 73 |
| PET | 32 |
| GAME_MODE_BUTTON | 10 |
| UNKNOWN | 9 |
| MOVE_MINION_HOVER_TARGET | 4 |
| BATTLEGROUND_HERO_BUDDY | 1 |

## Voice 槽位

| slot | matched | no_voice | unresolved | error |
|---|---:|---:|---:|---:|
| play | 10737 | 25065 | 5 | 0 |
| attack | 10945 | 24855 | 7 | 0 |
| death | 11697 | 24109 | 1 | 0 |

## Mapping

槽位合计（play+attack+death = 107421）：

| mappingType | 槽位数 |
|---|---:|
| `no_voice` | 74029 |
| `direct` | 14939 |
| `shared_resource` | 11454 |
| `token_clip` | 2959 |
| `named_sfx` | 2823 |
| `shared_audio` | 1204 |
| `unresolved` | 13 |

按卡主键（优先级：unresolved > shared_resource > shared_audio > token_clip > named_sfx > direct > no_voice）：

| mappingType | 卡数 |
|---|---:|
| `no_voice` | 23963 |
| `direct` | 4983 |
| `shared_resource` | 4228 |
| `named_sfx` | 1147 |
| `token_clip` | 1054 |
| `shared_audio` | 419 |
| `unresolved` | 13 |
| `error` | 0 |

VoiceSourceCardID ≠ CardID 的卡牌数: **5701**

error 卡牌数: **0**

## unresolved（13 条槽位 / 13 张卡，未自动修复）

两类：

1. **GUID 未进 prefab container**（`guid_not_resolved_to_clip`）：佣兵书 `BOM_06_Cariel_*hp` 共用 Attack GUID `ba4d6bfd…`，以及若干 Story 法术/英雄。
2. **container 有 GUID，preload 无 VO**（`soundspell_preload_has_no_vo`）：`DINO_421`、`NX2_022`（可收藏随从）、`DRGA_BOSS_21t`。

详见 `phase-0.8-unresolved.json`。

## 性能

- 总耗时: **211.0s**
- CardDef 解析: 2.8s（279 bundles，35757 GameObjects，0 parse error）
- GUID / SoundSpell 索引: 74.3s（1418 prefab/sound bundles，119216 GUIDs；**排除 audio 包**，未按卡扫 700+ audio）
- AudioClip Index: 132.1s（438 zhcn audio bundles **各扫一次**，70609 clip 名）
- Voice Mapping: 0.4s（内存 GUID / clip 查找）

audio-index：**复用** Phase 0.6 的 `data/voice-verification/audio-index.json` 作为种子，并一次建成 `data/index/audio-index.json`。没有对每张卡扫描 audio bundle。

## 抽样（30 张，种子 20260828）

覆盖 direct / shared_resource / shared_audio / token_clip / named_sfx / no_voice / unresolved。

资源链复核：**30/30 通过**（CardDef GUID → SoundSpell preload VoiceKey → audio-index）。

## Phase 0.7 未覆盖的新情况

映射类型没有新增；卡牌 **type** 从只有 MINION 样本扩展到 ENCHANTMENT、LETTUCE_ABILITY、BATTLEGROUNDS_*、PET、LOCATION、HERO_POWER 等。`no_voice` 在法术/附魔/英雄技能上是正常现象，不是解析失败。

`named_sfx` 中出现 clip 把 CardID 写成无下划线（如 `FireplumePhoenix_UNG084_Play` 对应 `CORE_UNG_084`）。按规则不猜测，保持 named_sfx。

## 输出文件

- `data/index/card-voice-index.json`
- `data/index/manifest.json`
- `data/index/audio-index.json`
- `data/index/cache/carddef-sounds.json`
- `data/index/cache/guid-voice-index.json`
- `data/voice-verification/phase-0.8-report.md`
- `data/voice-verification/phase-0.8-unresolved.json`
- `data/voice-verification/phase-0.8-sample.json`

## 测试

`npm test`：Phase 0.7 规则测试保留；全量索引抽检 EX1_116 / VAN_NEW1_010 / CORE_DMF_067 / WON_302 / VAC_954 / CAP_107 / CFM_335 / EDR_526 以及 10 个实卡样本。`validateCardVoiceIndex` 通过。
