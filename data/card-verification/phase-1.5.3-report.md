# Phase 1.5.3 Report：最新扩展包数据源调查

## 1. Phase 状态

```text
Phase 1.5.3
Status: INVESTIGATION COMPLETE
Production code changes: 0
Test code changes: 0
Data changes: 0
UI changes: 0
```

只新增本报告。未改 `src/`、`miniprogram/`、`test/`、`package.json`、Catalog、音频、索引、HSJSON 文件。未 `npm install`。未进入 Phase 1.5.4。无残留调查脚本。

---

## 2. 当前项目数据现状

项目卡牌集合来自 `data/index/card-audio-index.json` → `buildCatalog`（`shouldPublish` → `adaptCard` → `foldSharedReprints`）。

### catalog.cards / 列表字段

`adaptCard` / `toListCard` 已有：`id`、`name`、`type`、`class`、`rarity`、`collectible`、**`set`**、`dbfId`、图片与音频标记。`set` 来自索引/HSJSON 的 CardSet 枚举字符串，作为「这张卡属于哪个收藏套装」是可靠的。

没有：`releaseDate`、`date`、`createdAt`、`updatedAt`、`patch`、`expansion`（独立字段）、set 顺序、`latestSet` 配置。

`catalog` 另有 `clientVersion`（当前 `36.4.0.250339`）和 `schemaVersion`。这是 **游戏客户端构建号**，与 set 不是同一概念。同一构建里同时存在 CORE、VANILLA、CATACLYSM、TIME_TRAVEL、ESCAPEFROM_VIOLET_HOLD 等。

### dbfId / clientVersion / featured

| 信号 | 能否当「最新扩展包」 | 原因 |
| --- | --- | --- |
| `dbfId` 最大 | **否** | 皮肤等 `HERO_SKINS` 的 dbfId 可大于正式扩展包（1.5.1 已测 `HERO_10cg`） |
| `clientVersion` | **否** | 构建号，不是 CardSet |
| `/api/mini/featured` | **否** | 有 Entrance 的传说随从，按 dbfId **升序** |
| `set` 字母序 / TIME_TRAVEL 名字 | **否** | 禁止；TIME_TRAVEL 对应 Across the Timeways（见下文），不是当前最新 Expansion |
| HSJSON URL 里的 `latest` | **否** | 文档写明是 **最新游戏 build**，不是最新扩展包 |

**结论：** 项目里 **没有**「扩展包 → 发行日期」表。1.5.1 的 DATA INSUFFICIENT 对「仅凭 catalog 自动发现 latest set」仍然成立。本阶段补上的是 **项目外** 的正式扩展包名称/日期，以及 **INFERRED** 的 set 字符串映射。

---

## 3. HearthstoneJSON 调查

判定：**PARTIAL**（有 set 枚举与卡牌 `set`；**没有**「当前最新扩展包」字段）

对「能否直接告诉我们哪个 set 是最新 Expansion」：**NOT SUFFICIENT**。

### 项目已用位置

| 用途 | 路径 |
| --- | --- |
| 本地卡牌 JSON | `data/hearthstonejson/zhCN/cards.json`、`cards.collectible.json` |
| 卡图 | `https://art.hearthstonejson.com/v1/render/latest/zhCN/256x` |
| 索引构建 | 与 `card-audio-index.json` 对齐，非运行时拉 set metadata |

远程 API（文档）：`https://api.hearthstonejson.com/v1/`，`/v1/latest/` **302 到当前最新 build**（[hearthstonejson.com](https://hearthstonejson.com/)）。卡对象文档示例字段无日期（[docs/cards.html](https://hearthstonejson.com/docs/cards.html)）。

本机 collectible 卡字段并集 **无任何 date/release/patch/version 键**。存在 `isMiniSet`（布尔）：**不是发行日**，表示 mini-set / class set 类卡片。`ESCAPEFROM_VIOLET_HOLD` 中 28 张 `isMiniSet: true`。

公开 `https://api.hearthstonejson.com/v1/enums.json` 有 `CardSet` 名→整数，**无** release date、无 current 标记、无中文名。

文档写明旧版曾按 CardSet 拆文件，后来 **「CardSet separation has been removed」**。没有作为一等公民的 `sets.json`+日期。

### 示例（本地 HSJSON）

```json
{
  "id": "CAP_000",
  "name": "军情七处杀手",
  "set": "ESCAPEFROM_VIOLET_HOLD",
  "collectible": true,
  "dbfId": 127011,
  "isMiniSet": true
}
```

### 优点 / 缺点 / 是否推荐当 latest 源

- 优点：与 catalog `set` 同一套枚举；构建更新时卡已带 set。
- 缺点：不能回答「哪一个 Expansion 最新」。
- 推荐：继续当 **卡牌与 set 的绑定源**；**不要**当 latest 发现源。

二级补充（非 HSJSON API 本体）：[python-hearthstone `CardSet`](https://github.com/HearthSim/python-hearthstone/blob/master/hearthstone/enums.py) 有枚举注释与 `craftable` 列表（可构筑套装，含 Expansion 及部分其它），**仍无日期**。`CardSet.TIME_TRAVEL = 1957  # Across the Timeways`。`ESCAPEFROM_VIOLET_HOLD = 1988` 无英文注释。`is_standard` 依赖每年更新的 `STANDARD_SETS`，表示标准环境成员，**不是**「最新一个」。

---

## 4. Blizzard 官方数据调查

判定：**PARTIAL**

### 4.1 官方网站（公开 HTML，无需 Key）

| 项 | 内容 | 置信 |
| --- | --- | --- |
| 扩展包页 | [Escape from Violet Hold](https://hearthstone.blizzard.com/en-us/expansions-adventures/escape-from-violet-hold) | 一级来源 |
| 发行 | FAQ：**July 7, 2026 at 10:00 a.m. PT** | **PROVEN**（页面原文） |
| 后续内容 | [Azeroth's Most Wanted Class Sets](https://hearthstone.blizzard.com/en-us/news/24293282) 随 **Patch 36.4，August 25, 2026** 加入，文案写明是 **该扩展包的 Class Set**，不是新 Expansion | **PROVEN** |

适合人工核对；HTML 结构可变，**不适合**小程序运行时抓取当唯一自动化。

### 4.2 Hearthstone Game Data API

- 文档：Battle.net Developer Portal，`GET /hearthstone/metadata`、`/hearthstone/metadata/sets`
- 认证：**OAuth 2.0 client credentials**（需在开发者门户创建 client，本阶段 **未申请**）
- 社区/第三方 schema：set 对象常见 `id`、`name`、`slug`、`type`（`expansion` \| `adventure` \| `base`）、`hyped`、`collectibleCount`；**公开 schema 未列出 `releaseDate`**
- `setGroups` 可区分 standard/wild 分组，仍不是「最新 Expansion 的发行日」
- 适合：自建服务端（若接受 ToS、限流、密钥保管）。**不适合**写进微信小程序客户端。
- 本调查 **未** 用真实 token 拉生产 JSON，故 **不能** 声称线上 metadata 一定含日期。

生产自动化：密钥、ToS、限流、网关变更（token 必须放 Header）→ 成本高于本项目「本地 Mini + 构建时更新索引」的规模。

---

## 5. 其他数据源

| Source | Latest Set | Release Date | Structured | API | Reliability | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| 项目 catalog / HSJSON 本地卡 | 有 `set` 字符串 | 无 | 是 | 本地 | 高（绑定），不能发现最新 | 过滤用，不当发现源 |
| HSJSON `/v1/latest/` | 最新 **build** | 无 | 是 | 是 | 高，但语义不是 Expansion | 更新卡数据时用，不当 latestSet |
| HSJSON `enums.json` | CardSet 名 | 无 | 是 | 是 | 高 | 校验枚举存在 |
| python-hearthstone CardSet | 枚举+部分英文注释 | 无 | 是 | Git 文件 | 中高，需随仓库更新 | 辅助映射，不当日期源 |
| hsdata `Strings/*/GLOBAL.txt` | `GLOBAL_CARD_SET_JAIL` = Escape from Violet Hold / 逃离紫罗兰监狱 | 无 | 键值文本 | Git | 高（游戏内文案） | 中英文名；与枚举映射仍要核对 |
| Blizzard 扩展包/新闻页 | 当前主打 Expansion 名称+FAQ 日期 | 有（文案） | HTML | 无稳定 JSON | 一级，页面会改 | **人工校验 latestSet** |
| Blizzard Game Data API | set 列表+type | schema **未证明**有日期 | 是 | 要 OAuth | 未实测 | 不作为 1.5.4 默认 |
| Hearthstone Wiki (wiki.gg) | 表格含 Expansion + 日期 | 有 | HTML 表 | 无 | 三级，会过期（页面仍写 Patch 36.2） | 禁止当生产自动依赖 |
| HSReplay 揭示页 | 营销「latest expansion」 | 有（文案） | HTML | 无本调查确认的 latest-set API | 二级站点，页会变 | 不依赖 |
| Hearthstone Deck Tracker | 硬编码 set | 无 | 源码 | 无 | 随 HDT 发版 | 不依赖 |

---

## 6. 当前最新扩展包

必须拆开三层，禁止把映射写成 PROVEN。

### 6.1 官方最新正式 Expansion（名称与日期）

```text
Product name (en): Escape from Violet Hold
Release Date: 2026-07-07 10:00 PT
Primary Source: https://hearthstone.blizzard.com/en-us/expansions-adventures/escape-from-violet-hold
Verification Source: 同页 FAQ「When will Escape from Violet Hold release?」
Confidence: PROVEN
```

Class Set（2026-08-25）属于该扩展包增量，**不是**新的 Expansion。项目 `clientVersion` 36.4.x 与该补丁时间线一致，只说明 **dump 新于 36.4**，不能单独证明 set。

### 6.2 映射到 catalog.cards.set

```text
Candidate set ID: ESCAPEFROM_VIOLET_HOLD
English (hsdata GLOBAL_CARD_SET_JAIL): Escape from Violet Hold
Chinese (hsdata GLOBAL_CARD_SET_JAIL): 逃离紫罗兰监狱
Local collectible count: 164（HSJSON cards.collectible.json）
Folded catalog 同 set 数量: 164（折叠掉 0）
Confidence: INFERRED
```

推断依据（不是日期、不是 dbfId 最大、不是字符串排序）：

1. CardSet 枚举名与官方英文标题同指「Violet Hold」。
2. 游戏字符串 `GLOBAL_CARD_SET_JAIL` 英文行与官方标题一致；中文为「逃离紫罗兰监狱」。
3. 本地该 set 可收藏数量与「主扩展包 + Class Set 并入同一 set」相符（28 张 `isMiniSet`）。

**未**找到一份机器字段写着 `latestExpansion = ESCAPEFROM_VIOLET_HOLD`。

### 6.3 仅凭仓库能否自动发现

```text
Automatic latestSet from repo fields alone: DATA INSUFFICIENT
```

### 6.4 禁止误判

`TIME_TRAVEL` = Across the Timeways（python-hearthstone 注释）。官方 Catch-Up 文案把它列为 Violet Hold 上线时 **仍然在标准** 的过去套装之一，**不是**当前最新 Expansion。

---

## 7. 推荐架构

```text
官方扩展包页（人工核对名称/日期）
        ↓
本地 latestSet metadata（set id + 名称 + 日期 + 来源）
        ↓
catalog.cards（已 shouldPublish + foldSharedReprints）
        ↓
filter card.set === latestSet
        ↓
toListCard → pages/latest
```

**维护位置（推荐）：** 构建/数据层一份小 JSON（例如未来 `data/index/latest-set.json` 或 catalog 旁 metadata），**不要**写死在 `pages/latest/latest.js`，**不要**改 `foldSharedReprints`。Mini API 增加只读过滤（如 `set=` 或 `/api/mini/latest`），小程序只消费 folded 列表。

`isMiniSet` 卡与主扩展包同 `set` 时，应一并出现（同属该 Expansion 收藏）。不要用 `isMiniSet` 当「不是最新」。

---

## 8. 再版折叠兼容性

继续使用 **folded `catalog.cards`**。禁止按名称去重，禁止再实现 fold。

| 情况 | 含义 | 过滤 folded `catalog.cards` 且 `set === latestSet` |
| --- | --- | --- |
| A 最新套装卡被 share 到别套 | Core 再版通常是 `CORE_HIDDEN` + `sourceCardId` 指向原卡 | 列表保留 **canonical**；若 canonical 的 `set` 是最新套，仍显示 |
| B 最新套装自己含再版 | 本套 `set` 仍是最新 id 的新卡会留下；Core/Vanilla 再版 **不会**带最新 `set` | 最新页不会出现 Core 重复列 |
| C canonical 不属于最新 set | 若最新套一张卡 `sourceCardId` 指向旧卡，fold 赢家可能是旧 `set` | 该卡 **不会**出现在最新页。当前 `ESCAPEFROM_VIOLET_HOLD`：**折叠 0 张** |

产品定义应明确为：

> 展示 **folded 目录里 `card.set` 等于当前 latest Expansion 的卡**  
> （该扩展包收藏，含并入同一 set 的 Class Set）

而不是「时间上最后印的任意卡」，也不是「最新版本新增但 fold 到旧 canonical 的再版」。

**不要在折叠前单独滤一套再展示**，否则会把已折叠掉的 Core 再版加回来。详情仍走 `catalog.byId`。

---

## 9. 方案比较

| 方案 | 准确性 | 稳定性 | 自动化 | 维护成本 | 推荐 |
| --- | --- | --- | --- | --- | --- |
| A 运行时完全自动（Wiki/官网 HTML/无字段的 HSJSON） | 低–中 | 低 | 高（脆） | 高（改版即挂） | 否 |
| B 构建时自动拉 HSJSON latest **当 latest set** | 错（那是 build） | 高 | 高 | 低但语义错 | 否 |
| C 本地配置 `{ "latestSet": "ESCAPEFROM_VIOLET_HOLD" }` | 高（人核对官方） | 高 | 无 | 每扩展包改一行 | **是（主方案）** |
| D 构建提示/脚本对比官方文案 + 写入 C 的 JSON | 高 | 高 | 半自动 | 中 | 可作 C 的辅助，1.5.4 非必须 |

Blizzard OAuth metadata：未证实有发行日，且密钥不适合本仓库默认路径 → 不进主方案。

---

## 10. 最终推荐

**主方案：C — 本地 latestSet metadata。**

Phase 1.5.4 应：

1. 新增一份 **非代码硬编码页面** 的 metadata（set id、中英文名、发行日、来源 URL）。初值可写 `ESCAPEFROM_VIOLET_HOLD`，并在报告/注释标明映射为 INFERRED、日期来自官方 FAQ。
2. 在 **不改 fold** 的前提下，对 `catalog.cards` 做 `set` 过滤；API 只读。
3. `pages/latest` 拉该列表，复用 `card-item` 与现有详情 `navigateTo`。
4. 每次新 Expansion：更新卡 dump **同时**改 latestSet。不要从 dbfId/`TIME_TRAVEL`/featured 推。

**不要在 1.5.3 实施。**

---

## 11. 下一阶段边界

数据源对「人工维护的 latestSet + 官方页核对」已经足够实施过滤；对「零配置自动发现」仍不足。

```text
Phase 1.5.4
实现 latestSet metadata + 基于 catalog.cards 的最新卡牌 API/过滤
（禁止猜 set；初值须与本报告 INFERRED 映射一致并写明来源）
```

不是「继续只查数据源、完全不能做页面」。也不是「HSJSON 已提供 latest expansion 字段」。

---

## 验收对照

- [x] HearthstoneJSON 是否有可用 set **卡牌字段**：有；是否有 **latest expansion metadata**：**NOT SUFFICIENT**
- [x] 项目内是否存在 release date：**无**
- [x] Blizzard 官方：网页名称/日期 **AVAILABLE**；Game Data 日期字段 **未证实**（PARTIAL）
- [x] 备用：hsdata 文案、python-hearthstone 枚举（二级）；Wiki 仅人工交叉（三级）
- [x] 当前最新 **Expansion 产品名/日期**：**PROVEN**；**catalog set id**：**INFERRED**；纯自动发现：**DATA INSUFFICIENT**
- [x] latest set 可映射到 `catalog.cards.set`（INFERRED 候选已存在于本地数据）
- [x] 再版折叠：应滤 folded 列表；该候选 set 当前 fold 损失为 0
- [x] latest metadata 维护方式：本地配置（方案 C）
- [x] Phase 1.5.4：metadata + 过滤，不改 fold/音频

```text
Phase 1.5.3 COMPLETE
```
