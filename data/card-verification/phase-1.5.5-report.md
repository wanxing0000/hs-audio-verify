# Phase 1.5.5 Report：最新卡牌分类与排序调查

## 1. Phase 状态

```text
Phase 1.5.5
Status: INVESTIGATION COMPLETE
Production code changes: 0
Test code changes: 0
Data changes: 0
UI changes: 0
```

只新增本报告。未改 `src/`、`miniprogram/`、`test/`、`package.json`、`data/index/latest-set.json`、Catalog、HSJSON、音频。未 `npm install`。未进入 Phase 1.5.6。调查用临时脚本已删除。

```text
READY FOR PHASE 1.5.6
```

当前 164 张 latest 卡的 `class` / `rarity` 完整、无空值、无未知枚举、无多职业数组。分类可以只使用已有 folded catalog 字段。分页与「按职业成块展示」冲突，这是 1.5.6 的主要架构决策，不是数据缺口。

---

## 2. 当前 latest 数据流

```text
data/index/latest-set.json          (set 唯一过滤字段)
        ↓
data/index/card-audio-index.json
        ↓
shouldPublish
        ↓
adaptCard                           (class / classLabel / rarity / rarityLabel)
        ↓
foldSharedReprints                  (catalog.cards；byId 仍保留 reprint id)
        ↓
filterLatestCards                   (card.set === latestSet.set，保持 catalog 相对顺序)
        ↓
paginateList                        (默认 pageSize 30，上限 50)
        ↓
toListCard                          (列表 DTO，含 class、rarity、legendary、id)
        ↓
GET /api/mini/latest
        ↓
latest.js 多页合并
        ↓
单一 .grid + card-item
```

分类应插在：

```text
filterLatestCards
  ↓
【1.5.6 插入】按 class 分组 + 组内传说稳定前置
  ↓
再决定是否 paginate / 一次返回全部
  ↓
latest page 按 group 渲染
```

禁止插在 fold 之前，禁止绕过 `catalog.cards`，禁止在页面重读 HSJSON。

---

## 3. 实际职业字段

### 结论（PROVEN）

最新列表用的职业字段名是 **`class`**，不是 `cardClass`，catalog **没有** `classes` 数组。

| 层 | 字段 | 来源 |
| --- | --- | --- |
| HSJSON | `cardClass`（字符串） | `data/hearthstonejson/zhCN/cards.collectible.json` |
| 索引构建 `phase11-build.mjs` | `class: c.cardClass \|\| x.cardClass` | 写入 `card-audio-index.json` |
| `adaptCard` | `class: raw.class \|\| null` | `catalog.cards` |
| `adaptCard` | `classLabel: CLASS_ZH[raw.class] \|\| raw.class \|\| ''` | 中文名 |
| `toListCard` / latest API | `class`、`classLabel` | 与 catalog 相同，无第二套 DTO |
| `toListCard` | **没有** `cardClass` / `classes` / `multiClassGroup` / `isMiniSet` | |

示例（真实 latest 第一张，catalog 顺序）：

```json
{
  "id": "CAP_000",
  "name": "军情七处杀手",
  "class": "ROGUE",
  "classLabel": "潜行者",
  "rarity": "COMMON",
  "rarityLabel": "普通",
  "legendary": false,
  "set": "ESCAPEFROM_VIOLET_HOLD"
}
```

`card-item` 只展示 `card.classLabel · card.rarityLabel`，点击事件只传 `card.id`。页面 **不应** 再读原始 HSJSON。

索引对象实际键（CAP_000）：`id, name, text, flavor, type, class, rarity, collectible, set, dbfId, cardImageKey, voice, music, entrancePreview`。无 `cardClass`。

---

## 4. 当前职业统计

集合：`catalog.cards` 过滤 `set === ESCAPEFROM_VIOLET_HOLD`，共 **164**。与 HSJSON collectible 同 set **164** 张 id 完全对齐。

| class（原始值） | 中文（CLASS_ZH） | 数量 |
| --- | --- | --- |
| DEATHKNIGHT | 死亡骑士 | 10 |
| DEMONHUNTER | 恶魔猎手 | 10 |
| DRUID | 德鲁伊 | 10 |
| HUNTER | 猎人 | 10 |
| MAGE | 法师 | 10 |
| PALADIN | 圣骑士 | 10 |
| SHAMAN | 萨满祭司 | 10 |
| PRIEST | 牧师 | 17 |
| ROGUE | 潜行者 | 17 |
| WARLOCK | 术士 | 17 |
| WARRIOR | 战士 | 17 |
| NEUTRAL | 中立 | 26 |
| **合计** | | **164** |

这 12 个值 **全部** 已在项目 `CLASS_ZH` / `CLASS_ORDER` 中。无额外新职业。

`isMiniSet=true`（HSJSON collectible）：**28** 张，仍按 `class` 归入上表，不是独立职业。

---

## 5. 当前 rarity 统计

判断传说：**`rarity === "LEGENDARY"`**（PROVEN）。`toListCard` 另有布尔 `legendary`，与该等式一致。

| rarity | 数量 |
| --- | --- |
| LEGENDARY | 31 |
| EPIC | 36 |
| RARE | 46 |
| COMMON | 51 |
| FREE | 0 |
| 其他 / 空 | 0 |
| **合计** | **164** |

latest API 已包含 `rarity`、`rarityLabel`、`legendary`。1.5.6 **不必** 补字段。

---

## 6. class + rarity 统计

| class | legendary | other | 合计 |
| --- | --- | --- | --- |
| DEATHKNIGHT | 2 | 8 | 10 |
| DEMONHUNTER | 2 | 8 | 10 |
| DRUID | 2 | 8 | 10 |
| HUNTER | 2 | 8 | 10 |
| MAGE | 2 | 8 | 10 |
| PALADIN | 2 | 8 | 10 |
| SHAMAN | 2 | 8 | 10 |
| PRIEST | 3 | 14 | 17 |
| ROGUE | 3 | 14 | 17 |
| WARLOCK | 3 | 14 | 17 |
| WARRIOR | 3 | 14 | 17 |
| NEUTRAL | 5 | 21 | 26 |
| **合计** | **31** | **133** | **164** |

组内 rarity 细分（无异常值）：

| class | COMMON | RARE | EPIC | LEGENDARY |
| --- | --- | --- | --- | --- |
| DEATHKNIGHT | 3 | 3 | 2 | 2 |
| DEMONHUNTER | 3 | 3 | 2 | 2 |
| DRUID | 3 | 3 | 2 | 2 |
| HUNTER | 3 | 3 | 2 | 2 |
| MAGE | 3 | 3 | 2 | 2 |
| PALADIN | 3 | 3 | 2 | 2 |
| SHAMAN | 3 | 3 | 2 | 2 |
| PRIEST | 5 | 5 | 4 | 3 |
| ROGUE | 5 | 5 | 4 | 3 |
| WARLOCK | 5 | 5 | 4 | 3 |
| WARRIOR | 5 | 5 | 4 | 3 |
| NEUTRAL | 10 | 5 | 6 | 5 |

---

## 7. 多职业调查

```text
PROVEN for current latest set: NOT FOUND
HYPOTHESIS for future sets: possible in HSJSON, not in catalog today
```

对当前 `ESCAPEFROM_VIOLET_HOLD`：

| 检查 | collectible 164 | cards.json 同 set 330（含非收藏） |
| --- | --- | --- |
| `classes` 数组非空 | 0 | 0 |
| `multiClassGroup` 存在 | 0 | 0 |
| HSJSON 职业相关键 | 仅 `cardClass` | 同左（本 set） |
| catalog `class` vs HSJSON `cardClass` 不一致 | 0 | — |

`phase11-build.mjs` **不拷贝** `classes` / `multiClassGroup`。`adaptCard` / `toListCard` 也不保留。即使未来 HSJSON 出现多职业卡，**当前流水线也只会留下单个 `class`（= cardClass）**。

`card-item` 不读取 `classes`，无法按多职业重复渲染，除非 1.5.6 自己按数组展开——**不要这样做**。

---

## 8. 异常 class

当前 latest 164：

| 异常 | 数量 | cardId |
| --- | --- | --- |
| `class` null / undefined / `''` | 0 | — |
| `INVALID` / `UNKNOWN` | 0 | — |
| 不在 `CLASS_ZH` 的新值 | 0 | — |
| `rarity` 空或未知 | 0 | — |
| catalog 有、HSJSON collectible 无 | 0 | — |
| HSJSON collectible 有、catalog 无 | 0 | — |
| latest 中 `CORE_*` / `VAN_*` id | 0 | — |

无异常 cardId 可列。1.5.6 仍需为「未来未知 class」写兜底，避免丢卡。

---

## 9. 当前 latest API 排序与分页机制

### 过滤前（catalog.cards）

`foldSharedReprints` 把 canonical group key **按字符串 sort** 后输出。因此 `catalog.cards` 的顺序是 **fold 分组键字母序**，不是 HSJSON 文件序，也不是 dbfId 序。对同一索引文件该顺序稳定。

### 过滤

`filterLatestCards`：正向扫描，`card.set === latestSet.set`，**不 sort**。latest 相对顺序 = 上述 catalog 顺序中的子集。

当前未分组时，列表会从 `CAP_000` 等 id 靠前的卡开始，实测开头是 **潜行者**，不是死亡骑士。

### 分页

`latestCardsPage`：**filter → paginateList → toListCard**。没有 `compareHome`（牌库 `catalogPage` 才会 `filter → compareHome → paginate`）。

| 项 | 值 |
| --- | --- |
| 默认 pageSize | 30（`clampPageSize` 非法时也回 30） |
| 上限 | 50 |
| latest 页请求 | `pageSize: 30` |
| 164 张所需页数 | 6 页（30×5 + 14） |
| 若 pageSize=20 | 9 页 |

`count` / `total` = 过滤后全量 164；`cards` / `items` = **当前页**。

### 前端若对「当前已加载列表」分组

在未拉完全部页之前：

- 第 1 页 30 张会按 catalog 顺序切出若干职业的**碎片**
- 同一职业会被拆到多页
- 职业标题会随加载跳动/重复

这是当前分页与分类目标的**硬冲突**。不是实现细节。

---

## 10. 分类与分页方案比较

| 方案 | 做法 | 优点 | 缺点 | 判定 |
| --- | --- | --- | --- | --- |
| A 前端分类 | 保持分页 API；页内 group | 不改 API | **职业被拆页**；未加载完无法出完整 section | 否（除非先拉完全量） |
| A2 前端分类 + 拉完全部页 | 6 次请求后 group | API 不动 | 闪烁/中间态；分组逻辑在 Page，难单测；多请求 | 可用但不佳 |
| **B 服务端分类一次返回** | filter → group → legendary partition → `groups` | 测试集中；页只渲染；164 张很小 | 1.5.4 分页语义要改；需更新 latest 测试 | **RECOMMENDED** |
| C 新 grouped endpoint | `/latest/grouped` 或 `?grouped=1` | 保留旧分页 | 两套 latest 行为；页面仍要选对接口 | 仅当必须兼容旧客户端 |
| D 按职业分页 | 每 class 一组再 paginate | 理论上无限扩展 | 对 164 过度设计；UI 复杂 | 否 |

**RECOMMENDED：B**

理由：

1. 当前规模 164，远小于牌库 7263；`paginateList` 是为牌库准备的，不是为「完整职业块」准备的。
2. 分组 + 传说前置是 **latest 专用**，应放在 `catalogAdapter` 的 latest 数据层（与 `filterLatestCards` 同层），不要复制进 Page，也不要改 `catalogPage`。
3. 微信小程序 164 个 `card-item` + 256px 卡图可接受；图片本身异步加载。
4. 不需要 Redis/新依赖/新组件。

不推荐为 164 张做「每职业内再分页」。

---

## 11. 推荐职业顺序

| 声明 | 内容 |
| --- | --- |
| **PROVEN（本项目）** | `CLASS_ORDER` 已存在于 `catalogAdapter.js` 与 `miniprogram/utils/labels.js`，牌库 `filter-bar` 使用同一顺序，**中立在最后** |
| **NOT DATA-PROVEN** | 该顺序 **不是** 从官方扩展包页、HSJSON enum 发行序或本扩展 UI 证明出来的 |
| **ORDER NOT CONFIRMED by user** | 需求只说「按职业分类」，未指定职业块顺序 |
| **RECOMMENDED** | 复用现有 `CLASS_ORDER`，不要再发明第三份顺序 |

```text
DEATHKNIGHT → DEMONHUNTER → DRUID → HUNTER → MAGE → PALADIN
→ PRIEST → ROGUE → SHAMAN → WARLOCK → WARRIOR → NEUTRAL
```

中文名用已有 `CLASS_ZH`。空 class 组不要插入 CLASS_ORDER 中间。

---

## 12. 推荐职业内排序

```text
LEGENDARY first
then stable original order   // = 过滤后 catalog.cards 相对顺序
```

**不要** 组内再按 dbfId / name / cardId 排序。

推荐 **稳定 partition**，不要依赖 `Array.sort` 稳定性（Node 24 的 sort 实际稳定，微信 JSCore 不在本阶段证明）：

```text
legend = []
rest = []
for card in classBucket:          // classBucket 已保持 catalog 相对序
  if card.rarity === 'LEGENDARY': legend.push(card)
  else rest.push(card)
return legend.concat(rest)
```

法师组实测（catalog 相对序 → partition）：

```text
原: JAIL_122(L), JAIL_123(R), JAIL_125(C), JAIL_312(C), JAIL_313(R),
    JAIL_315(R), JAIL_319(L), JAIL_321(E), JAIL_379(C), JAIL_735(E)
后: JAIL_122(L), JAIL_319(L), JAIL_123(R), JAIL_125(C), JAIL_312(C),
    JAIL_313(R), JAIL_315(R), JAIL_321(E), JAIL_379(C), JAIL_735(E)
```

传说相对顺序不变；非传说相对顺序不变。符合需求示例。

「原顺序」含义必须写清：是 **folded catalog.cards** 的相对序，不是 HSJSON 数组序。

---

## 13. 中立处理

- 数量最多：**26**（约 16%）
- 用户未要求中立位置
- 牌库筛选已把 NEUTRAL 放最后（PROJECT-PROVEN）
- 中立放最前会让 11 个职业块整体下移，浏览职业卡更慢

**RECOMMENDED：** 中立 **最后一块**（跟随 `CLASS_ORDER`）。

不能写成「官方已确认」。

---

## 14. 多职业卡处理

当前 set：**NOT FOUND**，每张卡只会进一个 `class` bucket。

**RECOMMENDED（现有语义，一张卡出现一次）：**

```text
B. 只按 catalog.class（= HSJSON cardClass）归入一个职业
禁止按 classes[] 把同一 id 渲染多次
```

不新建「多职业」分组。不改索引、不补 `classes` 字段（那会扩大范围）。若未来 HSJSON 出现 `classes` 而 catalog 仍只有 `class`，行为与今天一致：单归属。

---

## 15. 未知 class 处理

当前 0 张。1.5.6 仍必须：

1. 先输出 `CLASS_ORDER` 中数量 > 0 的组
2. 其余 `class` 值（含 null）各成一组，放在 **NEUTRAL 之后**
3. 标题：`CLASS_ZH[class] || classLabel || class || '未知'`
4. **禁止** `filter` 掉未知 class

保证：分组后 id 集合 = 过滤后 id 集合，张数仍 164。

---

## 16. 再版折叠兼容

**PROVEN：** latest 使用 `catalog.cards`，fold 在 filter 之前。

| id | 在 catalog.cards？ | 在 latest 164？ |
| --- | --- | --- |
| CORE_BOT_548 | 否（已 fold） | 否 |
| BOT_548 | 是（BOOMSDAY，非 latest set） | 否 |
| CORE_NEW1_010 / VAN_NEW1_010 | 否 | 否 |
| NEW1_010 | 是（非该 set） | 否 |

1.5.6 分组不得调用 `foldSharedReprints`，不得按 name/dbfId 去重。分组只是排列，不增删卡。

---

## 17. UI 最小改造方案

当前 latest WXML：一个 `.grid`，`wx:for="{{cards}}"` + `card-item`。无 section header。样式与牌库双列 cell 相同（50% + `card-item` 未改）。

小程序支持嵌套 `wx:for`；本仓库尚未用 `wx:for-item`，1.5.6 用它避免内外都叫 `item`。

**最小结构（不新建组件）：**

```text
hero（最新卡牌 / 逃离紫罗兰监狱 / 共 164 张）不变

wx:for="{{groups}}" wx:for-item="group" wx:key="class"
  职业标题 group.classLabel
  .grid
    wx:for="{{group.cards}}" wx:for-item="card" wx:key="id"
      card-item card="{{card}}" bindopen="onOpenCard"
```

- 复用现有 `.grid` / `.cell`
- 标题可用接近牌库 `.h2` 的样式，只写在 `latest.wxss`
- **不改 card-item**
- **不改牌库页**
- 若一次返回 164 张：可去掉 `onReachBottom` 加载更多（只影响 latest）

不需要新 UI 框架、动画、职业图标。

---

## 18. API 最小改造方案

**保持路径：** `GET /api/mini/latest`

**不建议** 本阶段再加 `/grouped` 或 `grouped=true`（仅 latest 页消费该接口；双接口会重复维护）。

**建议返回（讨论稿，1.5.6 实施）：**

```json
{
  "set": "ESCAPEFROM_VIOLET_HOLD",
  "nameEn": "Escape from Violet Hold",
  "nameZh": "逃离紫罗兰监狱",
  "releaseDate": "2026-07-07T10:00:00-07:00",
  "count": 164,
  "groups": [
    {
      "class": "DEATHKNIGHT",
      "classLabel": "死亡骑士",
      "count": 10,
      "cards": []
    }
  ]
}
```

`groups[].cards` 继续 `toListCard`，禁止第二套 DTO。

分页：grouped 模式下 **一次返回全量**；`hasMore: false`。若保留 `page`/`pageSize` 字段，语义改为「已是全量」以免客户端误加载。1.5.4 的分页测试必须在 1.5.6 **改写**，不要为了旧测试牺牲分组完整性。

`miniprogram/utils/data.js` 的 `loadLatestPage` 改为读取 `groups`（可同时提供扁平 `cards` 作测试便利，但页面应以 groups 为准，避免两份顺序不一致）。

**隔离：** 只动 `latestCardsPage`（及必要时 `loadLatestPage` + latest 页）。不改 `/api/mini/catalog`、`/api/mini/search`、`filterCards`、`compareHome`。

未来职业/稀有度筛选 **不要** 在 1.5.6 做。

---

## 19. Phase 1.5.6 实施计划

只计划，本阶段不实施。

1. 在 `catalogAdapter.js` 新增 latest 专用 `groupLatestCards`（CLASS_ORDER + 未知兜底 + legendary partition）。**不改** `foldSharedReprints` / `shouldPublish` / `catalogPage`。
2. `latestCardsPage`：filter 后分组，返回 `groups` + `count`；不再按 30 条切碎职业。
3. Mini `/api/mini/latest` 仍走 `latestCardsPage`。
4. `loadLatestPage` 适配 `groups`。
5. `pages/latest/*`：按 group 渲染；去掉依赖分页才能看全的逻辑；**页面 JS 仍不得写死** `ESCAPEFROM_VIOLET_HOLD` 或职业枚举（标题用 API `classLabel`）。
6. 不改 `pages/index`、`pages/card`、`card-item`、tabBar、音频。
7. 更新 `test/latestCards.test.js`（分页语义改为分组语义），`package.json` 已包含该文件则不必改脚本名。
8. `npm test`；报告 `phase-1.5.6-report.md`。
9. 微信开发者工具手动验收标 MANUAL REQUIRED。

---

## 20. Phase 1.5.6 测试计划

| 编号 | 内容 |
| --- | --- |
| TEST 1 | latestSet 过滤不变：只有 `ESCAPEFROM_VIOLET_HOLD`；CORE / TIME_TRAVEL 不出现 |
| TEST 2 | 职业分组：每组 `class` 一致；组顺序遵循 CLASS_ORDER（已知职业） |
| TEST 3 | 扁平展开后恰好 164 个 id，无重复、无丢失 |
| TEST 4 | 每组内所有 LEGENDARY 都在非传说之前 |
| TEST 5 | 每组内传说之间、非传说之间相对序 = 过滤后 catalog 相对序 |
| TEST 6 | NEUTRAL 存在且（若采用推荐）为 CLASS_ORDER 最后一块 |
| TEST 7 | 构造未知 class：仍出现在 groups 末尾，不丢卡 |
| TEST 8 | 同名不同 set 仍只留 latest；构造 `classes[]` 时仍只按 `class` 出现一次（当前真实数据无多职业） |
| TEST 9 | folded reprint：`CORE_BOT_548` 等不因分组再现 |
| TEST 10 | 列表卡仍用 `id` 跳转详情，不用 name/dbfId |
| TEST 11 | `catalogPage` / 牌库相关测试仍过；latest 分组不 mutate `catalog.cards` |
| TEST 12 | API：200；`count` 与展开张数一致；`groups` 为数组；不再把半页未分组列表当成完整职业块 |

TEST 8 对真实 164 张是「无多职业」快照；应用 fixture 覆盖「若误按 classes 展开会重复」的防护。

---

## 21. 风险矩阵

| 风险 | 现状 | 1.5.6 应对 |
| --- | --- | --- |
| 职业字段异常 | 当前 0 | 未知组兜底，禁止丢卡 |
| 多职业卡 | 当前 NOT FOUND；catalog 无 `classes` | 只按 `class` 出现一次 |
| 分页拆职业 | **当前必现**（pageSize 30） | 改为全量 groups |
| 未知 class | 当前 0 | 见 §15 |
| 排序稳定性 | 应用 partition，不靠 sort | 单测相对序 |
| 再版折叠 | latest 已用 folded cards | 不重 fold、不去重 name |
| 页面性能 | 164 张可接受 | 不一次拉 7263 |
| API 兼容 | 1.5.4 测试假定分页 | 1.5.6 必须改测试，不并行两套 latest |
| 职业顺序争议 | 用户未确认 | 复用 CLASS_ORDER，报告标 RECOMMENDED |
| 误改牌库 | 隔离点清晰 | 禁止改 index.js / catalogPage |
| 页面写死 set/class | 1.5.4 已禁止写死 set | 组标题用 API classLabel |

---

## 22. 最终结论

```text
READY FOR PHASE 1.5.6
```

不是 DATA INSUFFICIENT：职业与传说字段已在 folded catalog / latest DTO 中，当前 164 张无空 class、无多职业、无未知 rarity。

**下一阶段推荐方案（仍不在本阶段实施）：**

```text
Latest set source:          latest-set.json（不变）
Catalog card source:        existing folded catalog.cards
Deduplication:              existing foldSharedReprints only
Latest filtering:           card.set === latestSet.set
Grouping field:             card.class
Legendary rule:             rarity === "LEGENDARY"  (stable partition)
Class order:                existing CLASS_ORDER (RECOMMENDED / PROJECT-PROVEN)
Neutral:                    last group (RECOMMENDED)
Multi-class:                single bucket by class; no duplicate ids
Pagination:                 do not page-split groups; return all 164 grouped
UI:                         section title + existing card-item grid
Client-side set hardcode:   NONE
```

停止。不实施 1.5.6。
