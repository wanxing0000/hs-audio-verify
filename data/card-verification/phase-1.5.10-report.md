# Phase 1.5.10 Report：Supabase 数据库与动态数据层基础建设

## Phase Status

```text
Phase 1.5.10
Status: BLOCKED
```

原因：**远程 PostgreSQL 未能执行 migration**。Node 用现有 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 可以初始化 client，也可以打到 PostgREST；该密钥只能访问 Data API，**不能跑 DDL**。环境中没有 `DATABASE_URL` / `SUPABASE_DB_URL` / `SUPABASE_ACCESS_TOKEN`，未安装 Supabase CLI，未登录 Management API。未绕过 RLS、未改 `.env` 中的 Secret、未用 Dashboard 作为 schema 唯一来源。

Schema **已经写入 git 路径** `supabase/migrations/001_initial_admin_data.sql`。远程 5 张表 **尚未创建**。解除阻塞：在 Dashboard SQL editor 执行该文件，或提供可用的 DB URL / Management token 后再跑同一 SQL。不要把密钥贴进聊天或代码。

未进入 Phase 1.5.11。未实现 Admin / 登录 / latest 数据流切换。

---

## 开工前检查

```text
src/services/supabaseClient.js     已存在，未改
dotenv                             已接入 Mini / 测试
SUPABASE_URL                       存在（可被 Node 读取）
SUPABASE_SERVICE_ROLE_KEY          存在（可被 Node 读取）
SUPABASE_ANON_KEY                  存在（本阶段不用于写库）
supabase/migrations                原先不存在，本阶段新建
数据库业务代码                     原先不存在
latest-set.json                    未改
catalogAdapter.js                  未改
Mini latest API                    仍读 latest-set.json
```

PostgREST 探测 `public.latest_sets`：`PGRST205`（表不在 schema cache / 不存在）。

---

## Database

远程实例：

```text
admin_users       NOT CREATED
latest_sets       NOT CREATED
app_settings      NOT CREATED
feedback          NOT CREATED
admin_logs        NOT CREATED
```

仓库 migration（可重复执行）已定义上述 5 张表，含：

- `ENABLE ROW LEVEL SECURITY`（无 anon/authenticated policy）
- `REVOKE` anon/authenticated；`GRANT` 仅 `service_role`
- `admin_users.user_id` → `auth.users(id) ON DELETE CASCADE`
- `latest_sets` partial unique index `latest_sets_one_current`（仅 `is_current = true`）
- seed：`ESCAPEFROM_VIOLET_HOLD` 为唯一 current（字段对齐 `data/index/latest-set.json`）
- `feedback.status` 默认 `'new'`，CHECK `new|reviewing|resolved|ignored`
- `admin_logs.admin_user_id` → `admin_users.user_id`
- 统一 `set_updated_at()` + 4 个 UPDATE trigger
- `NOTIFY pgrst, 'reload schema'`
- 无 password / password_hash；无 `cards` 表；无 Catalog / 音频索引

---

## RLS

远程无法验证（表未创建）。Migration 设计：

```text
admin_users     ENABLE + no policies + revoke anon/authenticated
latest_sets     ENABLE + no policies + revoke anon/authenticated
app_settings    ENABLE + no policies + revoke anon/authenticated
feedback        ENABLE + no policies + revoke anon/authenticated
admin_logs      ENABLE + no policies + revoke anon/authenticated
```

未提前开放 anonymous INSERT。

---

## Current Latest Set

**JSON（Mini 仍使用，未改）：**

```text
ESCAPEFROM_VIOLET_HOLD
Escape from Violet Hold
逃离紫罗兰监狱
2026-07-07T10:00:00-07:00
verified=true
source=Blizzard official expansion page
```

**数据库 current：** 未写入（表不存在）。Migration seed 与 JSON 对齐，`is_current=true`。

---

## Verification

```text
Supabase connection:     PASS  (client init + PostgREST reachable)
Database read:           FAIL  (PGRST205, tables absent)
Current latest uniqueness: NOT RUN
RLS:                     NOT RUN
FK:                      NOT RUN
updated_at trigger:      NOT RUN
```

`test/supabaseDatabase.test.js`：

- TEST 1：client 初始化 **PASS**
- TEST 2–8 及 RLS/FK/trigger：表不存在时 **SKIP**（不把缺 DDL 凭证当成回归失败）
- 环境变量缺失时 SKIP；密钥不写入测试文件

---

## Regression

```text
npm test:     PASS
Mini health:  PASS  HTTP 200  {"ok":true,"service":"mini-api","host":"0.0.0.0","port":8767}
Catalog:      7263  (GET /api/mini/catalog total)
Mini PID:     50296  (本阶段未重启；无 Mini 代码改动)
```

latest / class grouping / catalog / audio / tabBar 测试均过。Mini 仍：

```text
latest-set.json → Mini Server → /api/mini/latest → 小程序
```

未从 Supabase 读 latest。

---

## Security

```text
.env ignored:                 PASS  (.gitignore 含 .env；仓库无 .git，故无 staged .env)
service role not hardcoded:   PASS
service role not in miniprogram/: PASS
public/:                      PASS
test/ / scripts/ / supabase/: PASS（无硬编码 eyJ / sb_secret_ 真实值）
```

未打印 `SUPABASE_SERVICE_ROLE_KEY`，未把完整 `.env` 写入本报告。未修改 `.env` 中已有 Secret。

---

## Scope

```text
Admin UI:                          NOT IMPLEMENTED
Admin Auth:                        NOT IMPLEMENTED
Latest DB migration in Mini API:   NOT IMPLEMENTED
Feedback API:                      NOT IMPLEMENTED
Cards table:                       NOT IMPLEMENTED
Audio storage migration:           NOT IMPLEMENTED
Supabase CLI / Docker / Vercel:    NOT INSTALLED
Realtime / Edge Functions:         NOT ENABLED
```

---

## 修改文件

- `package.json` — `test` 脚本接入 `test/supabaseDatabase.test.js`

未改：`src/services/supabaseClient.js`、`miniServer.js`、`catalogAdapter.js`、`latest-set.json`、牌库、音频、tabBar、详情页、`.env`。

---

## 新增文件

- `supabase/migrations/001_initial_admin_data.sql`
- `test/supabaseDatabase.test.js`
- `data/card-verification/phase-1.5.10-report.md`（本报告）

---

## Git

```text
git status --short
fatal: not a git repository
```

无待提交列表。`.gitignore` 仍忽略 `.env`。

---

## 下一步（解除 BLOCKED，仍不进入 1.5.11）

在 **SQL editor** 执行 `supabase/migrations/001_initial_admin_data.sql`，或配置仅服务端可用的 DB URL / Management token 后执行同一文件。然后再跑 `node test/supabaseDatabase.test.js`。不要为此开放 anon 写权限。
