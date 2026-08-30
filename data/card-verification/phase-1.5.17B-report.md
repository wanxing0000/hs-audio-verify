# Phase 1.5.17-B Report

```text
Phase 1.5.17-B: COMPLETE VERIFIED
```

本阶段只做真实 Admin Check 的收尾验证与报告。未进入 Phase 1.5.18。未执行 `data:update`、未点击「更新 HSJSON」、未下载或替换生产 HSJSON Snapshot、未执行 phase08 / phase11、未重建 Catalog、未改变 Latest Set。

未重放已登录的 `POST /api/admin/data/check`（避免再写一条 reuse audit）。证据来自 Mini 鉴权门闩、服务端 job / `admin_logs`、以及生产 Snapshot / Mini 只读核对。

---

## Admin

```text
active admin: PASS (count = 1)
real login: PASS（用户已登录 /admin；本机未索取或打印 password / token）
admin data page: PASS (GET /admin/data → 200)
check session: PASS
```

- 无 token：`POST /api/admin/data/check` → **401** `ADMIN_AUTH_REQUIRED`
- 伪造 token：`POST /api/admin/data/check` → **401** `ADMIN_TOKEN_INVALID`
- `GET /api/admin/data-versions` 无 token → **401**
- `GET /api/admin/update-jobs` 无 token → **401**

真实 Check 写入的 `update_jobs.created_by` 与 `admin_logs.admin_user_id` 均指向当前 **active admin**（`role=admin` 且 `is_active=true`）。匿名请求无法产生这些行。

未记录 email / password / access token / service role key。

---

## HSJSON Check

```text
result: PASS
http: PASS (handler 成功路径；未抓浏览器 HAR)
remote status: UP_TO_DATE
remote source: https://api.hearthstonejson.com/v1/latest/zhCN/cards.json
               https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json
```

服务端记录（与 `checkRemote()` 首次 UP_TO_DATE 路径一致：create job → CHECKING → SUCCEEDED，**不**新建 `data_version`）：

- `admin_logs.data.update.check.details.status` = **UP_TO_DATE**
- job `8fd501d5-3fe2-4829-b70e-da2d4b823089` status = **SUCCEEDED**，`error_code` / `error_message` = null
- `data_version_id` = null（Check 不是 Update）

该路径只有在 `orch.checkRemote(auth)` 正常返回后，API 才会以 **HTTP 200** `{ ok: true, status }` 结束。若失败，job 会标 FAILED，并写 `data.update.failed`。库中无 FAILED job、无 failed audit。

页面上 Remote Status = UP_TO_DATE 与上述记录一致。页面当时 Data Versions = 0、Update Jobs = 0：Check 成功后 UI **没有**再 `loadLists()`，列表仍是打开页时的空表。以数据库为准（见下）。

---

## Update Job

```text
job type: HSJSON_SNAPSHOT
status: SUCCEEDED
idempotency: PASS（同 fingerprint 仅 1 条 SUCCEEDED；无 FAILED；无重复错误行）
```

| 项 | 值 |
| --- | --- |
| count | **1** |
| id | `8fd501d5-3fe2-4829-b70e-da2d4b823089` |
| created_at | 2026-08-29T12:25:29.261Z |
| finished_at | 2026-08-29T12:25:31.293Z |
| fingerprint | 与当前生产 Snapshot 一致 |
| data_version_id | null |
| created_by | active admin |

`npm test` 后行数仍为 1（测试 PREFIX 行已清理，未删除这条真实 job）。

---

## Data Version

```text
version count before Check: 0
version count after Check: 0
fingerprint: n/a（无 version 行）
duplicate prevention: PASS（无错误行、无重复 fingerprint 行）
```

UP_TO_DATE Check **按设计不创建** `data_versions`。`build` 未猜测。无 `snapshot-meta.json`。

---

## Audit

```text
check audit: PASS
secret leakage: NOT FOUND
```

`admin_logs` 共 **3** 行，全部 `target_type=hsjson_snapshot`，`target_id` = 上述 job id，且来自 active admin：

| action | details.status |
| --- | --- |
| `data.update.start` | PENDING |
| `data.update.check` | UP_TO_DATE |
| `data.update.success` | UP_TO_DATE |

无 `data.update.failed`。details 仅含 jobId / source / locale / status / snapshotFingerprint，不含 token / password / service role。

---

## Snapshot

```text
snapshot changed: NO
cards sha256 unchanged: PASS
collectible sha256 unchanged: PASS
```

- cards.json = 10038512 / `4c815ace15781d07e45588265971a7e4e46e2b91bc47c640378c488fea16e5bf`
- cards.collectible.json = 3401974 / `c2512895b549bacd2ecd6420d384a054b44641d7afb6c0d8327bacbdec24f383`
- `snapshot-meta.json`：不存在（未创建）

与 1.5.17-A / 本阶段 Check 前基线相同。`npm test` 后再次哈希，未变化。

---

## Mini

```text
health: PASS (200)
catalog: 7263
latest: ESCAPEFROM_VIOLET_HOLD
latest count: 164
```

`GET /admin/login` → 200；`GET /admin/data` → 200。Catalog / Latest 与 Check 前一致。

---

## Pipeline

```text
data:update: NO
HSJSON download: NO
Snapshot replacement: NO
phase08: NO
phase11: NO
catalog rebuild: NO
latest publish: NO
```

---

## Tests

相关：

```text
node test/phase1517ASchema.test.js   PASS
node test/phase1517DataJobs.test.js  PASS
node test/adminDataUpdate.test.js    PASS
node test/dataUpdateUi.test.js       PASS
node test/supabaseDatabase.test.js   PASS
node test/dataVersionService.test.js PASS
node test/updateJobService.test.js   PASS
```

```text
npm test: PASS
```

`test/phase1517ASchema.test.js` 原先断言 `data_versions` / `update_jobs` 必须为 0（1.5.17-A 空表检查点）。真实 Check 写入 1 条 SUCCEEDED job 后，该断言会把合法生产行当成失败。已改为：**只读核对行数在本测试前后不变**（不插入、不把真实 Check job 清掉）。未改 migration、未改 Check/Update 业务代码、未改 `.env`。

---

## Security scan

扫描 `admin/` `miniprogram/` `public/` `src/` `test/` `data/card-verification/`：无真实 service role / Secret / access token / password 字面量写入报告。测试里仅有 redaction 样例字符串。

未打印 `.env` 内容。

---

未进入 Phase 1.5.18。
