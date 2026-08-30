# Phase 1.5.6 Report：最新卡牌职业分类与传说优先排序

## 1. Phase 状态

```text
Phase 1.5.6
Status: IMPLEMENTATION COMPLETE

Production code changes:
  miniprogram/utils/latestGroups.js (new)
  miniprogram/utils/data.js
  miniprogram/pages/latest/latest.js
  miniprogram/pages/latest/latest.wxml
  miniprogram/pages/latest/latest.wxss

Test code changes:
  test/latestClassGrouping.test.js (new)
  package.json (test script)

Data changes:
0

Audio changes:
0

Catalog core changes:
0
```

未改 `latest-set.json`、`card-audio-index.json`、HSJSON、`shouldPublish`、`foldSharedReprints`、`buildCatalog`、`catalog.byId`、牌库、详情页、`card-item`、tabBar、音频。

未进入 Phase 1.5.7。

---

## 2. 数据快照

```text
latest cards: 164
groups: 12
legendary: 31
non-legendary: 133
```

| class | count |
| --- | --- |
| DEATHKNIGHT | 10 |
| DEMONHUNTER | 10 |
| DRUID | 10 |
| HUNTER | 10 |
| MAGE | 10 |
| PALADIN | 10 |
| SHAMAN | 10 |
| PRIEST | 17 |
| ROGUE | 17 |
| WARLOCK | 17 |
| WARRIOR | 17 |
| NEUTRAL | 26 |

---

## 3. 排序规则

```text
职业：
CLASS_ORDER
（与 labels.js / catalogAdapter 现有顺序一致）

DEATHKNIGHT → DEMONHUNTER → DRUID → HUNTER → MAGE → PALADIN
→ PRIEST → ROGUE → SHAMAN → WARLOCK → WARRIOR → NEUTRAL

组内：
Legendary first
（rarity === "LEGENDARY" 或 legendary === true）

同优先级：
保持 catalog 原始相对顺序
（稳定 partition，不按 dbfId / 名称 / 费用排序）
```

中立为最后一个已知职业区块，标题为「中立」（`classLabel`）。

指令文案里的微信验收清单把「萨满祭司」写在「牧师」之前；**实际实现跟随项目 `CLASS_ORDER`**，因此牧师 → 潜行者 → 萨满祭司。

空职业不渲染。未知 `class` 不丢卡，放在 `CLASS_ORDER` 之后。

---

## 4. 数据流

```text
latest-set.json
  ↓
folded catalog.cards
  ↓
GET /api/mini/latest?page=&pageSize=   （分页 API 保留，上限仍 50）
  ↓
loadLatestAll：pageSize=50 逐页合并到全量 164
  ↓
groupLatestCardsByClass
  ↓
latest 页按 groups 渲染 card-item
```

未在页面读 HSJSON。未改 latest 卡片 DTO。未按页分组。

---

## 5. 页面

- 顶部：逃离紫罗兰监狱 / 共 164 张
- 每职业：标题 + 「N 张」+ 双列 `card-item`
- 点击仍为 `navigateTo /pages/card/card?id=`
- 页面滚动（非 scroll-view），无虚拟列表
- 无 `onShow` 重载

---

## 6. 测试

`test/latestCards.test.js` TEST 1–10 保留并通过。

`test/latestClassGrouping.test.js` TEST 1–12 通过（164、单归属、CLASS_ORDER、传说前置、相对序、31/133、职业计数、中立最后、无重复 id、不按 isMiniSet 丢卡、未知职业不崩溃）。

```text
npm test: PASS

WeChat DevTools: NOT VERIFIED
MANUAL REQUIRED

Real device: NOT VERIFIED
MANUAL REQUIRED
```

自动化通过不等于微信开发者工具或真机验证。

---

## 7. Mini 重启

本阶段结束后已重启 `npm run mini`，使开发者工具连到含分组逻辑的客户端代码所依赖的现有 latest API（API 结构未改，客户端改为拉全量后分组）。

请在微信开发者工具重新编译后按指令第二十八节验收。
