# Phase 1.0.1 — 传说卡 Music Stinger 覆盖率验证

未修改 `C:\Hearthstone`。未批量导出音频。未修改 Voice Index。未改网页 UI。

本报告区分：**资源中没有音乐引用**（`no_music_reference`）与 **当前工具无法确认**（`unresolved` / `parse_error`）。

## 1. 当前客户端版本

Hearthstone **36.4.0.250339**（build 250339），locale zhCN。

## 2. 可收藏传说随从数量

**1047** 张（`cards.json` + `cards.collectible.json`：`collectible=true`、`type=MINION`、`rarity=LEGENDARY`）。

## 3–8. 覆盖率

| 状态 | 含义 | 数量 |
|---|---|---:|
| music_stinger_found | 明确找到 Music Stinger，且 GUID 未被其他卡共享 | 577 |
| shared_music_found | 找到音乐，但与其他 CardDef 共享同一 GUID | 466 |
| other_music_found | 不是 MusicStinger 命名，但资源关系指向音乐 Clip | 0 |
| no_music_reference | 正向 CardDef 全 Prefab/WAV + 反向 music GUID 索引后仍无音乐引用 | 4 |
| unresolved | 有疑似音乐引用，但 GUID 无索引或无 Clip | 0 |
| parse_error | 找不到 CardDef GameObject 或解析失败 | 0 |

## 9. 火车王属于哪一种

EX1_116 火车王里诺艾：`shared_music_found`。

- Prefab: MusicStinger.prefab `c6aaf3440b38a664db44d8870f3864d1`
- AudioClip: Pegasus_Stinger_Leeroy_Jenkins
- Bundle: initial_base_global-775a814d-prefab-1.unity3d

## 10. 是否存在多个不同的 Music Stinger

传说随从上解析到 **857** 条不同的 (AudioClip, Prefab GUID) 组合；其中 Prefab 名含 Stinger 的有 **856**。

## 11. 是否存在共享 Music Stinger

是。170 条映射被多于 1 张卡引用。

## 12. 除了 MusicStinger.prefab 是否发现其他音乐挂载方式

Card 级 `other_music_found` = 0。有 1 条映射的 Prefab 名不含 Stinger，但仍通过 GUID→Clip 指向音乐（TSC_067 的 `Faelin.prefab` → `HS_LegendaryStinger_AmbassadorFaelin`）。主流挂载仍是 PlayEffect 的 `MusicStinger.prefab:GUID`，未发现独立 `m_MusicStinger*` CardDef 字段。

检测方法（不只复制火车王路径）：

1. 合并 CardDef 上全部 MonoBehaviour 的 `.prefab:GUID` 与 `.wav:GUID`（含 Play/Attack/Death/CustomSummon/其它）。
2. Prefab 名 `/stinger/i`、`/music/i` 分类。
3. GUID → `guid-voice-index` 的 AudioClip 名（Pegasus_Stinger / *_Stinger / *_Music）。
4. 反向：索引中带音乐 Clip 的 GUID 是否被某张卡的 CardDef 引用。
5. Play/Attack/Death GUID 的 preload Clip 是否为音乐（嵌套挂载）。

## 13. EPIC / RARE / COMMON 是否也发现 Music Stinger

对照样本（种子 20260828，每档 20 张可收藏随从）：

| 稀有度 | 样本 | stinger | shared | other | none | unresolved | parse_error |
|---|---:|---:|---:|---:|---:|---:|---:|
| LEGENDARY | 20 | 12 | 8 | 0 | 0 | 0 | 0 |
| EPIC | 20 | 0 | 0 | 0 | 20 | 0 | 0 |
| RARE | 20 | 0 | 0 | 0 | 20 | 0 | 0 |
| COMMON | 20 | 0 | 0 | 0 | 20 | 0 | 0 |

## 14. “只有传说卡有登场 BGM”是否成立

对**可收藏随从**而言：Music Stinger **高度集中在传说**。全量 1047 张传说随从中仅 4 张 CardDef 无音乐引用；EPIC/RARE/COMMON 各 20 张对照样本全部是 `no_music_reference`。

因此「传说才有登场 BGM、普通/稀有/史诗随从 CardDef 上没有 Music Stinger」在本阶段证据下**成立**。但不要理解成「只有火车王有」——那是旧 CardDef 缓存用 `/musichstinger/i` 匹配不到 `MusicStinger` 造成的漏检。

shared_music 多数是 CORE_/VAN_/WON_ 重印共用同一 GUID，以及少数通用 `Pegasus_Stinger_*` 主题曲。火车王 GUID 由 EX1_116、CORE_EX1_116、VAN_EX1_116 共享。

## 15. 是否足以支持下一阶段全量 Music Index

正向 CardDef → Prefab GUID → guid-voice-index → AudioClip 链对火车王已经闭合，也可以批量化扫描全部 CardDef。

仍不足以称为完整 Music Index：

- 未解析每张卡 Play.prefab 内部 TypeTree（仅用 guid-index preload Clip 名做嵌套探测）。
- 未扫全部 audio bundle 建立独立 music clip 目录。
- Adventure / Hero / UI Stinger 大量存在于 guid-index，但未挂到可收藏随从 CardDef。

## 典型 10 例

- EX1_116 火车王里诺艾 — `shared_music_found` — MusicStinger / Pegasus_Stinger_Leeroy_Jenkins
- AT_009 罗宁 — `music_stinger_found` — MusicStinger / Dalaran_Play_Stinger_1
- AT_018 银色神官帕尔崔丝 — `shared_music_found` — MusicStinger / Tournament_Play_Stinger_3
- NEW1_030 死亡之翼 — `shared_music_found` — MusicStinger / Pegasus_Stinger_Deathwing3
- EX1_572 伊瑟拉 — `shared_music_found` — MusicStinger / Pegasus_Stinger_Dragon_Good_New
- EX1_298 炎魔之王拉格纳罗斯 — `shared_music_found` — MusicStinger / Pegasus_Stinger_Elemental_Villain
- BAR_551 巴拉克·科多班恩 — `shared_music_found` — MusicStinger / HS_LegendaryStinger_BarakKodobane
- TOY_373 益智大师卡德加 — `music_stinger_found` — TOY_373_ArchmageKhadgar_Stinger / TOY_373_ArchmageKhadgar_Stinger
- CATA_300 黑血 — `music_stinger_found` — CATA_300_TheBlackBlood_Stinger / CATA_300_TheBlackBlood_Stinger
- CFM_815 燃鬃·自走炮 — `shared_music_found` — MusicStinger / Burnbristle_Play_Stinger

## 异常 / 无音乐引用 10 例

- ETC_409 融合独奏团 — `no_music_reference` — extra prefabs: ETCFX_OneAmalgamBand_Impact_Super, ETCFX_OneAmalgamBand_CustomSummon
- PRO_001 精英牛头人酋长 — `no_music_reference` — extra prefabs: ETC_FX
- VAN_PRO_001 精英牛头人酋长 — `no_music_reference` — extra prefabs: ETC_FX
- WW_364 威拉罗克·温布雷 — `no_music_reference` — extra prefabs: WW_364_diamond_velarok_windblade_skip3, Play_Blunderbuss_Underlay_Play, Death_Shotgun_Underlay_Death, WWFX_VelarokWindrunner_TransformImpact, WWFX_VelarokWindrunner_CustomSummon

## Prefab 命名变体（仍计为 Music Stinger，不是 other_music）

CardDef 上出现的含 Stinger 的 Prefab 名以 `MusicStinger` 为主，另有 `Stinger`、`Music_Stinger`、`Play_HS_*_Stinger` 等。这些都通过 `/stinger/i` 识别，证据仍是真实 `.prefab:GUID`，不是按 CardID 猜测。

## 音频抽样

最多抽取 5 个不同 Clip 验证可播放。实际：5。
- Pegasus_Stinger_Leeroy_Jenkins: ok C:\Users\123\hs-audio-verify\tmp\music\Pegasus_Stinger_Leeroy_Jenkins.wav cached=true
- Dalaran_Play_Stinger_1: ok C:\Users\123\hs-audio-verify\tmp\music\Dalaran_Play_Stinger_1.wav cached=true
- Tournament_Play_Stinger_3: ok C:\Users\123\hs-audio-verify\tmp\music\Tournament_Play_Stinger_3.wav cached=true
- CATA_300_TheBlackBlood_Stinger: ok C:\Users\123\hs-audio-verify\tmp\music\CATA_300_TheBlackBlood_Stinger.wav cached=true
- Burnbristle_Play_Stinger: ok C:\Users\123\hs-audio-verify\tmp\music\Burnbristle_Play_Stinger.wav cached=false