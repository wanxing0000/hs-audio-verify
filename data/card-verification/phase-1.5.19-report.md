# Phase 1.5.19 Report

```text
Phase 1.5.19: COMPLETE — MANUAL REQUIRED
```

未进入 Phase 1.5.20。未修改 HSJSON Updater / `data_versions` / `update_jobs`。未执行 `data:update`、Phase08、Phase11。未重建 Catalog。未修改 Latest Set / `latest-set.json`。未修改 Mini 卡牌 API 行为。未修改音频系统。

---

## Status

```text
COMPLETE — MANUAL REQUIRED
```

原因：远程 `feedback` 表仍是 migration `001` 的 CHECK（`status` = `new|reviewing|resolved|ignored`，`type` = `bug|suggestion|data|audio|other`）。本阶段新增的 `004_feedback_management.sql` **尚未在 Dashboard 执行**。因此：

- Mock / 内存：TEST 1–20 PASS
- 远程：表可读；legacy `new`/`bug` 写入 + 状态更新 + 清理 PASS
- 远程：`OPEN` / `BUG` 写入被 CHECK 拒绝（未伪造成功）

在 Supabase SQL Editor 执行 `supabase/migrations/004_feedback_management.sql` 之后，Public `POST /api/feedback` 与 Admin 新枚举才能对真实库生效。

---

## Files Changed

修改：

- `src/services/adminAuth.js` — `dispatchAdminRequest` 增加 `handleFeedback`（PATCH 不再落到 405）
- `src/miniprogram/miniServer.js` — `POST /api/feedback`（独立 CORS）；Admin feedback handler；进程内存限流
- `src/miniprogram/adminStatic.js` — `/admin/feedback` 可刷新
- `admin/index.html` / `admin/latest.html` / `admin/data.html` — Sidebar「用户反馈」
- `admin/index.html` / `admin/admin.js` — Dashboard「待处理反馈」
- `admin/admin.css` — 筛选、详情、`modal-backdrop[hidden]`
- `miniprogram/pages/more/more.js` / `more.wxml` / `more.wxss` — 意见反馈表单（未改 tabBar）
- `test/adminUi.test.js` / `test/dataUpdateUi.test.js` — `/admin/feedback` 与 sidebar
- `package.json` — `npm test` 纳入新测试

新增：

- `supabase/migrations/004_feedback_management.sql`
- `src/services/feedbackService.js`
- `src/services/feedbackAdmin.js`
- `admin/feedback.html`
- `admin/feedback.js`
- `test/feedbackService.test.js`
- `test/feedbackApi.test.js`
- `test/adminFeedback.test.js`
- `data/card-verification/phase-1.5.19-report.md`

未改：`001_initial_admin_data.sql`、`002_latest_set_publish.sql`、`003_data_update_jobs.sql`、HSJSON 快照、`latest-set.json`、`.env`。

---

## Database

```text
feedback schema (001, 当前远程):
  id uuid
  content text NOT NULL          ← API JSON 字段 message 映射到此列
  contact text                   ← 本阶段不强制填写
  type text                      ← 远程仍为旧枚举
  status text DEFAULT 'new'      ← 远程仍为旧枚举
  admin_note text
  created_at / updated_at
  RLS: enabled
  GRANT: service_role only（anon/authenticated REVOKE ALL）

migration 004: 已写入仓库，远程未执行
RLS: 未改策略；Public/Admin 均走 Node service role，浏览器不直连 feedback
真实写入测试:
  readable: YES
  insert OPEN/BUG: NO（legacy CHECK）
  insert legacy new/bug + status update + cleanup: YES
  TEST 前缀 [TEST_PHASE_1_5_19] 结束后 leftover: 0
```

Public 路径：浏览器 / 小程序 → Node `POST /api/feedback` → service role → Supabase。  
Admin 路径：Bearer token → `requireAdmin()` → service role → Supabase。  
`SUPABASE_SERVICE_ROLE_KEY` 未放入 `admin/`、`miniprogram/`、`public/`、浏览器 config。

---

## Public Feedback

```text
POST /api/feedback  匿名，无需登录 / email / token
validation:
  type ∈ BUG | FEATURE_REQUEST | CARD_DATA | AUDIO | OTHER
    else 400 FEEDBACK_TYPE_INVALID
  message trim 后 5–2000
    else 400 FEEDBACK_MESSAGE_TOO_SHORT / FEEDBACK_MESSAGE_TOO_LONG
rate limit: 同一 IP 5 次 / 10 分钟，进程内存 Map
  超限 429 FEEDBACK_RATE_LIMITED
  Server restart clears rate limit state
success: { ok, feedback: { id, status, createdAt } }  （不返回 Supabase 内部信息）
Mini UI: 更多页 → 问题反馈 → 意见反馈表单
```

重启 Mini 后实测非法 type：`FEEDBACK_TYPE_INVALID`。远程未执行 004 时，合法提交会因 CHECK 返回 `FEEDBACK_UNAVAILABLE`（503），这是真实结果，不是 API 路由缺失。

---

## Admin Feedback

```text
GET  /api/admin/feedback            列表；status/type/page/pageSize
GET  /api/admin/feedback/:id        UUID 校验；404 FEEDBACK_NOT_FOUND
PATCH /api/admin/feedback/:id       只改 status
auth: 无 token / 假 token → 401；非 Admin → 403
pagination: page>=1；pageSize 默认 20，最大 100；created_at DESC
filter: status / type 实测于 Mock
```

已登录 Admin 浏览器：`/admin/feedback` 列表加载成功（0 条，远程无反馈）。Dashboard「待处理反馈」= 0。`/admin/data` 不是 Not Found。

---

## Audit

```text
action: feedback.update_status
details: { feedbackId, fromStatus, toStatus }
Mock TEST 20: PASS
Live 新枚举 audit: NOT RUN（004 未应用，未伪造）
```

未写入 access token / service role / password。

---

## Admin UI

```text
/admin/feedback  刷新可打开（adminStatic PAGE_MAP）
List: YES（空列表「暂无反馈」）
Filter: status + type
Detail: modal（默认隐藏；修复了 .modal-backdrop 覆盖 [hidden]）
Status update: UI 已接 PATCH；远程新枚举需 004
Sidebar: 用户反馈（未破坏 Dashboard / latest / data）
```

未登录跳转：页面 HTML 仍走 `requireAdmin()` → `/admin/login`。本次浏览器会话已有 Admin 登录，因此未再测「清空 session 后的跳转」。该项保持 MANUAL。

---

## Tests

```text
test/feedbackService.test.js  PASS  TEST 1–7 + list/filter/detail/status
test/feedbackApi.test.js      PASS  TEST 1–7 HTTP
test/adminFeedback.test.js    PASS  TEST 8–20 + live readable/legacy write/cleanup
npm test: PASS
```

---

## Regression

```text
GET /api/mini/health     HTTP 200
Catalog total            7263
Latest Set               ESCAPEFROM_VIOLET_HOLD
Latest Count             164
/admin/login             200
/admin                   200  Mini 正常 / Catalog 7263 / Latest 164 / 待处理反馈 0
/admin/latest            200
/admin/data              200（不是 Not Found）
/admin/feedback          200
Sidebar                  正常
```

---

## Security

```text
service role actual value: NOT FOUND
access token: NOT FOUND
password: NOT FOUND
```

扫描：`admin/`、`miniprogram/`、`src/`、`test/`、`data/card-verification/`。日志只区分 configured / not configured。未 `console.log(process.env)`。

---

## Explicitly Not Done

```text
HSJSON snapshot changed: NO
data:update: NO
phase08: NO
phase11: NO
Catalog rebuilt: NO
Latest Set changed: NO
file/image upload: NO
admin reply / email / user accounts: NO
Phase 1.5.20: NO
```

---

## Manual next step（本阶段停止点）

在 Supabase Dashboard SQL Editor 执行：

`supabase/migrations/004_feedback_management.sql`

执行后再测：`POST /api/feedback` 合法提交 → `status=OPEN`；Admin PATCH → `admin_logs.action = feedback.update_status`。

```text
DO NOT ENTER PHASE 1.5.20
```
