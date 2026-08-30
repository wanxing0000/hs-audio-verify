# Phase 1.5.15 Report

Status: COMPLETE

Production code changes: yes (updater service + CLI + package.json scripts + `.gitignore`)
Test changes: yes (`test/hsjsonUpdater.test.js` added to `npm test`)
Data changes: **0** (production HSJSON snapshot not replaced)
Database changes: 0
UI changes: 0
Dependency changes: 0 (Node 原生 `fetch`，未新增 HTTP 库)

本阶段没有自动运行 phase08 / phase11。没有扫描或修改 `C:\Hearthstone`。没有改 Mini 路由、Catalog、`latest_sets`、`latest-set.json`。未进入 Phase 1.5.16。

---

## 1. Remote source

固定：

- `https://api.hearthstonejson.com/v1/latest/zhCN/cards.json`
- `https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json`

`data:check`：HEAD；若无 `Content-Length`，再用 `GET Range: bytes=0-0` 读 `Content-Range` 总量（不写生产目录）。  
`data:update`：GET 流式写入 staging。

ETag 比较会去掉 `W/` 弱标记。远程无某 header 时字段为 `null`。

---

## 2. Downloader architecture

`src/services/hsjsonUpdater.js`（`createHsjsonUpdater` 可注入 `fetch` / 目录，便于单测）：

- `checkRemoteSnapshot`
- `downloadSnapshotToStaging` → `tmp/hsjson-update/<id>/`
- `validateSnapshot`
- `commitSnapshot`
- `updateSnapshot`

下载：`pipeline` 流式写盘，再校验。中断不碰生产文件。

---

## 3. Validation rules

- 合法 JSON，顶层 Array，非空
- cards `> 1000`，collectible `> 100`，`cards.length >= collectible.length`
- 大部分条目为 object，且具备 `id`/`dbfId`、`set`、`type`
- collectible 中需有足够 `collectible === true`
- ID overlap：`overlapRatio >= 0.9`（collectible 足够大时）
- **不**硬编码 35807 / 8154

---

## 4. Staging strategy

`tmp/hsjson-update/<id>/cards.json`、`cards.collectible.json`、`metadata.json`  
`.gitignore` 已加 `tmp/hsjson-update/`。

---

## 5. Atomic commit strategy

Windows 兼容：`rename`，失败则 `copyFile` + `unlink`。

1. 现有文件移到 `*.bak.<txId>`
2. staging 移入生产 `cards.json` / `cards.collectible.json`
3. 成功后再写 `snapshot-meta.json`
4. 读回校验
5. 删除 bak 与 staging

三文件同一事务。

---

## 6. Rollback behavior

任一步失败：按相反顺序从 bak 恢复；没有 bak 则删除半写入文件。  
`updateSnapshot` 失败返回 `preserved: true`。CLI 打印 `current snapshot preserved`。

成功后 bak 删除。无 `data/hearthstonejson/history/`。

---

## 7. Metadata format

成功 commit 后才写 `data/hearthstonejson/zhCN/snapshot-meta.json`。

本次 **未执行** `data:update`，因此生产目录仍只有：

- `cards.json`
- `cards.collectible.json`

无 `snapshot-meta.json`（符合「成功提交后才写」）。

字段：`schemaVersion`、`source`、`locale`、每文件 `url` / `etag` / `lastModified` / `contentLength` / `sha256` / `entryCount` / `downloadedAt`。无 secret。

当前 `data/hearthstonejson` 是版本化快照；将来有 meta 时可一并入库。仓库 **无 `.git`**，未 init git。

---

## 8. CLI

```text
npm run data:check   → scripts/run-hsjson-check.cjs
npm run data:update  → scripts/run-hsjson-update.cjs
node scripts/run-hsjson-check-live.cjs
```

`data:update` **不**调用 `index:voice` / `index:audio`，不启 Mini。

---

## 9. Tests

`test/hsjsonUpdater.test.js` TEST 1–20：全部 mock/fixture。PASS。

---

## 10. Security audit

updater / CLI 不含 `SUPABASE_SERVICE_ROLE_KEY` 或密钥值。不读 `.env` 也能跑更新。不写 Supabase 表。

---

## 11. Mini regression

未重启 Mini。已有进程：

- `GET /api/mini/health` → 200
- `GET /api/mini/catalog?page=1&pageSize=1` → `total=7263`

---

## 12. Known limitations

- 无本地 `snapshot-meta.json` 时，靠远程 size/ETag 判断；HEAD 常无 `Content-Length`，需 Range 补全
- `data:update` 成功后 Catalog **不会**变（仍读旧 `card-audio-index`）
- 001 schema **没有** `data_versions` 表（与部分旧描述不符）；本阶段未建表
- 远程 002 `publish_latest_set` 仍可能未 apply（与本阶段无关）

---

## 13. Next recommended phase

Phase 1.5.16 建议：把 updater 接到 Admin「检查更新」只读页 / `update_jobs`，或为 phase08/11 增加 staging 输出目录。  
仍然不要把 HSJSON 一键更新与 Unity 扫包绑死。

---

Snapshot data unchanged.  
No production snapshot replacement was performed.
