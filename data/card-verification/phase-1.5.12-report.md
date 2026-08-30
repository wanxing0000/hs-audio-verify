# Phase 1.5.12 Report：Admin 登录与后台基础 UI

## 1. Phase Status

```text
Phase 1.5.12
Status: COMPLETE
Manual: MANUAL REQUIRED（真实 Admin 密码登录 Dashboard 未做）
```

未写 COMPLETE VERIFIED。未进入 Phase 1.5.13。

`public/` 仍是 Explorer（`npm run explorer`），未改造成 Admin。Admin 独立入口由 **Mini 同源** 提供：

```text
http://127.0.0.1:8767/admin
http://127.0.0.1:8767/admin/login
```

静态文件在仓库 `admin/`，不经过 `public/index.html`。

---

## 2. 修改文件

- `src/miniprogram/miniServer.js` — 提供 `/admin*` 静态页；`GET /api/admin/status` 经 adminAuth
- `src/services/adminAuth.js` — `publicAdminStatus` + status 路由
- `package.json` — 接入 `test/adminUi.test.js`

未改：`catalogAdapter.js` 核心、`latest-set.json`、小程序页面、音频、tabBar、`public/index.html`、`.env` 值、RLS。

---

## 3. 新增文件

- `src/miniprogram/adminStatic.js`
- `admin/login.html` / `login.js`
- `admin/index.html` / `admin.js` / `admin.css` / `auth.js`
- `test/adminUi.test.js`
- `data/card-verification/phase-1.5.12-report.md`

SDK 由 Mini 映射：`/admin/vendor/supabase.js` → `node_modules/@supabase/supabase-js/dist/umd/supabase.js`（不复制进 git）。

公开配置运行时生成：`GET /admin/config.js`（仅 URL + anon/publishable，`Cache-Control: no-store`）。不含 service role。

---

## 4. Admin 页面结构

```text
/admin/login     登录
/admin/          Dashboard（无 session 则 JS 跳转 login）
Sidebar          Dashboard 可用；最新卡牌 / 反馈 / 设置 / 系统状态 = 即将开放
```

无大型前端框架。无注册 / 找回密码。

---

## 5. 登录流程

```text
Email + Password
  → supabase-js signInWithPassword（anon key）
  → GET /api/admin/health  Bearer access_token
  → 仅 200 进入 /admin/
  → 401/403 不进后台，signOut，提示「邮箱或密码不正确」或「你没有管理员权限」
```

Auth 成功但非 admin **不能**进 Dashboard。token 不放 URL。

---

## 6. Auth 权限模型

与 1.5.11 相同：Supabase Auth 用户 + `admin_users.is_active` + `role=admin`。浏览器只有 anon key。

---

## 7. API 路由

| 路径 | 认证 | 说明 |
| --- | --- | --- |
| `GET /api/admin/health` | 是 | 不变 |
| `GET /api/admin/status` | 是 | mini/catalog/latest/supabase 只读快照 |
| `GET /admin/*` | 否（页面） | HTML/CSS/JS；进 Dashboard 前仍打 health |
| `GET /admin/config.js` | 否 | 仅公开 URL + anon |
| `GET /api/mini/*` | 否 | 未加 Admin Auth |

CORS 未放宽。Admin 与 API 同源，fetch 相对路径。

---

## 8. Dashboard 数据来源

| 卡片 | 来源 |
| --- | --- |
| Mini API | `GET /api/mini/health`（公开） |
| Admin Auth | `GET /api/admin/health` 200 |
| Supabase | `GET /api/admin/status`.supabase.connected |
| 当前管理员 | session.user.email（不把 token 画到页面） |
| Catalog | status.catalog.count（内存 catalog） |
| Latest | status.latest.set / count（`latestCardsPage`，仍读 latest-set.json） |

不显示 JWT、secret、堆栈。

Logout：`signOut` → `/admin/login`。

---

## 9. 安全检查

```text
service_role 密钥值 in admin/:     NOT FOUND
SUPABASE_SERVICE_ROLE_KEY in admin/: NOT FOUND
miniprogram/:                       NOT FOUND（密钥值）
config.js 注入 service role:        NOT FOUND（单测用假 env 断言）
/api/admin/health 无 token:         401
/api/admin/status 无 token:         401
假 token:                           401
```

当前 `admin_users` 仍为 0 行：真实 200/403 登录仍需 Dashboard 建用户后 **MANUAL**。

---

## 10. 自动化测试

```text
test/adminUi.test.js     PASS  TEST 1–11
test/adminAuth.test.js   PASS
test/supabaseDatabase.test.js PASS
```

---

## 11. npm test

```text
PASS
```

---

## 12. 手动验收

本机已做：

```text
GET /api/mini/health                 200
浏览器打开 /admin/                   跳转到 /admin/login
登录页：项目名、邮箱、密码、登录按钮
错误密码                             「邮箱或密码不正确」；按钮有「登录中…」
Logout / 真实 Admin 进 Dashboard     未做（无真实管理员密码）
普通 Auth 用户                       未做（需 Dashboard 用户）
```

```text
MANUAL REQUIRED
```

请用 Dashboard 创建的 Admin（`admin_users` 已插入）在 `http://127.0.0.1:8767/admin/login` 完成：成功进 Dashboard、卡片数字、Logout、Logout 后再进 /admin 被挡。

---

## 13. 未完成项目

- 真实管理员登录 Dashboard
- 域名白名单 CORS（本阶段不需要）
- 最新卡牌 / 反馈 / 设置写操作

---

## 14. 风险

- `admin_users` 为空时，任何能过 Auth 的账号都会在 health 后被拒绝（符合设计）
- `/admin/config.js` 暴露 anon key（设计如此，禁止 service role）
- 无 session 时 `/admin/` 仍 200 HTML，靠前端跳转；API 仍 401

---

## 15. 下一阶段建议

Phase 1.5.13：在已登录 Dashboard 上做 **latest set 只读/更新设计**（仍不要自动抓暴雪官网，直到单独批准）。
