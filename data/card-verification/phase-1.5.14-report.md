# Phase 1.5.14 Report

Status:
INVESTIGATION COMPLETE

Production code changes: 0
Test code changes: 0
Data changes: 0
Database changes: 0
UI changes: 0

本阶段只调查，未实现下载器 / updater / Job / Admin「数据更新」页。未覆盖 `data/hearthstonejson`、`data/index`、音频、`latest_sets`、`.env`。未进入 Phase 1.5.15。

调查证据来自当前仓库源码、本地文件只读统计，以及对公开 HSJSON HTTP 端点的 **HEAD**（未把远程 JSON 写入仓库）。

---

## 1. Current Architecture

### 1.1 分层（以代码为准，不以文件名猜测）

| 层 | 实际位置 | 谁读 | 谁写 |
| --- | --- | --- | --- |
| 原始卡牌 JSON（HSJSON 快照） | `data/hearthstonejson/zhCN/cards.json`、`cards.collectible.json` | `phase08-build.mjs`、`phase11-build.mjs`；测试只读 | **无下载脚本**；人为放入 |
| 中间语音/音频索引 | `data/index/card-voice-index.json`、`audio-index.json`、`data/index/cache/*` | phase11、Mini `UnifiedAudioRepo` | `npm run index:voice` → phase08 |
| 统一卡牌+音频索引 | `data/index/card-audio-index.json`、`music-index.json`、`music-assets.json` | Mini 启动 `buildCatalog` | `npm run index:audio` → phase11 |
| Catalog（运行时） | Mini 进程内存 `catalog.cards` / `catalog.byId` | Mini API、Admin card_count | **无磁盘文件**；启动时 `buildCatalog` |
| 动态运营 | Supabase `latest_sets`、`admin_users`、`feedback`、`admin_logs`、`app_settings` | Mini `loadLatestRuntime`、Admin API | Admin latest-sets / Auth |
| latest fallback JSON | `data/index/latest-set.json` | Mini 仅 DB 失败时 | 人工；Admin **禁止写** |
| 音频缓存 | `tmp/audio`、`tmp/music`、`tmp/preview` | 播放 API | 按需 Extractor |
| 游戏本机 | `C:\Hearthstone`（只读） | phase08、phase11 `scanCardDefs`、Extractor | **禁止修改** |

Mini **启动不读 HSJSON**。读的是 `card-audio-index.json` + `audio-index.json` + `music-assets.json`（`src/miniprogram/miniServer.js`）。

### 1.2 当前 HSJSON 快照规模（只读 stat + parse）

目录仅 2 个文件：

| 文件 | 大小 | 数组长度 | mtime（本地） |
| --- | --- | --- | --- |
| `data/hearthstonejson/zhCN/cards.json` | 10 038 512 B（9.57 MB） | **35807** | 2026-08-28 |
| `data/hearthstonejson/zhCN/cards.collectible.json` | 3 401 974 B（3.24 MB） | **8154** | 2026-08-28 |

- collectible 中不同 `set`：**48**
- `ESCAPEFROM_VIOLET_HOLD` collectible：**164**
- `cards.json` 样例字段：`cardClass,dbfId,health,heroPowerDbfId,id,name,set,type`（其余字段按 HSJSON 规则在 0/空时省略）

无 `cardbacks.json`、无 `enums.json` 本地副本、无 mercenaries 本地副本。

### 1.3 当前 index 规模

| 文件 | 大小 | 证据 |
| --- | --- | --- |
| `card-voice-index.json` | 42.37 MB | 35807 cards；`source.productVersion` = `36.4.0.250339` |
| `audio-index.json` | 11.98 MB | phase08 clip→bundle 元数据 |
| `card-audio-index.json` | 26.89 MB | schema `1.0`，locale `zhCN`，35807 keys，clientVersion `36.4.0.250339` |
| `music-index.json` / `music-assets.json` | 3.64 / 0.33 MB | phase11 输出 |
| `manifest.json` | 375 B | phase08：`cardCount` 35807，`totalMs` **211012**（约 211 s），`audioIndexReused: true` |
| `latest-set.json` | 331 B | fallback，非 Catalog |

Cache：`data/index/cache/carddef-sounds.json`、`guid-voice-index.json`、`phase-0.8-stats.json`。

### 1.4 生成入口（package.json）

| npm script | 入口 | 产物 |
| --- | --- | --- |
| `index:voice` | `scripts/run-phase08.cjs` → `phase08-build.mjs` | voice + audio-index + cache + manifest |
| `index:audio` | `scripts/run-phase11.cjs` → `phase11-build.mjs` → `validateCardAudioIndex.js` | card-audio-index + music-* |
| `validate:index` | `src/validation/validateCardVoiceIndex.js` | 校验 voice index |
| `validate:audio` | `src/validation/validateCardAudioIndex.js` | 校验 audio index |
| `mini` | `scripts/run-mini.cjs` | 启动 Mini，**不重建 index** |
| 其它 | explorer / diagnose / discover bundles | 诊断，不是 Catalog 生产流水线 |

**仓库内不存在** HSJSON downloader / importer / updater 模块。`src/` 与 `scripts/` 中唯一稳定的 HSJSON HTTP 用法是卡图 CDN：

`https://art.hearthstonejson.com/v1/render/latest/zhCN/256x`（`catalogAdapter.js`、`CardVoiceRepository.js`、`miniprogram/utils/config.js`）。

### 1.5 Catalog 核心（`src/miniprogram/catalogAdapter.js`）

- `shouldPublish(raw)`：`collectible === true` **或** `VERIFY_IDS` 中的 8 个固定 id
- `adaptCard`：从 unified 卡对象生成展示卡（名称/职业/稀有度/`set`/语音音乐标记/卡图 URL）
- `foldSharedReprints`：按 play `sourceCardId` 折叠 reprint；输出顺序为分组 key **字母序**
- `buildCatalog(unified)`：过滤 → adapt → fold → `{ cards, byId, foldStats, clientVersion }`

Mini 日志曾打印 `reprint fold before=8154 after=7263 folded=891`：8154 为 collectible（+VERIFY 影响很小），7263 为 fold 后 **publishable Catalog**。

### 1.6 Latest / Admin / Mini 启动（Phase 1.5.13 现状）

- DB：`latest_sets.is_current=true` → `loadLatestRuntime` → 内存 runtime
- 失败：仅 `DB_ERROR` / 无 client 才 fallback `latest-set.json`
- `DB_NO_CURRENT`：**不用** JSON 覆盖
- Publish RPC：`supabase/migrations/002_latest_set_publish.sql` 中 `publish_latest_set(uuid)`（远程是否已 apply 不在本阶段修改）
- Admin API：`/api/admin/health`、`/status`、`/latest-sets*`（全部 adminAuth）
- Admin 静态：`admin/` 登录、Dashboard、`/admin/latest`；**无「数据更新」页**
- Mini 公开：`/api/mini/*`、按需 `/api/audio/*`
- Catalog **不会**在 publish latest 时重建；只换 latest 过滤条件

### 1.7 依赖（package.json）

运行时：`@arkntools/unity-js`、`@supabase/supabase-js`、`dotenv`、`esbuild`。无 `hearthstonejson-client`、无 HTTP 下载库。

---

## 2. HSJSON Source Investigation

公开文档：[hearthstonejson.com](https://hearthstonejson.com/)、[docs/cards.html](https://hearthstonejson.com/docs/cards.html)、[docs/images.html](https://hearthstonejson.com/docs/images.html)。数据由游戏文件自动转换，并指向 hs-data 仓库（XML/DBF，不是本项目用的 JSON 数组）。

### SOURCE — HearthstoneJSON API（推荐生产卡牌 JSON 源）

| 项 | 调查结果 |
| --- | --- |
| SOURCE | HearthSim HearthstoneJSON（非暴雪官方 Game Data API） |
| URL | 文档：`https://api.hearthstonejson.com/v1/`；locale 文件：`/v1/latest/{locale}/…` 与 `/v1/{build}/{locale}/…` |
| FORMAT | UTF-8 JSON 数组（cards）或对象（enums） |
| LANGUAGE | 本项目需要 **zhCN**；enUS 可选（英文名交叉） |
| UPDATE FREQUENCY | 随游戏 build；`/v1/latest/` 文档写 **302 到最新 build**。本次 HEAD：`/v1/latest/zhCN/cards.json` 直接 **200**（Cloudflare/S3），`Content-Length`/`ETag` 与 `/v1/250339/zhCN/cards.json` **相同** |
| STABILITY | HTTPS、按 build 归档、ETag + Last-Modified；`Cache-Control: public, max-age=60`（latest） |
| LICENSE / USAGE NOTES | 站点未给出 OSI 许可证文本；内容来自客户端提取。卡牌数据与美术仍属暴雪。本项目仅作粉丝工具数据源，**不要**把 dumps 当成可再授权开源数据。GitHub `HearthSim/hsdata` 本次未取到 LICENSE 文件（404） |
| RECOMMENDATION | **生产更新源：pin `api.hearthstonejson.com`。** 下载 `zhCN/cards.json` + `zhCN/cards.collectible.json`。用 ETag/Last-Modified/Content-Length 做「检查更新」。需要可复现时同时记录 build（当前与本机 index 一致为 **250339**）。不要用 Blizzard OAuth API 替换（本仓库未接入，且不是当前 index 输入格式）。不要用 hs-data XML 作为 Mini 输入 |

### 本项目实际需要的远程文件

| 文件 | 需要？ | 证据 |
| --- | --- | --- |
| `cards.json` zhCN | **必须** | phase08 `CARDS_PATH`；phase11 `loadMeta()` |
| `cards.collectible.json` zhCN | **必须** | phase11 补 `cardClass/rarity/text/flavor/collectible/name/cost` |
| `enums.json` | 检查更新 / 发现 Set **有用**，构建 **不读** | `CardSet` 81 项，含 `ESCAPEFROM_VIOLET_HOLD=1988`；**无日期字段** |
| `mercenaries.json` | 否 | HEAD 200（~254 KB），无代码引用 |
| `cardbacks.json` | 否 | 文档 changelog：cardback API 已不支持；`…/zhCN/cardbacks.json` HEAD **404** |
| 卡图 render | 运行时 URL，不入库 | `art.hearthstonejson.com/v1/render/latest/zhCN/256x/{id}.png` HEAD 200 |

### HTTP 可下载性（本次 HEAD，未保存 body）

| URL | 状态 | 备注 |
| --- | --- | --- |
| `https://api.hearthstonejson.com/v1/latest/zhCN/cards.json` | 200 | Length **10038512** = 本地 `cards.json` |
| `https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json` | 200 | Length **3401974** = 本地 collectible；ETag `"466cbc24…"`；Last-Modified `Wed, 26 Aug 2026 07:01:02 GMT` |
| `https://api.hearthstonejson.com/v1/250339/zhCN/cards.json` | 200 | 与 latest 同 ETag `"a4277be4…-2"` |
| `https://api.hearthstonejson.com/v1/enums.json` | 200 | `Cache-Control: no-store`；Last-Modified 同日 |

结论：当前检入快照与远程 latest/**250339** 体积一致，可视为同一代数据。仓库里 **现在不能自动下载**（没有 fetcher）。

### 其它来源

| 来源 | 适合生产？ |
| --- | --- |
| `art.hearthstonejson.com` | 卡图；不是 cards.json |
| GitHub `HearthSim/hs-data` | CardXML/DBF；本流水线不吃 |
| npm `hearthstonejson-client` | 可封装 GET latest；**未安装** |
| Blizzard develop.battle.net | 另一套 OAuth API，不是 phase08 输入 |

---

## 3. phase08 Pipeline

**入口：** `npm run index:voice` → `scripts/run-phase08.cjs`（esbuild `phase08-build.mjs` → `tmp/phase08-build.cjs`）。

**输入：**

- `data/hearthstonejson/zhCN/cards.json`（**不用** collectible 文件）
- `C:\Hearthstone`：`.product.db` / `boot.config` / `Hearthstone.exe` 读 build；`Data\Win\*.unity3d` 扫 CardDef / GUID / zhCN audio clip 名
- 可选先验：`data/voice-verification/audio-index.json`（存在则 `audioIndexReused`）

**输出（原地覆盖）：**

- `data/index/card-voice-index.json`
- `data/index/audio-index.json`
- `data/index/manifest.json`
- `data/index/cache/carddef-sounds.json`、`guid-voice-index.json`
- `data/voice-verification/phase-0.8-report.md` 等

**联网：** 否（不 fetch HSJSON）。

**读 C:\Hearthstone：** **是**（硬编码 `HS_ROOT = 'C:\\Hearthstone'`）。无游戏客户端则失败。

**执行时间：** 上次成功 `manifest.timings.totalMs = 211012`（~3.5 min）。GUID ~74 s，audio clip 扫描 ~132 s，CardDef ~3 s。

**内存：** 未实测；需同时容纳 3.5 万卡映射 + Unity 解析。按 JSON 体积，建议按 **数百 MB RSS** 规划，不要当 Serverless 同步请求。

**可重复 / 幂等：** 可重复跑。`generatedAt` 会变。audio-index 可能「复用+全量 zhcn clip 名扫描」。**不是**字节级幂等。

**半成品：** `main()` **按序 writeFileSync**。中途崩溃可能留下新 cache + 旧 `card-voice-index`。当前实现 **不是** staging 提交。

**能否当 Job：** 逻辑上可以，但必须：本机有 Hearthstone、长超时、staging 目录、失败不切 active。现成脚本 **直接写生产 `data/index`**，不安全。

**云服务器：** **不能**假设存在 `C:\Hearthstone`。把整个 `Data\Win` 拷到云上既巨大又触及游戏文件分发边界，**不推荐**。

**新扩展后：** **必须再跑**（见 §5：phase11 只遍历 `voiceIndex.cards` 的 key）。

---

## 4. phase11 Pipeline

**入口：** `npm run index:audio` → `scripts/run-phase11.cjs` → `phase11-build.mjs` → 随后 `validateCardAudioIndex.js`。

**输入：**

- HSJSON：`cards.json` **和** `cards.collectible.json`
- `data/index/card-voice-index.json`、`audio-index.json`、`cache/guid-voice-index.json`
- **再次** `scanCardDefs()` → `C:\Hearthstone\Data\Win\carddef_*.unity3d`（`src/music/cardDefMusicScan.mjs`）
- 可选：`data/music-verification/phase-1.0.1-results.json` 交叉校验

**输出（原地覆盖）：**

- `data/index/card-audio-index.json`（Mini 主输入）
- `music-index.json`、`music-assets.json`
- `card-audio-index-report.md`
- 可能删除/写入 `card-audio-index-diff.json`

**明确不覆盖：** `card-voice-index.json`、`audio-index.json`。不批量导 WAV。

**联网：** 否。

**读 C:\Hearthstone：** **是**（CardDef music 扫描）。注释「no audio-bundle scan」只表示不扫 audio FSB 包，**不是**零游戏依赖。

**执行时间：** 报告 `totalMs: 4216`（~4 s）+ 写出 27 MB JSON。远快于 phase08。

**关键循环（决定「只更新 HSJSON 够不够」）：**

```text
for (const cardId of Object.keys(voiceIndex.cards)) { … unifiedCards[cardId] = … }
```

新卡若只存在于 HSJSON、不在 `card-voice-index.cards`，**不会进入** `card-audio-index`，Mini Catalog **看不到**。

**半成品：** 先写 `music-assets.json` / `music-index.json` 再写 `card-audio-index.json`。崩溃窗口内 Mini 若重启可能 music 与 unified 不一致。

**Job：** 可作为「在已有 voice index + 本机 CardDef 上刷新元数据」的第二步；仍需 staging。不能替代 phase08。

---

## 5. Catalog Pipeline

```text
HSJSON (构建期)
  → phase08 card-voice-index + audio-index
  → phase11 card-audio-index.json
  → Mini 启动 loadJson
  → buildCatalog
       shouldPublish → adaptCard → foldSharedReprints
  → catalog.cards（内存）
  → GET /api/mini/catalog|search|latest|card
```

**若只更新 HSJSON、不跑 build：** Mini **完全无变化**（不读该目录）。

**必须重建的磁盘产物（新卡/新语音/新 CardDef）：**

1. `card-voice-index.json`、`audio-index.json`、cache（phase08）
2. `card-audio-index.json`、`music-*`（phase11）

**通常不必重建：** `latest-set.json`（运营独立）、WAV cache、`audio-index` 仅当 clip 目录未变且策略允许复用时仍建议随 phase08 刷新。

**Catalog 是否启动时重算：** **是**（`miniServer.js` `buildCatalog(unified)`）。

**fold 是否启动时重算：** **是**（在 `buildCatalog` 内）。

**latest count：** **实时** `filterLatestCards(catalog.cards, set)` / `latestCardsPage`；**不**存在静态 count 表。Admin `card_count` 同样扫内存 Catalog。

**构建产物 vs 运行时：**

- 构建产物：HSJSON 快照、phase08/11 JSON、验证报告
- 运行时：Catalog 内存、latest runtime、WAV cache、Supabase 运营行

**热更新缺口：** 1.5.13 能热更新 **latest set 配置**；**不能**热替换 `catalog` / `unified`。换 index 后需 **重启 Mini**（除非 1.5.15 做 pointer + reload）。

---

## 6. Audio Pipeline

新卡出现后（在 **游戏客户端已更新** 且 phase08/11 已重建 index 的前提下）：

| 能力 | 是否自动有文件 | 来源 |
| --- | --- | --- |
| voice 可播标记 | index 里有 `voiceKey` 才算 indexed | `card-audio-index` ← phase08 映射 |
| music 可播标记 | `music.status` available/shared | phase11 + CardDef + guid + audio-index |
| entrance 逻辑 | play+music 同时可预览 | phase11 写入 `entrancePreview`；WAV 仍按需合成 |
| clip→bundle | `audio-index.clips` | phase08 |
| 真正 WAV | **否** | `HearthstoneAudioExtractor` 读 `C:\Hearthstone\Data\Win`，写入 `tmp/audio` 等 |

`tmp` WAV **不是**持久主数据；可删后按需再提取。新 Set **额外音频 Job**：需要新 Unity audio/carddef bundle（即本机游戏更新）+ phase08 重扫。没有 bundle 时 index 会 `unresolved` / `NOT_INDEXED`，播放 404。

### 「更新卡牌数据」vs「更新音频数据」

**推荐 B：两个独立 Job**，外加一个可选的「全量编排」。

原因（代码约束，不是口味）：

1. HSJSON 与 Unity bundle **不同步**（JSON 可先于或后于客户端）。
2. phase08 ~3.5 min 且绑 `C:\Hearthstone`；HSJSON 下载只需秒级 HTTP。
3. Mini Catalog 新卡 **依赖 voice index**，不是只依赖 HSJSON。
4. WAV 是按需缓存，不应塞进卡牌 JSON Job。
5. 失败域不同：下载失败不应毁掉 voice index；扫包失败不应回滚已验证的 HSJSON staging。

编排建议：Job A「HSJSON staging + 差异报告」；Job B「本机 phase08+phase11 staging」；成功后再 **一次** 切换 active index。Latest Set publish **永远**是第三个独立动作。

---

## 7. New Set Detection

当前 `latest_sets` 已能 Admin 管理。**发现**与 **发布为 Latest** 必须分开（1.5.13 已强制 create ≠ publish）。

HSJSON **能**提供：`set` 字符串、中文 `name`（卡级，不是套装官方译名）、collectible 张数。  
HSJSON **不能**提供：套装发行日、`is_current`、官方中英套装名（需卡面聚合或人工）。

`enums.json` `CardSet` 能确认枚举存在（如 1988），**无日期、无中文名**。

### 推荐检测（未来，本阶段不实现）

1. 对比 **新旧** `cards.collectible.json` 的 `set` 集合与每 set count。
2. 用 `enums.json` 确认新 code 在 `CardSet` 内。
3. 套装展示名：zhCN 众数卡名不可靠；**Admin 填写**或对照暴雪扩展页（与 1.5.3/1.5.13 一致）。
4. 输出 **候选列表**（draft），写入 Job details 或未来 `latest_sets` 且 `is_current=false`。
5. **禁止**自动 `publish_latest_set`。Catalog 无该 set 卡时 1.5.13 已 409。

不要用 `/v1/latest/` 当「最新扩展包」（那是 **游戏 build**）。

---

## 8. Data Validation

未来「更新」**禁止**直接覆盖正在被 Mini 打开的 `data/index`。建议校验阶梯（只设计）：

1. HTTP 200 + Content-Length > 0 + 与 HEAD 一致  
2. JSON.parse 成功且根为数组  
3. `cards.json.length` 不低于当前的合理下限（现 35807；允许缓慢增长，**禁止骤降**如 <90%）  
4. collectible 数量合理（现 8154；同样防骤降）  
5. 必要字段：`id`、`name`、`set`、`type`；collectible 子集 `collectible===true`  
6. 新旧 id：允许新增；对 **消失的 collectible id** 报 warning（可能 rotate/重印），不默默当成成功  
7. 新 set code 非空、出现在 enums `CardSet` 或明确标「未知枚举」  
8. 若声明目标 latest set：collectible count > 0，且与 fold 后 Catalog 过滤 count 对照  
9. staging 上 `buildCatalog` 成功；`foldStats.after` 相对旧 7263 的变化有阈值+人工确认  
10. staging 文件存在、体积与卡数同量级（unified ~27 MB 量级）  
11. 新 set 至少 1 张进入 **folded** `catalog.cards` 才允许「数据版本发布」（仍不等于 latest publish）  
12. `npm test` 中与数量绑死的用例（如 latest 164）在切换前必须评估，避免绿测掩盖错数据  

失败：丢弃 staging，active 不动。

---

## 9. Atomic Update Strategy

当前 phase08/11 = **方案 A 直接覆盖 `data/`**。失败可导致半套 JSON + Mini 仍指向残缺文件。

### 方案 A — 直接覆盖 `data/`

- 实现成本最低（已是现状）  
- Windows 本地 Mini：覆盖后须重启才能加载新 Catalog  
- **不可接受**作为 Admin 一键更新

### 方案 B — versioned directories + active pointer（推荐）

```text
data/releases/<releaseId>/
  hearthstonejson/zhCN/…
  index/card-audio-index.json …
data/active-release.json   { "id": "…", "clientVersion": "36.4.0.250339" }
```

流程：下载+构建全部写到 **新目录** → 校验 → 更新 pointer **一次** → Mini 加载新树（1.5.15 需改启动路径；过渡期可重启 Mini）。旧目录保留以便回滚。

Windows：先写完再 `rename` pointer；避免「删旧再写新」。Node `http.createServer` 无内置双缓冲 Catalog，需要显式 `buildCatalog` 后再切换引用，或重启进程。

Supabase：只存 release 元数据 / Job 状态，**不**存 3.5 万卡。

云：可构建 **纯 JSON staging**（无 Unity）；**不能**在无客户端时完成 phase08。

**推荐 B。** 在改 Mini 热加载之前，最小安全集是：staging 目录 + 校验通过后复制/切换 + 重启 Mini。

一致性：数据版本切换成功、runtime Catalog 仍旧 → API 应报失败（与 1.5.13 latest runtime 策略同类：不谎报 success）。

---

## 10. update_jobs Investigation

**001_initial_admin_data.sql 实际表：**

`admin_users`、`latest_sets`、`app_settings`、`feedback`、`admin_logs`

**不存在：** `update_jobs`、`data_versions`。  
Phase 1.5.8 报告里的 Job 表是 **建议，从未落地**。

未来若做异步更新，**需要新 migration**（不要改 001）。建议字段（设计，不建表）：

- `id` uuid  
- `status`：`pending | running | success | failed | cancelled`  
- `step`：`check | download_hsjson | validate_json | phase08 | phase11 | catalog_validate | switch_release`  
- `progress` int 或 jsonb  
- `error_message` text（无 SQL/密钥）  
- `created_by` → `admin_users`  
- `started_at` / `finished_at`  
- `details` jsonb（etag、build、set diff，无 token）

可用 `app_settings` 暂存 `active_release`，但长任务仍需要 Job 行 + Admin 轮询。

---

## 11. Admin UX Design（不实现）

未来页「数据更新」建议只读展示：

- 数据版本 / clientVersion（来自 `card-audio-index` / pointer）  
- index `generatedAt`  
- 当前 latest set（运营，来自 `latest_sets`）  
- Catalog 张数、当前 latest 张数（内存/API）

按钮：`检查更新`（HEAD/ETag + set diff，只读）→ 发现差异后 `开始更新`（创建 Job）。

进度：下载 → 校验 JSON →（可选）等待本机 phase08/11 → Catalog 校验 → 准备切换 → 完成。

失败：停在具体 step + 中文原因；**旧 index 继续服务**。

**不要**在该页自动「设为当前扩展包」。发现新 Set 只提示去「最新卡牌」人工发布。

---

## 12. Cloud vs Local Boundary

| 位置 | 能做 | 不能做 |
| --- | --- | --- |
| Supabase | 运营、Admin 身份、Job 状态、logs、latest_sets | 存 Catalog；跑 Unity；读 `C:\Hearthstone` |
| 云 VM | 下载 HSJSON、JSON 校验、diff Set、托管静态 index（若有人上传构建结果） | 默认无游戏安装则 **不能** phase08/11/Extractor |
| 本机 Mini 所在 PC | 全套：下载、phase08/11、按需 WAV、切 release | 把本机游戏目录当云盘 |

**完整自动更新是否必须依赖用户电脑？**

- **仅 HSJSON 元数据刷新（已有卡 id）：** 理论上可在任何能跑 Node 的地方做 phase11，但 **当前 phase11 仍扫本机 CardDef**。  
- **新扩展卡进入 Mini：** **必须**能读更新后的 Hearthstone bundles → **必须本机（或专用构建机）有游戏客户端**。

### 架构选择

| 方案 | 评价 |
| --- | --- |
| A Admin → 纯云端 Job | 做不到完整 phase08；最多下载+diff |
| B 本地 updater agent | 与当前 Mini 同居最贴合 |
| C 两阶段 | **推荐**：云或本机做 HSJSON check/download/staging；本机做 Unity 构建；Admin 只编排 |
| D 暂时保持本地手动 `npm run index:*` | 可作 1.5.15 前的过渡 |

**推荐 C：** Admin 触发 Job；HSJSON 步骤可本机可云；**index 构建绑定 Mini 主机上的 Hearthstone**；切换 pointer 后重启或热加载 Catalog。不要假装云函数能扫 `C:\Hearthstone`。

---

## 13. Recommended Update Architecture

基于实际循环与依赖，而不是套模板：

```text
Admin「检查更新」
  → HEAD latest zhCN cards.json + collectible
  → 比较 ETag / Length / 本地快照
  →（可选）diff collectible set 集合
  → 只读报告；不改 latest_sets

Admin「开始更新」（创建 update_job）
  → 下载到 data/releases/<id>/hearthstonejson/（staging）
  → JSON 校验
  → 若需要新卡/新 bundle：
        本机确认游戏 build（.product.db）与目标匹配
        staging 上跑 phase08 → phase11（输出进同一 release 目录，不写当前 data/index）
  → 在 staging 上 buildCatalog + 数量阈值 + 目标 set 是否进入 fold 后列表
  → 写 admin_logs（无密钥）
  → 切换 active pointer；重启 Mini 或热替换 catalog 引用
  → 失败则 pointer 不变

latest_sets
  → 仍独立：人工创建/编辑/publish
  → Catalog 无该 set → 继续 409
```

音频：index 切换后由 Extractor **按需**填 `tmp/`；不在卡牌 Job 里批量导 WAV。

---

## 14. Final Conclusions

1. **现在能否自动下载 HSJSON？** 不能。无 fetcher；仅有本地快照。远程 latest 与本地体积一致，可下载但未实现。  
2. **最适合的数据源？** `https://api.hearthstonejson.com/v1/` 的 zhCN `cards.json` + `cards.collectible.json`；用 ETag 检查；用 `/v1/{build}/` 固定版本（当前 250339）。  
3. **HSJSON 更新要重跑哪些 build？** 新卡/新语音：**phase08 然后 phase11**。仅已有 id 的文本/职业字段：仍建议 phase11；**只换 JSON 不够让 Mini 变化**。  
4. **phase08 必须跑吗？** 新 Set / 新 cardId / 新 voiceKey / 新 audio clip：**必须**。纯文案且 id 不变：可跳过，但新扩展不行。  
5. **phase11 必须跑吗？** 要让 Mini 读到新 unified index：**必须**（Catalog 不读 HSJSON）。  
6. **Catalog 必须重建吗？** 换 `card-audio-index` 后启动（或热加载）会重建；不换 index 则否。  
7. **音频必须重建吗？** 不必批量重建 WAV。必须更新的是 **index + 游戏 bundle**；WAV 按需。  
8. **新 Set 能否自动发现？** 能发现 **set code + collectible 张数**；不能可靠发现发行日与官方套装名。  
9. **latest 应否自动发布？** **否。**  
10. **失败如何不影响旧数据？** versioned staging + pointer；禁止生产路径原地覆盖。  
11. **是否需要 update_jobs？** 异步、可恢复、可展示进度：**需要新表**（目前没有）。  
12. **Supabase 负责什么？** 运营状态、Admin、Job 元数据、日志；**不负责**卡牌行存储。  
13. **必须本机的步骤？** phase08、phase11 的 CardDef 扫描、Extractor。  
14. **可云端的步骤？** 检查更新、下载 HSJSON、JSON 校验、set diff、Job 状态。  
15. **Admin 最终能否一键更新？** **不能在无本机游戏构建的前提下**对「新扩展进入 Catalog」一键完成。对「检查 JSON 是否更新」可以一键。完整一键 = Admin 编排 + **本机构建机** + 人工确认 latest。  
16. **一键更新前缺的基础设施：** HSJSON fetcher（只写 staging）、release 目录与 pointer、Mini 按 pointer 加载/热加载 Catalog、update_jobs schema、校验套件、phase08/11 输出目录参数（现写死 `data/index`）、远程 002 RPC 若仍未 apply、真实 Admin 账号。

---

## 15. Recommended Phase 1.5.15

建议下一阶段仍然 **小步**，不要一次做完 Unity 流水线云化：

1. 落地 `update_jobs`（及可选 `data_releases`）migration，**不**改 001。  
2. 实现 **只读**「检查更新」（HEAD ETag + 本地对比 + set diff 预览），不覆盖 HSJSON。  
3. 实现 staging 下载 **写入 `data/releases/…` 或 `tmp/hsjson-staging`**，校验后 **仍不**切 Mini 生产 index。  
4. 调查/设计 phase08/11 的 `OUT` 可配置，为原子切换做准备，**先不默认改生产 data/index**。  
5. Admin 增加「数据更新」只读页 + 检查按钮；**不**自动 publish latest。

明确非目标：下载覆盖 `data/hearthstonejson` 生产文件、自动 phase08、自动改 current Set、把 7263 张卡迁进 Supabase。

---

READY FOR PHASE 1.5.15
