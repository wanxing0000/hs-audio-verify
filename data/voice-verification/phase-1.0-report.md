# Phase 1.0 — Hearthstone Voice Codex MVP

未修改 `C:\Hearthstone`。未批量导出音频。未引入账号 / 数据库 / 部署 / 支付 / SEO。

启动时只加载 `data/index/card-voice-index.json` 与 `data/index/audio-index.json`，不扫描游戏目录、不解析 Unity Bundle。播放时才按需提取到 `tmp/audio/`、`tmp/music/`、`tmp/preview/`。

## 1. MVP 完成了哪些功能

- 面向用户的本地图鉴：搜索 → 卡牌详情 → **完整登场试听**（Music Stinger + 登场语音，t = 0 同时开始）
- 单独播放：登场语音、登场音乐、攻击、死亡
- 自定义播放器：播放/暂停、进度条、时间、音量；同一时间只播一条
- 首页热门卡牌（少量种子 + 有登场语音的收藏卡补齐），不渲染 35,807 张
- 前端分页（每页 30）
- `?card=EX1_116` 打开详情；`?debug=1` 才展示 VoiceKey / Mapping / Bundle 等
- 共享语音在普通模式显示「使用原卡语音」，不展示 `shared_resource` 等内部类型
- 卡图走 HearthstoneJSON URL，失败显示占位图，不拖垮页面

## 2. 页面如何启动

```text
npm run explorer
```

打开：http://127.0.0.1:8766/

Node `http` 服务（esbuild 打包 `src/explorer/server.js`），静态资源来自 `public/`。

## 3. 当前页面结构

- Header：炉石传说 · 卡牌语音图鉴 + 搜索（窄屏）
- Hero：探索炉石卡牌的声音 / 搜索框
- 热门卡牌 Grid，或搜索结果 Grid + 分页
- 同页 Drawer：卡图、卡名、CardID、职业/类型/稀有度/费用/收藏、完整登场试听、四条音轨、自定义播放器

数据层：

- `src/repository/cardRepository.js` — `searchCards` / `getCard` / `getCardVoice`
- `src/services/audioCache.js` — 缓存检查
- `src/services/audioService.js` — `getVoiceAudio` / `getMusicAudio`
- `src/services/entrancePreviewService.js` — `getEntrancePreview`

UI 不直接操作 Unity / FSB / Bundle。

API：

- `GET /api/cards?q=&page=&pageSize=`
- `GET /api/cards/:id`（`?debug=1` 才返回 mapping / VoiceKey / asset）
- `GET /api/voice/:cardId/:type`
- `GET /api/music/:cardId`
- `GET /api/entrance/:cardId`
- `GET /api/featured`

## 4. 搜索是否正常

是。实时过滤（1 字起，约 120ms debounce）。

实测搜索「火车王」：

- 共 **22** 张
- 第一张：**EX1_116 火车王里诺艾**，带「有登场语音」
- 同时支持 CardID（`EX1_116`）与英文别名（`Leeroy`）

## 5. 卡牌详情是否正常

是。`/?card=EX1_116` 自动打开 Drawer：

- 卡图、火车王里诺艾、EX1_116
- 中立 / 随从 / 传说 / 5 费 / 收藏卡
- 完整登场试听 + 登场语音 / 登场音乐 / 攻击 / 死亡
- 普通模式无 GUID / Bundle / FSB / UnityFS

## 6. 完整登场是否正常

是。这是 Phase 1.0 的核心验收。

浏览器中搜索「火车王」→ 打开 EX1_116 → 点击 **完整登场试听**：

1. 按钮变为「准备音频...」
2. 拉取 `/api/entrance/EX1_116`，WAV **820140** bytes，`RIFF`，`X-Cache: hit`（第二次）
3. 自定义播放器走到 **0:04 / 0:04**（约 4.27 秒，与 Music Stinger 时长一致）
4. 播放结束后按钮恢复「完整登场试听」

Preview 文件：

- `tmp/preview/EX1_116_entrance.wav`
- PCM 16-bit，立体声，**48 kHz**
- 由已有 Play Voice + Music Stinger 混音生成，**不修改** `tmp/audio/`、`tmp/music/` 原文件
- 文案是「完整登场试听」，不是「官方混音」

## 7. Play 是否正常

是。`GET /api/voice/EX1_116/play` → 200，WAV 399916 bytes，cache hit。

## 8. Attack 是否正常

是。`GET /api/voice/EX1_116/attack` → 200，WAV 203308 bytes，cache hit。

## 9. Death 是否正常

是。`GET /api/voice/EX1_116/death` → 200，WAV 279340 bytes，cache hit。

## 10. Music Stinger 是否正常

是。`GET /api/music/EX1_116` → 200，WAV 753508 bytes，cache hit。

当前 Music 目录只来自 Phase 0.10 样本索引（`data/music-verification/music-sample-index.json`），**仅 EX1_116**。其它卡详情显示「暂无语音」，完整登场回退为仅 Play Voice（若有）。

## 11. 缓存是否正常

是。AudioCache 命中后 `X-Cache: hit`，不再重新提取。

实测二次请求：

| 接口 | cache |
|---|---|
| `/api/entrance/EX1_116` | hit |
| `/api/voice/EX1_116/play` | hit |
| `/api/voice/EX1_116/attack` | hit |
| `/api/voice/EX1_116/death` | hit |
| `/api/music/EX1_116` | hit |

当前按需缓存规模（非全量导出）：`tmp/audio` 20 个文件，`tmp/music` 6 个，`tmp/preview` 1 个。

## 12. shared_resource 是否正常

是。

| CardID | 名称 | 用户可见 | Play |
|---|---|---|---|
| VAN_NEW1_010 | 风领主奥拉基尔 | 使用原卡语音 | 200 hit |
| CORE_DMF_067 | 奖品商贩 | 使用原卡语音 | 200 hit |
| WON_302 | 泥潭守护者 | 使用原卡语音 | 200 hit |

普通 API 不返回 `mappingType`。`?debug=1` 才返回 `shared_resource`、`VoiceSourceCardID=NEW1_010` 等。

## 13. shared_audio 是否正常

是。VAC_954 顶流主唱：用户可见「使用原卡语音」，Play 200 hit。

## 14. named_sfx 是否正常

是。CFM_335 驮运科多兽：Play 200 hit（named_sfx 仅 debug 可见）。

## 15. 异常资源是否正确处理

CAP_107 火炮长：

- 索引仍把 Play 标成可播放（token_clip / 使用原卡语音）
- 实际提取失败：`GET /api/voice/CAP_107/play` → **500** `{ error: "暂时无法播放", code: "EXTRACT_FAILED" }`
- `GET /api/entrance/CAP_107` → **404** `{ error: "暂无完整登场音频" }`
- 页面不崩溃，用户看到「暂时无法播放」/「暂无完整登场音频」，不出现 ENOENT / FSB / UnityFS 原文

EDR_526 雷弗拉尔（direct）Play 200 hit。

## 16. 手机端是否正常

CSS 已按验收宽度实现：

- **375px**：2 列 Grid；详情贴底单列 Drawer；播放按钮 `min-height: 48px`
- **768px**：4 列 Grid；Drawer 居中
- **1440px**：5 列 Grid

桌面浏览器已实际完成：搜索「火车王」→ 打开 EX1_116 → 点击完整登场试听并播完（播放器 0:04 / 0:04），再点击登场语音进入「准备音频...」。布局按 375 / 768 / 1440 媒体查询落地（2 / 4 / 5 列 Grid，详情单列，按钮 min-height 48px）。

## 17. npm test 是否通过

是。

```text
ok voiceMappingRules
ok phase-0.8 index
ok explorer repository
ok musicStinger.test.js
ok cardRepository
ok audioService
ok entrancePreview
```

新增：`test/cardRepository.test.js`、`test/audioService.test.js`、`test/entrancePreview.test.js`。

覆盖：`searchCards`、`getCard`、`getVoice`、`getMusic`、`getEntrancePreview`、cache hit、missing voice、missing music。

## 18. C:\Hearthstone 是否保持只读

是。本阶段只读游戏安装。提取只写入仓库内 `tmp/`。

## 19. 是否发生批量音频导出

否。没有全量导出 70,609 条 VoiceClip，也没有全量 Music Index。只在用户点击播放时按需提取并缓存。

未修改：

- `data/index/card-voice-index.json`
- `data/index/audio-index.json`
- `data/index/manifest.json`

## 20. 当前项目距离正式 MVP 还缺什么

Phase 1.0 已经是可用的本地语音图鉴原型。尚未包含、且按计划不应在本阶段做的：

- 全量 Music Stinger 索引（现在只有 EX1_116）
- `/card/EX1_116` 路径路由（现为 `?card=`）
- CAP_107 这类「索引可播放、提取失败」在列表层提前标红
- 最近搜索持久化
- 账号 / 云端 / 部署 / 支付 / SEO / 小程序

混音策略仍是 **t = 0 同时开始**，不声称还原游戏内部混音。

---

Phase 1.0 完成。停止。不进入 Phase 1.1。
