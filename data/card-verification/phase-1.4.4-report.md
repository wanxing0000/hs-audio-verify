# Phase 1.4.4 — 苔丝·格雷迈恩 BGM 缺失专项调查

本阶段只调查，未修改生产代码、音频数据、索引或播放器。

## 1. 调查目标

苔丝·格雷迈恩（Tess Greymane）有 Voice，但没有 BGM。确认 BGM 在证据链的哪一层断开。

## 2. Tess 身份信息

同名「苔丝·格雷迈恩」不是一张卡。索引中至少有以下相关 cardId。

### 2.1 可收藏随从（图鉴主卡）

| cardId | dbfId | set | type | collectible | catalog.cards | Voice play | BGM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GIL_598` | 47211 | GILNEAS | MINION | true | 是（canonical） | own `VO_GIL_598_Female_Human_Play_01` | own `Gilneas_Play_Stinger_6` |
| `CORE_GIL_598` | 86539 | CORE_HIDDEN | MINION | true | 否（1.4.3 折叠） | shared → `GIL_598` | shared → `GIL_598` |

`GIL_598` 是图鉴与音频的 canonical 身份。`CORE_GIL_598` 仍在 `catalog.byId`，详情 API 可打开。

### 2.2 共享同一 BGM clip 的非收藏身份

| cardId | dbfId | set | collectible | Voice | BGM |
| --- | --- | --- | --- | --- | --- |
| `Story_06_TessGreymane` | 71015 | DARKMOON_FAIRE | false | shared → `GIL_598` | shared → `GIL_598` / `Gilneas_Play_Stinger_6` |

### 2.3 同名但无本调查所指 BGM 的身份

| cardId | dbfId | set | collectible | Voice play | BGM |
| --- | --- | --- | --- | --- | --- |
| `HERO_03bg` | 121643 | HERO_SKINS | true（在 catalog.cards） | unavailable | unavailable |
| `HERO_03bg_meta` | 126201 | HERO_SKINS | false | unavailable | unavailable |
| `GILA_500h3` | 48486 | GILNEAS | false | unavailable | unavailable |
| `GILA_500h4` | 49566 | GILNEAS | false | shared → `GILA_500h3` | unavailable |
| `LT24_011H_01` / `_02` / `_03` | 93339 / 93396 / 93397 | LETTUCE | false | shared → `GIL_598` | unavailable |
| `TB_BaconShop_HERO_50` | 60367 | BATTLEGROUNDS | false | unavailable | unavailable |

相关但名称不是「苔丝·格雷迈恩」：`HERO_03bo`（野兽苔丝）、若干酒馆皮肤（温西尔苔丝等）。

搜索「苔丝·格雷迈恩」实时 Mini API 只返回两张已发布卡：

- `GIL_598`：`hasPlay=true` `hasMusic=true` `hasEntrance=true`
- `HERO_03bg`：三者均为 false

用户描述「有 Voice、无 BGM」对应 **`GIL_598`**，不是英雄皮肤 `HERO_03bg`（那张卡 Voice 也没有）。

## 3. Catalog 检查

`catalog.cards` 中 `GIL_598` 实际对象（`adaptCard` / 详情 API `GET /api/mini/card/GIL_598`）：

```text
id                GIL_598
name              苔丝·格雷迈恩
set               GILNEAS
collectible       true
dbfId             47211
type              MINION
class             ROGUE

voice.play
  available       true
  shared          false
  voiceKey        VO_GIL_598_Female_Human_Play_01
  sourceCardId    GIL_598

voice.attack      VO_GIL_598_Female_Human_Attack_01 / sourceCardId GIL_598
voice.death       VO_GIL_598_Female_Human_Death_01 / sourceCardId GIL_598

music
  available       true
  shared          false
  status          available
  musicAssetId    d7504580b84df004e85650f93b1d14d2
  audioClipName   Gilneas_Play_Stinger_6
  sourceCardId    GIL_598

entrancePreview   available true
audio.cardAudioStatus  full
```

Catalog **没有**把 BGM 标成 missing。UI 会显示可点的「登场音乐」和「完整登场」。断点不在 Catalog。

`CORE_GIL_598` 的 music 字段相同 clip，`status=shared`，`sourceCardId=GIL_598`。

## 4. Resolver 检查

给定 `GIL_598`，生产链为：

```text
GIL_598
  → UnifiedAudioRepo.getMusicMeta
      audioClip   Gilneas_Play_Stinger_6
      bundle      initial_base_global-d2f4bda7-prefab-4.unity3d
      prefabGuid  d7504580b84df004e85650f93b1d14d2
  → getVoiceAsset('Gilneas_Play_Stinger_6')
      indexed     true
      zhcnBundles []
      prefabBundles [initial_base_global-d2f4bda7-prefab-4.unity3d]
  → AudioBundleResolver.listCandidates
      19 个候选（无 sibling -audio-，因 C:\Hearthstone\Data\Win 不存在 initial_base_global-d2f4bda7-audio-*.unity3d）
  → inspectCandidate（decode:true）
      winner = null
      failureClass = CLIP_NOT_FOUND
```

候选与结果（`npm run discover:audio-bundles -- --cardId GIL_598`）：

| 顺序 | bundle | reason | clipFound |
| --- | --- | --- | --- |
| 1–7 | `playsound_*` / `soundotherminion_*` `d2f4bda7-audio-*` | hash_related_audio | false |
| 8–11 | `soundlegend_base_global-6c782fd0-audio-0..3` | soundlegend_audio_bundle | false |
| 12–18 | `heromusic_*` / `musicexpansion_*` | music_catalog_bundle | false |
| 19 | `initial_base_global-d2f4bda7-prefab-4.unity3d` | indexed_prefab_bundle | false；错误 `End position (4217355878) out of boundary (998660)` |

Voice 对照（同一张卡、同一 hash 家族）：

```text
VO_GIL_598_Female_Human_Play_01
  zhcnBundles  playsound_base_zhcn-d2f4bda7-audio-0.unity3d
  winner       该 zhcn bundle
  offset       998816  size 23072  decode success
```

Resolver **不是**返回「卡没有 music 字段」。它按索引去找 `Gilneas_Play_Stinger_6`，找遍 19 个候选后判定 **CLIP_NOT_FOUND**。

对比同机制的吉恩·格雷迈恩 `GIL_692` / `Gilneas_Play_Stinger_4`：索引同样 `zhcnBundles=[]` + prefab-only，但 Resolver 在 `soundlegend_base_global-6c782fd0-audio-1.unity3d` 找到 clip（offset 18439392，size 228064，decode success）。说明 soundlegend 回退对其他吉尔尼斯 stinger 有效，**唯独 `Gilneas_Play_Stinger_6` 不在这 4 个 soundlegend 包里**。

## 5. Audio Index 检查

属于调查清单 **情况 B**：索引里有 Tess BGM，Resolver 找不到可解码文件。

`data/index/audio-index.json` → `clips.Gilneas_Play_Stinger_6`：

```text
zhcnBundles    []
prefabBundles  [initial_base_global-d2f4bda7-prefab-4.unity3d]
```

`data/index/music-assets.json` / `music-index.json`：

```text
guid           d7504580b84df004e85650f93b1d14d2
audioClipName  Gilneas_Play_Stinger_6
prefabName     MusicStinger
bundle         initial_base_global-d2f4bda7-prefab-4.unity3d
format         FSB5/Vorbis
lengthSec      null   （从未成功解码）
```

`data/index/card-audio-index.json` `GIL_598.music.status=available`。

同 clip 还挂在 `CORE_GIL_598`、`Story_06_TessGreymane`（shared → `GIL_598`）。没有「另一个无关 cardId 拥有一份独立、可解析的 Tess BGM」。

`carddef-sounds.json` 的 `GIL_598.musicStinger` 字段为 `null`（该缓存只记主字段，不记 extra prefab）。Phase 1.0.1 证据把 MusicStinger 记在 extra prefab：`guid d7504580…`，clip `Gilneas_Play_Stinger_6`。

## 6. Audio File 检查

项目音频目录（只报告存在性，未改文件）：

| 文件 | 存在 | 格式 | 大小 | 时长 |
| --- | --- | --- | --- | --- |
| `tmp/audio/VO_GIL_598_Female_Human_Play_01.wav` | 存在 | WAV | 199468 bytes | 2.077 s |
| `tmp/audio/VO_GIL_598_Female_Human_Attack_01.wav` | 不存在 | — | — | — |
| `tmp/audio/VO_GIL_598_Female_Human_Death_01.wav` | 不存在 | — | — | — |
| `tmp/audio/Gilneas_Play_Stinger_6.wav` | 不存在 | — | — | — |
| `tmp/music/GIL_598_MusicStinger.wav` | 不存在 | — | — | — |

按文件名搜索 Tess / Greymane / 苔丝：没有 Tess BGM wav。`tmp/music` 中巫林相关仅见 `GIL_820_MusicStinger.wav`、`CORE_GIL_826_MusicStinger.wav`，没有 `GIL_598`。

`C:\Hearthstone\Data\Win` 存在索引指向的 prefab `initial_base_global-d2f4bda7-prefab-4.unity3d`（156102 bytes），以及同 hash 的若干 audio 包；**不存在** `initial_base_global-d2f4bda7-audio-*.unity3d`。原始包为 UnityFS 压缩，裸字节搜索 clip 名无命中（不能据此否定解包后的 clip 元数据）。

## 7. Extractor 检查

分两层：

**索引阶段（已发生）：** Extractor / 索引流水线发现了 Tess 的 MusicStinger。证据：`guid-voice-index` 该 GUID 的 `voiceKeys` 含 `Gilneas_Play_Stinger_6`；`audio-index`、`music-assets`、`card-audio-index` 均有记录。对应调查清单第八步的 **A（发现了 BGM 引用）**，不是「没扫到」。

**运行时提取（当前失败）：** `extractVoice('Gilneas_Play_Stinger_6')` 与 discover 使用同一 Resolver。无 winner。生产 `GET /api/audio/music/GIL_598` 返回 **HTTP 404** `{"error":"暂时无法播放"}`。未写出 wav（检查上述两个路径仍不存在）。

因此：Extractor 找到了 **名字和 prefab**，没有提取到 **可播放 WAV**。索引没有丢失该条目。

## 8. 原始 Hearthstone 数据检查

数据源仍是 `C:\Hearthstone`（Extractor 默认 `C:\Hearthstone\Data\Win`）。未修改任何原始文件。

HSJSON `data/hearthstonejson/zhCN/cards.json` 的 `GIL_598` 只有卡牌定义（id / dbfId / name / set / collectible），没有 sound / music 字段。音频引用在 CardDef prefab，不在 HSJSON。

CardDef / GUID 证据（只读缓存，来自对原始包的扫描）：

```text
GIL_598 CardDef bundle   carddef_base_global-d2f4bda7-prefab-2.unity3d
playGuid                 d9b4551a3205f2c40b511ab1cf26c426
attackGuid               2cfb4ef3300e83e41be7a3f8d0345831
deathGuid                543f030587262ac4793583082339ae44
customSummon             TessGreymane_CustomSummon / 216998010aa1159408971667c8e6c3ad
musicStingerPrefab       MusicStinger / d7504580b84df004e85650f93b1d14d2
extraPrefabNames         TessGreymane_FX, MusicStinger, TessGreymane_CustomSummon
guid → clip              Gilneas_Play_Stinger_6
guid → file              initial_base_global-d2f4bda7-prefab-4.unity3d
```

原始数据 **有** BGM 引用（MusicStinger prefab + clip 名）。不能归为「Hearthstone 没有 Tess BGM」。

该 prefab 在运行时检查中 FSB 外置偏移越界（end `4217355878` / 边界 `998660`），说明 clip 元数据在 prefab 内，**有效 FSB 载荷不在该 prefab 内**，且当前候选 audio 包里也没有同名 clip。

## 9. Shared Audio 检查

Voice 与 BGM **不是**两个无关 source：

```text
Voice:  GIL_598 → sourceCardId GIL_598 → VO_GIL_598_Female_Human_Play_01
BGM:    GIL_598 → sourceCardId GIL_598 → Gilneas_Play_Stinger_6
```

共享关系：

```text
CORE_GIL_598          → sourceCardId GIL_598 → 同一 clip
Story_06_TessGreymane → sourceCardId GIL_598 → 同一 clip
```

映射正确。不存在「Tess 应改用另一张卡已成功提取的 BGM、只是 sourceCardId 没挂上」。`GIL_692` 的 `Gilneas_Play_Stinger_4` 是吉恩自己的 stinger，没有数据表明 Tess 应共享它。

Lettuce `LT24_011H_*` 只共享 Voice，music 为 unavailable，与本问题无关。

## 10. 最终分类

**CATEGORY D**

```text
Audio Index 存在
Resolver 没有正确解析到可播放 bundle
```

不是 A：原始 CardDef 有 MusicStinger / `Gilneas_Play_Stinger_6`。  
不是 B：索引阶段已经抽出 clip 名与 GUID。  
不是 C：索引条目在，且指向上述 prefab。  
不是 E：shared 的 sourceCardId 已指向 `GIL_598`。  

D 的含义在这里是：**索引声明 BGM 存在，Resolver 穷尽候选后 CLIP_NOT_FOUND**。不是「Resolver 写错了 cardId」。对照吉恩，同一套 soundlegend 回退能解开 `Gilneas_Play_Stinger_4`，解不开 `Gilneas_Play_Stinger_6`。

## 11. 证据链

```text
Raw Hearthstone Data
  CardDef extra MusicStinger GUID d7504580…
  GUID → Gilneas_Play_Stinger_6
  prefab 文件存在于 C:\Hearthstone\Data\Win
  无 initial_base_global-d2f4bda7-audio-* 同胞包
↓
Extractor（索引）
  写入 audio-index / music-assets / card-audio-index
  lengthSec 仍为 null
↓
Audio Index
  有条目；zhcnBundles 空；仅 prefab
↓
Resolver / 运行时 Extractor          ← 断点
  19 候选无 winner
  failureClass CLIP_NOT_FOUND
↓
Catalog
  music.available = true（忠实于索引，不检测能否解码）
↓
生产播放器
  详情页按钮可点
  GET /api/audio/music/GIL_598 → 404 暂时无法播放
  Voice GET 可走已缓存 wav
```

用户可见现象：Voice 能播（zhcn 包 + 已缓存 wav），BGM 按钮在但请求失败。

## 12. 对比卡

| | GIL_598 苔丝 | GIL_692 吉恩 |
| --- | --- | --- |
| Voice | zhcn 命中，decode success | zhcn 命中，decode success |
| BGM clip | `Gilneas_Play_Stinger_6` | `Gilneas_Play_Stinger_4` |
| Index zhcnBundles | `[]` | `[]` |
| Index prefab | `…-d2f4bda7-prefab-4` | `…-d2f4bda7-prefab-6` |
| Resolver | winner null / CLIP_NOT_FOUND | `soundlegend-…-audio-1` decode success |
| Catalog music.available | true | true |
| 本地 BGM wav | 不存在 | 不存在（未点播；但 Resolver 已证明可解） |

## 13. 证据矩阵

| 检查层 | Tess Voice | Tess BGM | 结果 |
| --- | --- | --- | --- |
| Catalog | available / source `GIL_598` | available / `Gilneas_Play_Stinger_6` / source `GIL_598` | Catalog 认为两者都有 |
| Resolver | winner：`playsound_base_zhcn-d2f4bda7-audio-0` | winner：null，`CLIP_NOT_FOUND` | BGM 在此层断开 |
| Audio Index | clip 有 zhcn bundle | clip 有，仅 prefab，zhcn 空 | 情况 B |
| Audio Files | `VO_GIL_598_…_Play_01.wav` 存在，199468 B / 2.077 s | 不存在 | Voice 已落地，BGM 未落地 |
| Extractor | 索引+运行时均可 | 索引有元数据；运行时提取失败 | 元数据在，WAV 无 |
| Raw Hearthstone Data | Play prefab GUID 存在 | MusicStinger GUID + clip 名存在 | 原始引用存在 |

## 14. npm test

`npm test`: **PASS**

未为调查结果修改任何测试或生产代码。

## 15. 修改文件

本阶段只新增：

```text
data/card-verification/phase-1.4.4-report.md
```

调查过程中运行了只读 discover（重写了已有 `tmp/discover-audio-bundles.cjs` 打包产物），并请求了一次 `GET /api/audio/music/GIL_598` 以确认生产播放器错误（404，未写出 wav）。未改 `player.js`、`playerController.js`、`audio.js`、Extractor、Resolver、索引、catalog、`miniServer`、小程序页面、`C:\Hearthstone` 或任何生产音频文件。
