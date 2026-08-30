# Phase 0.7 Indirect Voice Mapping 报告

未导出音频。未修改 `C:\Hearthstone`。未做全量 35000 张卡。样本仍是 Phase 0.6 的 50 张（种子 20260828）。

## 结论摘要

| 分类 | 数量 |
|---|---:|
| direct | 40 |
| indirect_verified | 10 |
| unresolved | 0 |

映射类型：

- `own_clip`: 40
- `shared_resource`: 7
- `named_sfx`: 1
- `shared_audio`: 1
- `token_clip`: 1

## Phase 0.6 的 10 个 indirect + EDR_526

| CardID | 名称 | 0.6 | 0.7 | VoiceSource | mappingType | Play VoiceKey |
|---|---|---|---|---|---|---|
| `CORE_EX1_250` | 土元素 | indirect | **indirect_verified** | `EX1_250` | `shared_resource` | `EX1_250_Earth_Elemental_EnterPlay2` |
| `LEG_CS3_031` | 生命的缚誓者阿莱克丝塔萨 | indirect | **indirect_verified** | `CS3_031` | `shared_resource` | `VO_CS3_031_Female_Dragon_Play_01` |
| `WON_302` | 泥潭守护者 | indirect | **indirect_verified** | `OG_202` | `shared_resource` | `VO_OG_202_Male_Keeper_Play_01` |
| `VAN_NEW1_010` | 风领主奥拉基尔 | indirect | **indirect_verified** | `NEW1_010` | `shared_resource` | `VO_NEW1_010_Play_01` |
| `EDR_526` | 雷弗拉尔，恶念巨蛛 | not_found | **direct** | `EDR_526` | `own_clip` | `VO_EDR_526_Female_Spider_Play_01` |
| `CFM_335` | 驮运科多兽 | indirect | **indirect_verified** | `CFM_335` | `named_sfx` | `CFM_ClumsyKodo_Play` |
| `VAC_954` | 顶流主唱 | indirect | **indirect_verified** | `VAC_301` | `shared_audio` | `VO_VAC_301_Female_Naga_Play_01` |
| `CAP_107` | 火炮长 | indirect | **indirect_verified** | `CAP_106t` | `token_clip` | `VO_CAP_106t_Male_Draenei_Play_01` |
| `VAN_NEW1_024` | 绿皮船长 | indirect | **indirect_verified** | `NEW1_024` | `shared_resource` | `VO_NEW1_024_Play_01` |
| `WON_305` | 展览馆守卫 | indirect | **indirect_verified** | `KAR_065` | `shared_resource` | `VO_KAR_065_Female_NightElf_Play_01` |
| `CORE_DMF_067` | 奖品商贩 | indirect | **indirect_verified** | `DMF_067` | `shared_resource` | `VO_DMF_067_Male_Murloc_Play_01` |

## 每张卡的证据

### A. shared_resource（Play/Attack/Death prefab GUID 完全相同）

CardDef 是**不同文件里的不同 GameObject**，但 `Play.prefab` / `Attack.prefab` / `Death.prefab` 的 32 位 GUID 三元组相同。DBF 只有各自的卡牌文本，**没有** copy-of / voice-source 字段。

| CardID | VoiceSource | Play GUID | 0.6 VoiceKey |
|---|---|---|---|
| `CORE_EX1_250` | `EX1_250` | `87a1267891d8ee4418d0d539c873221e` | `EX1_250_Earth_Elemental_EnterPlay2` |
| `LEG_CS3_031` | `CS3_031` | `074296ca3b1b513499933b2cf4d5b5be` | `VO_CS3_031_Female_Dragon_Play_01` |
| `WON_302` | `OG_202` | `731b090123a634bdfad3f33babaca31c` | `VO_OG_202_Male_Keeper_Play_01` |
| `VAN_NEW1_010` | `NEW1_010` | `737152c48ecd04d4e9623fc141391554` | `VO_NEW1_010_Play_01` |
| `VAN_NEW1_024` | `NEW1_024` | `e53f09f1e3c2dca4e91ebf42b8eebea6` | `VO_NEW1_024_Play_01` |
| `WON_305` | `KAR_065` | `aa759ef140f0fbe4fac73e7a8df4c6bb` | `VO_KAR_065_Female_NightElf_Play_01` |
| `CORE_DMF_067` | `DMF_067` | `b9ab0fe4a5e5f7749a7b032fd6a0f592` | `VO_DMF_067_Male_Murloc_Play_01` |

VoiceSource 取自 **AudioClip 名里出现的 CardID**，再要求该 CardID 的 CardDef 拥有同一组 GUID。不是把 `VAN_` / `CORE_` 从当前 CardID 上剥掉。

例如 `VAN_NEW1_010` 的 clip 是 `VO_NEW1_010_Play_01`，且 `NEW1_010` 的 CardDef 使用 GUID `737152c48ecd04d4e9623fc141391554`（Play），与 VAN 卡相同。

### B. shared_audio（GUID 不同，clip 名指向另一张卡）

`VAC_954`（顶流主唱）与 `VAC_301`（炫目演出者）**互换了 clip 名**：

- VAC_954 CardDef Play GUID `ea0a75f3…` → `VO_VAC_301_Female_Naga_Play_01`
- VAC_301 CardDef Play GUID `55542a77…` → `VO_VAC_954_Male_Naga_Play_01`

两套 SoundSpell 资源不同（mappingType ≠ shared_resource），但各自的 AudioClip 名称写着对方的 CardID。

### C. token_clip（clip 名含不存在 CardDef 的实体 ID）

`CAP_107`（火炮长）Play GUID `628f6c80…` 解析为 `VO_CAP_106t_Male_Draenei_*`。

- `CAP_106`（克罗雷船长）有独立 SoundSpell，clip 为 `VO_CAP_106_Male_Worgen_*`，GUID **不相同**
- `CAP_106t`：**没有** CardDef GameObject，**没有** DBF 记录，**不在** cards.json
- DBF 里实际衍生物是 `CAP_107t`（回合结束打 1 伤害的 1/1 炮手）

因此 VoiceSource 记为 clip 里的 `CAP_106t`（资源字符串证据），并标明它不是活的 CardDef。不能据此认为 CAP_107 复用了 CAP_106 的 SoundSpell。

### D. named_sfx（本卡独有 clip，名称不含 CardID）

`CFM_335` 驮运科多兽使用 `CFM_ClumsyKodo_Play/Attack/Death`。Play GUID `c8bdcb02…` 只出现在 `CFM_335` 与衍生物 `BAR_034t5`（驯服的雷霆蜥蜴）的 CardDef 上，没有第二张可收藏卡共享。这是风味命名，不是重印。

### E. EDR_526（Phase 0.6 not_found）

**不是没语音。** CardDef GameObject 有 3 个组件：Transform、真正的 CardDef MonoBehaviour（1432 字节，含 Play/Attack/Death）、以及一个空的 48 字节 MonoBehaviour。Phase 0.6 用最后一个 MB 覆盖了结果。

修正后：

- Play `8f27a9b3…` → `VO_EDR_526_Female_Spider_Play_01`
- Attack `9e7a5dd4…` → `VO_EDR_526_Female_Spider_Attack_01`
- Death `4e6e1193…` → `VO_EDR_526_Female_Spider_Death_01`

另有 `EDRFX_RenferalTheMalignant_CustomSummon` 与 Stinger，但不替代 SoundSpell。DBF 只有战吼文本（困住对手手牌），无“无语音”标记。

**0.7 分类：`direct` / `own_clip`。**

## 哪些规则可以自动化

已实现于 `src/rules/voiceMappingRules.js`：

1. **own_clip**：三个 clip 名都包含当前 CardID → `direct`
2. **shared_resource**：另一张卡的 CardDef 有完全相同的 Play+Attack+Death GUID，且 clip 名含那张卡的 ID → `indirect_verified`
3. **shared_audio**：GUID 不同，但 clip 名含另一张**有 CardDef** 的 CardID → `indirect_verified`
4. **token_clip**：clip 名含已知/登记的实体 ID，但该 ID 没有 CardDef → `indirect_verified`
5. **named_sfx**：有 clip、名称不含任何已知 CardID → `indirect_verified`（源仍是自己）
6. **no_soundspell**：CardDef 上三个槽都空 → `unresolved`

**禁止的规则：** 把 `VAN_` / `CORE_` / `LEG_` / `WON_` 从 CardID 字符串删掉。没有 GUID 或 clip 证据时不得当重印处理。

## 仍需人工 / 特殊处理

- `CAP_106t` 这种设计时 ID 与上线 DBF ID（`CAP_107t`）不一致
- `VAC_954`/`VAC_301` 交叉命名，全量索引应双向记录
- 风味 SFX 名（`CFM_ClumsyKodo`）无法对应第二张可收藏卡
- CardDef 多 MonoBehaviour 必须合并，不能只读最后一个

## 78% 能提升到多少

同一 50 张样本：

- Phase 0.6 **direct（clip 含 CardID）**：39/50 = 78%
- 修正 EDR_526 后 **own_clip direct**：40/50 = **80%**
- **indirect_verified**（资源关系明确）：10/50 = 20%
- **unresolved**：0/50
- **能自动给出 VoiceKey**（含 indirect）：50/50 = 100%

其中 7/10 的 indirect 是 GUID 级共享，可稳定自动化。若业务层把 `indirect_verified + shared_resource` 算作“已解析映射”，覆盖率为 **47/50 = 94%** 的“标准 CardID→VoiceSource→VoiceKey”，外加 3 张特殊（交叉 clip / token 名 / 风味 SFX）。

## 是否建议进入 Phase 0.8 全量索引

**建议进入**，前提：

1. CardDef 提取合并全部 MonoBehaviour（已在 `src/extractCardDefSounds.js`）
2. 全量建立 CardID → Play/Attack/Death GUID 表，用 GUID 三元组做共享检测（不要前缀剥皮）
3. clip 名解析 CardID 时用已知 ID 集合（cards.json + CardDef 名），长 ID 优先
4. 仍只读游戏目录，索引写在工作区

## 五个问题（完成条件）

1. **10 个 indirect 中 10 个都能被资源关系解释**（7 shared_resource，1 shared_audio，1 token_clip，1 named_sfx）。
2. **重印卡可以自动识别**，依据是 **相同 SoundSpell GUID 三元组**，不是改名字。
3. **CORE / VAN / LEG / WON 在本样本中全部是 shared_resource**；WON 对的是更早的原卡（OG_202、KAR_065），不是去掉 `WON_` 后的残串。
4. **VAC / CAP 可以自动识别，但不能当成重印：** VAC 是交叉 clip 名；CAP 是 clip 写了不存在的 `CAP_106t`。
5. **EDR_526 有 SoundSpell**；0.6 漏检是解析器取了空 MB。
6. **可以建立统一的 CardID → VoiceSourceCardID → VoiceKey 层**（本仓库 `classifyVoiceMapping`）。
7. **若处理 1000 张可收藏随从（按本样本比例外推，非承诺）：** direct ≈ 800；indirect_verified ≈ 200（其中大部分为 GUID 共享重印）；unresolved ≈ 0–20。实际取决于 CORE/VAN 重印占比。
8. **具备进入 Phase 0.8 的条件**（解析链 + 共享 GUID 规则 + 样本 0 unresolved）。
