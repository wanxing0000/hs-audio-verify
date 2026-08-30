# Phase 1.4.2 — Duplicate Card Investigation

## Status
INVESTIGATION COMPLETE

## Scope

只读调查小程序卡牌搜索与首页列表中的「重复卡牌」观感。

未修改任何生产代码、UI、API、索引、Extractor、Resolver、Player。

数据来源（只读）：

- `data/index/card-audio-index.json`（小程序目录唯一卡牌库）
- `data/hearthstonejson/zhCN/cards.json` / `cards.collectible.json`（补 elite / artist / mechanics）
- `src/miniprogram/catalogAdapter.js`（发布、搜索、分页）
- `src/miniprogram/miniServer.js`（API）
- `miniprogram/pages/index/*`、`miniprogram/utils/data.js`、`miniprogram/components/card-item/*`

一次性脚本：`tmp/phase-142-investigate.cjs`（调查后删除，不纳入生产）。

---

## Card 1 — 奇利亚斯

### 搜索实现实际结果

`searchCards(catalog.cards, '奇利亚斯')` / `GET /api/mini/search?q=奇利亚斯`：

```
result count = 3
```

| index | cardId | dbfId | name | set | collectible |
| ---: | --- | ---: | --- | --- | --- |
| 0 | BOT_548 | 49184 | 奇利亚斯 | BOOMSDAY | true |
| 1 | CORE_BOT_548 | 97112 | 奇利亚斯 | CORE_HIDDEN | true |
| 2 | TOY_330 | 102983 | 奇利亚斯豪华版3000型 | WHIZBANGS_WORKSHOP | true |

英文 `Zilliax`：`result count = 0`。目录对象没有 `nameEn` / `localizedName`。`scoreCard` 虽读取 `card.nameEn`，但 `adaptCard` 从未写入该字段。

### 索引层全部名称/ID 相关记录（含未发布）

索引 `unified.cards` 中与「奇利亚斯 / BOT_548 / TOY_330」相关的对象多于 3 条（附魔、模块、战棋、豪华版衍生等）。`shouldPublish` 只放行 `collectible === true`（外加白名单 `VERIFY_IDS`，不含这些 ID）。

未进入小程序列表的例子：`BOT_548e`（附魔，同名「奇利亚斯」、collectible=false）、大量 `TOY_330t*`、`BG29_100_*`。

### 发布后（小程序能看到）的 3 条

=== 奇利亚斯 ===

Record #1
cardId: BOT_548
dbfId: 49184
name: 奇利亚斯
localizedName: NOT_PRESENT
type: MINION
cardClass: NEUTRAL（索引字段名为 `class`，不是 `cardClass`）
set: BOOMSDAY
rarity: LEGENDARY
collectible: true
elite: true（来自 HSJSON，索引中 NOT_PRESENT）
artist: L. Lullabi & K. Turovec（HSJSON）
mechanics: DIVINE_SHIELD, LIFESTEAL, MAGNETIC, RUSH, TAUNT（HSJSON）
voice.play: available / VO_BOT_548_Male_Mech_Play_02 / sourceCardId=BOT_548
music: available / Zilliax_Play_Stinger / sourceCardId=BOT_548
数据来源: data/index/card-audio-index.json

Record #2
cardId: CORE_BOT_548
dbfId: 97112
name: 奇利亚斯
localizedName: NOT_PRESENT
type: MINION
cardClass: NEUTRAL
set: CORE_HIDDEN
rarity: LEGENDARY
collectible: true
elite: true
artist: L. Lullabi & K. Turovec
mechanics: 与 Record #1 相同
voice.play: **shared** / 同一 voiceKey / sourceCardId=**BOT_548**
music: **shared** / 同一 clip / sourceCardId=**BOT_548**
数据来源: 同上

Record #3
cardId: TOY_330
dbfId: 102983
name: 奇利亚斯豪华版3000型
localizedName: NOT_PRESENT
type: MINION
cardClass: NEUTRAL
set: WHIZBANGS_WORKSHOP
rarity: LEGENDARY
collectible: true
elite: true
artist: Mooncolony
mechanics: NOT_PRESENT（HSJSON 该卡无 mechanics 数组）
voice.play: available / VO_TOY_330_Mech_Emote_Play_01 / sourceCardId=TOY_330
music: available / TOY_330_ZilliaxtheCustomizable_Stinger / sourceCardId=TOY_330
数据来源: 同上

### 字段比较

- cardId：三条都不同
- dbfId：三条都不同
- set：三条都不同
- collectible：三条都是 true
- 名称：1 与 2 完全相同；3 是子串包含「奇利亚斯」
- 语音/音乐：1 与 2 共用 BOT_548 资源；3 是独立卡

### 判断

- BOT_548 vs CORE_BOT_548：**A. 真正不同的卡牌版本**（核心再版 / 不同 set、不同 dbfId），同时对语音图鉴而言是同一套音频（shared）。
- TOY_330：**C. 同名相关但应该分别展示**（豪华版 3000 型，独立 cardId、独立语音）。
- 不是 B（同一 cardId 被插入多次）：索引 key 与发布目录的 cardId 均唯一。

搜索命中 3 条的直接原因：`scoreCard` 对 `name.includes(q)` 打分。因此「奇利亚斯豪华版3000型」也会进结果。

---

## Card 2 — 风领主奥拉基尔

### 索引 4 条，发布 3 条

索引：

| cardId | dbfId | set | type | rarity | collectible | 是否发布 |
| --- | ---: | --- | --- | --- | --- | --- |
| NEW1_010 | 32 | EXPERT1 | MINION | LEGENDARY | true | 是 |
| CORE_NEW1_010 | 69632 | CORE_HIDDEN | MINION | LEGENDARY | true | 是 |
| VAN_NEW1_010 | 70078 | VANILLA | MINION | LEGENDARY | true | 是 |
| THD_026 | 112965 | TB | HERO | null | false | 否（shouldPublish 过滤） |

英文 `Al'Akir the Windlord` / `Alakir`：搜索 0 条（无英文名字段）。

### 搜索

`search("风领主奥拉基尔")`：`result count = 3`（上述三张 collectible 随从）。

### 首页普通列表（无搜索）

同一数据源 `catalog.cards`，`catalogPage` + `compareHome`（先 collectible+entrance，再 dbfId，再 cardId）。

| 出现位置 | cardId | dbfId | set |
| --- | --- | ---: | --- |
| 第 1 页第 2 张 | NEW1_010 | 32 | EXPERT1 |
| 第 16 页第 14 张 | CORE_NEW1_010 | 69632 | CORE_HIDDEN |
| 第 17 页第 20 张 | VAN_NEW1_010 | 70078 | VANILLA |

`wx:key="id"`，三条 id 不同。翻页 `mergePageItems` 只按 `card.id` 去重，因此三条都会留下。

`card-item` 只显示 `name` + 职业/稀有度，**不显示 set / cardId**，所以三张在 UI 上看起来像同一张卡贴了三次。

语音：CORE / VANILLA 均为 `shared`，sourceCardId=`NEW1_010`，同一 Play clip。

### 为什么列表里会多次出现

不是同一个 cardId 被 push 多次。

不是 Extractor / Resolver。

不是 `wx:for` 把一条数据画成多份。

而是：**Hearthstone 再版体系下三张 collectible 卡都通过了 `shouldPublish`，各自成为列表项。**

判断：**A. 真正不同的卡牌版本**（经典 / 核心再版 / 经典模式 VANILLA）。对语音图鉴是同一套音频。

---

## Data Flow Investigation

```
HearthstoneJSON cards.json（每 cardId 一条）
        ↓
phase11-build.mjs loadMeta() / 写入 card-audio-index.json
        ↓
miniServer loadJson → buildCatalog / shouldPublish
        ↓
GET /api/mini/catalog  或  /api/mini/search
        ↓
index.js fetchPage → cards[]
        ↓
wx:for wx:key="id" → card-item
```

Extractor / Resolver / Player **不参与**卡牌列表组装。它们只在详情/播放时按 cardId 取音频。

| 层 | 文件 | 函数 | 输入 | 输出 | 是否可能产生重复 |
| --- | --- | --- | --- | --- | --- |
| 原始卡牌 | `data/hearthstonejson/zhCN/cards.json` | — | 全量 HSJSON | 每 id 一条 | 同名不同 id 是游戏数据常态 |
| 索引构建 | `phase11-build.mjs` `loadMeta` | 按 `c.id` 建 Map，`byId.has(c.id)` 跳过同 id | 索引对象 | **同一 cardId 不会写两次** |
| 音频索引 | `data/index/card-audio-index.json` | Object keyed by cardId | 35807 keys，全部唯一 | 同名多 id |
| Extractor | `HearthstoneAudioExtractor.js` | 按 voiceKey 抽 WAV | 音频文件 | **不产生列表行** |
| Resolver | `audioBundleResolver.js` | 找 FSB bundle | 音频路径 | **不产生列表行** |
| 发布 | `catalogAdapter.js` `shouldPublish` / `buildCatalog` | collectible 或 VERIFY_IDS | 8154 张，**id 唯一** | 再版全部进入 |
| 搜索 | `scoreCard` / `searchCardsPage` | name / id 子串（无有效英文名） | 命中数组 | 同名再版全部命中；子串会多打出豪华版 |
| 首页列表 | `catalogPage` / `compareHome` | 排序分页 | 分页 items | 再版按 dbfId 散落在不同页 |
| 筛选 | `filterCards` | class / rarity / legendaryMusic | 子集 | 萨满传说会同时留下三张奥拉基尔 |
| 翻页合并 | `mergePageItems` | 按 **card.id** | 去重同 id | **不去重同名** |
| UI | `index.wxml` | `wx:for` `wx:key="id"` | 渲染 | key 正确；无法消除数据层多 id |
| card-item | 不显示 set | 观感重复 | 加重「看起来像同一张」 |

**发生层：数据源（多 cardId 再版）+ 发布策略（所有 collectible 都展示）+ UI 未展示 set。不是 Extractor/Resolver/前端把一条复制成多条。**

对应 Case：**Case A**（不是 B/C/D）。搜索与首页同源，都是 `catalog.cards`，不是 Case E。

全库发布目录中，**1280 个中文名对应多于 1 个 cardId**（再版、皮肤、同名英雄等）。这是系统性问题，不是两张卡的特例。

---

## Search Investigation

匹配字段（`catalogAdapter.scoreCard`）：

- `card.id` 精确 / startsWith / includes
- `card.name` 精确 / startsWith / includes
- `card.nameEn`：代码有，**数据里没有**，英文搜索无效

不匹配：text、flavor。

`search("奇利亚斯")` 底层结果见上，count=3。

---

## List Investigation

首页默认列表 = `loadCatalogPage` → `/api/mini/catalog` → `catalogPage(catalog.cards)`。

搜索 = `searchRemote` → `/api/mini/search` → `searchCardsPage(catalog.cards, q)`。

筛选 = 同一 `catalog.cards` 上的 `filterCards`。

三者数据源一致。差别只是排序：无搜索时 `compareHome`；有搜索时按 score。

---

## Existing Deduplication

| 位置 | 规则 | 作用 |
| --- | --- | --- |
| `phase11-build.mjs` `byId.has(c.id)` | 按 cardId | 索引构建防同 id |
| `validateCardAudioIndex` `seen.has(cardId)` | 按 cardId | 校验 |
| `mergePageItems` / 前端同名函数 | 按 `card.id` | 翻页不重复同一 id |
| `pickCanonicalCardId`（`musicStingerRules.js`） | collectible 优先，再小 dbfId，再 cardId 字符串 | **只用于音乐归属**，不用于列表 |
| `cardRepository.featuredCards` | `seen` Set of cardId | Explorer 精选，不是小程序首页 |

**不存在按 name / dbfId 的列表去重。**

---

## Canonical identity

小程序卡牌身份在代码中一致使用 **`card.id`（即 Hearthstone cardId）**：

- 索引 `unified.cards[id]`、`rec.id === cardId`
- `catalog.byId[card.id]`
- 详情 `GET /api/mini/card/:id`
- 音频 `sourceCardId`
- 翻页 `seen[card.id]`
- `wx:key="id"`

**CANONICAL_IDENTITY = cardId**（对「一条游戏卡」）。

**没有**「展示用 canonical reprint 族」字段。最接近的已有信号是 `voice.play.sourceCardId` / `music.sourceCardId`（shared 再版指向原卡）。

---

## Root Cause

1. HSJSON / 索引里，核心再版、VANILLA 再版、原卡是 **不同 cardId、不同 dbfId、不同 set** 的 collectible 记录。
2. `shouldPublish` 把所有 collectible 放进图鉴。
3. 搜索按名称包含匹配，再版全部命中；「奇利亚斯」还会命中豪华版 3000 型。
4. 列表项 UI 不展示 set/cardId，再版看起来一模一样。
5. 已有去重只防 **同一 cardId** 翻页重复，不合并再版族。

---

## Recommended Fix Location

**推荐：目录发布 / 列表组装层（`shouldPublish` 之后，或 `catalogPage` / `searchCardsPage` 共用的展示规范化），而不是 Extractor、Resolver、Player、card-item 渲染。**

搜索和首页必须用同一规则，否则会出现 Case E。

不推荐只在搜索层去重（首页仍会刷到奥拉基尔再版）。

不推荐按 `name` 去重。

可选产品策略（下一阶段再定，本阶段不改代码）：

1. **语音图鉴折叠再版**：`voice.play.sourceCardId`（或 music.sourceCardId）相同则只保留一条（通常保留 source 自身 / `pickCanonicalCardId`）。CORE_BOT_548、CORE_NEW1_010、VAN_NEW1_010 会折进原卡；TOY_330 保留。
2. **按 set 过滤**：默认隐藏 `CORE_HIDDEN` 和/或 `VANILLA`。
3. **不去重，只改 UI**：显示 set / cardId，让用户看出是再版。

---

## Recommended Identity Key

- 记录身份：**cardId**（已是项目标准）
- 若要「少显示几张看起来一样的卡」：**不要用 name**
- 较安全的折叠键（仅当产品目标是语音图鉴）：**`voice.play.sourceCardId`（fallback 自身 cardId）**，或现成的 `pickCanonicalCardId`
- **UNKNOWN — 若产品要「收藏级每种再版都展示」则不应去重，只补 set 标签**

---

## Risks

- 按 **name** 去重：会把 TOY_330 与 BOT_548 并掉（若用 includes 更糟）；会把「炎魔之王拉格纳罗斯」的随从和 **英雄皮肤** 并掉（已观察到同名 5 条，含 HERO_SKINS）。
- 按 **dbfId**：本案例每条 dbfId 都不同，去不掉再版。
- 按 **sourceCardId** 折叠：符合本 App 的音频共用关系；可能让只想看 Core/Vanilla 条目的用户找不到独立行。详情仍可用 cardId 打开。
- 丢掉 collectible=false：当前已经丢掉；不要为了去重再放进附魔/TB 英雄。
- 误删真正不同版本：**高**（若按名）；**中**（若按 set 一刀切隐藏 VANILLA）；**较低**（若只折叠 shared 音频再版并保留 TOY_330）。

是否需要区分 collectible：

**需要。** 当前已用 collectible 作为发布门槛。`BOT_548e`、`THD_026` 同名但非收藏卡，不应进图鉴。去重不应改回把 false 放进来。

---

## Investigation table

| 场景 | 显示名称 | UI出现次数 | 底层记录数（发布后） | 不同cardId | 不同dbfId | 不同set | 初步判断 |
| ---- | ------- | -----: | ----: | -------: | ------: | ----: | ---- |
| 搜索 | 奇利亚斯 | 3 | 3 | 3 | 3 | 3 | 2 条再版 + 1 条豪华版（子串命中）；非程序复制 |
| 普通列表 | 奇利亚斯（精确名） | 2（第8页、第23页） | 2 | 2 | 2 | 2 | BOT_548 + CORE_BOT_548；TOY_330 名不同故不计入精确名 |
| 搜索 | 风领主奥拉基尔 | 3 | 3 | 3 | 3 | 3 | 经典/核心/VANILLA 再版 |
| 普通列表 | 风领主奥拉基尔 | 3（第1、16、17页） | 3 | 3 | 3 | 3 | 同上；非同一 id 重复插入 |
| 其他 | 炎魔之王拉格纳罗斯 等 | 多名 5 条 | 5 | 5 | 5 | 多 | 再版 + 英雄皮肤；禁止按名去重 |

---

## Conclusion

重复是 **collectible 再版（及搜索子串）被原样展示**，不是管道把一张卡复制了三份。

修复若发生，应在 **catalog 展示策略**，并用 **cardId / sourceCardId**，禁止 `Set(name)`。

本阶段 **未修复**。等待确认后进入 1.4.3。
