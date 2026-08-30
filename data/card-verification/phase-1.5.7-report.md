# Phase 1.5.7 Report：Admin 后台架构调查

## 1. Phase Status

```text
Phase 1.5.7
Status: INVESTIGATION COMPLETE
Production code changes: 0
Test code changes: 0
Data changes: 0
UI changes: 0
package.json changes: 0
```

只新增本报告。未实现 Admin。未 `npm install`。未进入 Phase 1.5.8。无残留临时脚本。

未在仓库中发现 `.env`、`.env*`、`vercel.json`、`api/`（Vercel Functions）目录。报告中不含任何 Secret 值。

---

## 2. Current Architecture

### PROJECT STRUCTURE（实际存在，非假设）

```text
hs-audio-verify/
  miniprogram/          微信小程序（WeChat DevTools 根：project.config.json miniprogramRoot）
  src/
    miniprogram/        Mini HTTP 服务 + catalogAdapter + LAN
    explorer/           旧 Explorer HTTP + Extractor + Resolver
    services/           AudioService / AudioCache / EntrancePreview
    music/              mix / stinger / compensation
    repository/         Explorer 用 CardRepository
    validation/         诊断 / 校验脚本
    rules/              voice mapping
  data/
    index/              card-audio-index / audio-index / latest-set.json 等
    hearthstonejson/    本地 HSJSON 快照
    card-verification/  阶段报告
    audio-verification/ 音频诊断与 resolver cache
    music-verification/
  scripts/              npm run 包装（esbuild bundle 后执行）
  test/
  public/               Explorer Web UI（HTML/CSS/JS），不是 Admin
  tmp/                  Mini 打包产物 + WAV 缓存（运行时写入）
  package.json
  project.config.json   微信小程序配置
```

| 能力 | 位置 | 证据 |
| --- | --- | --- |
| Mini Program 前端 | `miniprogram/` | `app.json` 三 Tab + card / audio-test |
| Node Mini 服务 | `src/miniprogram/miniServer.js`，启动 `npm run mini` → `scripts/run-mini.cjs` → `tmp/mini-server.cjs` | Node `http.createServer`，默认 `0.0.0.0:8767` |
| Node Explorer 服务 | `src/explorer/server.js`，`npm run explorer`，默认 **8766** | 静态 `public/` + 另一套 `/api/*` |
| 小程序 API | Mini `/api/mini/*`、`/api/audio/*` | `miniServer.js` |
| 数据构建 | `phase08-build.mjs`、`phase11-build.mjs`、`scripts/run-phase08.cjs`、`run-phase11.cjs` 等 | 写 `data/index/*` |
| 音频处理 | `HearthstoneAudioExtractor`、`audioBundleResolver`、`AudioService`、`entrancePreviewService` | 读 `C:\Hearthstone\Data\Win`，写 `tmp/` |
| 测试 | `test/` + `package.json` `npm test` | |
| 部署 | **本仓库无 Vercel / Docker / CI 配置** | `vercel.json` **NOT FOUND**；`api/` **NOT FOUND** |
| Web 页面 | **FOUND**：`public/index.html`（Explorer 卡牌图鉴，非 Admin） | |
| Admin 代码 | **NOT FOUND** | 无 `/admin`、无 `/api/admin`、无 admin 目录 |

当前运行模型（PROVEN）：

```text
微信开发者工具 / 真机小程序
        │ HTTP
        ▼
本机 Node Mini :8767
        │ 读
        ▼
data/index/*.json + latest-set.json（启动时加载进内存）
        │ 按需提取
        ▼
C:\Hearthstone（只读游戏目录）→ tmp/*.wav
```

`miniServer` banner 写明「开发阶段局域网方案，不是正式上线方案」。**云上 Production Mini 是否已部署：NOT CONFIRMED**（仓库内无部署清单）。

---

## 3. Backend Architecture

### 3.1 当前服务器是什么？

```text
Node 内置 http.createServer
NOT Express
NOT Fastify
NOT Vercel Functions（本仓库无证据）
```

另有独立 Explorer：同样是 Node `http`，端口 8766。

### 3.2 主要 API（以 `miniServer.js` 为准）

只处理 `GET` 与 `OPTIONS`。无 `POST`/`PUT`/`PATCH`/`DELETE`。

```text
GET  /api/mini/health
GET  /api/mini/manifest
GET  /api/mini/filters
GET  /api/mini/featured
GET  /api/mini/latest?page=&pageSize=
GET  /api/mini/catalog?page=&pageSize=&class=&rarity=&legendaryMusic=
GET  /api/mini/search?q=&page=&pageSize=&class=&rarity=&legendaryMusic=
GET  /api/mini/card/:id
GET  /api/audio/voice/:cardId/:type
GET  /api/audio/music/:cardId
GET  /api/audio/entrance/:cardId
GET  /api/audio/health
GET  /api/audio-test/tone.wav
```

Explorer（8766，**不是**小程序生产路径）另有 `/api/manifest`、`/api/featured`、`/api/cards`、`/api/search`、`/api/voice/`、`/api/music/`、`/api/entrance/` 及静态 HTML。**不要把 Explorer 当成已有 Admin。**

### 3.3 基础设施能力

| 项 | 判定 | 证据 |
| --- | --- | --- |
| JSON response helper | **FOUND** | `send()` |
| error handler | **PARTIAL** | 外层 `try/catch` → 500 `{ error: '暂时无法播放' }`；音频有 `sendAudioError`；无统一 error code 层 |
| request parser | **PARTIAL** | `new URL` + `searchParams`；无 JSON body 解析（也无 POST） |
| auth middleware | **NOT FOUND** | 全库 `src/` 无 JWT / Authorization / password |
| logging | **PARTIAL** | `console.log` / `console.error`；无操作审计 |
| CORS | **FOUND** | `Access-Control-Allow-Origin: *`，Methods `GET, OPTIONS` |
| rate limit | **NOT FOUND** | |
| environment config | **PARTIAL** | `MINI_HOST` / `MINI_PORT`（`lanListen.js`）；Explorer `PORT`；无 `.env` 文件 |

---

## 4. Deployment Architecture

| 目标 | 本仓库证据 |
| --- | --- |
| Vercel | **NOT FOUND**（无 `vercel.json`、无 `api/`、`package.json` 无 vercel 脚本） |
| 本地 Mini Server | **FOUND**（`npm run mini`，8767） |
| 其他云服务器 | **NOT CONFIRMED** |
| 微信小程序发布 | `project.config.json` 有 `appid`；是否已上传体验版/正式版 **NOT CONFIRMED** |

### 当前环境能否写盘？（本地 Mini，PROVEN）

| 操作 | 本地 Mini | 说明 |
| --- | --- | --- |
| 写本地文件 | **能**（进程用户权限下） | `AudioCache.write`、`lanListen` 写 `apiBase.lan.js`、Extractor 写 WAV / resolver cache |
| 修改 `data/*.json` | **文件系统允许，当前无 API 去做** | 无 Admin 写接口 |
| 修改 `latest-set.json` | 同上 | 启动时读一次，改文件 **不会** 自动进内存 |
| 写音频 | **能** | `tmp/audio|music|preview`（本机已有 WAV 缓存：voice 441 / music 199 / preview 187） |
| 持久化上传 | **NOT FOUND** | 无上传 API |
| 保存 Admin / 反馈 / 操作日志 | **NOT FOUND** | 无存储层 |

### Vercel Serverless 与 EROFS

- 本仓库 **没有** Vercel 配置，也 **没有** `EROFS` 字符串。
- 用户提到的 `EROFS: read-only file system`：**不是本仓库可复现的证据** → **NOT CONFIRMED IN THIS REPO**。
- 若未来把 Mini **原样**放到典型 Serverless（含 Vercel）：项目目录只读、`fs.writeFileSync('data/...')` 会失败，是平台常识，但 **对本项目未做部署测试** → 标 **REQUIRES IMPLEMENTATION TEST**。
- **绝对不能**在 Serverless 上直接写：`data/index/*.json`、`latest-set.json`、`tmp/` 持久 WAV、操作日志文件。短暂可写区通常只有 `/tmp`，进程结束后丢失。

`C:\Hearthstone`：项目约束为只读游戏目录（多份 phase 报告 PROVEN）。Admin **不得**写游戏目录。Extractor 只读 Unity bundle。

---

## 5. Storage

| 技术 | 判定 |
| --- | --- |
| Supabase | **NOT FOUND** |
| PostgreSQL / MYSQL / SQLITE | **NOT FOUND** |
| `DATABASE_URL` | **NOT FOUND** |
| Vercel KV | **NOT FOUND** |
| `.env` | **NOT FOUND** |
| JSON 文件 | **FOUND** — `data/index/*`、`data/hearthstonejson/*`、报告 JSON |
| 内存 | **FOUND** — Mini 启动后 `catalog`、`latestSetConfig`、`unified` 常驻 |
| WAV 文件缓存 | **FOUND** — `tmp/` |

```text
FOUND JSON + memory + tmp WAV
NOT FOUND any database
USED BY: Mini catalog, latest-set, audio extract cache
```

无 Secret 文件可引用。

---

## 6. Current Data Update Pipeline

**本仓库没有「下载 HSJSON」脚本**（无 `https://api.hearthstonejson.com` 的 fetch/download 实现）。HSJSON 是检入的本地快照。

实际链路（PROVEN）：

```text
C:\Hearthstone  （只读客户端）
  ↓  npm run index:voice  (phase08-build.mjs，~211s)
data/index/card-voice-index.json
data/index/audio-index.json
data/index/cache/*

data/hearthstonejson/zhCN/cards.json
data/hearthstonejson/zhCN/cards.collectible.json
  ↓  npm run index:audio  (phase11-build.mjs，~4.2s，不覆盖 voice/audio-index)
data/index/card-audio-index.json
data/index/music-index.json
data/index/music-assets.json

  ↓  npm run mini 启动
buildCatalog(unified)     // shouldPublish → adaptCard → foldSharedReprints
catalog.cards / catalog.byId  （内存）
  ↓
GET /api/mini/* 、 GET /api/audio/*
  ↓
miniprogram（config.js API base → 本机/LAN 8767）
```

没有「检查远程是否有新扩展包」的自动化。换 latest set 靠人手改 `latest-set.json` 并重启 Mini。

---

## 7. Current Catalog Pipeline

`src/miniprogram/catalogAdapter.js`：

| 函数 | 分类 | 说明 |
| --- | --- | --- |
| `shouldPublish` | **A 纯计算** | collectible 或 VERIFY_IDS |
| `adaptCard` | **A** | 映射字段 |
| `foldSharedReprints` | **A** | 再版折叠；输入已是 adapted 数组 |
| `buildCatalog` | **B** | 需要完整 `unified.cards` 对象（~35807 键，文件 26.9MB） |
| `filterLatestCards` / `latestCardsPage` | **A** | 依赖已构建 catalog + latest-set |
| `paginateList` / `catalogPage` | **A** | |

Mini 启动实测 catalog 构建约 **320–360ms**（先前 Mini 日志 PROVEN）。这是 **在已有 card-audio-index 上** 的纯 CPU，不扫 Hearthstone。

> **未来 Admin「更新数据」能否在线重建 Catalog？**

- **仅 `buildCatalog(existingIndex)`：可以**，秒级，适合长驻 Node。
- **从零重建 voice+audio index：不适合** 塞进一次 HTTP / Serverless（见 §19）。
- 当前 Mini **没有**热重载 catalog 的 API；即使磁盘上换了 JSON，也要重启进程才进内存。

---

## 8. Current Audio Pipeline

```text
C:\Hearthstone\Data\Win\*.unity3d
  ↓ Extractor + audioBundleResolver（读 bundle，写 tmp WAV）
audio-index.json / card-audio-index 中的 voiceKey、clip
  ↓ AudioService / EntrancePreviewService
GET /api/audio/voice|music|entrance
  ↓ 小程序 player
```

`/api/audio/health`：`hearthstoneReadOnly: true`，`bulkExport: false`。

| Admin 动作 | 标记 | 原因 |
| --- | --- | --- |
| 检查音频状态（读 index / `getCardAudioAvailability`） | **SAFE** | 只读 JSON + 已有 diagnostic |
| 重新扫描/解析单卡（读游戏文件，更新 cache） | **POSSIBLE** | 需本机 `C:\Hearthstone`；写 `tmp/` 与可能写 resolver cache |
| 重新生成单卡 WAV | **POSSIBLE** | 与现有按需 extract 相同；不要做成任意路径写入 |
| 重新生成全部音频 | **DANGEROUS / NOT RECOMMENDED** | 无 bulk API；耗时长；磁盘大（本机 tmp 已约 0.75GB WAV）；违反现有 `bulkExport: false` |

「检查状态」≠「重建索引/提取」。后者依赖游戏安装，不能假设云主机有 `C:\Hearthstone`。

---

## 9. Latest Set Architecture

文件：`data/index/latest-set.json`（331 bytes）。

| 谁读 | 何时 |
| --- | --- |
| `miniServer.js` | **进程启动一次** `loadLatestSetConfig(...)`，结果放 `latestSetConfig` |
| `test/latestCards.test.js` 等 | 测试时读 |
| 小程序 | **不读该文件**；只调 `/api/mini/latest` |

无文件监视、无热更新。修改 JSON 后 **必须重启 Mini** 才生效（PROVEN：启动时 try/catch 加载）。

| 环境 | Admin 改 latest-set 后能否立即生效 |
| --- | --- |
| 当前本地 Mini | **否**，除非重启或未来增加 reload API |
| 「生产 Server」 | **NOT CONFIRMED** 是否存在；若同样启动时加载，同样要重启/reload |
| 未来 Admin | 应：**写配置源 + 触发内存 reload**，不要只改文件以为即时 |

`latest-set.json` 仍适合作为 **单一配置源**（1.5.4 已落地）。Admin 应改它（或未来 DB 中的等价记录），而不是在页面硬编码 set。

---

## 10. Feedback Capability

| 项 | 判定 |
| --- | --- |
| feedback API | **NOT FOUND** |
| 数据库 / 表 | **NOT FOUND** |
| 用户标识 | **NOT FOUND**（小程序无登录） |
| UI | **PARTIAL**：`pages/more/more` 有「问题反馈 · 即将开放」，无点击、无提交 |

未来最小模型（**不创建**）：

```text
feedback
  id, type, cardId, content, contact,
  status, createdAt, updatedAt, adminNote
```

本地长驻 Node 可用 JSON/SQLite；Serverless 必须外部库。无微信 openId 时 contact 只能自愿填写。

---

## 11. Authentication

**NOT FOUND** 任何认证。Mini API 对局域网完全开放；CORS `*`。

| 方案 | 安全 | 复杂度 | 适配 | 维护 |
| --- | --- | --- | --- | --- |
| A 单用户名密码 | 中（需 HTTPS + 防爆破） | 中 | 需新 POST + session | 中 |
| **B Admin Token**（环境变量，Header） | 中（token 强度、勿进 git） | **低** | 与现有 Node 最贴 | **低** |
| C JWT | 中高 | 高 | 无用户表，过重 | 高 |
| D Supabase Auth | 高 | 高 | **当前无 Supabase** | 高 |
| E Cloudflare Access / Vercel Protection | 高 | 中 | **当前无这些部署** | 中 |

**RECOMMENDED（未来第一版，不实现）：B `ADMIN_TOKEN` + 仅 `/api/admin/*` 校验；禁止把 token 放进小程序。** 隐藏 URL **不够**。前端藏按钮 **不够**。后续若公网部署再升 HTTPS + 更强方案。

---

## 12. Logging

无审计日志。仅有 console 与诊断报告文件。

未来最小日志（不实现）：

```text
id, at, actor, action, paramsSummary, result, durationMs, error
```

禁止把 token、完整用户输入、WAV 路径里的隐私写进可下载日志。参数只记 set id / cardId / job id。

---

## 13. Recommended Admin Architecture

比较：

| | 改动 | 部署 | 安全 | 维护 | 规模 |
| --- | --- | --- | --- | --- | --- |
| **A** Mini 上挂 `/api/admin/*` + 静态 Admin 页 | 小（已有 `send`/`http`） | 与 Mini 同进程，本地立刻能用 | 需把 admin 与公开 GET 隔离 | 一套进程 | **最贴当前** |
| B 独立 Admin 应用调 API | 两套服务 | 多一端口/仓库 | 边界清晰 | 双倍 | 规模尚小，过早 |
| C `admin/` 目录同仓 | 与 A 兼容（静态放 `admin/` 或 `public/admin/`） | 同 A | 同 A | 目录清晰 | 推荐作为 A 的落地形态 |

```text
RECOMMENDED ADMIN ARCHITECTURE

方案 A + 同仓静态页（类 Explorer 的 public/，但是 /admin）

  Mini Server :8767
    GET  /api/mini/*     公开（小程序）
    GET  /api/audio/*    公开（播放）
    *    /api/admin/*    必须鉴权；默认不开放给小程序
    GET  /admin          静态 Admin UI（浏览器，不是微信页）

不要把 Admin 做进 miniprogram Tab。
不要在未搞清云部署前绑定 Vercel。
```

Explorer `public/` 证明项目 **已有**「Node 提供 HTML」的模式，但那是卡牌图鉴，**不是** Admin；不要复用其无鉴权 API 做管理。

---

## 14. Admin API Architecture

```text
Public Mini API     /api/mini/*  /api/audio/*
Protected Admin API /api/admin/*
```

**应该分开（PROVEN 需求）：** Mini 全是只读 GET、无鉴权、CORS `*`。管理写操作、构建 Job、反馈处理 **不能** 挂在同一套无鉴权路由上。

Admin 响应可包含内部计数、job 状态、diff；不要把 admin DTO 泄漏进小程序 list card。

CORS：Admin 应收紧，不要 `*` + 无鉴权写。

---

## 15. Data Update Architecture

推荐未来（不实现）：

```text
检查新数据（人工或脚本）→ Preview diff → 确认
  → Job：构建到 data/builds/<id>/
  → 校验脚本（已有 validate:index / validate:audio）
  → PASS 后原子切换 active 指针
  → 日志
  → Mini reload catalog（新能力，当前没有）
```

**应该**「构建新目录 → 验证 → 切换」，**不要**直接覆盖正在被 Mini 读取的 `card-audio-index.json`（文件 27MB，写到一半会损坏运行中服务）。

示例目录（不创建）：

```text
data/
  active.json          # { indexPath, latestSetPath, version }
  builds/<id>/
  backup/<id>/
  index/               # 当前仍是 active 的实际文件，直至迁移
```

当前 **没有** Job 队列。长任务必须后台跑，不能阻塞 HTTP。

---

## 16. Versioning / Rollback

当前：单份 `data/index/*.json`，**无版本目录**。覆盖即丢失上一版，除非 git / 手工拷贝。仓库 **无 git**（先前调查）。

| | 回滚 |
| --- | --- |
| 直接覆盖 | **弱** / 失败时难恢复 |
| 版本化 + Previous | **推荐** |

未来至少：`Current` / `Previous` / `Rollback` 指针。音频 `tmp/` 可不纳入版本（可重建）。`latest-set.json` 应随数据版本一起记。

---

## 17. Admin Information Architecture

建议（浏览器 `/admin`，非小程序）：

```text
/admin
├── 概览          版本、catalog 张数、latest set、Mini health（只读）
├── 最新卡牌      查看/编辑 latest-set（写 = Level 2 + reload）
├── 数据
│   ├── 当前版本
│   ├── 检查更新（先只读对比，不下载覆盖）
│   ├── 更新历史 / 回滚     Level 2–3
│   └── Jobs
├── 卡牌          查询（可复用 catalog 只读）
├── 音频          状态查询；单卡「检查」SAFE；「重建全部」隐藏
├── 反馈          Level 1 UI，存储未建
└── 系统          健康、操作日志、关于
```

不要做：在线改 `shouldPublish` / `foldSharedReprints`、一键全量抽音频、任意文件删除。

---

## 18. Security Risk Matrix

| # | 风险 | 当前 | 未来 |
| --- | --- | --- | --- |
| 1 未授权 Admin | **HIGH**（尚无 Admin；一旦加写接口且无鉴权则 **CRITICAL**） | Token + 分离 `/api/admin` |
| 2 任意构建 | **HIGH** 若把 `index:voice` 暴露给 HTTP | 白名单 Job、无用户拼命令 |
| 3 任意写文件 | **HIGH** | 禁止用户路径；固定 data/builds |
| 4 任意删除 | **CRITICAL** 若实现 | 只切换指针，不 `rm -rf` |
| 5 Command Injection | **HIGH** 若 `exec(userInput)` | **禁止**；只调用固定 npm script |
| 6 路径穿越 | **MEDIUM** | `path.join` 规范化 + 根目录 jail |
| 7 Secret 泄露 | **MEDIUM** | token 仅环境变量；勿进小程序/报告 |
| 8 CSRF | **MEDIUM**（浏览器 Admin） | 非简单 CORS、自定义 Header |
| 9 XSS | **MEDIUM** | 反馈内容转义 |
| 10 日志泄密 | **MEDIUM** | 日志不含 token |
| 公开 Mini 局域网 | **MEDIUM** | 开发预期；公网需另议 |

当前 Mini **无鉴权 GET 音频** 对 LAN 开放：符合「开发局域网方案」，不是 Admin 漏洞，但是公网暴露时的独立风险。

---

## 19. Performance Assessment

| 数据 | 值 | 来源 |
| --- | --- | --- |
| `catalog.cards` | 7263 | Mini / fold 后 |
| unified `card-audio-index` 卡数 | 35807 | report + manifest |
| collectible（fold 前 publish 池） | 8154 | phase 1.1 report |
| `card-audio-index.json` | 26.9 MB | 本机 stat |
| `card-voice-index.json` | 42.4 MB | |
| `audio-index.json` | 12.0 MB | |
| HSJSON `cards.json` | 9.6 MB | |
| `cards.collectible.json` | 3.2 MB | |
| guid cache | 23.8 MB | |
| phase08 总耗时 | **211012 ms（~3.5 min）** | `data/index/manifest.json` |
| 其中 audioIndexMs | 132120 ms | 可复用先验 index |
| phase11 统一索引 | **4216 ms** | `card-audio-index-report.md` |
| Mini `buildCatalog` | ~320–360 ms | Mini 启动日志 |
| tmp WAV | ~0.75 GB（441+199+187 文件） | 本机 stat |

Serverless 超时：phase08 **远超** 常见 10–60s 限制 → **NOT SUPPORTED BY CURRENT ARCHITECTURE** 作为在线同步 Job。

`buildCatalog`  alone：**可以**在长驻 Node 的 HTTP 里做；仍建议不阻塞播放请求（独立队列更稳）。

---

## 20. 15 Core Questions

**Q1. Admin 放在哪里？**  
同仓静态 `/admin` + Mini 进程上的 `/api/admin/*`。不要放进微信 Tab。

**Q2. 是否与 Mini Server 共用后端？**  
**第一阶段是。** 共用进程、**分开路由与鉴权**。音频提取已在 Mini 内，硬拆收益小。

**Q3. 是否需要独立 Admin Web App？**  
**现在不需要**（规模小、无云部署证据）。以后若 Mini 与构建机分离再拆。

**Q4. 当前部署环境能否持久化 Admin 数据？**  
**本地可以写盘。** 云 Serverless：**NOT CONFIRMED** 且典型只读。无 DB。

**Q5. 是否应该引入数据库？**  
**Level 1 不必。** 反馈/日志一旦要公网或多实例，再引入。

**Q6. 如果引入，最适合什么？**  
本机可用 SQLite；云再用托管 Postgres。当前 **零** 数据库证据，不要为调查安装。

**Q7. latest-set.json 是否继续当配置源？**  
**是。** 单一 `set` 过滤源，页面不写死。

**Q8. 改 latestSet 后如何生产立即生效？**  
当前 **不能**。需要：写文件（或 DB）+ **内存 reload**（或重启 Mini）。没有 reload API。

**Q9. 数据更新是否做成后台 Job？**  
**完整 index：必须 Job。** 仅 `buildCatalog`：可同步，仍建议队列。

**Q10. Catalog 能否在线重建？**  
**能**（已有 index 时，亚秒到一秒）。**不能**等同「在线跑完 phase08」。

**Q11. Audio Index 能否在线重建？**  
**本机长驻 Node：POSSIBLE（数分钟 + 读 Hearthstone）。Serverless：NOT SUPPORTED。** 不要对公网 HTTP 同步调用。

**Q12. 是否需要版本化数据？**  
**需要**（一旦允许覆盖 27MB 索引）。当前没有。

**Q13. 是否需要回滚？**  
**需要**（与版本化一起）。当前没有。

**Q14. Admin 认证？**  
第一版 **ADMIN_TOKEN**（Header）。不要隐藏 URL。

**Q15. Phase 1.5.8 最合理第一步？**  
**只读 Admin 骨架**：鉴权后的概览（health、catalog 张数、latest-set 内容、clientVersion），**零写盘、零构建、零反馈表。** 验证 `/api/admin` 与小程序路由隔离。不要一上来做更新 Job。

---

## 21. Recommended Phase 1.5.8

```text
Level 1 只读
- GET /api/admin/overview（token）
- 静态 /admin 一页
- 展示 latest-set.json 字段与 catalog.count
- 不改 latest-set、不跑 phase08/11、不抽音频、不建 DB
```

明确不做：数据更新、回滚、反馈写入、全量音频。

---

## 22. Files Investigated

`package.json`、`project.config.json`、`src/miniprogram/miniServer.js`、`lanListen.js`、`catalogAdapter.js`、`src/explorer/server.js`、`HearthstoneAudioExtractor.js`、`audioService.js`、`audioCache.js`、`phase08-build.mjs`、`phase11-build.mjs`、`scripts/run-mini.cjs`、`scripts/run-phase08.cjs`、`scripts/run-phase11.cjs`、`miniprogram/app.json`、`miniprogram/pages/more/*`、`miniprogram/utils/config.js`、`public/index.html`、`data/index/latest-set.json`、`data/index/manifest.json`、`data/index/card-audio-index-report.md`、`data/index/cache/phase-0.8-stats.json`。

搜索：`vercel.json`、`api/`、`.env*`、`SUPABASE`、`DATABASE_URL`、`EROFS`、`admin`、`feedback` API、`POST`。

---

## 23. Production Changes

```text
0
```

---

## 24. Tests

本阶段不改测试、不要求 `npm test`。

---

## 25. Final Status

```text
READY FOR PHASE 1.5.8
（只读 Admin 骨架；非实现更新流水线）

INVESTIGATION ONLY
```

功能分层摘要：

**Level 1 立即适合：** 系统概览、查看 latest set、卡牌只读查询、音频**状态**查询、反馈 UI 占位（无存储）。

**Level 2 需要 Job / reload：** 改 latest-set 并热加载、HSJSON/index 更新预览、构建 catalog、校验、版本切换。

**Level 3 暂时不要：** 一键全量提取音频、删除全部数据、在线改 fold/publish 规则、Serverless 上写 `data/`。
