# Phase 1.4.3 — Fold shared reprints

## 1. 实施结果

已在目录发布层（`shouldPublish` 之后）完成 canonical / shared reprint folding。

首页、搜索、筛选、分页都使用折叠后的 `catalog.cards`。`catalog.byId` 仍保留全部已发布 cardId，详情 API 仍可用真实 id 打开再版卡。未改 `card.id`。

## 2. 修改文件

| 文件 | 修改 | 原因 |
| --- | --- | --- |
| `src/miniprogram/catalogAdapter.js` | `foldSharedReprints`：用 `voice.play.sourceCardId` 分组；组内优先 `id === canonicalId`，缺主卡时调用已有 `pickCanonicalCardId`；`buildCatalog` 在 publish 之后折叠 | 1.4.2 指定的修复位置 |
| `test/catalogFold.test.js` | TEST 1–10 + 真实索引「奇利亚斯 / 奥拉基尔」 | 验收 |
| `package.json` | `npm test` 加入上述文件 | 回归 |
| `data/card-verification/phase-1.4.3-report.md` | 本报告 | 阶段记录 |

## 3. 未修改文件

Extractor、Resolver、Player、`playerController.js`、`audio.js`、音频数据/索引、详情页 `pages/card`、首页/搜索 WXML、`wx:key`：均未改。

## 4. 去重规则

- **禁止按名称去重。**
- 折叠键：`voice.play.sourceCardId`（空或等于自身 → `card.id`）。
- source 不在已发布集合中：保留当前卡，记 warning。
- 只跟一跳；环 / 链：不猜测，保留安全候选并 warning。
- 组内优先保留 `id === canonicalId`；否则 `pickCanonicalCardId`（collectible、较小 dbfId）。
- 不修改 `card.id`。

## 5. 测试结果

`npm test`: **PASS**

新增 `test/catalogFold.test.js`（TEST 1–10 及真实数据断言）。

同名非 shared（TEST 5）：CARD_A 与 CARD_B 均保留。

## 6. 真实数据验证

奇利亚斯搜索：`BOT_548`, `TOY_330`。无 `CORE_BOT_548`。

风领主奥拉基尔搜索与首页精确名：仅 `NEW1_010`。无 `CORE_NEW1_010`、`VAN_NEW1_010`。

## 7. 全库统计

```
Before:  8154
After:   7263
Folded:  891
canonical groups: 7263
warnings: 136
```

891 / 8154 ≈ 10.9%，与「大量 CORE/VANILLA 再版」相符，并非把目录腰斩。

## 8. 风险 / 异常

136 条 warning，主要是 `sourceCardId` 指向未发布 token/Boss（如 `UNG_076t1`、`CAP_106t`）——按规则保留当前卡。

少量环：`ICC_019↔ICC_094`、`ICC_807↔ICC_808`、`UNG_070↔UNG_208`、`UNG_079↔UNG_205`、`VAC_301↔VAC_954`。双方都保留。

少量链（只折一跳），缺主卡时用 `pickCanonicalCardId` 留下稳定候选。

未跟 `music.sourceCardId`，也未按名称合并英雄皮肤。
