# Phase 1.4.1 Card Display Aspect Ratio Fix

## 根因

首页 `card-item` 将卡图固定为 `height: 168px` + `mode="aspectFill"`（cover）。双列格子里图片宽度约等于高度，接近正方形，竖图 256×388 的上下被裁切。

实测 HSJSON render（`zhCN/256x`）：EX1_116 / BOT_548 / 法术 / 武器 / 英雄均为 **256×388**（EX1_414 为 256×387）。

## 修复

`card-item`：`widthFix` + `width: 100%` + `height: auto` + `aspect-ratio: 256 / 388`。详情页原本已是 `widthFix`，未改。

## 真机

布局需在微信开发者工具 / 真机确认。自动化不能替代视觉检查。
