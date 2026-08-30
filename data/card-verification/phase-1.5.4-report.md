# Phase 1.5.4 Report：接入最新扩展包卡牌

## 1. Phase 状态

```text
Phase 1.5.4
Status: IMPLEMENTATION COMPLETE
Automated tests: PASS
WeChat DevTools / device UI: NOT VERIFIED
Manual playback (Voice / Music / Entrance): NOT VERIFIED
MANUAL REQUIRED
```

本阶段把「最新卡牌」Tab 从 1.5.2 占位页接到 folded catalog + 本地 latest-set metadata。未进入自动抓取 Blizzard 网站的后续 Phase。

```text
Latest set source:
Blizzard official expansion information

Catalog card source:
existing folded catalog

Deduplication:
existing foldSharedReprints

Latest filtering:
card.set === latestSet.set

Client-side latest-set hardcode:
NONE
```

---

## 2. 修改文件

- `src/miniprogram/catalogAdapter.js` — 仅新增 latest metadata 解析 / 过滤 / 分页封装；未改 `shouldPublish`、`foldSharedReprints`、`buildCatalog` 折叠分组、`catalogPage` 排序
- `src/miniprogram/miniServer.js` — 启动时读取 latest-set；新增 `GET /api/mini/latest`
- `miniprogram/utils/data.js` — 新增 `loadLatestPage`
- `miniprogram/pages/latest/latest.js`
- `miniprogram/pages/latest/latest.wxml`
- `miniprogram/pages/latest/latest.wxss`
- `miniprogram/pages/latest/latest.json` — 增加 `onReachBottomDistance`
- `package.json` — `npm test` 接入 `test/latestCards.test.js`

---

## 3. 新增文件

- `data/index/latest-set.json`
- `test/latestCards.test.js`
- `data/card-verification/phase-1.5.4-report.md`（本报告）

---

## 4. Latest metadata

路径：`data/index/latest-set.json`

| 字段 | 值 |
| --- | --- |
| `set` | `ESCAPEFROM_VIOLET_HOLD`（唯一过滤字段） |
| `nameEn` | Escape from Violet Hold |
| `nameZh` | 逃离紫罗兰监狱 |
| `releaseDate` | `2026-07-07T10:00:00-07:00`（仅 metadata，不参与过滤） |
| `source` | Blizzard official expansion page |
| `sourceUrl` | https://hearthstone.blizzard.com/en-us/expansions-adventures/escape-from-violet-hold |
| `verified` | true |

页面 JS **没有** `ESCAPEFROM_VIOLET_HOLD` 硬编码。更换扩展包只需改该 JSON 并重启 `npm run mini`。

---

## 5. API 路径

```text
GET /api/mini/latest?page=&pageSize=
```

- 读取 latest-set metadata
- 使用内存中已构建的 `catalog.cards`（`shouldPublish` → `adaptCard` → `foldSharedReprints`）
- `card.set === latestSet.set` 过滤，**保持 catalog 原顺序**（不走 `compareHome` / dbfId「越新」）
- 复用现有 `paginateList`（默认 pageSize 30，上限 50）
- list DTO 复用 `toListCard`，无第二套卡片结构
- metadata 缺失/损坏：HTTP 500，`code: LATEST_SET_CONFIG_INVALID`，**不会**把整个 catalog 当 latest，也不会猜测 set

未同时维护 `GET /api/mini/catalog?set=` 作为 latest 入口。牌库仍用 `/api/mini/catalog`。

---

## 6. 数据来源

```text
原始卡牌
  ↓
shouldPublish
  ↓
adaptCard
  ↓
foldSharedReprints
  ↓
catalog.cards
  ↓
filter card.set === latestSet.set
  ↓
GET /api/mini/latest
  ↓
latest page + card-item
```

未从 HSJSON 直接喂 latest 页，未在页面重做 collectible / 名称去重 / fold。

---

## 7. 最新 set

`ESCAPEFROM_VIOLET_HOLD` / Escape from Violet Hold / 逃离紫罗兰监狱

来源：Blizzard 官方扩展包信息（Phase 1.5.3 已确认发行日 2026-07-07 10:00 PT），映射写入本地 metadata，**不是** dbfId / clientVersion / 字母序 / TIME_TRAVEL / HSJSON `/v1/latest/` 推断。

---

## 8. 卡牌数量

当前数据快照（未为测试改生产数据）：

| 口径 | 数量 |
| --- | --- |
| HSJSON collectible `ESCAPEFROM_VIOLET_HOLD` | 164 |
| folded catalog 同 set | 164 |
| latest filter | 164 |
| 该 set 因 shared reprint 被 fold 掉 | 0 |
| 全 catalog `catalog.cards` | 7263 |

164 与 1.5.3 调查一致。测试将 164 / 7263 作为**当前快照断言**；若未来数据变化应先调查，禁止为了绿测改断言或改生产 JSON。

---

## 9. Mini Set 数量

HSJSON collectible 中该 set `isMiniSet === true`：**28**。

过滤条件只有 `card.set === latestSet.set`，**没有** `!card.isMiniSet`。这 28 张属于该 Expansion，应出现在 latest 列表。`toListCard` 仍不输出 `isMiniSet` 字段（与牌库列表 DTO 一致）。

---

## 10. fold 兼容性

继续使用现有 `foldSharedReprints` 结果。

- 全库：before 8154 → after 7263，folded 891
- `ESCAPEFROM_VIOLET_HOLD`：fold 前后均为 164，lost 0
- latest 结果不含已折叠的 `CORE_BOT_548` 这类 Core/VANILLA 再版
- latest **不会**再次 fold，也**不会**按名称去重（同名但不同 set 只留 latest set；同名且同属 latest set 则都保留）

---

## 11. 页面实现

`pages/latest/latest`：

- `onLoad` → `GET /api/mini/latest`（`loadLatestPage`）
- 标题「最新卡牌」，扩展包中文名来自 API `nameZh`，数量来自 API `count`
- 双列 `card-item`，点击 `navigateTo /pages/card/card?id=`
- 分页与牌库相同：`pageSize` 30，`onReachBottom`
- loading / error / empty 复用牌库视觉语言
- 无 `onShow` 重载（Tab 切回应保留已加载列表）
- 已去掉「即将上线」
- `mini-player lift-for-tab-bar`
- 未改 `app.json` tabBar、未改 `pages/index/index.js`、未改详情页、未改 `card-item`

---

## 12. 测试结果

`test/latestCards.test.js`：

| 编号 | 内容 | 结果 |
| --- | --- | --- |
| TEST 1 | metadata set / nameEn / nameZh / releaseDate | PASS |
| TEST 2 | 只保留 latest set | PASS |
| TEST 3 | 同名不同 set；非名称去重 | PASS |
| TEST 4 | Mini Set 保留 | PASS |
| TEST 5 | 使用 folded catalog，无 CORE_BOT_548 | PASS |
| TEST 6 | 跳转使用 card `id` | PASS |
| TEST 7 | 真实数据 latest = 164 | PASS |
| TEST 8 | catalog 仍为 7263，原数组未被 destructive filter | PASS |
| TEST 9 | `/api/mini/latest` 200、set、分页 count、无 Core/VANILLA 再版 | PASS |
| TEST 10 | metadata 无效 → `LATEST_SET_CONFIG_INVALID`，不返回全库 | PASS |

---

## 13. npm test 结果

```text
npm test
Status: PASS
```

含既有 suite + 本阶段 `latestCards.test.js`。自动化通过 **不等于** 微信真机验收。

---

## 14. 手动测试状态

```text
WeChat DevTools compile: NOT VERIFIED
MANUAL REQUIRED

Default tab 最新卡牌 UI: NOT VERIFIED
MANUAL REQUIRED

Click card → detail: NOT VERIFIED
MANUAL REQUIRED

Voice / Music / Entrance on latest card: NOT VERIFIED
MANUAL REQUIRED

Library search / filter / pagination after tab switch: NOT VERIFIED
MANUAL REQUIRED

More tab: NOT VERIFIED
MANUAL REQUIRED

Tab switch retains latest data: NOT VERIFIED
MANUAL REQUIRED

Card art crop / mini-player vs tabBar: NOT VERIFIED
MANUAL REQUIRED
```

建议步骤：重启 `npm run mini` → 微信开发者工具重新编译 → 按 Phase 需求第二十四节走一遍。

---

## 15. 未修改的核心模块

- `foldSharedReprints` / `shouldPublish` / `buildCatalog` 折叠核心
- `miniprogram/pages/index/index.js`（搜索 / 筛选 / 分页）
- `miniprogram/pages/card/card.*`
- `miniprogram/components/card-item/*` 行为
- `miniprogram/app.json` tabBar
- `player.js` / `playerController.js` / `audio.js` / `mixPcm16` / `entrancePreviewService`
- Resolver / Extractor / Audio Index / Mini 音频路由
- HSJSON 与 `card-audio-index.json` 生产数据

仓库当前无 git，文件清单按本阶段实际写入核对。

---

## 16. 当前已知风险

1. 微信开发者工具 / 真机 UI 与播放链路尚未人工确认。
2. latest metadata 只在 Mini 启动时加载；改 JSON 后必须重启 `npm run mini`。
3. 配置无效时 latest API 明确失败，最新 Tab 会走加载失败 UI，而不是猜一个 set。
4. `adaptCard` 仍不拷贝 `isMiniSet`；列表过滤靠 `set`，不影响这 28 张是否出现。
5. 164 / 7263 是当前索引快照；HSJSON 或索引重建后数量可能变化，需调查而非改断言凑绿。

---

## 17. 后续建议

1. 完成第二十四节微信开发者工具手动验收。
2. 未来换扩展包：只改 `data/index/latest-set.json` 的 `set` 与名称/日期，重启 Mini。不要在页面 JS 写死 set。
3. 不要把「从 Blizzard 网站自动抓最新扩展包」混进本阶段之后的热修；若需要，单独设计 Phase。
4. 不要用 dbfId / clientVersion / TIME_TRAVEL / HSJSON latest URL 自动推断最新 Expansion。
