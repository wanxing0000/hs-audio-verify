# Phase 1.5.13 Report：Admin Latest Set 管理与发布

## 1. Phase Status

```text
Phase 1.5.13
Status: COMPLETE
Manual: MANUAL REQUIRED
Live publish RPC: 002 尚未在远程库执行（Dashboard SQL）
```

本阶段只实现 **Latest Set 运营管理**（哪个 Set 是当前 Latest）。

尚未实现：

- HSJSON 自动下载
- Catalog 数据重建
- 音频数据更新
- 自动更新流水线

未进入 Phase 1.5.14。

未改 `C:\Hearthstone`、Catalog 核心、`foldSharedReprints`、`shouldPublish`、Extractor、Resolver、播放器、小程序 latest UI、tabBar。Admin **不写** `data/index/*.json`。

---

## 2. 修改文件

- `src/miniprogram/miniServer.js` — 启动时优先读 DB current；JSON 仅 DB 错误 fallback；runtime getter；Admin POST/PATCH JSON body；CORS 仍由 adminAuth 处理
- `src/miniprogram/adminStatic.js` — `/admin/latest`
- `src/services/adminAuth.js` — CORS 增加 POST/PATCH；dispatch 接入 latest-sets
- `admin/index.html` — Sidebar「最新卡牌」可点
- `admin/auth.js` — `adminApi` 支持 method/body
- `admin/admin.css` — 表格 / 表单 / 弹窗 / toast
- `package.json` — 接入 `test/adminLatestSets.test.js`
- `test/supabaseDatabase.test.js` — 断言 002 文件；探测 `publish_latest_set` RPC（未应用则 skip）

未改：`001_initial_admin_data.sql`、`catalogAdapter.js` 核心、`data/index/latest-set.json`、`pages/latest/*`。

---

## 3. 新增文件

- `src/services/latestSetRuntime.js` — `getLatestSetConfig` / `setLatestSetConfig`；boot 区分 `DB_ERROR` / `DB_NO_CURRENT` / `json-fallback`
- `src/services/latestSetsAdmin.js` — Admin latest-sets 路由与 Supabase deps
- `supabase/migrations/002_latest_set_publish.sql` — `publish_latest_set(uuid)` 事务函数
- `admin/latest.html` / `admin/latest.js`
- `test/adminLatestSets.test.js`
- `data/card-verification/phase-1.5.13-report.md`

---

## 4. Admin API

全部 `/api/admin/latest-sets/*` 经 `requireAdmin()`（Phase 1.5.11）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/latest-sets` | 全部；`release_date` DESC，空日期在后；含 Catalog `card_count` |
| GET | `/api/admin/latest-sets/current` | 当前 Set；无 current → 404 `LATEST_SET_NOT_CONFIGURED` |
| POST | `/api/admin/latest-sets` | 创建；强制 `is_current=false` |
| PATCH | `/api/admin/latest-sets/:id` | 改名称/日期/来源/verified；**不可改** `set_code`、`is_current` |
| POST | `/api/admin/latest-sets/:id/publish` | 原子切换 current + runtime 刷新 + audit |
| DELETE | — | **未提供** |

未登录 401；普通 Auth / inactive 403。响应不含 service role / JWT / 连接信息。

无 token 探测：`GET /api/admin/latest-sets` → **401**。

---

## 5. latest_sets 数据流

```text
运营：
  Supabase latest_sets  →  Admin API  →  Admin UI

小程序：
  latest_sets.is_current=true
        → Mini runtime
        → GET /api/mini/latest
        → catalog.cards（card.set === set_code）

Fallback（仅 DB 无法连接 / 查询失败）：
  data/index/latest-set.json → Mini runtime
```

本机启动日志：

```text
[mini] latest source=db set=ESCAPEFROM_VIOLET_HOLD
```

`latest-set.json` **保留**，Admin **从不写入** 该文件。

---

## 6. current Set 机制

- 数据库：最多一行 `is_current=true`（沿用 `latest_sets_one_current` 部分唯一索引，未删除）
- Mini：内存 runtime，不在每次请求打 DB
- 创建扩展包 **不会** 自动成为 current
- 数据库明确「没有 current」→ `DB_NO_CURRENT`，**不会**用本地 JSON 静默覆盖
- 数据库查询失败 → `DB_ERROR` → 才用 JSON fallback

---

## 7. 发布事务 / 一致性方案

**不**用两次独立 UPDATE。

新增 RPC：`public.publish_latest_set(p_id uuid)`（`SECURITY DEFINER`，仅 `service_role` `EXECUTE`）：

1. `FOR UPDATE` 锁定目标行
2. 将其他 `is_current=true` 置 false
3. 目标置 true
4. 同一事务提交（部分唯一索引防止双 current）

发布 API 顺序：

```text
Admin Auth
  → 读目标行并校验字段
  → Catalog 至少 1 张 card.set === set_code
  → rpc publish_latest_set
  → setLatestSetConfig + 校验 runtime.set
  → admin_logs
  → 200
```

**Runtime 刷新失败**：返回 500 `LATEST_SET_RUNTIME_REFRESH_FAILED`，**不自动回滚数据库**（当前架构没有可靠的跨进程补偿事务）。此时 DB 可能已是新 current，Mini 仍是旧值；API 不会报 success。需查日志后重试 publish 或重启 Mini 从 DB 再加载。

**远程库**：`002_latest_set_publish.sql` **尚未执行**（service role 不能跑 DDL，与 1.5.10 相同）。`node test/supabaseDatabase.test.js` 记为：

```text
skip publish_latest_set RPC: migration 002 not applied
```

在 Dashboard SQL Editor 执行该文件之前，线上「设为当前」会 500。列表 / 创建 / 编辑 / Mini 读 current **不依赖** 该函数。

---

## 8. Catalog 校验

只读现有 `catalog.cards` + `filterLatestCards`。

- 0 张 → 409 `LATEST_SET_DATA_NOT_FOUND`（文案：该扩展包尚未存在于当前卡牌数据中，无法发布。）
- 不扫 HSJSON、不下载、不启动 Extractor
- 卡牌数来自 Catalog，不是数据库行数；查询失败 UI 显示「数据不可用」

---

## 9. Runtime refresh

`createLatestSetRuntime()`：`getLatestSetConfig` / `setLatestSetConfig`。

发布成功后当前进程立即切换；**不必为发布重启 Mini**。

本阶段为加载新代码已重启过一次 Mini（旧进程没有这些路由）。之后 publish 路径不再要求重启。

`GET /api/mini/latest` 分页、pageSize 默认 30 / 最大 50、职业分组与 legendary 排序仍走 `latestCardsPage`，未改小程序页面。

---

## 10. admin_logs

按实际 schema：`admin_user_id`、`action`、`target_type`、`target_id`、`details`（jsonb，不是 `metadata`）。

| action | 时机 |
| --- | --- |
| `latest_set.create` | POST 创建 |
| `latest_set.update` | PATCH |
| `latest_set.publish` | 发布成功且 runtime 已校验 |

publish `details`：`set_code`、`previous_set_code`、`card_count`。不写 password / token / service_role。

写日志失败不回滚已成功的 DB+runtime（吞掉 insert 错误，避免把运营切换打成失败）；单测 mock 断言 publish 一定写入。

---

## 11. 安全检查

```text
service_role 密钥值 in admin/:              NOT FOUND
SUPABASE_SERVICE_ROLE_KEY 字符串 in admin/: NOT FOUND
src/miniprogram/:                           无密钥值
/admin/config.js:                           仍仅 URL + anon
GET /api/admin/latest-sets 无 token:        401
假 token:                                   401
普通 Auth 用户:                             403
inactive admin:                             403
Mini /api/mini/latest:                      仍公开，200
```

未创建 `cards` / `card_audio` / catalog 表。

---

## 12. 自动化测试

```text
test/adminLatestSets.test.js  PASS  TEST 1–20
  1  无 token → 401
  2  假 token → 401
  3  Admin 列表 200
  4  current 正确
  5  创建
  6  创建默认非 current
  7  更新（忽略 is_current）
  8  set_code 不可改 → 409 SET_CODE_IMMUTABLE
  9  发布不存在 → 404
  10 Catalog 无该 Set → 409 LATEST_SET_DATA_NOT_FOUND
  11 合法发布 success
  12 仅一个 current
  13 旧 current false
  14 新 current true
  15 runtime 更新
  16 Mini latest 用新 set
  17 admin_logs publish
  18 普通用户 403
  19 inactive 403
  20 Mini 不受 Admin Auth 影响

另测：DB_ERROR → JSON fallback；DB_NO_CURRENT → 不用 JSON 覆盖

test/adminAuth.test.js           PASS
test/adminUi.test.js             PASS
test/supabaseDatabase.test.js    PASS（002 RPC skip：未 apply）
```

测试前缀 `TEST_PHASE_1_5_13_` / `TEST_PHASE_1513_` 结束时 delete。未删除 `ESCAPEFROM_VIOLET_HOLD`。

---

## 13. npm test

```text
PASS
```

未删旧测试、未 skip、未把失败改成 PASS。

---

## 14. 手动测试

本机已做：

```text
Mini 启动 latest source=db set=ESCAPEFROM_VIOLET_HOLD
GET /api/mini/latest?page=1&pageSize=1
  set=ESCAPEFROM_VIOLET_HOLD  total/count=164
GET /admin/latest HTML 200，Sidebar 含「最新卡牌」
浏览器打开 /admin/latest → 跳转 /admin/login（无 session）
GET /api/admin/latest-sets 无 token → 401
```

未做（无 Dashboard Admin 密码；`admin_users` 仍可能为 0）：

```text
真实 Admin 登录
添加/编辑 Set
设为当前（需先执行 002）
回滚 ESCAPEFROM_VIOLET_HOLD
查 admin_logs
Logout 后再进 /admin
```

```text
MANUAL REQUIRED
```

请先在 Supabase SQL Editor 执行 `supabase/migrations/002_latest_set_publish.sql`，再用真实 Admin 按需求文档第二十六、二十七节验收，并在结束后把 current 恢复为 `ESCAPEFROM_VIOLET_HOLD`、删除测试 Set。

---

## 15. 测试数据清理

自动化：`like set_code TEST_PHASE_1_5_13_%` / `TEST_PHASE_1513_%` 已 delete。

当前库 current 仍为 `ESCAPEFROM_VIOLET_HOLD`（supabaseDatabase TEST 3/4）。

手动测试产生的行需操作者自行删除。

---

## 16. 当前限制

- 不能更新 HSJSON / card-audio-index / 音频
- Catalog 没有的 Set 不能发布（设计如此）
- 无删除 / archive API
- `set_code` 创建后不可改
- 远程未执行 002 时 live publish 不可用
- 无真实 Admin 账号时 UI 发布路径无法点完
- DB 已发布但 runtime 刷新失败时不自动回滚

---

## 17. 下一阶段建议

Phase 1.5.14 再考虑：**HSJSON / 卡牌索引如何进入 Catalog**（仍不要自动抓官网，直到单独批准）。

执行 002 并完成 MANUAL 登录发布回滚后，运营侧 Latest Set 切换才算在真实库上闭环。
