# Phase 1.5.17-A Report

```text
Phase 1.5.17-A

Status: COMPLETE VERIFIED
```

本阶段只做远程 Supabase **结构与安全验证**。未执行 Admin Check，未下载/替换 HSJSON，未跑 phase08/phase11，未重启 Mini。

---

## Database

migration 003：人工已在 Dashboard SQL Editor 执行（`Success. No rows returned`）。本阶段 **未修改** `supabase/migrations/003_data_update_jobs.sql`。

| 项 | 结果 |
| --- | --- |
| data_versions | EXISTS |
| update_jobs | EXISTS |
| RLS | ENABLED（migration 含 `ENABLE ROW LEVEL SECURITY`；anon 实测 `42501 permission denied`） |
| constraints | PASS（OpenAPI PK/NOT NULL/FK；UNIQUE/CHECK 以 003 文本为准，见下） |
| indexes | PASS（003 已 apply；partial unique predicate 与文件一致，见下） |
| FK | PASS |
| trigger | PASS（`set_updated_at` 已存在；003 绑定同名 trigger；live `latest_sets` trigger 测试 PASS） |
| anon deny | PASS |
| service role read | PASS |
| Mini health | PASS |

当前行数（service role `count=exact`）：

- `data_versions` = **0**
- `update_jobs` = **0**
- `admin_logs` = **0**
- `admin_users` = **0**

无本次验证产生的测试行。空表是正常状态。

### data_versions（OpenAPI + SELECT）

列与 003 一致：`id`(PK uuid)、`version`、`status`、`source`、`locale`、`build`、`cards_sha256`、`collectible_sha256`、`cards_count`、`collectible_count`、`snapshot_fingerprint`、`snapshot_meta`(jsonb)、`created_at`、`updated_at`。

003 文本（未改）：

- `UNIQUE (snapshot_fingerprint)` → `data_versions_fingerprint_key`
- `UNIQUE (version)` → `data_versions_version_key`
- `status IN ('STAGED', 'VALIDATED', 'READY', 'ACTIVE', 'FAILED', 'RETIRED')`

PostgREST **不暴露** `information_schema` / `pg_catalog`（`PGRST106`）。因此未用脏数据探测 UNIQUE/CHECK；也未列出远程 `pg_indexes`。

### update_jobs（OpenAPI + SELECT）

列与 003 一致。OpenAPI FK：

- `data_version_id` → `data_versions.id`
- `created_by` → `admin_users.user_id`

003 文本：

- `job_type IN ('HSJSON_SNAPSHOT')`
- status CHECK：`PENDING` … `CANCELLED`（含 `RUNNING`，本阶段不使用）
- partial unique index `update_jobs_one_active_hsjson` on `(job_type)`  
  **predicate：** `WHERE status IN ('CHECKING', 'DOWNLOADING', 'VALIDATING', 'RUNNING')`  
  与 migration 文件逐字一致。

### admin_logs

003 **没有** `data_versions` / `update_jobs` 指向 `admin_logs` 的 FK，也没有反向 FK。  
OpenAPI：`admin_logs.admin_user_id` → `admin_users.user_id`。  
Audit 仍用 `target_type` / `target_id` 文本。未改历史 log。

### RLS

未关闭 RLS，未增加 policy。

- anon → `data_versions` = DENY（`42501`）
- anon → `update_jobs` = DENY（`42501`）
- service_role → READ = PASS

`authenticated` 与 anon 一样在 003 中 `REVOKE ALL`。无真实登录用户，未伪造 JWT。

### trigger

`public.set_updated_at()` 已存在（001）。`node test/supabaseDatabase.test.js` 在 **`latest_sets` 测试行** 上验证 `updated_at` 推进（该测试原有，本阶段未改 `ESCAPEFROM_VIOLET_HOLD` 业务行）。  
003 为 `data_versions` / `update_jobs` 安装 `trg_*_updated_at` → 同一 function。空表上未做 UPDATE。

---

## Tests

```text
node test/supabaseDatabase.test.js   PASS
node test/phase1517ASchema.test.js   PASS
```

003 覆盖改为 **只读**：OpenAPI 列/PK/FK + count + anon deny。**没有** insert/delete `data_versions` / `update_jobs`。

---

## Mini

未重启。`GET http://127.0.0.1:8767/api/mini/health` → **HTTP 200**。

未调用 `POST /api/admin/data/check`。

---

## Safety

```text
HSJSON snapshot changed: NO
phase08 executed: NO
phase11 executed: NO
Catalog rebuilt: NO
Latest Set changed: NO
```

Snapshot（只读哈希，未改文件）：

- cards.json = 10038512 bytes, sha256 `4c815ace15781d07e45588265971a7e4e46e2b91bc47c640378c488fea16e5bf`
- cards.collectible.json = 3401974 bytes, sha256 `c2512895b549bacd2ecd6420d384a054b44641d7afb6c0d8327bacbdec24f383`
- 无 `snapshot-meta.json`

current latest_sets 仍为 **ESCAPEFROM_VIOLET_HOLD**（1 行 `is_current`）。

未输出 secret / token / password。未改 `.env`。未建 Admin 用户。

---

## Known limitation

无 `DATABASE_URL`；PostgREST 禁止 `information_schema` / `pg_catalog`。UNIQUE / CHECK / partial index / RLS 开关的 **catalog 行** 无法用 REST 列出。验证依据：003 成功执行 + 表可读 + OpenAPI 形状 + anon `42501`。

---

未进入 Phase 1.5.18。未进入完整 1.5.17 Admin Check（`admin_users` = 0）。
