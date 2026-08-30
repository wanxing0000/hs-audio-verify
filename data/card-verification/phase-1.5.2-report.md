# Phase 1.5.2 Report

## 1. Goal

把小程序升级为微信原生底部三 Tab：

- 最新卡牌
- 牌库
- 更多

不破坏现有牌库搜索 / 筛选 / 分页、卡牌详情、音频播放、iOS 播放链路、Phase 1.4.3 再版折叠。

最新卡牌数据来源仍为 **DATA INSUFFICIENT**。本阶段只完成页面架构与安全占位，不伪造最新扩展包卡牌。

## 2. Tab Architecture

| Tab | 文案 | pagePath |
| --- | --- | --- |
| 1 | 最新卡牌 | `pages/latest/latest` |
| 2 | 牌库 | `pages/index/index`（原首页，路径未改） |
| 3 | 更多 | `pages/more/more` |

`app.json` `pages` 第一项为 `pages/latest/latest`，作为启动页。

非 Tab：`pages/card/card`（`navigateTo`）、`pages/audio-test/audio-test`（诊断，仍注册、不进 tabBar）。

Tab 切换由微信原生 `switchTab` 管理。未手写底部导航，未使用 `redirectTo` / `reLaunch`。

## 3. Changes

### A. 新增

- `miniprogram/pages/latest/latest.js`
- `miniprogram/pages/latest/latest.wxml`
- `miniprogram/pages/latest/latest.wxss`
- `miniprogram/pages/latest/latest.json`
- `miniprogram/pages/more/more.js`
- `miniprogram/pages/more/more.wxml`
- `miniprogram/pages/more/more.wxss`
- `miniprogram/pages/more/more.json`
- `miniprogram/assets/tabbar/latest.png`
- `miniprogram/assets/tabbar/latest-active.png`
- `miniprogram/assets/tabbar/library.png`
- `miniprogram/assets/tabbar/library-active.png`
- `miniprogram/assets/tabbar/more.png`
- `miniprogram/assets/tabbar/more-active.png`
- `test/tabBar.test.js`
- `data/card-verification/phase-1.5.2-report.md`

### B. 修改

- `miniprogram/app.json` — pages 顺序 + 原生 tabBar
- `miniprogram/pages/index/index.wxml` — `mini-player` 增加 `lift-for-tab-bar`（无搜索/筛选/分页改动）
- `miniprogram/pages/index/index.wxss` — 底部 padding / 回顶按钮上移，避开 tabBar + mini-player
- `miniprogram/components/mini-player/mini-player.js` — 仅增加 `liftForTabBar` 属性（不改播放逻辑）
- `miniprogram/components/mini-player/mini-player.wxml` — tab 页加 `.bar-tab`
- `miniprogram/components/mini-player/mini-player.wxss` — `.bar-tab` 增加 48px 底部偏移
- `package.json` — `npm test` 接入 `test/tabBar.test.js`

### C. 未修改但检查过

- `miniprogram/pages/index/index.js`（搜索 / 筛选 / 分页 / API 未改；无 `onShow` 重载）
- `miniprogram/pages/card/card.js` / `.wxml` / `.wxss` / `.json`
- `miniprogram/components/card-item/*`（行为未改；latest 直接引用）
- `miniprogram/utils/player.js`
- `miniprogram/utils/playerController.js`
- `miniprogram/utils/audio.js`
- `src/miniprogram/catalogAdapter.js`（含 `foldSharedReprints` / `shouldPublish` / `buildCatalog`）
- `src/music/*`、`src/services/entrancePreviewService.js`、音频 API

## 4. New Pages

**latest：** 标题「最新卡牌」，副标题「当前版本最新卡牌」。`hasData === false` 时显示「最新卡牌功能即将上线」，不是错误页。预留 `loading` / `cards` / `hasData` 与 `card-item` + `onOpenCard` → `/pages/card/card?id=`。本阶段不请求 catalog / featured，不写死 set / cardId。

**more：** 标题「更多」。静态三项：问题反馈、打赏支持、关于，均标「即将开放」。无点击假完成、无支付、无反馈后端。

两页均挂 `mini-player` 且 `lift-for-tab-bar="{{true}}"`。

## 5. Tab Icons

6 张本地 81×81 PNG，目录 `miniprogram/assets/tabbar/`：

| 文件 | 语义 | 颜色 |
| --- | --- | --- |
| `latest.png` / `latest-active.png` | 五角星 | 灰 `#8b93a7` / 金 `#d7b56d` |
| `library.png` / `library-active.png` | 叠卡 | 同上 |
| `more.png` / `more-active.png` | 三点 | 同上 |

无网络图、无 emoji、无运行时图标库。普通态与选中态颜色不同。

## 6. Library Compatibility

`pages/index/index` 未重命名，未复制为 library。搜索 / 筛选 / 分页 / `loadCatalogPage` / `searchRemote` / `navigateTo` 详情均保持。未加 `onShow` 重载，Tab 切换与从详情返回不应重置牌库状态。仅 WXML 播放条属性与 WXSS 底距做了 Tab 兼容。

## 7. Detail Compatibility

详情仍为 `wx.navigateTo` → `pages/card/card?id=xxx`。详情页未加入 tabBar，文件未改。latest 已预留同一跳转。

## 8. Audio Compatibility

未修改 `player.js`、`playerController.js`、`audio.js`、mix / Entrance / Voice / Music API。未在 Tab 切换时 stop 播放。`app.player` 仍为 App 级单例。

mini-player 只增加定位属性：详情页默认不抬高；三个 Tab 页抬高，避免挡住原生 tabBar。

## 9. Catalog Compatibility

未修改 Phase 1.4.3 `foldSharedReprints`、`shouldPublish`、`catalog.cards`、`catalog.byId`。未按名称去重。未从原始 HSJSON 另拉列表。

## 10. Latest Data Status

**DATA INSUFFICIENT**

本阶段没有猜测当前最新扩展包。没有 `TIME_TRAVEL` 或其它 set 硬编码。没有用 dbfId / featured / clientVersion 填列表。

最新卡牌页面与 Tab 架构已经完成，但当前版本最新扩展包的数据来源尚未接入。

## 11. Tests

`npm test`：**PASS**

含新增 `test/tabBar.test.js`：TEST 1–10（latest / index / more 注册、tab 文案顺序、诊断页与详情不在 tabBar、页面文件、6 图标、index 路径未改）。

## 12. Manual Verification

需要在微信开发者工具确认（本环境未代替真机/模拟器点选）：

1. 编译小程序  
2. 默认启动是否为「最新卡牌」  
3. 底部是否为 最新卡牌 | 牌库 | 更多  
4. 点「牌库」是否仍是原首页  
5. 搜索  
6. 筛选  
7. 翻页  
8. 点卡进入详情  
9. 返回牌库  
10. 搜索 / 筛选状态是否保留  
11. 点「更多」  
12. 点「最新卡牌」  
13. Tab 图标  
14. mini-player 是否遮挡 tabBar  
15. 播放后切换 Tab，播放器是否仍正常  
16. 最新页未来接卡后进详情的结构是否仍在（`card-item` + `navigateTo`）

## 13. Risks

- 最新 set 尚未接入；latest 目前是占位，不是完整产品功能  
- mini-player 与原生 tabBar 的 48px 抬升需要开发者工具 / 真机确认（部分基础库页面窗口已不含 tabBar，可能略偏上）  
- 原生 tabBar 图标需在开发者工具确认清晰度与选中态  

## 14. Production Code Changes

生产相关（小程序运行时）：

- 新增页面与图标：如上 A 中 miniprogram 路径  
- 修改：`app.json`、index WXML/WXSS、mini-player 三文件  

明确未改：音频核心、catalog 折叠核心、card-item 行为、详情页、index.js 业务逻辑。

未进入 Phase 1.5.3。未实现问题反馈 / 打赏。
