# Phase 1.5.11 Report：Admin Auth + 权限基础

## 1. Phase Status

```text
Phase 1.5.11
Status: COMPLETE
```

未进入 Phase 1.5.12。未做 Admin UI / Dashboard / latest 管理 / 反馈 UI。

开工实测（不以 1.5.10 报告为准）：

```text
Supabase client:                 PASS
admin_users / latest_sets /
app_settings / feedback /
admin_logs:                      CREATED（PostgREST 可读）
latest_sets current:             ESCAPEFROM_VIOLET_HOLD（1 条，verified=true）
admin_users rows:                0
anon 读 admin_users:             42501（拒绝）
既有 Admin 登录系统:             无
Mini:                            Node 原生 http，未迁 Express
service_role:                    仅 Node 环境变量
```

`admin_users` 为空是预期：本阶段禁止自动注册 Admin。

---

## 2. Changes

修改：

- `src/miniprogram/miniServer.js` — `/api/admin/*` 走 Admin CORS + `dispatchAdminRequest`；`/api/mini/*` 仍公开
- `package.json` — `test` 接入 `test/adminAuth.test.js`

新增：

- `src/services/adminAuth.js`
- `test/adminAuth.test.js`
- `data/card-verification/phase-1.5.11-report.md`

未改：`supabaseClient.js` 职责、`catalogAdapter.js`、`latest-set.json`、小程序页面、音频、tabBar、`.env` 值、RLS / migration SQL。

---

## 3. Authentication Architecture

```text
浏览器未来（本阶段无登录页）
  → Supabase Auth Email+Password
  → access token
  → GET /api/admin/*  Authorization: Bearer <token>
  → Node authenticateAdminRequest
       1. 解析 Bearer
       2. supabase.auth.getUser(token)   （不信任自解码 JWT role）
       3. service role 查 admin_users
       4. is_active === true AND role === 'admin'
  → 允许后，后续写库仍只用 server-side service role
```

普通 `auth.users` 无 `admin_users` 行 → 403。不开放 `POST /api/admin/register`。无 password 列。

---

## 4. Authorization

| HTTP | code | 含义 |
| --- | --- | --- |
| 401 | `ADMIN_AUTH_REQUIRED` | 无 Authorization |
| 401 | `ADMIN_TOKEN_INVALID` | 格式错误 / token 空 / Auth 拒绝 |
| 403 | `ADMIN_USER_NOT_FOUND` | Auth 用户存在但无 admin_users |
| 403 | `ADMIN_INACTIVE` | `is_active !== true` |
| 403 | `ADMIN_FORBIDDEN` | `role !== 'admin'` |
| 200 | — | active admin；`GET /api/admin/health` |

响应不含 service_role、access/refresh token、password。health 不返回 email。

---

## 5. Admin API

```text
GET /api/admin/health
```

本机 Mini 重启后：

```text
无 token:     401  ADMIN_AUTH_REQUIRED
假 token:     401  ADMIN_TOKEN_INVALID
有效 Admin:   单元/进程内 HTTP 200；真实 Dashboard 用户见 Manual
```

`/api/mini/health` `200`；`/api/mini/latest` `200` total=164；catalog total=7263。未给 mini 路由加 Admin Auth。

---

## 6. Security Boundary

```text
service_role key 值:  仅 .env（gitignore）→ Node process.env
miniprogram/:         NOT FOUND
public/:              NOT FOUND
API response:         NOT FOUND
测试输出:             NOT FOUND（假 token / 变量名允许）
```

服务端文件可出现**变量名** `SUPABASE_SERVICE_ROLE_KEY` 与 SQL 角色名 `service_role`，不是密钥值。

CORS：

```text
/api/mini/*    Access-Control-Allow-Origin: *  Allow-Headers: Content-Type（未改）
/api/admin/*   Origin 仍为 *（本阶段无域名白名单）
               Allow-Headers: Authorization, Content-Type
```

限制已记录：Admin 与 Mini 同机 `*`，后续 UI 再收紧 Origin。未加 `Access-Control-Allow-Credentials`。

---

## 7. RLS

未 disable RLS。未给 anon/authenticated 加全开 policy。未把 service_role 发给浏览器。

```text
anon 读 admin_users: 42501
anon 读 latest_sets: 拒绝（空或错误，database test PASS）
```

Admin 查 `admin_users` 仅 Node + service role，且先做 Bearer + Auth + 表校验。

---

## 8. Tests

```text
test/adminAuth.test.js:        PASS（TEST 1–13 + live 假 token 401）
test/supabaseDatabase.test.js: PASS（表已存在，含 uniqueness / RLS / FK / trigger）
npm test:                      PASS
```

TEST 7 `role != admin` 用 mock：数据库 CHECK 只允许 `role = 'admin'`，中间件仍校验 role。

---

## 9. Manual Verification

```text
MANUAL REQUIRED
```

1. Dashboard → Authentication → 创建 Email+Password 用户（不要把密码写入仓库）
2. 将该 `auth.users.id` 插入 `admin_users`（`role=admin`, `is_active=true`）
3. 另建一个 Auth 用户且**不**插入 admin_users → 真实 403
4. 用 Admin 的 access token 调 `GET /api/admin/health` → 真实 200
5. Admin 登录页 / 浏览器 UI：本阶段未做

`admin_users` 当前 0 行，故本机无法用真实 JWT 打出 200/403（非 mock）。不要把真实账号密码写进测试。

---

## 10. Not Changed

```text
Catalog / foldSharedReprints / shouldPublish
latest-set.json / latest 页面 / card-item
音频 / Music / Entrance / Extractor / TabBar
牌库 / HSJSON
RLS policies（未削弱）
```

---

## 11. Next Phase

建议 **Phase 1.5.12 Admin 基础 UI**（登录页 + 调 `/api/admin/health`）。不要在浏览器初始化 service-role client。
