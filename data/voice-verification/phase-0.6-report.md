# Phase 0.6 语音映射验证报告

- 随机种子：`20260828`
- 测试卡牌数量：50
- 候选可收藏随从池：4333
- asset_manifest 中的 `.prefab:GUID` 条目：35790
- 扫描 prefab/sound bundle：2140，解析含目标 GUID 的 bundle：45，解析失败：0

## 成功率

| 槽位 | matched | not_found | indirect | error | 成功率 |
|---|---:|---:|---:|---:|---:|
| play | 39 | 1 | 10 | 0 | 78% |
| attack | 39 | 1 | 10 | 0 | 78% |
| death | 39 | 1 | 10 | 0 | 78% |

## 失败类型分布

- `play/matched`: 39
- `attack/matched`: 39
- `death/matched`: 39
- `play/indirect:vo_key_does_not_contain_cardId`: 10
- `attack/indirect:vo_key_does_not_contain_cardId`: 10
- `death/indirect:vo_key_does_not_contain_cardId`: 10
- `play/not_found:carddef_missing_play_prefab`: 1
- `attack/not_found:carddef_missing_attack_prefab`: 1
- `death/not_found:carddef_missing_death_prefab`: 1

## 样本明细

| CardID | 名称 | Play | Attack | Death |
|---|---|---|---|---|
| `DAL_565` | 传送门大恶魔 | matched / VO_DAL_565_Male_Doomguard_Play_01 | matched / VO_DAL_565_Male_Doomguard_Attack_01 | matched / VO_DAL_565_Male_Doomguard_Death_01 |
| `OG_267` | 南海畸变船长 | matched / VO_OG_267_Female_Faceless_Play_01 | matched / VO_OG_267_Female_Faceless_Attack_01 | matched / VO_OG_267_Female_Faceless_Death_01 |
| `DMF_523` | 碰碰车 | matched / DMF_523_BumperCar_Play | matched / DMF_523_BumperCar_Attack | matched / DMF_523_BumperCar_Death |
| `CORE_EX1_250` | 土元素 | indirect / EX1_250_Earth_Elemental_EnterPlay2 | indirect / EX1_250_Earth_Elemental_Attack3 | indirect / EX1_250_Earth_Elemental_Death2 |
| `SCH_147` | 骨网之卵 | matched / SCH_147_BonewebEgg_Play | matched / SCH_147_BonewebEgg_Attack | matched / SCH_147_BonewebEgg_Death |
| `TTN_859` | 命运切分者 | matched / VO_TTN_859_Female_IronDwarf_Play_01 | matched / VO_TTN_859_Female_IronDwarf_Attack_01 | matched / VO_TTN_859_Female_IronDwarf_Death_01 |
| `LEG_CS3_031` | 生命的缚誓者阿莱克丝塔萨 | indirect / VO_CS3_031_Female_Dragon_Play_01 | indirect / VO_CS3_031_Female_Dragon_Attack_01 | indirect / VO_CS3_031_Female_Dragon_Death_01 |
| `BT_737` | 玛维·影歌 | matched / VO_BT_737_Female_NightElf_Play_01 | matched / VO_BT_737_Female_NightElf_Attack_01 | matched / VO_BT_737_Female_NightElf_Death_01 |
| `TIME_858` | 时空构造体 | matched / VO_TIME_858_Male_Elemental_Play_01 | matched / VO_TIME_858_Male_Elemental_Attack_01 | matched / VO_TIME_858_Male_Elemental_Death_01 |
| `CS1_069` | 沼泽爬行者 | matched / SFX_CS1_069_EnterPlay | matched / SFX_CS1_069_Attack | matched / SFX_CS1_069_Death |
| `EDR_942` | 好奇的积云 | matched / VO_EDR_942_Female_Elemental_Play_01 | matched / VO_EDR_942_Female_Elemental_Attack_01 | matched / VO_EDR_942_Female_Elemental_Death_01 |
| `TSC_620` | 恶鞭海妖 | matched / VO_TSC_620_Female_Naga_Play_01 | matched / VO_TSC_620_Female_Naga_Attack_01 | matched / VO_TSC_620_Female_Naga_Death_01 |
| `TLC_225` | 烬鳍鱼人 | matched / VO_TLC_225_X_MurlocElemental_Play_01 | matched / VO_TLC_225_X_MurlocElemental_Attack_01 | matched / VO_TLC_225_X_MurlocElemental_Death_01 |
| `EDR_849` | 梦缚迅猛龙 | matched / EDR_849_DreamboundRaptor_Play | matched / EDR_849_DreamboundRaptor_Attack | matched / EDR_849_DreamboundRaptor_Death |
| `EDR_485` | 腐心树妖 | matched / VO_EDR_485_Female_Dryad_Play_01 | matched / VO_EDR_485_Female_Dryad_Attack_01 | matched / VO_EDR_485_Female_Dryad_Death_01 |
| `TSC_087` | 指挥官西瓦拉 | matched / VO_TSC_087_Female_NagaCentuar_Play_01 | matched / VO_TSC_087_Female_NagaCentuar_Attack_01 | matched / VO_TSC_087_Female_NagaCentuar_Death_01 |
| `SCH_613` | 园地管理员 | matched / VO_SCH_613_Female_Dryad_Play_01 | matched / VO_SCH_613_Female_Dryad_Attack_02 | matched / VO_SCH_613_Female_Dryad_Death_01 |
| `EX1_414` | 格罗玛什·地狱咆哮 | matched / VO_EX1_414_Play_01 | matched / VO_EX1_414_Attack_02 | matched / VO_EX1_414_Death_03 |
| `BOT_531` | 星界密使 | matched / VO_BOT_531_Male_Elemental_Play_01 | matched / VO_BOT_531_Male_Elemental_Attack_01 | matched / VO_BOT_531_Male_Elemental_Death_01 |
| `WON_302` | 泥潭守护者 | indirect / VO_OG_202_Male_Keeper_Play_01 | indirect / VO_OG_202_Male_Keeper_Attack_01 | indirect / VO_OG_202_Male_Keeper_Death_01 |
| `UNG_803` | 翡翠掠夺者 | matched / UNG_803_EmeraldReaver_Play | matched / UNG_803_EmeraldReaver_Attack | matched / UNG_803_EmeraldReaver_Death |
| `GVG_115` | 托什雷 | matched / VO_GVG_115_Play_01 | matched / VO_GVG_115_Attack_02 | matched / VO_GVG_115_Death_03 |
| `WW_426` | 矿工炎术师 | matched / VO_WW_426_BlastmageMiner_Goblin_Emote_Play_01 | matched / VO_WW_426_BlastmageMiner_Goblin_Emote_Attack_01 | matched / VO_WW_426_BlastmageMiner_Goblin_Emote_Death_01 |
| `AT_012` | 暗影子嗣 | matched / VO_AT_012_PLAY_01 | matched / VO_AT_012_ATTACK_02 | matched / VO_AT_012_DEATH_03 |
| `ONY_028` | 米达，纯净圣光 | matched / VO_ONY_028_Male_Naaru_Play_01 | matched / VO_ONY_028_Male_Naaru_Attack_01 | matched / VO_ONY_028_Male_Naaru_Death_01 |
| `VAN_NEW1_010` | 风领主奥拉基尔 | indirect / VO_NEW1_010_Play_01 | indirect / VO_NEW1_010_Attack_02 | indirect / VO_NEW1_010_Death_03 |
| `UNG_027` | 派烙斯 | matched / Pyros_UNG_027_Play | matched / Pyros_UNG_027_Attack | matched / Pyros_UNG_027_Death |
| `LOE_022` | 凶暴猿猴 | matched / SFX_LOE_022_Play | matched / SFX_LOE_022_Attack | matched / SFX_LOE_022_Death |
| `EDR_526` | 雷弗拉尔，恶念巨蛛 | not_found | not_found | not_found |
| `WW_326` | 矿车巡逻兵 | matched / VO_WW_326_MinecartManiac_Elemental_Emote_Play_01 | matched / VO_WW_326_MinecartManiac_Elemental_Emote_Attack_01 | matched / VO_WW_326_MinecartManiac_Elemental_Emote_Death_01 |
| `CFM_335` | 驮运科多兽 | indirect / CFM_ClumsyKodo_Play | indirect / CFM_ClumsyKodo_Attack | indirect / CFM_ClumsyKodo_Death |
| `EX1_559` | 大法师安东尼达斯 | matched / VO_EX1_559_Play_01 | matched / VO_EX1_559_Attack_03 | matched / VO_EX1_559_Death_04 |
| `EX1_046` | 黑铁矮人 | matched / VO_EX1_046_Play_01 | matched / VO_EX1_046_Attack_02 | matched / VO_EX1_046_Death_03 |
| `VAC_954` | 顶流主唱 | indirect / VO_VAC_301_Female_Naga_Play_01 | indirect / VO_VAC_301_Female_Naga_Attack_01 | indirect / VO_VAC_301_Female_Naga_Death_01 |
| `BOT_511` | 爆盐投弹手 | matched / VO_BOT_511_Female_Goblin_Play_01 | matched / VO_BOT_511_Female_Goblin_Attack_02 | matched / VO_BOT_511_Female_Goblin_Death_02 |
| `CATA_305` | 盛怒主母 | matched / CATA_305_IncensedMatriarch_Play | matched / CATA_305_IncensedMatriarch_Attack | matched / CATA_305_IncensedMatriarch_Death |
| `REV_000` | 可疑的炼金师 | matched / VO_REV_000_Female_Venthyr_Play_01 | matched / VO_REV_000_Female_Venthyr_Attack_01 | matched / VO_REV_000_Female_Venthyr_Death_01 |
| `CAP_107` | 火炮长 | indirect / VO_CAP_106t_Male_Draenei_Play_01 | indirect / VO_CAP_106t_Male_Draenei_Attack_01 | indirect / VO_CAP_106t_Male_Draenei_Death_01 |
| `AV_403` | 赛拉辛·疾行 | matched / VO_AV_403_Female_NightElf_Play_02 | matched / VO_AV_403_Female_NightElf_Attack_02 | matched / VO_AV_403_Female_NightElf_Death_01 |
| `SCH_142` | 贪婪的书虫 | matched / VO_SCH_142_Female_Gnome_Play_02 | matched / VO_SCH_142_Female_Gnome_Attack_01 | matched / VO_SCH_142_Female_Gnome_Death_01 |
| `ULD_236` | 始祖龟朝圣者 | matched / VO_ULD_236_Female_Tortollan_Play_01 | matched / VO_ULD_236_Female_Tortollan_Attack_03 | matched / VO_ULD_236_Female_Tortollan_Death_01 |
| `VAN_NEW1_024` | 绿皮船长 | indirect / VO_NEW1_024_Play_01 | indirect / VO_NEW1_024_Attack_02 | indirect / VO_NEW1_024_Death_03 |
| `NEW1_018` | 血帆袭击者 | matched / VO_NEW1_018_Play_01 | matched / VO_NEW1_018_Attack_02 | matched / VO_NEW1_018_Death_03 |
| `CAP_406` | 暗金教主谋 | matched / VO_CAP_406_Female_Arakkoa_Play_01 | matched / VO_CAP_406_Female_Arakkoa_Attack_01 | matched / VO_CAP_406_Female_Arakkoa_Death_01 |
| `WON_305` | 展览馆守卫 | indirect / VO_KAR_065_Female_NightElf_Play_01 | indirect / VO_KAR_065_Female_NightElf_Attack_01 | indirect / VO_KAR_065_Female_NightElf_Death_01 |
| `JAIL_321` | 机灵的即兴舞者 | matched / VO_JAIL_321_Male_Troll_Play_01 | matched / VO_JAIL_321_Male_Troll_Attack_01 | matched / VO_JAIL_321_Male_Troll_Death_01 |
| `CORE_DMF_067` | 奖品商贩 | indirect / VO_DMF_067_Male_Murloc_Play_01 | indirect / VO_DMF_067_Male_Murloc_Attack_02 | indirect / VO_DMF_067_Male_Murloc_Death_01 |
| `TIME_852` | 碧蓝女王辛达苟萨 | matched / VO_TIME_852_Female_Dragon_Play_01 | matched / VO_TIME_852_Female_Dragon_Attack_01 | matched / VO_TIME_852_Female_Dragon_Death_01 |
| `BOT_280` | 全息术士 | matched / VO_BOT_280_Male_VoidElf_Play_01 | matched / VO_BOT_280_Male_VoidElf_Attack_01 | matched / VO_BOT_280_Male_VoidElf_Death_02 |
| `RLK_592` | 无敌 | matched / RLK_592_Invincible_Play | matched / RLK_592_Invincible_Attack | matched / RLK_592_Invincible_Death |

## 判定规则

## 五个问题

1. **50 张卡中，有多少张能够自动找到 Play Voice？**  
   **39 / 50（78%）direct matched。** 另有 10 张沿同一条链路找到了语音，但 Voice Key 不含该 CardID（`indirect`）。合计 **49 / 50 能自动解析到 Play 音频名**。只有 1 张完全没有 Play SoundSpell。

2. **有多少张能够自动找到 Attack Voice？**  
   与 Play 相同：**39 matched + 10 indirect + 1 not_found**。这 50 张样本里三个槽位同成同败，没有“只有 Play 没有 Attack”的情况。

3. **有多少张能够自动找到 Death Voice？**  
   同样 **39 matched / 10 indirect / 1 not_found**。

4. **CardID → VoiceKey 的自动化方法是否可以扩展到几千甚至几万张卡？**  
   **可以扩展，但不该把 78% 直接当成最终成品率。**  
   - 链路是机械的：CardDef GameObject 名 = CardID → MonoBehaviour 里的 `Play/Attack/Death.prefab:GUID` → 该 GUID 在 sound prefab bundle 的 `AssetBundle.m_Container` → `preloadTable` 切片里的 `.wav` 名。  
   - 本次 50 张、279 个 CardDef + 2140 个 prefab/sound bundle，只解析命中 GUID 的 45 个 bundle，约 1.5 分钟，索引可复用。扩展到全量可收藏随从（本池 4333）是同一套扫描，不需要每张卡重扫 700+ audio bundle。  
   - **direct（Key 含 CardID）约 78%。** 若把 `CORE_` / `VAN_` / `LEG_` / `WON_` 重印视为“映射到原卡 VoiceKey”，可再抬升约 8–10 个百分点，但那是规则层，不是猜 VO 名。  
   - 剩余主要是：共享皮肤/衍生物语音、以及少数 CardDef 上根本没有 SoundSpell 的特殊随从。

5. **当前最大的失败类型是什么？**  
   **共享 / 重印 VoiceSet（`indirect`，10/50），不是解析器崩溃。**  
   细分：
   - **重印共用原卡语音（7）**：`CORE_EX1_250`→`EX1_250_*`，`CORE_DMF_067`→`VO_DMF_067_*`，`VAN_NEW1_010`→`VO_NEW1_010_*`，`VAN_NEW1_024`→`VO_NEW1_024_*`，`LEG_CS3_031`→`VO_CS3_031_*`，`WON_302`→`VO_OG_202_*`，`WON_305`→`VO_KAR_065_*`。
   - **相关卡 / 皮肤共享（3）**：`VAC_954`→`VO_VAC_301_*`，`CAP_107`→`VO_CAP_106t_*`，`CFM_335`→`CFM_ClumsyKodo_*`。
   - **CardDef 没有 Play/Attack/Death SoundSpell（1）**：`EDR_526` 雷弗拉尔。CardDef 能定位，字段里没有这三项 prefab（不是 GUID 解析失败）。
   - **解析器 error：0。** 找不到 CardDef：0。GUID 无法在 container 中解析：0。

## 语音形态

`matched` 里不全是 `VO_` 台词：

- **30 张**：标准 `VO_{CardID}_..._Play/Attack/Death`
- **9 张**：生物/机械音效，clip 名含 CardID 但无 `VO_` 前缀，例如 `DMF_523_BumperCar_Play`、`SFX_CS1_069_EnterPlay`、`RLK_592_Invincible_Play`。这些仍是 CardDef→SoundSpell 直连，不算猜测。

## 判定规则

链路：`CardDef`（GameObject 名精确等于 CardID）→ `Play/Attack/Death.prefab:GUID` → 目标 bundle 的 `AssetBundle.m_Container[GUID]` → `preloadTable[preloadIndex .. +preloadSize]` 对象上的 `VO_*` 或 `*.wav` clip 名。

- **matched**：preload 里出现音频名，且名称包含该 CardID。
- **indirect**：preload 里有音频名，但名称不含该 CardID（重印共享、皮肤共享、VoiceSet）。即使能看出是 `CORE_`→原卡，也不标成 matched。
- **not_found**：CardDef 没有对应 SoundSpell prefab，或 GUID 未进入 container，或 preload 范围内没有 clip 名。不根据 `VO_{CardID}_Play_01` 命名规则猜测。
- **error**：解析异常。本次为 0。

未导出任何 FSB/WAV。只读取 `C:\Hearthstone`，结果写在工作目录 `data/voice-verification/`。
