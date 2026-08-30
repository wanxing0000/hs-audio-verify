# Phase 1.5.16 Report

Status: COMPLETE — MANUAL DB MIGRATION REQUIRED

Production code changes: yes  
Test code changes: yes  
Database changes: migration file only (`003_data_update_jobs.sql`); remote DDL **not** applied  
UI changes: yes (`/admin/data`)  
Dependency changes: 0  

Phase 1.5.16 DOES NOT RUN PHASE08.  
Phase 1.5.16 DOES NOT RUN PHASE11.  
Phase 1.5.16 DOES NOT PUBLISH CATALOG.

Snapshot data unchanged.  
Phase08 not executed.  
Phase11 not executed.  
Catalog not published.

未进入 Phase 1.5.17。

---

## 1. Current database schema

001 实际表（远程已存在，可读写）：

- `admin_users`
- `latest_sets`
- `app_settings`
- `feedback`
- `admin_logs`

001 **没有** `data_versions`、`update_jobs`。未改 001 / 002。

002 `publish_latest_set`：远程仍未 apply（`PGRST202` skip，与本阶段无关）。

003 已写成文件，**未在远程执行**。service role 不能跑 DDL。

---

## 2. data_versions

新表（003）：

| 列 | 说明 |
| --- | --- |
| id | uuid PK |
| version | 如 `hs-<12-char fingerprint>`；若 metadata 有 build 则为 `hs-<build>-<short>` |
| status | STAGED / VALIDATED / READY / ACTIVE / FAILED / RETIRED |
| source / locale | 默认 hearthstonejson / zhCN |
| build | 可为 null |
| cards_sha256 / collectible_sha256 | 快照指纹输入 |
| cards_count / collectible_count | 来自 snapshot-meta，不猜 |
| snapshot_fingerprint | UNIQUE |
| snapshot_meta | jsonb，仅 metadata |
| created_at / updated_at | trigger `set_updated_at` |

本阶段服务层 **不会** 自动写成 ACTIVE。允许自动：STAGED → VALIDATED → READY（失败则 FAILED）。

---

## 3. update_jobs

| 列 | 说明 |
| --- | --- |
| id | uuid PK |
| job_type | 仅 `HSJSON_SNAPSHOT`（CHECK） |
| status | PENDING / CHECKING / DOWNLOADING / VALIDATING / READY / RUNNING / SUCCEEDED / FAILED / CANCELLED |
| data_version_id | FK data_versions，可空 |
| source / locale / snapshot_fingerprint | |
| error_code / error_message | 无 stack、无 secret |
| started_at / finished_at / failed_at | |
| created_by | FK admin_users，可空 |

部分唯一索引 `update_jobs_one_active_hsjson`：同一 `job_type` 在 CHECKING / DOWNLOADING / VALIDATING / RUNNING 只能一行。

本阶段 CLI/API **不** 进入 RUNNING（留给未来 phase08/11）。不实现 CANCELLED 操作。

---

## 4. status model

Data Version：STAGED → VALIDATED → READY。ACTIVE / RETIRED 列上允许、本阶段不切换生产。FAILED 可回到 STAGED（同一 fingerprint 重试）。

Update Job（HSJSON）：

PENDING → CHECKING →（UP_TO_DATE）SUCCEEDED  
CHECKING → DOWNLOADING → VALIDATING → READY → SUCCEEDED  
任一步 → FAILED

---

## 5. fingerprint

```text
sha256(source + "\n" + locale + "\n" + cardsSha256 + "\n" + collectibleSha256)
```

不含时间。相同 snapshot 一致；不同 SHA 不同。version 用 fingerprint 前 12 位，避免 uuid 当 version。

当前 `snapshot-meta.json` **不存在**，metadata 无 build → **build = null**（不从文件内容猜 build，不猜 250339）。

---

## 6. idempotency

- `data_versions.snapshot_fingerprint` UNIQUE；`createDataVersion` 先查找再插入
- 单进程 mutex `lock.inProgress`（在任何 await 之前置位）
- DB 阻塞状态 + 部分唯一索引
- 已有 CHECKING/DOWNLOADING/VALIDATING/RUNNING → API **409** `DATA_UPDATE_ALREADY_RUNNING`
- 重复「检查 HSJSON 更新」只写 `admin_logs`，不刷 data_version

---

## 7. job lifecycle

`src/services/hsjsonSnapshotJob.js` `runHsjsonSnapshotJob()` 调用现有 `hsjsonUpdater`（不重写）：

1. 创建 job PENDING  
2. CHECKING → `checkRemoteSnapshot()`（HEAD / Range，不下载整包）  
3. UP_TO_DATE → job SUCCEEDED，**不**新建 data_version，不改生产 JSON  
4. UPDATED_AVAILABLE → DOWNLOADING → `updateSnapshot()`  
5. VALIDATING → 读 commit 返回的 meta → create/reuse data_version → VALIDATED → READY  
6. job READY → SUCCEEDED  

失败：FAILED + error_code / error_message / failed_at。不保存 stack / `.env` / key / token。

---

## 8. Admin API

全部 `requireAdmin()`：

- `GET /api/admin/data-versions`（含本地 snapshot 摘要，不 parse 3 万张卡）
- `GET /api/admin/data-versions/:id`
- `GET /api/admin/update-jobs`
- `GET /api/admin/update-jobs/:id`
- `POST /api/admin/data/check` → `UP_TO_DATE` / `UPDATED_AVAILABLE` / `UNKNOWN`
- `POST /api/admin/data/update` → `{ jobId, dataVersionId, status }`（HSJSON Snapshot Update，不是完整游戏数据更新）

未认证 401；Auth 但非 active admin 403。Mini API 权限未改。

003 未执行时列表/更新会 503 `DATA_SCHEMA_UNAVAILABLE`。

---

## 9. Admin UI

路径：`/admin/data`  
Sidebar：Dashboard / 最新卡牌 / **数据更新**

按钮文案：**检查 HSJSON 更新**、**更新 HSJSON**  
（没有「一键更新全部数据」「更新游戏数据」）

展示：当前 Snapshot、Remote Status、Data Versions、Update Jobs。

浏览器仍只用 `SUPABASE_ANON_KEY`。未改 Auth。

---

## 10. audit logs

沿用 `admin_logs`：

- `data.update.check`
- `data.update.start`
- `data.update.success`
- `data.update.failed`

details：jobId、dataVersionId（可空）、status、source、locale。无 HSJSON 正文、无 secret。

---

## 11. tests

| 文件 | 结果 |
| --- | --- |
| test/dataVersionService.test.js | TEST 1–7 PASS（memory） |
| test/updateJobService.test.js | TEST 1–6 PASS（memory） |
| test/adminDataUpdate.test.js | TEST 1–9 PASS（mock updater，不下载） |
| test/dataUpdateUi.test.js | PASS |
| 旧测试 | 未删、未 skip |

---

## 12. npm test

**PASS**（含新增四份测试与原有套件）。

---

## 13. database migration status

文件：`supabase/migrations/003_data_update_jobs.sql`

- RLS ENABLE
- REVOKE anon / authenticated
- GRANT service_role
- FK / index / unique

**MANUAL REQUIRED**：在 Supabase Dashboard SQL Editor 执行该文件。执行前真实 `data_versions` / `update_jobs` 写入测试为：

DATABASE INTEGRATION BLOCKED

不能声称 COMPLETE VERIFIED。

---

## 14. live HSJSON status

`npm run data:check` → **UP_TO_DATE**

因此 **没有** 执行 `data:update`。

---

## 15. Mini regression

未重启 8767 上已有 Mini（避免 EADDRINUSE）。现有进程：

- `GET /api/mini/health` → **200**
- manifest `cardCount` → **7263**
- latest set → **ESCAPEFROM_VIOLET_HOLD**
- latest total → **164**

新 Admin 路由在**下次**启动 Mini 后生效。未重建 Catalog。

---

## 16. security audit

扫描 `src/` `scripts/` `admin/` `public/` `test/`（117 文件）：**NOT FOUND** 实际 `SUPABASE_SERVICE_ROLE_KEY` 值。

admin HTML/JS 无 service_role、无 token、无 `.env` 内容。API 单测响应无 secret。error_message 会剥离 stack / key。

---

## 17. snapshot changed or unchanged

**Unchanged.**

仍无 `snapshot-meta.json`。

---

## 18. known limitations

- 远程 003 未执行 → 真实 DB 写入未验证
- 无 snapshot-meta 时 Admin「当前 Snapshot」的 count / downloadedAt 可能为 —
- build 恒为 null，直到 metadata 显式提供
- 进程崩溃可能留下 CHECKING/DOWNLOADING 行（无 worker 回收）
- 单 Node mutex 不是分布式锁
- 现有 Mini 进程尚未加载本阶段路由
- 002 RPC 仍可能未 apply

---

## 19. next phase

Phase 1.5.17 **未开始**。建议先执行 003，再考虑只读 Admin 与 HSJSON 的联调；仍不要把一键更新绑到 phase08/11。

---

## Production / test files

新增：

- `src/services/dataVersionService.js`
- `src/services/updateJobService.js`
- `src/services/hsjsonSnapshotJob.js`
- `src/services/dataUpdateAdmin.js`
- `admin/data.html`
- `admin/data.js`
- `supabase/migrations/003_data_update_jobs.sql`
- `test/dataVersionService.test.js`
- `test/updateJobService.test.js`
- `test/adminDataUpdate.test.js`
- `test/dataUpdateUi.test.js`
- `data/card-verification/phase-1.5.16-report.md`

修改：

- `src/services/adminAuth.js`
- `src/miniprogram/miniServer.js`
- `src/miniprogram/adminStatic.js`
- `admin/index.html`
- `admin/latest.html`
- `admin/admin.css`
- `scripts/run-hsjson-update.cjs`
- `package.json`
- `test/supabaseDatabase.test.js`

未改：`hsjsonUpdater.js` 核心、Catalog fold、Extractor、001/002、`C:\Hearthstone`、`data/index/*`、生产 HSJSON。
