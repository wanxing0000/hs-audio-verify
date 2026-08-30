# Phase 2.9-C 小程序图片加载性能优化

## ROOT CAUSE

列表卡牌图来自跨境 `art.hearthstonejson.com` 256x PNG（约 165KB）。  
首页一次渲染 30 张 `<image>`，最新页一次 `setData` 约 164 张并创建 164 个 image。  
`card-item` 未使用 `lazy-load`，最新页没有 `onReachBottom` 分批渲染。  
用户只看见 6～8 张卡，微信却同时排队下载几十到一百多张图。

## CHANGES

- `card-item` 卡牌图增加 `lazy-load`，保留 `mode="widthFix"`、`imageUrl`、`binderror`。
- 详情页 `<image>` 不使用 lazy-load，保持立即加载。
- 最新页 API 仍一次取全量 164 条；页面只渲染首批 20 张，触底再追加 20 张。
- 使用 `loadingMoreLatest` / `hasMoreLatest` 防止重复 append。
- 未增加 hidden preload、`wx.getImageInfo`、批量预取。

## IMAGE URL

UNCHANGED

`https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/{id}.png`

## HOME

已有 catalog 分页 30 张 + `onReachBottom`。本阶段只给列表卡图加 lazy-load，未改 API 批次。

## LATEST

`LATEST_BATCH_SIZE = 20`  
首批渲染 20，滚动触底继续 20，直到 164。排序与职业分组顺序不变。

## LAZY LOAD

列表 `card-item`：YES  
详情页：NO（立即加载）

## BATCH LOAD

最新页：YES  
首页：沿用已有 30 张分页

## AUDIO

UNCHANGED

## PRODUCTION AUDIO

UNCHANGED

## TESTS

npm test = PASS  
npm run test:production = PASS

## WECHAT DEVTOOLS

NOT AVAILABLE

本环境无法打开微信开发者工具，未观察 Network 面板。

## REAL DEVICE

NOT VERIFIED

不能把开发者工具或本机 Node 测试冒充真机。

## NETWORK REQUEST OBSERVATION

NOT PRECISELY MEASURED

代码路径保证：

- 首页首批可见图片数量：约 6～8（两列，取决于屏高）
- 首页进入时实际 image 节点：最多 30（另有 lazy-load）
- 最新页首批渲染数量：20
- 最新页第一次进入时 image 节点：20（不再是 164）
- 滚动后第二批数量：再 +20
- 图片 URL 是否改变：NO
- 音频 API 是否改变：NO

## FILES MODIFIED

本阶段：

- miniprogram/components/card-item/card-item.wxml
- miniprogram/pages/latest/latest.js
- miniprogram/pages/latest/latest.wxml
- miniprogram/utils/latestGroups.js
- package.json
- scripts/test-production.cjs
- test/latestClassGrouping.test.js
- test/latestImageBatch.test.js
- data/card-verification/phase-2.9-C-report.md

工作区另有此前未提交的导航栏标题修改，以及用户本地：

- project.config.json
- project.private.config.json

本阶段未恢复、未修改这两个微信工具文件。

## FILES NOT MODIFIED

- .env
- data/production-audio
- 音频 API / 生产 API URL
- Nginx / systemd / VPS
- miniprogram/utils/config.js imageBase
- src/miniprogram/catalogAdapter.js ART_BASE

## GIT

NO COMMIT  
NO PUSH

## VPS

NOT MODIFIED

## NGINX

NOT MODIFIED

## SYSTEMD

NOT MODIFIED

## EXTRACTOR

NOT CALLED

## HEARTHSTONE WINDOWS DEPENDENCY

NOT REQUIRED
