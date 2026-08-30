# Phase 2.10 Related / Generated Card Audio Integrity Audit

## 1. Executive Summary

This is a **read-only** audit. No production audio, catalog, index, or VPS files were modified.

The current HSJSON snapshot has **no `entourage` / `relatedCardDbfIds` fields**. Confirmed generated-card relations therefore come from **structured cardId token suffixes** (`t` / `tN` / `a` / `b` / `c` / `e`) plus a small number of explicit `questReward` pointers.

- Primary parents: **5499**
- Primary relation edges: **7809**
- Related cards: **7809**
- Parents with 3+ related: **396**
- Zero-audio cards: **23930** (collectible 2938, non-collectible 20992, generated/token 6365)
- Mapping exists / production missing: **11262**
- Related card not in catalog: **7648**
- Parent has index audio / related has none (playable types): **756**
- Audio exists but unindexed (clip-name probe): **842**

Headline cases:

- **游侠将军希尔瓦娜斯 (`TIME_609`)** has **2 structured minion tokens** with full unique voice mappings. They are **not in catalog** (`collectible=false`) and **not in production-audio**.
- **时空大盗拉法姆 (`TIME_005`)** has **10 structured minion tokens** (9 siblings + 1 nested sheep) with voice mappings. Same catalog/production gap.
- Both collectible parents themselves have **full audio-index mappings and zero production files**. In the miniapp this is `catalog mapping AND production manifest`, so users currently see **no playable audio** for these cards.

## 2. Data Sources

| Role | Path |
|---|---|
| Card database | `C:\Users\123\hs-audio-verify\data\hearthstonejson\zhCN\cards.json` |
| Audio index / catalog source | `C:\Users\123\hs-audio-verify\data\index\card-audio-index.json` |
| Production manifest | `C:\Users\123\hs-audio-verify\data\production-audio\manifest.json` |
| Clip metadata | `data/index/audio-index.json` |

Catalog is built from `card-audio-index.json` via `shouldPublish` (collectible or `VERIFY_IDS`). It is not a second card database.

## 3. Audio Model

```
CURRENT_AUDIO_MODEL

Card identity: id, dbfId, name, type, class, rarity, collectible, set
Voice mapping: voice.play / voice.attack / voice.death
  available when status is available|shared AND voiceKey is set
Music mapping: music.status available|shared AND audioClipName or musicAssetId
Entrance mapping: entrancePreview.available = play mapping AND music mapping
Production availability: overlay — catalog/index mapping AND production manifest
Catalog availability: published only if collectible === true (plus VERIFY_IDS)
```

Phase 2.9-A rule is unchanged: advertised playable audio requires **both** index mapping and a production manifest entry. Mapping alone is not enough on the production miniapp.

## 4. Relation Detection Rules

| Level | Name | What this project actually has | Used in primary graph |
|---|---|---|---|
| 1 | EXPLICIT | `heroPowerDbfId`, `questReward`, Battlegrounds buddy/related/skin, `countAsCopyOfDbfId`. **`entourage` is absent.** | `questReward` / `entourage` only |
| 2 | STRUCTURED | Immediate `cardId` token suffix when the prefix exists as another card | YES |
| 3 | PROJECT_INDEXED | No parent→generated index. `sourceCardId` is reprint/shared-audio alias | NO (alias only) |
| 4 | INFERRED | Same-set exact card-name mention in text | Reported, never counted as missing |

Hero-power edges (3016) and Battlegrounds edges (1185) are recorded but **excluded** from primary generated-card totals so skins and BG buddies do not inflate the graph.

## 5. Sylvanas Case

Collectible minion parent: `TIME_609` 游侠将军希尔瓦娜斯 set=TIME_TRAVEL type=MINION dbfId=119707.

1. `TIME_609t1` 游侠队长奥蕾莉亚 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
2. `TIME_609t2` 游侠新兵温蕾萨 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
3. `TIME_609t2e` 风行者之誓 (ENCHANTMENT, collectible=false, STRUCTURED/enchantment) catalog=NO index=[] production=[] gap=AUDIO_TRULY_ABSENT category=NO_AUDIO_EXPECTED

Same-name cards that are **not** generated relations: `HERO_05z` HERO_SKINS/HERO.

Text mentions 奥蕾莉亚 / 温蕾萨. Those names are already covered by structured tokens `TIME_609t1` / `TIME_609t2`. They are not extra inferred edges.

Enchantment `TIME_609t2e` 风行者之誓 has no voice mapping. That is expected for `ENCHANTMENT`.

## 6. Rafaam Case

Collectible minion parent: `TIME_005` 时空大盗拉法姆 set=TIME_TRAVEL type=MINION dbfId=119432.

1. `TIME_005t1` 小小拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
2. `TIME_005t2` 绿色拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
3. `TIME_005t2e` 最最伟大的绿色学！ (ENCHANTMENT, collectible=false, STRUCTURED/enchantment) catalog=NO index=[] production=[] gap=AUDIO_TRULY_ABSENT category=NO_AUDIO_EXPECTED
4. `TIME_005t3` 探险者拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
5. `TIME_005t4` 大酋长拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
6. `TIME_005t5` 夺心者拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
7. `TIME_005t6` 灾异拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
8. `TIME_005t7` 巨人拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
9. `TIME_005t8` 鱼人拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
10. `TIME_005t8e` 姆啦啦姆鱼人学！！ (ENCHANTMENT, collectible=false, STRUCTURED/enchantment) catalog=NO index=[] production=[] gap=AUDIO_TRULY_ABSENT category=NO_AUDIO_EXPECTED
11. `TIME_005t9` 大法师拉法姆 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death,music,entrance] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING
12. `TIME_005t9t` 拉法姆绵羊 (MINION, collectible=false, STRUCTURED/token) catalog=NO index=[play,attack,death] production=[] gap=AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING category=MAPPING_EXISTS_PRODUCTION_MISSING

Same-name cards that are **not** generated relations: `HERO_07bk` HERO_SKINS/HERO.

`TIME_005t9t` 拉法姆绵羊 is a nested token of `TIME_005t9`, then of `TIME_005`. Its voiceKeys are filename-style (`TIME_005t9t_Play`) rather than `VO_TIME_005t9t_...`. That is an alias/id mismatch, not a missing mapping.

## 7. Global Relation Statistics

| Metric | Count |
|---|---|
| TOTAL_PARENT_CARDS | 5499 |
| TOTAL_RELATION_EDGES | 7809 |
| TOTAL_RELATED_CARDS | 7809 |
| TOTAL_CARDS_WITH_1_RELATED | 4295 |
| TOTAL_CARDS_WITH_2_RELATED | 808 |
| TOTAL_CARDS_WITH_3_PLUS_RELATED | 396 |

Largest 3+ parents (first 20):

- `BG36_MidGameEffect_000` 黑暗之赐！ → 40 (BG36_MidGameEffect_000t, BG36_MidGameEffect_000t10, BG36_MidGameEffect_000t11, BG36_MidGameEffect_000t12, BG36_MidGameEffect_000t13, BG36_MidGameEffect_000t14, BG36_MidGameEffect_000t15, BG36_MidGameEffect_000t16, BG36_MidGameEffect_000t18, BG36_MidGameEffect_000t2, BG36_MidGameEffect_000t21, BG36_MidGameEffect_000t22, BG36_MidGameEffect_000t28, BG36_MidGameEffect_000t29, BG36_MidGameEffect_000t3, BG36_MidGameEffect_000t30, BG36_MidGameEffect_000t4, BG36_MidGameEffect_000t5, BG36_MidGameEffect_000t50, BG36_MidGameEffect_000t51, BG36_MidGameEffect_000t52, BG36_MidGameEffect_000t60, BG36_MidGameEffect_000t61, BG36_MidGameEffect_000t62, BG36_MidGameEffect_000t64, BG36_MidGameEffect_000t65, BG36_MidGameEffect_000t66, BG36_MidGameEffect_000t69, BG36_MidGameEffect_000t6e2, BG36_MidGameEffect_000t7, BG36_MidGameEffect_000t71, BG36_MidGameEffect_000t72, BG36_MidGameEffect_000t73, BG36_MidGameEffect_000t74, BG36_MidGameEffect_000t75, BG36_MidGameEffect_000t79, BG36_MidGameEffect_000t80, BG36_MidGameEffect_000t81, BG36_MidGameEffect_000t82, BG36_MidGameEffect_000t9)
- `CFM_621` 卡扎库斯 → 38 (CFM_621e, CFM_621e2, CFM_621e3, CFM_621t, CFM_621t10, CFM_621t11, CFM_621t12, CFM_621t13, CFM_621t14, CFM_621t15, CFM_621t16, CFM_621t17, CFM_621t18, CFM_621t19, CFM_621t2, CFM_621t20, CFM_621t21, CFM_621t22, CFM_621t23, CFM_621t24, CFM_621t25, CFM_621t26, CFM_621t27, CFM_621t28, CFM_621t29, CFM_621t3, CFM_621t30, CFM_621t31, CFM_621t32, CFM_621t33, CFM_621t37, CFM_621t38, CFM_621t39, CFM_621t4, CFM_621t5, CFM_621t6, CFM_621t8, CFM_621t9)
- `SCH_199` 转校生 → 38 (SCH_199t, SCH_199t10, SCH_199t11, SCH_199t12, SCH_199t13, SCH_199t14, SCH_199t15, SCH_199t16, SCH_199t17, SCH_199t18, SCH_199t19, SCH_199t2, SCH_199t20, SCH_199t21, SCH_199t22, SCH_199t23, SCH_199t24, SCH_199t25, SCH_199t26, SCH_199t27, SCH_199t28, SCH_199t29, SCH_199t3, SCH_199t30, SCH_199t31, SCH_199t32, SCH_199t33, SCH_199t34, SCH_199t35, SCH_199t36, SCH_199t37, SCH_199t38, SCH_199t4, SCH_199t5, SCH_199t6, SCH_199t7, SCH_199t8, SCH_199t9)
- `TLC_452` 泰坦考据学家欧斯克 → 31 (TLC_452t1, TLC_452t13, TLC_452t14, TLC_452t15, TLC_452t16, TLC_452t17, TLC_452t18, TLC_452t19, TLC_452t2, TLC_452t20, TLC_452t21, TLC_452t22, TLC_452t23, TLC_452t24, TLC_452t26, TLC_452t27, TLC_452t28, TLC_452t29, TLC_452t3, TLC_452t30, TLC_452t31, TLC_452t32, TLC_452t33, TLC_452t34, TLC_452t35, TLC_452t4, TLC_452t5, TLC_452t6, TLC_452t7, TLC_452t8, TLC_452t9)
- `TTN_002` 调节规则 → 31 (TTN_002e, TTN_002e1, TTN_002e2, TTN_002t1, TTN_002t11, TTN_002t13e, TTN_002t13e1, TTN_002t14, TTN_002t15, TTN_002t17e, TTN_002t20, TTN_002t21, TTN_002t22, TTN_002t24, TTN_002t26e, TTN_002t29, TTN_002t2e, TTN_002t30, TTN_002t32, TTN_002t34e, TTN_002t35, TTN_002t36, TTN_002t41, TTN_002t43, TTN_002t44, TTN_002t45, TTN_002t46e, TTN_002t5, TTN_002t50, TTN_002t8e, TTN_002t9)
- `VAC_464` 财宝猎人尤朵拉 → 30 (VAC_464t, VAC_464t10, VAC_464t11, VAC_464t12, VAC_464t14, VAC_464t15, VAC_464t16, VAC_464t17, VAC_464t18, VAC_464t19, VAC_464t2, VAC_464t20, VAC_464t21, VAC_464t22, VAC_464t23, VAC_464t24, VAC_464t25, VAC_464t26, VAC_464t27, VAC_464t28, VAC_464t29, VAC_464t3, VAC_464t30, VAC_464t31, VAC_464t4, VAC_464t5, VAC_464t6, VAC_464t7, VAC_464t8, VAC_464t9)
- `TLC_100` 导航员伊莉斯 → 24 (TLC_100t1, TLC_100t11, TLC_100t12, TLC_100t13, TLC_100t14, TLC_100t15, TLC_100t16, TLC_100t17, TLC_100t2, TLC_100t21, TLC_100t22, TLC_100t23, TLC_100t24, TLC_100t25, TLC_100t26, TLC_100t27, TLC_100t3, TLC_100t31, TLC_100t32, TLC_100t33, TLC_100t34, TLC_100t35, TLC_100t36, TLC_100t37)
- `VAC_449` 歌唱明星卡瑞斯 → 22 (VAC_449e1, VAC_449t, VAC_449t1, VAC_449t10, VAC_449t11, VAC_449t12, VAC_449t13, VAC_449t14, VAC_449t15, VAC_449t16, VAC_449t17, VAC_449t18, VAC_449t19, VAC_449t2, VAC_449t20, VAC_449t3, VAC_449t4, VAC_449t5, VAC_449t6, VAC_449t7, VAC_449t8, VAC_449t9)
- `WW_001` 狗头人矿工 → 20 (WW_001t, WW_001t11, WW_001t12, WW_001t13, WW_001t14, WW_001t16, WW_001t17, WW_001t18, WW_001t2, WW_001t23, WW_001t24, WW_001t25, WW_001t26, WW_001t27, WW_001t3, WW_001t4, WW_001t5, WW_001t7, WW_001t8, WW_001t9)
- `TOY_330` 奇利亚斯豪华版3000型 → 19 (TOY_330e, TOY_330e1, TOY_330t10, TOY_330t11, TOY_330t12, TOY_330t26, TOY_330t5, TOY_330t6, TOY_330t7, TOY_330t8, TOY_330t9, TOY_330t92, TOY_330t93, TOY_330t94, TOY_330t95, TOY_330t96, TOY_330t97, TOY_330t98, TOY_330t99)
- `TTN_719` 废料回收 → 16 (TTN_719e, TTN_719e1, TTN_719e2, TTN_719e3, TTN_719e4, TTN_719e5, TTN_719e6, TTN_719e7, TTN_719t, TTN_719t1, TTN_719t2, TTN_719t3, TTN_719t4, TTN_719t5, TTN_719t6, TTN_719t7)
- `TOY_700` 酷炫的威兹班 → 15 (TOY_700t, TOY_700t1, TOY_700t10, TOY_700t11, TOY_700t12, TOY_700t13, TOY_700t14, TOY_700t2, TOY_700t3, TOY_700t4, TOY_700t5, TOY_700t6, TOY_700t7, TOY_700t8, TOY_700t9)
- `GDB_100` 阿肯尼特防护水晶 → 14 (GDB_100a, GDB_100b, GDB_100c, GDB_100e, GDB_100e1, GDB_100e3, GDB_100t1, GDB_100t2, GDB_100t4, GDB_100t5, GDB_100t6, GDB_100t7, GDB_100t8, GDB_100t9)
- `BAR_079` 魔像师卡扎库斯 → 12 (BAR_079t10, BAR_079t11, BAR_079t12, BAR_079t13, BAR_079t14, BAR_079t15, BAR_079t4, BAR_079t5, BAR_079t6, BAR_079t7, BAR_079t8, BAR_079t9)
- `TIME_619` 墓地尊主塔兰吉 → 11 (TIME_619e, TIME_619e2, TIME_619e3, TIME_619e4, TIME_619e5, TIME_619e6, TIME_619t, TIME_619t2, TIME_619t3, TIME_619t4, TIME_619t5)
- `BG31_HERO_801pt` 战列巡航舰 → 10 (BG31_HERO_801pta, BG31_HERO_801ptb, BG31_HERO_801ptc, BG31_HERO_801pte, BG31_HERO_801pte2, BG31_HERO_801pte3, BG31_HERO_801pte4, BG31_HERO_801pte5, BG31_HERO_801pte6, BG31_HERO_801pte7)
- `BG31_HERO_811` 刀锋女王凯瑞甘 → 10 (BG31_HERO_811t, BG31_HERO_811t10, BG31_HERO_811t2, BG31_HERO_811t3, BG31_HERO_811t4, BG31_HERO_811t5, BG31_HERO_811t6, BG31_HERO_811t7, BG31_HERO_811t8, BG31_HERO_811t9)
- `RLK_570` 食尸鬼炼金师 → 10 (RLK_570e, RLK_570e2, RLK_570e3, RLK_570e4, RLK_570t, RLK_570t1, RLK_570t2, RLK_570t3, RLK_570t4, RLK_570t5)
- `SW_710` ？？？ → 10 (SW_710t0, SW_710t1, SW_710t2, SW_710t3, SW_710t4, SW_710t5, SW_710t6, SW_710t7, SW_710t8, SW_710t9)
- `TTN_920` 天才米米尔隆 → 10 (TTN_920e1, TTN_920e2, TTN_920e3, TTN_920t10, TTN_920t4e, TTN_920t5, TTN_920t6, TTN_920t7, TTN_920t8, TTN_920t9)

## 8. Zero-Audio Cards

Cards with no play/attack/death/music index mapping:

| Slice | Count |
|---|---|
| TOTAL_CARDS_WITH_ZERO_AUDIO | 23930 |
| collectible | 2938 |
| non-collectible | 20992 |
| generated/token (primary related) | 6365 |

By type: BATTLEGROUND_ANOMALY=110, BATTLEGROUND_HERO_BUDDY=1, BATTLEGROUND_QUEST_REWARD=73, BATTLEGROUND_SPELL=205, BATTLEGROUND_TRINKET=386, ENCHANTMENT=6616, GAME_MODE_BUTTON=10, HERO=1945, HERO_POWER=2134, LETTUCE_ABILITY=4354, LOCATION=93, MINION=949, MOVE_MINION_HOVER_TARGET=4, PET=32, SPELL=6528, UNKNOWN=9, WEAPON=481.

Zero audio is **not** automatically a bug. Enchantments, most hero skins, hero powers, locations, and many spells have no minion voice system.

## 9. Parent-With-Audio / Related-Without-Audio

Primary graph, parent has **audio-index** mapping, related has none.

- All related types: **3088**
- Playable types only (minion/spell/weapon/hero/location): **756**

Enchantments dominate the all-types list and are usually `NO_AUDIO_EXPECTED`. The playable-type list is the real residual.

TOP playable residuals:

1. `AT_042` 刃牙德鲁伊 → `AT_042a` 雄狮形态 (MINION, choice, AUDIO_TRULY_ABSENT)
2. `AT_042` 刃牙德鲁伊 → `AT_042b` 黑豹形态 (MINION, choice, AUDIO_TRULY_ABSENT)
3. `AV_113` 野兽追猎者塔维什 → `AV_113t1` 强化爆炸陷阱 (SPELL, token, AUDIO_TRULY_ABSENT)
4. `AV_113` 野兽追猎者塔维什 → `AV_113t2` 强化冰冻陷阱 (SPELL, token, AUDIO_TRULY_ABSENT)
5. `AV_113` 野兽追猎者塔维什 → `AV_113t3` 强化毒蛇陷阱 (SPELL, token, AUDIO_TRULY_ABSENT)
6. `AV_113` 野兽追猎者塔维什 → `AV_113t7` 强化集群战术 (SPELL, token, AUDIO_TRULY_ABSENT)
7. `AV_113` 野兽追猎者塔维什 → `AV_113t8` 强化打开兽笼 (SPELL, token, AUDIO_TRULY_ABSENT)
8. `AV_113` 野兽追猎者塔维什 → `AV_113t9` 强化冰霜陷阱 (SPELL, token, AUDIO_TRULY_ABSENT)
9. `AV_136` 狗头人监工 → `AV_136t` 护甲碎片 (SPELL, token, AUDIO_TRULY_ABSENT)
10. `AV_202` 勇气战将洛卡拉 → `AV_202t2` 无坚不摧之力 (WEAPON, token, AUDIO_TRULY_ABSENT)
11. `AV_205` 野性之心古夫 → `AV_205a` 冰雪绽放 (SPELL, choice, AUDIO_TRULY_ABSENT)
12. `AV_258` 元素使者布鲁坎 → `AV_258t` 大地祈咒 (SPELL, token, AUDIO_TRULY_ABSENT)
13. `AV_258` 元素使者布鲁坎 → `AV_258t2` 流水祈咒 (SPELL, token, AUDIO_TRULY_ABSENT)
14. `AV_258` 元素使者布鲁坎 → `AV_258t3` 火焰祈咒 (SPELL, token, AUDIO_TRULY_ABSENT)
15. `AV_258` 元素使者布鲁坎 → `AV_258t4` 闪电祈咒 (SPELL, token, AUDIO_TRULY_ABSENT)
16. `AV_316` 恐惧巫妖塔姆辛 → `AV_316t4` 邪能裂隙 (SPELL, token, AUDIO_TRULY_ABSENT)
17. `BAR_079` 魔像师卡扎库斯 → `BAR_079t10` 野藤 (SPELL, token, AUDIO_TRULY_ABSENT)
18. `BAR_079` 魔像师卡扎库斯 → `BAR_079t11` 格罗姆之血 (SPELL, token, AUDIO_TRULY_ABSENT)
19. `BAR_079` 魔像师卡扎库斯 → `BAR_079t12` 冰盖草 (SPELL, token, AUDIO_TRULY_ABSENT)
20. `BAR_079` 魔像师卡扎库斯 → `BAR_079t13` 火焰花 (SPELL, token, AUDIO_TRULY_ABSENT)
21. `BAR_079` 魔像师卡扎库斯 → `BAR_079t14` 魔皇草 (SPELL, token, AUDIO_TRULY_ABSENT)
22. `BAR_079` 魔像师卡扎库斯 → `BAR_079t15` 皇血草 (SPELL, token, AUDIO_TRULY_ABSENT)
23. `BAR_079` 魔像师卡扎库斯 → `BAR_079t4` 雨燕草 (SPELL, token, AUDIO_TRULY_ABSENT)
24. `BAR_079` 魔像师卡扎库斯 → `BAR_079t5` 地根草 (SPELL, token, AUDIO_TRULY_ABSENT)
25. `BAR_079` 魔像师卡扎库斯 → `BAR_079t6` 太阳草 (SPELL, token, AUDIO_TRULY_ABSENT)
26. `BAR_079` 魔像师卡扎库斯 → `BAR_079t7` 活根草 (SPELL, token, AUDIO_TRULY_ABSENT)
27. `BAR_079` 魔像师卡扎库斯 → `BAR_079t8` 枯叶草 (SPELL, token, AUDIO_TRULY_ABSENT)
28. `BAR_079` 魔像师卡扎库斯 → `BAR_079t9` 墓地苔 (SPELL, token, AUDIO_TRULY_ABSENT)
29. `BAR_721` 曼科里克 → `BAR_721t` 奥格拉，曼科里克的妻子 (SPELL, token, AUDIO_TRULY_ABSENT)
30. `BAR_919` 尼尔鲁·火刃 → `BAR_919t` 火刃传送门 (MINION, token, AUDIO_TRULY_ABSENT)
31. `BG21_HERO_000_Buddy_G` 法莫斯队长 → `BG21_HERO_000_Buddy_Gt` 进攻姿态 (SPELL, token, AUDIO_TRULY_ABSENT)
32. `BG21_HERO_000_Buddy` 法莫斯队长 → `BG21_HERO_000_Buddyt` 进攻姿态 (SPELL, token, AUDIO_TRULY_ABSENT)
33. `BG21_HERO_000_Buddy` 法莫斯队长 → `BG21_HERO_000_Buddyt2` 防御姿态 (SPELL, token, AUDIO_TRULY_ABSENT)
34. `BG21_HERO_000_Buddy` 法莫斯队长 → `BG21_HERO_000_Buddyt3` 进攻姿态 (SPELL, token, AUDIO_TRULY_ABSENT)
35. `BG21_HERO_000_Buddy` 法莫斯队长 → `BG21_HERO_000_Buddyt4` 防御姿态 (SPELL, token, AUDIO_TRULY_ABSENT)
36. `BG23_000_G` 迷你侍从 → `BG23_000_Gt` 迷你三叉戟 (SPELL, token, AUDIO_TRULY_ABSENT)
37. `BG23_000` 迷你侍从 → `BG23_000t` 迷你三叉戟 (SPELL, token, AUDIO_TRULY_ABSENT)
38. `BG23_004_G` 深海钓客 → `BG23_004_Gt` 钓客的诱饵 (SPELL, token, AUDIO_TRULY_ABSENT)
39. `BG23_004` 深海钓客 → `BG23_004t` 钓客的诱饵 (SPELL, token, AUDIO_TRULY_ABSENT)
40. `BG23_007_G` 乘波骑士 → `BG23_007_Gt` 海底坐骑 (SPELL, token, AUDIO_TRULY_ABSENT)
41. `BG23_007` 乘波骑士 → `BG23_007t` 海底坐骑 (SPELL, token, AUDIO_TRULY_ABSENT)
42. `BG23_008_G` 闪鳞纳迦 → `BG23_008_Gt` 闪鳞头冠 (SPELL, token, AUDIO_TRULY_ABSENT)
43. `BG23_008` 闪鳞纳迦 → `BG23_008t` 闪鳞头冠 (SPELL, token, AUDIO_TRULY_ABSENT)
44. `BG23_015_G` 照看者奥戈佐亚 → `BG23_015_Gt` 艾萨拉的孵化场 (SPELL, token, AUDIO_TRULY_ABSENT)
45. `BG23_015` 照看者奥戈佐亚 → `BG23_015t` 艾萨拉的孵化场 (SPELL, token, AUDIO_TRULY_ABSENT)
46. `BG23_018` 暗视长者 → `BG23_018t` Darkgaze Mass Blood Gem (SPELL, token, AUDIO_TRULY_ABSENT)
47. `BG24_HERO_100_Buddy_G` 阴蔽的权贵 → `BG24_HERO_100_Buddy_Gt` 大袋钱币 (SPELL, token, AUDIO_TRULY_ABSENT)
48. `BG24_HERO_100_Buddy` 阴蔽的权贵 → `BG24_HERO_100_Buddyt` 小袋钱币 (SPELL, token, AUDIO_TRULY_ABSENT)
49. `BG25_044` 金枪格蕾塔 → `BG25_044t` 金枪 (SPELL, token, AUDIO_TRULY_ABSENT)
50. `BG25_807` 机械加拉克苏斯 → `BG25_807t3` 巴萨拉克 (MINION, token, AUDIO_TRULY_ABSENT)

## 10. Mapping Exists / Production Missing

Exclusive category `MAPPING_EXISTS_PRODUCTION_MISSING`: **11262**.

This is the largest actionable bucket. TIME_TRAVEL parents and their voiced tokens sit here: the index already points at real zhCN clips, but `data/production-audio` was built from previously extracted featured/latest waves, not from this set.

## 11. Related Card Missing From Catalog

Related cards with `collectible !== true` are excluded by `shouldPublish`. Count: **7648**.

This is **catalog modeling**, not a missing HSJSON row. Tokens exist in both `cards.json` and `card-audio-index.json`.

## 12. Audio Exists But Unindexed

Probe: card has no voice mapping, but `audio-index.json` has a clip named `VO_{cardId}_*` or `{cardId}_Play/Attack/Death`. Count: **842**.

Treat as a hypothesis, not proof the card should speak. Clip-name coincidence can happen.

## 13. Alias / ID Mapping

Normal and expected:

- `sourceCardId !== cardId` for shared reprints and shared music (tokens reuse parent stingers).
- `voiceKey` may be `VO_{id}_...` or a filename stem such as `TIME_005t9t_Play` / `JAIL_*_Play`. File stem != cardId is **not** missing audio.
- `countAsCopyOfDbfId` is a reprint/copy pointer, not a generated-card relation (304 rows).

## 14. False Positive Risks

1. Treating hero skins (`HERO_05z`, `HERO_07bk`) as generated forms of the minion. Same Chinese name, different id/set/type. **Rejected.**
2. Treating every `heroPowerDbfId` as a generated atlas card. **Excluded from primary graph.**
3. Treating Battlegrounds buddy/skin/related pointers as constructed-token relations. **Excluded from primary graph.**
4. Treating enchantment suffixes (`e` / `e2`) as missing voices. Usually `NO_AUDIO_EXPECTED`.
5. Treating card-text “召唤 XX” as a database relation. **INFERRED only.**
6. Assuming catalog absence means the card is absent from the database. Tokens are present; catalog simply does not publish non-collectibles.
7. Assuming production absence means the clip was never indexed. For TIME_609 / TIME_005 families the clips **are** indexed.

## 15. Recommended Next Phase

RECOMMENDED_NEXT_ACTION (do not execute in 2.10):

1. Extend catalog/relation model so a collectible parent can list structured tokens (`TIME_609t1`, `TIME_609t2`, `TIME_005t*`).
2. Decide product policy: publish voiced tokens in the atlas, or only show them on the parent detail page.
3. If those tokens should be playable in production, expand the production-audio package to include their already-indexed voiceKeys (and parent TIME_TRAVEL audio).
4. Re-run production availability after any package change.
5. Do **not** extract from Windows Hearthstone or rewrite catalog publish rules in this phase.

## 16. Safety / Change Summary

- production-audio: NOT MODIFIED
- manifest: NOT MODIFIED
- extractor: NOT CALLED
- Hearthstone install: NOT ACCESSED
- VPS / Nginx / systemd / env: NOT MODIFIED
- git commit / push: NOT DONE

## Q&A

### Q1 游侠将军希尔瓦娜斯是否有明确关联卡？

**YES** — structured tokens `TIME_609t1` 游侠队长奥蕾莉亚, `TIME_609t2` 游侠新兵温蕾萨, plus expected enchantment `TIME_609t2e` 风行者之誓. Hero skin `HERO_05z` is the same name only.

### Q2 这些关联卡是否存在于当前 catalog？

**NO** for the tokens/enchantment (`collectible=false`). Parent `TIME_609` **is** published. Hero skin `HERO_05z` is collectible and therefore catalog-eligible, but it is not a generated child.

### Q3 这些关联卡是否存在 audio index？

**YES** for both minion tokens (own play/attack/death + shared parent music). Enchantment: **NO** mapping (expected).

### Q4 这些关联卡是否存在 production-audio？

**NO**. Parent `TIME_609` is also absent from the production manifest.

### Q5 时空大盗拉法姆是否有明确关联卡？

**YES** — `TIME_005t1`…`TIME_005t9` plus nested `TIME_005t9t`, and enchantments `TIME_005t2e` / `TIME_005t8e`. Hero skin `HERO_07bk` is same-name only.

### Q6 这些关联卡是否存在音频？

**Index YES / production NO** for the minion tokens. Enchantments have no mapping. Parent also index YES / production NO.

### Q7 全项目数量

- zero-audio cards: **23930**
- related cards without audio (playable types / all types): **756 / 3088**
- mapping-but-production-missing: **11262**
- audio-but-unindexed: **842**
- related-card-not-in-catalog: **7648**

### Q8 这些问题分别是什么性质？

| Observation | Nature |
|---|---|
| Tokens missing from catalog | Catalog modeling (`shouldPublish` = collectible only) |
| TIME_609 / TIME_005 and voiced tokens have index but no WAV in production-audio | Production package did not include those already-indexed clips |
| Enchantments / most hero skins / hero powers have no mapping | Normal no-audio |
| Parent has audio and a playable related card has none | Residual true index gap; see playable D list |
| Clip-name probe hits | Hypothesis only |

Generated at `2026-08-30T10:52:46.070Z`.
