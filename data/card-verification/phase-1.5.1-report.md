# Phase 1.5.1 调查报告：底部 Tab + 页面架构

INVESTIGATION ONLY。未修改生产代码、测试、数据、UI。未创建页面。未进入 Phase 1.5.2。

---

## 1. 当前页面结构

`miniprogramRoot`（`project.config.json`）= `miniprogram/`。页面注册只在 `miniprogram/app.json`。无 `custom-tab-bar/`。无任何 png/svg 图标资源。

### 正式注册页面

| 页面 | 路径 | 用途 | 是否当前首页 | 是否可能成为 Tab |
| --- | --- | --- | --- | --- |
| 卡牌列表（现首页） | `pages/index/index` | 搜索、筛选、分页、卡牌网格、跳转详情 | **是**（`pages` 数组第 1 项） | **是** → 产品名「牌库」 |
| 卡牌详情 | `pages/card/card` | 单卡详情 + 语音 / 音乐 / Entrance | 否 | **否**（`navigateTo` 子页） |
| 音频诊断 | `pages/audio-test/audio-test` | Phase 1.3.8 诊断，独立 InnerAudioContext | 否 | **否**（禁止加入 Tab） |

`sitemap.json`：`page: "*"` allow，无额外导航。

### 未注册为页面的目录

| 路径 | 角色 |
| --- | --- |
| `miniprogram/components/card-item/` | 列表卡牌卡片 |
| `miniprogram/components/filter-bar/` | 职业 / 稀有度 / 传说音乐筛选 |
| `miniprogram/components/mini-player/` | 全局播放条 UI（订阅 `app.player`） |
| `miniprogram/components/audio-button/` | 详情页音轨按钮 |
| `miniprogram/utils/` | `data.js`、`audio.js`、`player.js`、`playerController.js`、`config.js`、`labels.js` |

搜索：**不是独立页面**。搜索框在首页 `index.wxml` 内，状态在首页 `Page.data`。

---

## 2. 当前首页分析

**当前首页 = `miniprogram/pages/index/index`。**

对应文件：`index.js` / `index.wxml` / `index.wxss` / `index.json`。

| # | 问题 | 结论 |
| --- | ---: | --- |
| 1 | 职责 | 远程分页目录：搜索、职业/稀有度/传说音乐筛选、网格展示、`card-item`、触底加载、回顶、挂 `mini-player` |
| 2 | 是否就是「牌库」 | **是。** 产品要保留的搜索/筛选/分页/展示都在这一页 |
| 3 | 搜索状态 | 页面 `data.query` + `_searchTimer`。无全局 store |
| 4 | 筛选状态 | 页面 `data.classFilter` / `rarityFilter` / `legendaryMusic` |
| 5 | 分页状态 | 页面 `data.page` / `pageSize` / `hasMore` / `cards` / `_seq` |
| 6 | 卡牌数据 | `GET {apiBase}/api/mini/catalog?...` 或 `/api/mini/search?q=...`（`utils/data.js`） |
| 7 | `getApp()` | **首页 JS 不直接用。** `card-item` / `mini-player` 使用 `app.player` |
| 8 | catalog | 服务端 `buildCatalog` 之后的 `catalog.cards`（已 `shouldPublish` + `foldSharedReprints`）。客户端不持有完整 catalog |
| 9 | store | **无** |
| 10 | URL query | `onLoad()` **无参数** |
| 11 | 进详情 | `card-item` `bindopen` → `onOpenCard` → `wx.navigateTo('/pages/card/card?id=' + id)` |
| 12 | 返回是否保留状态 | 详情是 `navigateTo`，首页留在栈上，**返回保留**。首页 **没有** `onShow` 重载 |
| 13 | 生命周期 | `onLoad` 拉第一页；`onUnload` 清搜索 timer；`onReachBottom` 加载更多；`onPageScroll` 回顶。无 `onShow` / `onHide` |
| 14 | 音频生命周期 | 首页不 stop/destroy player |
| 15 | 页面级播放器 | 无。播放在 `card-item.onPlay` → `app.player` |

**最小改名为「牌库」的方案（不执行）：不要改文件路径。** 保持 `pages/index/index`，只在 `tabBar.list[].text` 写「牌库」。不重命名、不移动首页文件。

---

## 3. 当前 app.json 分析

完整内容（调查时）：

- `pages`: `pages/index/index`、`pages/card/card`、`pages/audio-test/audio-test`
- `window`: 标题「卡牌语音图鉴」，导航栏/背景 `#141824`，白字
- **无 `tabBar`**
- **无 `custom-tab-bar`**
- `style: v2`，`sitemapLocation: sitemap.json`

### A. 当前是否已使用微信原生 tabBar？

**否。**

### B. 是否适合直接增加原生 tabBar？

**适合。** 理由：

- 需要 3 个一级入口，落在微信 tabBar 2–5 项限制内
- 详情必须继续 `navigateTo`，不能进 tabBar（tab 页无法带 `?id=`；`switchTab` 不能带 query）
- 诊断页已在 `pages` 中，只要不写入 `tabBar.list`
- 当前全项目只有一处 `wx.navigateTo`（首页→详情），没有 `switchTab` / `redirectTo` / `reLaunch`。把首页变成 tab **不会**打破现有跳转（`navigateTo` 指向非 tab 的详情）
- 首页变成 tab 之后，**不能再** `navigateTo('/pages/index/index')`（微信会失败，必须 `switchTab`）。当前代码没有这种调用

原生 bottom tabBar **必须**为每一项提供本地 `iconPath` + `selectedIconPath`（建议 81×81，≤40KB）。项目内 **0** 张图标。不能做成「纯文字原生底部 Tab」。`position: "top"` 可不显示 icon，但与目标底部 UI 不符。自定义 tabBar 能做纯文字，但改动面大于原生。

默认首页：微信启动 `pages` 数组第一项；tab 默认高亮 `tabBar.list` 第一项。下一阶段应把「最新卡牌」同时放在这两处的第一位。

---

## 4. 推荐 Tab 架构

| Tab | 文案 | pagePath | 来源 |
| --- | --- | --- | --- |
| 1 | 最新卡牌 | `pages/latest/latest` | **新建**，作为启动页 |
| 2 | 牌库 | `pages/index/index` | **现首页，路径不变** |
| 3 | 更多 | `pages/more/more` | **新建**，占位 |

非 Tab：

- `pages/card/card` — 详情，继续 `navigateTo`
- `pages/audio-test/audio-test` — 诊断，仅保留注册，不进 Tab

推荐 `pages` 顺序（不执行）：

1. `pages/latest/latest`
2. `pages/index/index`
3. `pages/more/more`
4. `pages/card/card`
5. `pages/audio-test/audio-test`

命名风格：现有为 `pages/{短名}/{同名文件}`（`index`、`card`）。`latest` / `more` 比 `latest-cards` / `new-cards` 更贴现有风格。

---

## 5. 最新卡牌数据来源

### catalog.cards / byId 字段（已确认）

`toListCard`（列表项，首页与 featured 实际下发）：

`id`, `name`, `type`, `class`, `classLabel`, `rarity`, `rarityLabel`, `collectible`, **`set`**, `dbfId`, `imageUrl`, `hasPlay`, `hasMusic`, `hasEntrance`, `legendary`, `quickPlay`

`adaptCard` 另有详情用：`text`, `flavor`, `voice`, `music`, `entrancePreview`。无 `nameEn` 在 adapt 结果里（搜索会读 `nameEn`，但 adapt 未写入 — 与本阶段无关）。

### 发布时间 / 版本 / 最新 set？

| 来源 | 有无发行日 | 有无 set 顺序 | 有无「当前扩展包」标识 | 标准/狂野 |
| --- | --- | --- | --- | --- |
| `catalog.cards` / `adaptCard` | **无** | **无** | **无** | **无** |
| `data/index/card-audio-index.json` | **无**。有 `clientVersion: "36.4.0.250339"`（游戏构建号，不是 set） | **无** | **无** | **无** |
| `data/index/manifest.json` | `generatedAt` 是索引生成时间 | **无** | `productVersion` 同构建号 | **无** |
| HearthstoneJSON `cards.json` / `cards.collectible.json` | 卡对象 **无** date/release/patch 字段 | 仅每卡 `set` 字符串 | **无** | **无** |
| 项目内 `sets.json` 或 set metadata | **不存在** | — | — | — |
| `/api/mini/featured` | 不是最新。筛选传说随从且有 Entrance，按 **dbfId 升序**（偏旧） | — | — | — |
| `/api/mini/catalog` | 无 `set=` 参数。排序 `compareHome`（有 Entrance 优先，再 dbfId 升序） | — | — | — |

`shouldPublish` 后 unique `set` 共 **48** 个（含 `CORE`、`CORE_HIDDEN`、`VANILLA`、`TIME_TRAVEL`、`SPACE`、`THE_LOST_CITY`、`HERO_SKINS` 等）。其中多个扩展包 collectible 数量同为 183，**不能**用数量推断「最新」。`dbfId` 最大的已发布卡是 `HERO_10cg` / `HERO_SKINS`，**不能**用 max(dbfId) 当最新扩展包。

HSJSON 部分卡有 `isMiniSet`（布尔），不是扩展包发行日历。

### 客户端能否「直接读 catalog → 筛最新 set」？

**不能（现状）。** 首页只分页请求，内存里没有完整 `catalog.cards`。最新页若只在小程序里 `filter(set === ?)`，必须先拉全量，不可行。

服务端 **可以** 在已有 `catalog.cards`（已 publish + 已 fold）上按 `card.set` 过滤。这需要 **新查询参数或新只读 API**。`filterCards` 今日只支持 class / rarity / legendaryMusic，**没有 set 过滤**。

### 结论

**DATA INSUFFICIENT** — 项目 **不能可靠识别「当前最新扩展包」**。

缺的是：带发行日期或官方顺序的 set metadata（例如 HearthstoneJSON `sets.json` 的 `releaseDate`），或一份项目内明确的 `latestSet` 配置。禁止在实施阶段把 `set === TIME_TRAVEL`（或任意名字像「新」的 set）当成已证实规则。

已确认可复用：

- **数据集合**：`buildCatalog` 输出的 `catalog.cards`（不是原始 HS 全量、不是未 fold 的 `byId` 列表）
- **列表卡片形状**：`toListCard`（含 `set`、`quickPlay`、`id`）
- **详情**：`catalog.byId` + `GET /api/mini/card/:id`

在补上「最新 set」定义之前，最新页可以建壳，**不能**诚实填入「当前版本卡牌」。

collectible=false：继续走现有 `shouldPublish`（仅 `collectible===true` 或 `VERIFY_IDS`）。不要另从 `cards.json` 拉一套。

---

## 6. 再版折叠兼容性

`buildCatalog`：`shouldPublish` → `adaptCard` → **`foldSharedReprints`** → `catalog.cards`；**`byId` 仍保留全部已发布 id**。

折叠键是 `voice.play.sourceCardId` 一跳，组内优先 `id === canonical`，不是按名称去重。

对用户点名的例子（索引实测 + 仅这 6 张做 fold）：

| cardId | set | play sourceCardId | 折叠后是否留在 `catalog.cards` |
| --- | --- | --- | --- |
| BOT_548 奇利亚斯 | BOOMSDAY | BOT_548 | **保留**（canonical） |
| CORE_BOT_548 | CORE_HIDDEN | BOT_548 | **不出现在列表**（折进 BOT_548） |
| TOY_330 奇利亚斯豪华版3000型 | WHIZBANGS_WORKSHOP | TOY_330 | **保留**（独立卡，不是 Core 再版） |
| NEW1_010 风领主奥拉基尔 | EXPERT1 | NEW1_010 | **保留** |
| CORE_NEW1_010 | CORE_HIDDEN | NEW1_010 | **不出现在列表** |
| VAN_NEW1_010 | VANILLA | NEW1_010 | **不出现在列表** |

最新卡牌页必须 **直接使用已折叠的 `catalog.cards`**（再按未来定义的 set 过滤）。禁止复制 `foldSharedReprints`，禁止按 `name` 去重。否则 Core/Vanilla 会再次并列，且可能把 TOY_330 与 BOT_548 错误合并。

`byId` 仍可打开 `CORE_BOT_548` 详情（若有人带该 id 进来）。最新 **列表** 不应再列出它。

---

## 7. 详情页兼容性

链路（首页已证实，最新页应原样复制，不改详情页）：

```
card-item  bindopen / triggerEvent('open', { id: card.id })
  → 页面 onOpenCard
  → wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(id) })
  → card.js onLoad(query.id)
  → GET /api/mini/card/:id
  → catalog.byId[id] + publicDetail
```

- **必须保留 cardId**
- 详情 **不依赖** 首页路径、不依赖是否 tab、不读首页 data、不读 `catalog.cards` 列表顺序
- 依赖服务端 `catalog.byId`（含被 fold 掉但仍 published 的 id）

从「最新卡牌」进详情：**完全可复用** 上述三行，无需改 `pages/card/*`。

---

## 8. card-item 兼容性

`miniprogram/components/card-item/`：`card` 对象 in，`open` 事件出 `{ id }`。点击整卡 `onOpen`；试听 `catchtap` → `audio.getQuickPlayUrl(card)` → `app.player.playAudio`。无首页路径硬编码。无页面事件总线。不依赖「是否首页」。

`toListCard` 已提供 `id` / `quickPlay` / `imageUrl` / `legendary` 等。最新页只要下发同一形状即可。

**可以直接复用。不要做第二套卡牌组件。不需要新 props。**

---

## 9. 音频兼容性

只调查，不修改。

| 项 | 现状 |
| --- | --- |
| Player | `app.js` `onLaunch` 创建，挂 `app.player`。`App.onHide` 为空，切后台不停播 |
| teardown | 仅新 `play`、ended、stop、destroy。**页面 onHide/onUnload 不停播** |
| 详情 `onUnload` | 只 `unsubscribe` 按钮文案，不 destroy player |
| 首页 | 无音频生命周期 |
| 跳转统计 | 全小程序仅 `navigateTo` 详情；无 `switchTab` |

路径：最新卡牌 → 详情 → 播放 → 返回 → 牌库：

- 详情 unload **不会** 因现有代码 stop/destroy
- 牌库 tab `onShow`（今日不存在）若 **不** 误加重载/stop，搜索与播放都保留
- `app.player` 单例，与几个 tab 无关
- tab 切换一般 **不** unload tab 页，`mini-player` 仍 attached
- 最新页若也用 `card-item` 试听，同一 `app.player`，会替换当前 session（与今日首页试听相同，不是新 bug）

**未发现必须改 player / playerController / InnerAudioContext 的架构冲突。**

布局风险（不是播放引擎）：`mini-player` `position:fixed; bottom: calc(12px + env(safe-area-inset-bottom))`。加上原生 tabBar 后，**tab 页**上播放条会与 Tab 重叠。详情页不是 tab，tabBar 隐藏，详情底栏现状可不变。下一阶段只需抬 tab 页底栏/回顶按钮，**不要**动 `player.js`。

iOS download 链路只看 URL 类型，与是否 tab 无关。

---

## 10. 推荐新增页面

**不要本阶段创建。**

现有规范：目录名 = 主文件名；每页 `.js` `.wxml` `.wxss` `.json`；`json.usingComponents` 相对路径到 `components/`。

```
miniprogram/pages/latest/
  latest.js
  latest.wxml
  latest.wxss
  latest.json    // card-item + mini-player；不要 filter-bar（除非产品明确要筛）

miniprogram/pages/more/
  more.js
  more.wxml
  more.wxss
  more.json      // 可只挂 mini-player；无现成 list 组件，占位用 view 即可
```

「更多」第一期：空壳 + 标题。不实现反馈/打赏/关于。不引入登录、支付、广告。

图标（下一阶段，本阶段不生成）：例如 `miniprogram/assets/tab/{latest,library,more}{,-active}.png`。仓库里目前没有任何图片资源。

---

## 11. 推荐最小修改文件

### A. 必须修改

- `miniprogram/app.json` — `pages` 顺序 + `tabBar`（三项 pagePath/text/icon）

### B. 必须新增

- `miniprogram/pages/latest/latest.{js,wxml,wxss,json}`
- `miniprogram/pages/more/more.{js,wxml,wxss,json}`
- tabBar 本地图标（6 张：3×未选 + 3×选中）。无图标则原生底部 Tab **无法上架式使用**

### C. 很可能要改（布局，非牌库逻辑）

- `miniprogram/components/mini-player/mini-player.wxss`（及可选 property）— tab 页避开 tabBar
- `miniprogram/pages/index/index.wxss` — `padding-bottom` / `.back-top` 的 `bottom`（现按无 tabBar + mini-player 84px 设计）

### D. 理论上不应修改

- `miniprogram/pages/index/index.js` 的搜索/筛选/分页/请求逻辑
- `miniprogram/pages/card/*`
- `miniprogram/components/card-item/*` 行为（除被 latest 引用）
- `miniprogram/components/filter-bar/*`
- `foldSharedReprints` / `shouldPublish` / `buildCatalog` 核心
- 音频：`player.js`、`playerController.js`、`audio.js`、Entrance/mix、extractor

### E. 明确禁止修改（本架构阶段）

- 任何音频生产代码与补偿/mix
- 按名称去重；复制 `foldSharedReprints`
- 从原始 Hearthstone/HSJSON 再做一套未 publish 的列表
- 把 `audio-test` 放进 tabBar
- 重命名/移动 `pages/index/`
- 用户登录、收藏、云同步、支付、广告、推送

**牌库核心逻辑可以不动**：只加 tabBar、把默认页改为 latest、新增两页。首页 JS 可以零改；WXSS 可能因 tabBar 重叠需要改。

**最新卡牌填数**：在「最新 set」有可靠来源之前，不要改 catalog 折叠。可选后续：**加法** `catalogPage` 的 `set` 过滤或只读 `/api/mini/latest`，输入必须仍是 `catalog.cards`。在 DATA INSUFFICIENT 解决前，该 API 无法正确实现。

测试：`test/audioDiagnostic*.js` 只断言 `audio-test` **在** `pages` 数组中，不要求它是首页。增加页面通常不必改这些断言；若有测试锁死 `pages[0]===index`，实施时再看（当前未见）。

---

## 12. 风险矩阵

| 风险 | 级别 | 原因 | 下一阶段处理方式 |
| --- | --- | --- | --- |
| 首页迁移为牌库 | 低 | 路径可保持 `pages/index/index`，只改 tab 文案 | 不重命名文件 |
| 新增最新卡牌 | 中 | 页面壳简单；**无可靠最新 set** | 先上 Tab + 空/待配置页；禁止猜 set |
| 最新版本识别错误 | **高** | 无发行日、无 set 顺序、featured/dbfId 都不能当「最新」 | **DATA INSUFFICIENT** 先补 metadata/配置，再填列表 |
| 再版重复 | 低（若复用 folded 列表） | Core/Vanilla 已按 sourceCardId 折叠 | 只用 `catalog.cards`；禁止按名去重 |
| 搜索状态丢失 | 低 | 状态在首页 data；tab 切换通常不 unload；无 onShow 重载 | **不要**在 `onShow` 里 `resetAndLoad` |
| 筛选状态丢失 | 低 | 同上 | 同上 |
| 分页状态丢失 | 低 | 同上 | 同上 |
| 详情页跳转 | 低 | 已是 `navigateTo` 非 tab 页 | 最新页复制同一 URL；勿 `switchTab` 去详情 |
| 音频播放 | 低 | player 在 App；页 hide 不停 | 不改 player；tab 页不要 stop |
| iOS 播放 | 低 | download 只看 URL | 不动 iOS 分支 |
| tabBar 生命周期 | 中 | 首页变 tab 后若误用 `navigateTo` 回牌库会失败；mini-player 与 Tab 重叠 | 回牌库用 `switchTab`；抬固定底栏 |
| 更多页面 | 低 | 空壳即可 | 不实现反馈/支付 |

---

## 13. Phase 1.5.2 实施建议

顺序必须：

1. **先改 tabBar / `app.json` pages 顺序**（latest 第一，index 第二，more 第三；card 与 audio-test 仍注册、不进 Tab）。准备 6 张本地图标。
2. **再新增最新卡牌页面**：复用 `card-item`、`mini-player`、`navigateTo` 详情。列表数据在最新 set **CONFIRMED** 之前不要猜。
3. **再新增更多页面**：占位，不接业务。
4. **牌库**（`pages/index`）核心 JS 尽可能不动；只处理与 tabBar 冲突的 WXSS/回顶/mini-player 底距。
5. **不动音频**（player、mix、Entrance、iOS download）。
6. **不动 catalog 核心**（`shouldPublish`、`foldSharedReprints`、`buildCatalog` 分组规则）。
7. **不重新实现再版折叠。**

不要做：登录、收藏、用户中心、云同步、社交、评论、复杂反馈后台、支付/打赏、广告、推送。

数据未补齐前，1.5.2 的成功标准应是：**三 Tab 可切换、牌库行为与今日一致、详情仍可用**；而不是「最新页已正确等于当前扩展包」。

---

## 14. 修改文件审计

```
Production code changes: 0
Test code changes: 0
Data changes: 0
UI changes: 0
```

本阶段实际修改文件：无生产/测试/数据/UI 文件。仅新增本报告：

`data/card-verification/phase-1.5.1-report.md`

验收：

1. 当前首页真实路径：`pages/index/index` — CONFIRMED  
2. `miniprogram/app.json` — CONFIRMED  
3. 当前无 tabBar — CONFIRMED  
4. 首页可作为「牌库」— CONFIRMED  
5. 详情页：`pages/card/card` — CONFIRMED  
6. 最新卡牌可复用 folded `catalog.cards` + `toListCard` — CONFIRMED（客户端尚无全量；需未来只读过滤）  
7. 最新版本可靠判断 — **DATA INSUFFICIENT / NOT CONFIRMED**（缺发行日或 set 顺序）  
8. `foldSharedReprints` 复用方式 — CONFIRMED  
9. `card-item` 复用 — CONFIRMED  
10. 新增 Tab 与音频无明显架构冲突 — CONFIRMED（有底栏重叠的 UI 风险）  
11. 最小修改文件列表 — 见第 11 节  
12. 下一阶段顺序 — 见第 13 节  
13. 生产代码修改 = 0 — CONFIRMED  

```
Phase 1.5.1 STOPPED — INVESTIGATION ONLY
```
