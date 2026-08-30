# Phase 1.5.8 Report：Supabase 数据库与 Admin 基础架构调查

## 1. Phase Status

```text
Phase 1.5.8
Status: INVESTIGATION COMPLETE
Production code changes: 0
Test code changes: 0
Data changes: 0
UI changes: 0
Dependency changes: 0
Supabase database changes: 0
Secret changes: 0
Only report added:
data/card-verification/phase-1.5.8-report.md
```

未连接真实 Supabase。未建表。未写 `.env`。报告不含任何 key / password。未进入 Phase 1.5.9。

本阶段重新读取仓库，不完全依赖 1.5.7。1.5.7 之后架构结论：**无实质变化**（仍无 DB、无 Admin API、无 Vercel）。

---

## 2. Current Architecture Re-check

| 项 | 2026-08-29 实测 |
| --- | --- |
| Mini Server | `src/miniprogram/miniServer.js`，Node `http.createServer`，仅 GET/OPTIONS |
| Catalog | `buildCatalog`：shouldPublish → adaptCard → foldSharedReprints；启动内存化 |
| latest API | `GET /api/mini/latest`；配置 `data/index/latest-set.json` **启动时读一次** |
| 当前 set | `ESCAPEFROM_VIOLET_HOLD` / 逃离紫罗兰监狱 |
| 小程序 latest | `loadLatestAll` + `groupLatestCardsByClass`；不读 HSJSON |
| 牌库 | `/api/mini/catalog` + search；`pages/index` 未改职责 |
| 音频 | Extractor 读 `C:\Hearthstone`，WAV 写 `tmp/`；`bulkExport: false` |
| 反馈 | `pages/more` 仍「即将开放」；无 API |
| 依赖 | 仅 `@arkntools/unity-js`；无 `@supabase/supabase-js` |
| `vercel.json` / `.env` / `api/` | **NOT FOUND** |
| 仓库内 supabase 字符串 | 仅 1.5.7 报告提及 **NOT FOUND** |

JSON 职责（PROVEN）：

| 文件 | 职责 | Mini 运行时 |
| --- | --- | --- |
| `hearthstonejson/zhCN/cards*.json` | HSJSON 快照；phase11 输入 | 不直接读 |
| `card-voice-index.json` / `audio-index.json` | 语音/clip 索引（phase08，~3.5 min） | Mini 读 audio-index |
| `card-audio-index.json` | 统一卡牌+音频元数据（26.9MB，35807 卡） | **启动加载** |
| `music-assets.json` / `music-index.json` | 登场音乐资产 | 启动加载 |
| `latest-set.json` | 当前 Expansion 配置 | 启动加载 |
| `tmp/*.wav` | 按需提取缓存（本机约 0.75GB） | 播放时读 |

游戏静态数据与动态运营数据 **已经在文件层分开**。Catalog 折叠逻辑在 Node，不在 JSON 里再实现一遍。

---

## 3. Supabase Suitability

结合本项目，而不是功能清单：

| 能力 | 判定 | 原因 |
| --- | --- | --- |
| PostgreSQL | **适合** | 反馈、设置、latest 历史、Job、日志需要关系与约束 |
| Auth | **适合 Admin** | 不要自管 password hash；禁止 `admin_users.password` |
| RLS | **适合** | 表默认启用；Admin 写走 service role 在 **服务器** |
| REST / JS client | **适合服务器** | Mini/Admin API 用 SDK；小程序 **不要** service role |
| Migrations | **适合** | 表结构进 git，不进 Dashboard 点点点 |
| Local CLI / Docker | **未来可用** | 本地可 `supabase start`；当前未装 |
| Storage | **暂时不要用存 WAV** | Free 1GB；本机 tmp 已 ~0.75GB；单文件 Free 上限 50MB |
| Realtime | **暂时不要用** | 小程序列表不需要推送；增加复杂度 |
| Edge Functions | **暂时不要用当构建机** | phase08 ~211s；音频提取需本机游戏目录 |
| Database webhooks | **未来可用** | 非 MVP |
| anon / publishable key | **适合公开反馈 insert（若走直连）** | 必须 RLS；仍推荐经 Mini 代理以便限流 |
| service_role / secret | **仅 Node 后端** | 禁止小程序、git、`public/`、Admin 浏览器包 |

**结论：** Supabase 适合作为 **长期动态数据层**。不适合替换 HSJSON / card-audio-index / fold / Extractor。

---

## 4. Authentication

**Admin 应使用 Supabase Auth。** 不要自建密码列。

推荐关系：

```text
auth.users.id  (uuid)
      ↓ 1:1
admin_users.user_id  PK/FK
  role: 'admin'
  is_active: boolean
  display_name
```

- **需要** `admin_users`：Auth 用户 ≠ 管理员。防止任意注册账号进后台。
- 登录：Email + 密码（或 Magic link）。**人工邀请**：只把已存在的 `auth.users.id` 插入 `admin_users`。
- Admin API：校验 JWT → 查 `admin_users.is_active`。不是 Admin 则 403。
- **RLS 不能单独当唯一闸门**：浏览器若拿 anon key 直连，策略必须极严。管理写操作应走 **Mini/Admin Node + secret key**，RLS 作为第二道（表对 anon 拒绝一切）。
- Service role / secret：**只在服务器环境变量**。小程序 **零接触**。
- 小程序用户 **不必** 登录才能看牌库。反馈见 §7。

第一版 Admin 人数预期 1–3 人。不必上 SSO。

---

## 5. Database Schema

以下 **只存在于报告**。类型为 PostgreSQL。时间一律 `timestamptz`，默认 `now()`。主键均为 `uuid` `gen_random_uuid()`，除非注明。

RLS 总原则：所有表 `ENABLE ROW LEVEL SECURITY`；`anon`/`authenticated` 默认无策略或仅反馈 insert；`service_role` 绕过 RLS，仅服务器使用。

### 5.1 admin_users

| 列 | 类型 | NULL | 默认 | 约束 |
| --- | --- | --- | --- | --- |
| user_id | uuid | 否 | — | PK，FK → auth.users(id) ON DELETE CASCADE |
| role | text | 否 | `'admin'` | check in (`admin`) |
| is_active | boolean | 否 | true | |
| display_name | text | 是 | — | |
| created_at / updated_at | timestamptz | 否 | now() | |

索引：`is_active`。读/写：仅 service role（Admin API）。浏览器直连：deny。

**禁止 password 列。**

### 5.2 app_settings

键值运营配置（公告文案等），**不是** 7263 张卡。

| 列 | 类型 | NULL | 约束 |
| --- | --- | --- | --- |
| key | text | 否 | PK |
| value | jsonb | 否 | |
| updated_at | timestamptz | 否 | |
| updated_by | uuid | 是 | FK admin_users |

读：Admin API。写：Admin。小程序若需要公告，经 Mini 只读缓存，不要每请求打 DB。

### 5.3 latest_sets

见 §6。

### 5.4 feedback

见 §7。

### 5.5 admin_logs

见 §8。

### 5.6 data_versions

见 §9。

### 5.7 update_jobs

见 §10。

另：**不需要** `cards` 表进第一版 schema。

---

## 6. latest_sets

当前 JSON 字段已够映射：

| DB | JSON |
| --- | --- |
| set_code | set |
| name_en / name_zh | nameEn / nameZh |
| release_date | releaseDate（timestamptz） |
| source / source_url | source / sourceUrl |
| verified | verified |
| is_current | 无（JSON 只有一份当前） |

推荐 **行历史 + 单当前**：

```text
latest_sets
  id uuid PK
  set_code text NOT NULL
  name_en, name_zh text NOT NULL
  release_date timestamptz NULL
  source text NULL
  source_url text NULL
  verified boolean NOT NULL DEFAULT false
  is_current boolean NOT NULL DEFAULT false
  created_at, updated_at
```

**唯一当前：** `UNIQUE (is_current) WHERE is_current`（部分唯一索引），保证最多一行 current。

备选 `app_settings.current_latest_set_id`：多一次 join，切换要两步事务。**更推荐 is_current 部分唯一**，切换用单事务：把旧行 `false`、新行 `true`。

历史：同一 `set_code` 可多行（改名/改期），或 `UNIQUE(set_code)` 只保留每套装一行、用 logs 记变更。第一版：**UNIQUE(set_code)** 更简单；改 current 只改 `is_current`。

### 是否删掉 latest-set.json

| | A 只留 JSON | B 只留 DB | C DB 主配置 + JSON 运行时副本 |
| --- | --- | --- | --- |
| 本地 Mini | 现状，重启生效 | Free 暂停则 latest 挂 | JSON 仍能启动 |
| 小程序 | 不直连文件 | 依赖 Mini/DB | 不直连 DB |
| Admin | 改文件+重启 | 立刻写 DB | 写 DB 再导出 JSON + reload |
| 云部署 | 只读盘问题仍在 | 需热加载 | JSON 随发布物走 |
| DB 不可用 | 无影响 | **CRITICAL** | Mini 用 JSON fallback |
| 回滚 | git/拷贝 | 改 is_current | 回滚 JSON + is_current |
| 运维 | 最低 | 中 | 中（双写） |

**推荐方案 C（过渡到 B 的运行时仍用 JSON 文件作为 Mini 启动源）。**

不要「彻底删除 JSON」作为第一刀。Mini 已证明启动读文件 + 内存 catalog。Admin 以 DB 为 **运营真相**；发布步骤生成/覆盖 `latest-set.json` 并 **reload Mini**。等 reload API 与监控稳定后，再考虑 Mini 启动读 DB（且须接受 Free 暂停或上 Pro）。

---

## 7. Feedback

最小列：

| 列 | 类型 | NULL | 说明 |
| --- | --- | --- | --- |
| id | uuid | 否 | PK |
| type | text | 否 | `bug` / `suggestion`（对应问题反馈 / 功能建议） |
| content | text | 否 | 长度上限（如 2000）应用层+check |
| contact | text | 是 | 可选 |
| card_id | text | 是 | 无 FK 到 JSON catalog |
| status | text | 否 | default `new`；`new\|processing\|resolved\|closed` |
| admin_note | text | 是 | 仅 Admin |
| created_at / updated_at | timestamptz | 否 | |

索引：`(status, created_at desc)`。

- 小程序 **允许匿名**（当前无登录）。不强制微信登录。
- contact **可选**。
- 垃圾：Mini **rate limit**（IP + 可选 openId 若以后有）；内容长度；**不要**第一版验证码（微信小程序 UX 差）。
- 提交：`POST /api/mini/feedback`（公开，限流）→ 服务器 insert。**不要**把 service role 放进小程序。
- Admin：`GET/PATCH /api/admin/feedback`。

---

## 8. Admin Logs

| 列 | 类型 | NULL |
| --- | --- | --- |
| id | uuid | 否 |
| actor_user_id | uuid | 是 | 系统 Job 可空 |
| action | text | 否 | 如 `UPDATE_LATEST_SET` |
| resource_type | text | 是 | |
| resource_id | text | 是 | |
| before_data | jsonb | 是 | |
| after_data | jsonb | 是 | |
| status | text | 否 | `success` / `failure` |
| error_message | text | 是 | 不含 token |
| created_at | timestamptz | 否 | 无 updated |

**JSONB 适合** before/after（latest-set 整份很小）。

- 日志 **默认不可删**（无 DELETE API）。
- 普通 Admin **可看**。
- 保留：Free 平台 log 1 天 ≠ 本表；本表自行保留 90 天+ 即可，第一版可不做自动清理。

---

## 9. Data Versions

与 **小程序代码版本 / package.json 1.0.0** 分开。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | |
| version | text UNIQUE | 如 `hs-36.4.0.250339-20260828` |
| source | text | `hearthstone-client` / `hsjson-snapshot` |
| client_version | text | 游戏 36.4.x，不是 App |
| card_count | int | fold 后或 publish 前需标明口径 |
| voice_count / music_count / entrance_count | int | 可空，来自校验摘要 |
| artifact_path | text | 服务器上 `data/builds/<id>/` **路径或对象键**，不是把 27MB 塞进 bytea |
| build_status / validation_status | text | |
| status | text | `draft\|building\|validating\|ready\|published\|failed\|rolled_back` |
| created_at / published_at | timestamptz | published_at 可空 |
| created_by | uuid | |

**游戏数据版本 ≠ App 版本。** App 可以 1.5.8 仍跑 36.4.0.250339 数据。

---

## 10. Update Jobs

| 列 | 类型 |
| --- | --- |
| id | uuid |
| data_version_id | uuid FK 可空 |
| status | `queued\|running\|success\|failed\|cancelled` |
| step | text | `download_hsjson` / `phase08` / `phase11` / `validate` / `publish` |
| progress | int 0–100 |
| error | text |
| created_by | uuid |
| started_at / finished_at | timestamptz |
| lock_key | text | 常量 `'global-update'` UNIQUE WHERE running |

**同时只能一个 running：** 部分唯一索引 `WHERE status = 'running'`。

- **异步**：phase08 ~3.5 min + 读 Hearthstone；禁止 HTTP 内同步跑完。
- 失败：status=failed，不自动切 published；保留 builds 目录。
- 进程重启：running 且心跳超时 → 标 failed（需 `heartbeat_at` 列，第一版可手工）。**断点恢复：暂不需要**（重跑脚本幂等性未证明）。
- 回滚：切 `data_versions.status` + 换磁盘上的 active JSON，不是 rewind Job。
- 下载 HSJSON：**本仓库尚无下载脚本**（1.5.7 PROVEN）。Job 第一步目前是「人工放入 JSON」或未来新增 fetcher。

---

## 11. Static Card Data Strategy

7263 张是 **fold 后列表**，不是唯一真相。真相是 35807 卡的 `card-audio-index` + fold 规则。

| | A 全进 Postgres | B 继续 JSON | C 混合（推荐） |
| --- | --- | --- | --- |
| 性能 | 每次查库；冷启动不如 27MB 一次读入内存 | Mini 已 ~320ms 建 catalog | 动态走 DB，列表走内存 |
| 成本 | 27MB 索引可进 500MB，但无必要 | 磁盘/git | DB 只 KB–MB 运营数据 |
| fold | 必须在 DB 重写或每次拉全表 fold | **现有函数** | **保持 Node fold** |
| 回滚 / git | 差 | 好 | JSON 版本目录 + DB 指针 |
| 小程序 API | 大改 | 不变 | Mini 仍读 JSON |
| 一键更新 | 行级 upsert 复杂 | 换文件+reload | Job 写新目录再切 |
| 音频关联 | 难 | index 已有 | 保持 |

**明确推荐 C。** 不要因为有数据库就把 Catalog 数据库化。

---

## 12. Audio Storage Strategy

当前：游戏文件 → Extractor → `tmp/*.wav`（本机约 441+199+187 个，~0.75GB）。

| 做法 | 判定 |
| --- | --- |
| WAV → Supabase Storage | **不适合第一版 / 不适合 Free 1GB**；egress 5GB 也经不起热门卡播放 |
| 音频 metadata → Postgres | **不适合替代** 12–42MB 的 audio/voice index |
| 索引继续 JSON | **适合** |
| 未来云 Mini 无本机 Hearthstone | Extractor **无法运行**。必须：**预提取对象存储（S3/R2/OSS）** 或 **保留一台带游戏目录的 worker** |

**未来正式云：** Mini API 只读对象存储 URL（或反代）；构建机单独、有磁盘与（可选）游戏客户端。不要假设 Vercel `/tmp` 能当音频库。

---

## 13. Mini Server Strategy

| 方案 | 判定 |
| --- | --- |
| A 继续 `http.createServer` | **第一阶段适合**；已有 send/CORS；加 POST + 少量 middleware |
| B 立刻 Express/Fastify | **不必须**；无证据当前路由爆炸 |
| C 分层 API → services → Supabase | **逐步**：新 Admin/feedback 走 service 模块，不重写 catalog/audio |

微信 **正式版要求 HTTPS**。当前为局域网 HTTP，不是云架构。长任务、Extractor、写盘 → **常驻 Node + 磁盘**，不是 Serverless 主路径。

Rate limit / Auth：只加在新的 POST 与 `/api/admin/*`。

---

## 14. Deployment Strategy

| | VPS + Nginx + Node + 托管 Supabase | Vercel Functions + Supabase |
| --- | --- | --- |
| 持久盘 | 有 | 无（EROFS，本仓库未部署，平台常识） |
| 长任务 | systemd/worker | 超时，phase08 失败 |
| Extractor | 可装游戏或只读 bundle | 无 |
| WAV | 本地或挂对象存储 | `/tmp` 易丢 |
| 小程序 HTTPS | Nginx 证书 | 有，但 API 能力不够 |
| 成本 | VPS 数十元级 + 可选 Supabase Free/Pro | 函数便宜但 **架构不匹配** |

**推荐正式部署：一台 VPS（或任意能跑 Node 的长驻机）+ Nginx HTTPS + 本仓库 Mini + Supabase 托管库。**

Vercel：**不作为 Mini+音频+构建主机。** 最多将来放静态 Admin 前端，API 仍回 VPS。

Kubernetes / Redis / Kafka / ES / GraphQL：**NOT NEEDED**。

---

## 15. Admin API

全部 **必须鉴权**（JWT + admin_users），除将来明确的健康检查。

| 路径 | 方法 | 鉴权 |
| --- | --- | --- |
| `/api/admin/auth/session` | GET | JWT |
| `/api/admin/dashboard` | GET | 是 |
| `/api/admin/settings` | GET/PATCH | 是 |
| `/api/admin/latest-set` | GET/PATCH | 是 |
| `/api/admin/feedback` | GET/PATCH | 是 |
| `/api/admin/logs` | GET | 是 |
| `/api/admin/data-versions` | GET | 是 |
| `/api/admin/update/check` | POST | 是 |
| `/api/admin/update/start` | POST | 是 |

公开 Mini：`POST /api/mini/feedback` 限流；**无** Admin 删除。

错误：延续 `{ error, code }`。Admin 用稳定 code：`UNAUTHORIZED` `FORBIDDEN` `LATEST_SET_CONFIG_INVALID`。

与 Mini **同一 Node 进程、路由前缀分离**（1.5.7 仍成立）。Auth middleware 只包 `/api/admin`。

---

## 16. Security

| 风险 | 措施 |
| --- | --- |
| service_role 泄漏 | 仅服务器 env；永不进小程序 / git / public / Admin SPA bundle |
| anon key | 可进小程序仅当 RLS 极严；仍优先 Mini 代理反馈 |
| JWT | 短时 access token；Admin 用 HTTPS |
| CORS | Admin 收紧 Origin；Mini 现状 `*` 仅开发 LAN |
| CSRF | Admin 用 Authorization Header，不用 cookie 当唯一凭证 |
| Rate limit | feedback POST |
| 暴力破解 | Supabase Auth 自带；再加登录限流 |
| 垃圾反馈 | 长度 + IP 限流 |
| SQL 注入 | 参数化 SDK，禁拼接 |
| RLS | 全表开启；anon 默认拒绝 |
| 日志 | 无 token、无完整 WAV 路径隐私 |

**Secret 流向：**

```text
Supabase Dashboard
  → 服务器环境变量（不进 git）
      → Node Admin/Mini 服务端 SDK
小程序 → 仅 Mini HTTPS API
Admin 浏览器 → 用户 JWT，不是 service_role
```

---

## 17. Migration Strategy

```text
1. Mini 继续只读 latest-set.json（零中断）
2. 建 latest_sets，从 JSON seed 一行 is_current=true
3. Admin 改 DB，发布时写回 JSON + 重启/reload Mini
4. 对照：DB current vs 文件 vs /api/mini/latest
5. 长期可选：Mini 启动读 DB，文件作 fallback
6. 不要在「reload 未做」时删 JSON
```

数据库不可用：Mini 仍用 JSON 启动。Admin 显示降级。

本地：无 Supabase 时 `SKIP_SUPABASE=1` 仅 JSON（实施阶段再定，本阶段不改代码）。

---

## 18. Future One-click Update Architecture

```text
Admin
  → POST update/check     人工看 diff（HSJSON/build 号）
  → 确认
  → POST update/start     异步 Job（单飞）
  → [可选] 下载 HSJSON    当前仓库无脚本，外部依赖 api.hearthstonejson.com
  → phase08 需 C:\Hearthstone 只读
  → phase11 写新 builds/<id>/
  → validate:index / validate:audio
  → data_versions = ready
  → 人工「发布」
  → 切 active 文件 + latest_sets + reload Mini
  → admin_logs
```

| 步骤 | 自动？ | 依赖 | 失败 | 回滚 |
| --- | --- | --- | --- | --- |
| 检查是否有新 build | 半自动 | HSJSON/客户端 | 中止 | 无 |
| 下载 HSJSON | 可自动 | 网络 | 重试 | 无 |
| phase08 | 自动但慢 | 游戏安装 | 保留旧 index | 不切 active |
| phase11 / fold | 自动 | JSON | 同上 | 同上 |
| 校验 | 必须自动闸门 | 现有 validate | 不发布 | |
| 发布 | **必须人工** 第一年 | reload | 切 previous 目录 | **要** |

不要第一版「一键到生产无确认」。

---

## 19. Admin MVP

**进入第一版：** Dashboard（只读计数）、查看/切换 latest_sets（经发布流水写 JSON）、Feedback 列表与状态、Logs 只读、Settings 占位。

**不要进入第一版：** 一键全量更新、全量抽音频、删库、改 fold 规则。

`检查更新`：可做 **只读对比**（本地 HSJSON clientVersion vs 记录），不触发 Job。

---

## 20. Cost

```text
价格时间点: 2026-08-29
来源: https://supabase.com/pricing （官方页抓取）
```

**Free（$0/月）**

- 50k MAU、无限 API 请求
- DB 500MB；File Storage **1GB**；egress 5GB + cached 5GB
- **1 周不活跃暂停**；最多 2 个 active 项目
- 备份：无（对比表 Automatic backups = Not included）
- Edge invocations 50 万
- Auth 对 1–3 个 Admin **远低于** 50k MAU

**本项目是否需要付费？**

- **仅动态表（设置/反馈/日志/Job 行）：Free 容量足够。**
- **若 Mini 24/7 每请求读 DB：** Free **暂停** 不可接受 → 需 **Pro from $25/月**（Never pause）或 Mini **不依赖 DB 运行时**（方案 C）。
- **WAV 进 Storage：** 本机缓存已 ~0.75GB，Free 1GB **会顶满**；播放 egress 易超 5GB → **不要用 Free Storage 当音频 CDN**。
- Pro 另含 7 天备份、100GB 文件（音频仍更适合 R2/S3 计费模型，需单独评估，**NOT CONFIRMED** 本项目用量）。

**可能超出 Free 的点：** 把 27MB×多版本索引当 bytea；Storage 放 WAV；Mini 直连 DB 却长期无 Admin 流量导致暂停。

---

## 21. Architecture Decision

```text
ARCHITECTURE DECISION

Database:
  Supabase PostgreSQL — 仅动态运营数据
  不把 Catalog / HSJSON / audio-index 作为行存储

Auth:
  Supabase Auth + admin_users 白名单
  无自建密码列

Dynamic Data:
  latest_sets, feedback, admin_logs, data_versions, update_jobs, app_settings

Static Game Data:
  继续 data/index JSON + Node foldSharedReprints
  版本化目录 data/builds/（未来）

Audio:
  索引 JSON；WAV 本机 tmp 或未来对象存储
  不把 WAV 作为 Supabase Storage MVP
  云上 Extractor 仅限有游戏目录的 worker

Admin:
  浏览器静态页 + 同进程 /api/admin（鉴权）
  不是微信 Tab

Mini API:
  现有 Node http 逐步加 POST/feedback/admin
  不因本阶段改 Express
  运行时 catalog/latest 仍以 JSON+内存为主

Update:
  异步 Job，单飞锁，人工发布
  不在 Serverless 同步跑 phase08

Versioning:
  data_versions（游戏数据）与 App/小程序版本分离

NOT NEEDED:
  Kubernetes, Redis, Kafka, RabbitMQ, Elasticsearch,
  GraphQL, 多数据库, CQRS, Event Sourcing, 微服务
```

---

## 22. Answers Q1–Q12

**Q1. 现在是否应该正式引入 Supabase？**  
ANSWER: **应该作为架构方向引入；不要在未做 JSON fallback 前让 Mini 运行时绑定 DB。**  
CONFIDENCE: **HIGH**  
REASON: 反馈/Admin/Job 需要真正的库；Catalog 已证明文件+内存足够。Free 暂停与音频体积反对「一切进 Supabase」。

**Q2. 是否作为长期数据库？**  
ANSWER: **是，仅动态数据。**  
CONFIDENCE: **HIGH**  
REASON: Postgres + Auth + migrations 适合一人维护；没有第二套库的证据。

**Q3. 哪些进数据库？**  
ANSWER: **admin_users、latest_sets、feedback、admin_logs、data_versions、update_jobs、app_settings。**  
CONFIDENCE: **HIGH**

**Q4. 哪些继续 JSON？**  
ANSWER: **HSJSON、card-*-index、music-assets、fold 输入、latest-set.json 作为 Mini 启动副本。**  
CONFIDENCE: **HIGH**

**Q5. latest-set.json 是否迁移？**  
ANSWER: **双写：DB 运营源，JSON Mini 源；不先删除文件。**  
CONFIDENCE: **HIGH**

**Q6. Admin 是否用 Supabase Auth？**  
ANSWER: **是，加 admin_users。**  
CONFIDENCE: **HIGH**

**Q7. Mini API 是否连接 Supabase？**  
ANSWER: **服务器可选连接（反馈写入、Admin）；小程序不拿 service role。列表/latest 默认仍不读库。**  
CONFIDENCE: **HIGH**

**Q8. Mini Server 是否需要重构？**  
ANSWER: **不需要推倒；增量加路由与 service 层。**  
CONFIDENCE: **HIGH**

**Q9. 音频文件未来放哪里？**  
ANSWER: **短期 tmp；正式云用对象存储 + 构建机，不用 Free Storage 当主站。**  
CONFIDENCE: **MEDIUM**（对象存储厂商未选定）

**Q10. Update Job 怎么实现？**  
ANSWER: **VPS 上异步进程/队列表 update_jobs，禁止 Serverless 同步 phase08。**  
CONFIDENCE: **HIGH**

**Q11. 正式部署？**  
ANSWER: **长驻 VPS + Nginx HTTPS + Node Mini + 托管 Supabase。**  
CONFIDENCE: **HIGH**（云厂商未锁）

**Q12. Phase 1.5.9 实施什么？**  
ANSWER: **见 §23：只做只读/地基，不建真实云项目强制连接、不迁走 JSON 主路径。**  
CONFIDENCE: **HIGH**

---

## 23. Recommended Phase 1.5.9

建议 1.5.9 **仍是小步实施或更细的落地设计+脚手架**，不要「一键接上生产 Supabase 并删 JSON」。

合理范围：

1. 把本报告 schema 写成 **未执行的** SQL 草稿（仍可不连云，或仅本地说明）。
2. 若实施代码：`/api/admin/dashboard` 只读 + token/Auth 二选一的最小闸门；**latest 仍读 JSON**。
3. 禁止：建真实表后立刻让 `/api/mini/latest` 改打 Postgres；禁止 Storage 上传 WAV；禁止 phase08 Job。

若 1.5.9 被定义为「创建云项目」：必须人工在 Dashboard 操作，Secret 不进 git，Mini 保持可离线 JSON。

```text
READY FOR PHASE 1.5.9
```

无架构缺口阻塞「开始做 Admin 地基」。有约束：**运行时游戏数据不得先绑死 Supabase Free。**

---

## 24. Files Changed

```text
Only:
data/card-verification/phase-1.5.8-report.md
```

无意外修改生产代码（本阶段未改 `src/`、`miniprogram/`、`test/`、`package.json`）。

---

## 25. Final Status

```text
Phase 1.5.8 STOPPED — INVESTIGATION ONLY

READY FOR PHASE 1.5.9
```

未自动创建 Supabase、未建表、未安装依赖、未创建 Admin、未改代码。
