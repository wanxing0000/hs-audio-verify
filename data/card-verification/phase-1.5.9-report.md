# Phase 1.5.9 Report：Supabase Server Connection Foundation

## 1. Phase 状态

```text
Phase 1.5.9
Status: IMPLEMENTATION COMPLETE
Automated tests: PASS
WeChat DevTools / device UI: NOT VERIFIED
MANUAL REQUIRED（本阶段无小程序 UI 改动）
```

本阶段只做 Node Mini Server 的 **Supabase 服务器端连接基础**：读环境变量、建 server client、最小初始化测试。未进入 Phase 1.5.10。

未实现：Admin 登录、Admin 页面、数据库建表、latest_sets CRUD、一键更新、反馈系统、app_settings、admin_logs、卡牌数据迁移。

```text
Catalog: unchanged
foldSharedReprints: unchanged
latest-set.json: unchanged
latest API: unchanged
latest 页面: unchanged
牌库: unchanged
card-item: unchanged
音频: unchanged
tabBar: unchanged
详情页: unchanged
Supabase database changes: 0
Secret values in this report: NONE
```

---

## 2. 开工前检查

| 文件 | 检查结果 |
| --- | --- |
| `package.json` | 当时 dependencies 仅 `@arkntools/unity-js`；`test` 脚本未含 supabase；无 `@supabase/supabase-js` / `dotenv` |
| `src/miniprogram/miniServer.js` | Node Mini HTTP 服务；无 Supabase；Catalog / latest / 音频路由已存在 |
| `scripts/run-mini.cjs` | `chdir` 后 esbuild 打包 `miniServer.js` → `tmp/mini-server.cjs`；**当时不加载 `.env`** |
| `.env` | 已存在且被 `.gitignore`；含 `MINI_HOST` / `MINI_PORT` / `PORT` / `SUPABASE_*` 占位；**值为空**；无真实 key |
| `.gitignore` | 第一行 `.env`，另有 `.env.*` 与 `!.env.example` |

结论：可以加 server-only client，不必改业务路由。`.env` 继续 git ignore。仓库当时 **不是** git repo（无 `.git`）。

---

## 3. 修改了哪些文件

- `package.json` — 增加 `@supabase/supabase-js`、`dotenv`；将原先未声明、被 `npm install` prune 掉的 `esbuild` 写回 dependencies（Mini / 若干 test 需要）；`test` 脚本接入 `test/supabaseClient.test.js`
- `package-lock.json` — 随 npm install 更新
- `scripts/run-mini.cjs` — `chdir(root)` 之后 `require('dotenv').config({ path: .../.env })`，再 spawn Mini
- `src/miniprogram/miniServer.js` — 启动时 `loadProjectEnv` + `tryCreateSupabaseAdmin`；仅打「initialized / not configured」日志；**未改任何 HTTP 路由、Catalog、latest、音频**
- `.env` — 仅更新注释（说明 Mini 经 dotenv 加载）；**未写入任何真实 key**；三个 `SUPABASE_*` 仍为空

未改：`src/miniprogram/catalogAdapter.js`、`data/index/latest-set.json`、`miniprogram/pages/latest/*`、牌库页、`card-item`、tabBar、详情页、音频服务。

---

## 4. 新增了哪些文件

- `src/services/supabaseClient.js`
- `test/supabaseClient.test.js`
- `data/card-verification/phase-1.5.9-report.md`（本报告）

未新增 `.env.example`（gitignore 预留了 `!.env.example`，本阶段不强制）。

---

## 5. npm install 情况

```text
npm install @supabase/supabase-js dotenv
  added 10 packages, removed 2 packages, 0 vulnerabilities
  @supabase/supabase-js  ^2.112.4
  dotenv                ^17.4.2

副作用：
  未在 package.json 声明的 esbuild 被 prune
  （run-mini.cjs 与 musicPlaybackCoverage.test.js 依赖 node_modules/esbuild）

npm install esbuild
  added 2 packages, 0 vulnerabilities
  esbuild  ^0.28.2
  （恢复 Mini 打包器，不是把 secret 打进前端）
```

`npm test` 在恢复 esbuild 后 **PASS**。

---

## 6. Supabase client 初始化结果

模块：`src/services/supabaseClient.js`

- `inspectSupabaseEnv`：只返回 `hasUrl` / `hasServiceRoleKey` / `hasAnonKey` 三个 **boolean**
- `createSupabaseAdmin`：`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`，`persistSession: false`，`autoRefreshToken: false`
- 缺 `SUPABASE_URL` → `SUPABASE_CONFIG_INVALID`，文案「缺少 SUPABASE_URL」
- 缺 `SUPABASE_SERVICE_ROLE_KEY` → 同 code，文案「缺少 SUPABASE_SERVICE_ROLE_KEY」
- 错误信息 **不含** secret 值
- `tryCreateSupabaseAdmin`：未配置时 **不抛错**，返回 `{ ok: false, configured: false, client: null }`，避免空 `.env` 时 Mini 起不来

测试（注入假 URL + 假 key，**非生产、非本机 .env**）：

```text
createClient 可构造
client.from 为 function
client.auth 为 object
不访问真实项目、不建表、不改库
```

当前本机 `.env` 三个 Supabase 值为空，因此 Mini 启动路径会走：

```text
[mini] supabase not configured
```

而不会走 `supabase client initialized`。这是预期，不是失败。本阶段 **没有** 对真实 Supabase 项目做网络握手。

`GET /api/mini/health` **未** 增加 Supabase 字段（避免牵动 `lanPreview.test.js`）。连接测试在 Node 单元测试 + 启动日志，不在公开 API。

---

## 7. 环境变量读取结果（只报告存在/不存在，不输出值）

`loadProjectEnv` 读取项目根目录 `.env`。dotenv 会提示注入了 6 个 **变量名**；测试只记录 boolean。

| 变量 | 本机当前 |
| --- | --- |
| `SUPABASE_URL` | 不存在（空字符串视为不存在） |
| `SUPABASE_SERVICE_ROLE_KEY` | 不存在 |
| `SUPABASE_ANON_KEY` | 不存在（仅保留在 `.env` 占位；本阶段客户端不使用） |
| `MINI_HOST` | 存在（非 secret） |
| `MINI_PORT` | 存在（非 secret） |
| `PORT` | 存在（非 secret） |

`.gitignore` 仍包含 `.env`。报告与日志均未打印任何 key。

---

## 8. service role 是否可能进入前端

**否（按当前代码与扫描）。**

| 边界 | 结果 |
| --- | --- |
| `miniprogram/`（微信客户端） | 无 `SUPABASE_SERVICE_ROLE_KEY` / `@supabase/supabase-js` / `createSupabaseAdmin` |
| `public/` | 同上 |
| 硬编码真实 key | `supabaseClient.js` 无 `eyJ` / `sb_secret_` 一类字面量 |
| 前端 bundle | 未把 supabase SDK 打进小程序或 `public/` |
| `tmp/mini-server.cjs` | `npm run mini` 的 **Node 服务端** bundle，可能含 SDK **代码**；key 仍来自运行时 `process.env`，不写入源码或前端 |

service role 只允许出现在 Node 服务端：`src/services/supabaseClient.js`、`miniServer.js` 启动路径、`scripts/run-mini.cjs` 加载的 `.env`。

`SUPABASE_ANON_KEY` 本阶段不进入任何客户端代码。

---

## 9. npm test 结果

```text
npm test
exit code: 0
PASS
```

含既有 catalog / latest / 音频 / tabBar 等测试，以及新建 `test/supabaseClient.test.js`（缺失 env 报错、初始化、gitignore、miniprogram+public 扫描）。

首次全量失败原因：esbuild 被 prune。恢复声明依赖后通过。**不是** Catalog / latest 业务回归。

---

## 10. Production code changes

```text
src/services/supabaseClient.js          (new)
src/miniprogram/miniServer.js           (env + optional client boot only)
scripts/run-mini.cjs                    (dotenv load)
package.json                            (deps + test script)
package-lock.json                       (lockfile)
.env                                    (comment only; gitignored; keys still empty)
```

Mini HTTP 路由、Catalog、fold、latest API/页面、牌库、音频：**0 行为变化**。

---

## 11. Test code changes

```text
test/supabaseClient.test.js             (new)
package.json test script                (wire supabaseClient.test.js)
```

---

## 12. Data changes

```text
data/card-verification/phase-1.5.9-report.md   (this report)
latest-set.json                                0
card-audio-index.json                          0
HSJSON                                         0
```

---

## 13. Supabase database changes

```text
0
未连接真实项目（本机 URL / service role / anon 均未配置）
未建表
未改 RLS
未写 latest_sets / feedback / app_settings / admin_logs
无 migration
```

---

## 14. 未做（故意停止）

- Admin 登录 / Admin 页面
- 数据库建表
- latest_sets CRUD
- 一键更新
- 反馈系统
- 卡牌数据迁移
- Phase 1.5.10

---

## 15. 本地填 key 后的预期

在 `.env` 写入非空的 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 并重启 Mini 后，日志应为 `[mini] supabase client initialized`，仍 **不会** 打印 key。不要把 service role 放进 `miniprogram/` 或 `public/`。
