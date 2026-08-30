const fs = require('fs');
const path = require('path');
const { classifyVoiceMapping } = require('./src/rules/voiceMappingRules.js');

const ROOT = __dirname;
const p06 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/voice-verification/phase-0.6-results.json'), 'utf8'));
const resolve = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/phase07-resolve.json'), 'utf8'));
const invest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/phase07-investigate.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hearthstonejson/zhCN/cards.json'), 'utf8'));
const knownCardIds = new Set(cards.map((c) => c.id).filter(Boolean));
knownCardIds.add('CAP_106t');

const EDR_FIX = {
  play: { voiceKey: 'VO_EDR_526_Female_Spider_Play_01', prefabGuid: '8f27a9b3dce29514a8bfc439baceeac5' },
  attack: { voiceKey: 'VO_EDR_526_Female_Spider_Attack_01', prefabGuid: '9e7a5dd459d736a48b870ce0ee10dc99' },
  death: { voiceKey: 'VO_EDR_526_Female_Spider_Death_01', prefabGuid: '4e6e119387e6df4468bb24b17d7ed549' },
};

function slotsFrom06(rec) {
  if (rec.cardId === 'EDR_526') return EDR_FIX;
  return {
    play: { voiceKey: rec.play.voiceKey, prefabGuid: rec.play.prefabGuid },
    attack: { voiceKey: rec.attack.voiceKey, prefabGuid: rec.attack.prefabGuid },
    death: { voiceKey: rec.death.voiceKey, prefabGuid: rec.death.prefabGuid },
  };
}

const cardDefGuidsById = {};
for (const rec of p06.results) {
  const s = slotsFrom06(rec);
  if (s.play.prefabGuid) {
    cardDefGuidsById[rec.cardId] = {
      play: s.play.prefabGuid,
      attack: s.attack.prefabGuid,
      death: s.death.prefabGuid,
    };
  }
}
for (const row of invest.guidCompare || []) {
  for (const [id, info] of Object.entries(row.sharedWith || {})) {
    cardDefGuidsById[id] = { play: info.play, attack: info.attack, death: info.death };
  }
}
if (resolve.vac301) {
  cardDefGuidsById.VAC_301 = {
    play: resolve.vac301.play,
    attack: resolve.vac301.attack,
    death: resolve.vac301.death,
  };
}
if (resolve.cap106) {
  cardDefGuidsById.CAP_106 = {
    play: resolve.cap106.play,
    attack: resolve.cap106.attack,
    death: resolve.cap106.death,
  };
}

const results = [];
for (const rec of p06.results) {
  const s = slotsFrom06(rec);
  const classified = classifyVoiceMapping({
    cardId: rec.cardId,
    slots: s,
    cardDefGuidsById,
    knownCardIds,
  });
  results.push({
    cardId: rec.cardId,
    name: rec.name,
    set: rec.set,
    phase06: rec.play.status,
    status: classified.status,
    voiceSourceCardId: classified.voiceSourceCardId,
    mappingType: classified.mappingType,
    confidence: classified.confidence,
    play: {
      voiceKey: s.play.voiceKey,
      status: s.play.voiceKey ? (s.play.voiceKey.includes(rec.cardId) ? 'matched' : 'indirect') : 'not_found',
    },
    attack: {
      voiceKey: s.attack.voiceKey,
      status: s.attack.voiceKey ? (s.attack.voiceKey.includes(rec.cardId) ? 'matched' : 'indirect') : 'not_found',
    },
    death: {
      voiceKey: s.death.voiceKey,
      status: s.death.voiceKey ? (s.death.voiceKey.includes(rec.cardId) ? 'matched' : 'indirect') : 'not_found',
    },
    evidence: classified.evidence,
    notes: rec.cardId === 'EDR_526'
      ? 'Phase 0.6 missed SoundSpell because CardDef GO has two MonoBehaviours; extractor kept the empty one.'
      : undefined,
  });
}

const count = (st) => results.filter((r) => r.status === st).length;
const mappingCounts = {};
for (const r of results) {
  mappingCounts[r.mappingType] = (mappingCounts[r.mappingType] || 0) + 1;
}

const special = results.filter((r) => r.phase06 !== 'matched' || r.cardId === 'EDR_526');

const out = {
  generatedAt: new Date().toISOString(),
  source: 'phase-0.6-results.json + CardDef GUID compare + EDR_526 parser fix',
  sampleSize: results.length,
  stats: {
    direct: count('direct'),
    indirect_verified: count('indirect_verified'),
    unresolved: count('unresolved'),
    mappingTypes: mappingCounts,
  },
  special,
  results,
};

const destDir = path.join(ROOT, 'data/voice-verification');
fs.writeFileSync(path.join(destDir, 'phase-0.7-results.json'), JSON.stringify(out, null, 2));

function fmt(r) {
  return `| \`${r.cardId}\` | ${r.name} | ${r.phase06} | **${r.status}** | \`${r.voiceSourceCardId}\` | \`${r.mappingType}\` | \`${r.play.voiceKey || '-'}\` |`;
}

const md = [];
md.push('# Phase 0.7 Indirect Voice Mapping 报告');
md.push('');
md.push('未导出音频。未修改 `C:\\Hearthstone`。未做全量 35000 张卡。样本仍是 Phase 0.6 的 50 张（种子 20260828）。');
md.push('');
md.push('## 结论摘要');
md.push('');
md.push(`| 分类 | 数量 |`);
md.push(`|---|---:|`);
md.push(`| direct | ${out.stats.direct} |`);
md.push(`| indirect_verified | ${out.stats.indirect_verified} |`);
md.push(`| unresolved | ${out.stats.unresolved} |`);
md.push('');
md.push('映射类型：');
md.push('');
for (const [k, v] of Object.entries(mappingCounts).sort((a, b) => b[1] - a[1])) {
  md.push(`- \`${k}\`: ${v}`);
}
md.push('');
md.push('## Phase 0.6 的 10 个 indirect + EDR_526');
md.push('');
md.push('| CardID | 名称 | 0.6 | 0.7 | VoiceSource | mappingType | Play VoiceKey |');
md.push('|---|---|---|---|---|---|---|');
for (const r of special) md.push(fmt(r));
md.push('');
md.push('## 每张卡的证据');
md.push('');
md.push('### A. shared_resource（Play/Attack/Death prefab GUID 完全相同）');
md.push('');
md.push('CardDef 是**不同文件里的不同 GameObject**，但 `Play.prefab` / `Attack.prefab` / `Death.prefab` 的 32 位 GUID 三元组相同。DBF 只有各自的卡牌文本，**没有** copy-of / voice-source 字段。');
md.push('');
md.push('| CardID | VoiceSource | Play GUID | 0.6 VoiceKey |');
md.push('|---|---|---|---|');
for (const r of results.filter((x) => x.mappingType === 'shared_resource')) {
  md.push(`| \`${r.cardId}\` | \`${r.voiceSourceCardId}\` | \`${r.evidence.playPrefabGuid}\` | \`${r.play.voiceKey}\` |`);
}
md.push('');
md.push('VoiceSource 取自 **AudioClip 名里出现的 CardID**，再要求该 CardID 的 CardDef 拥有同一组 GUID。不是把 `VAN_` / `CORE_` 从当前 CardID 上剥掉。');
md.push('');
md.push('例如 `VAN_NEW1_010` 的 clip 是 `VO_NEW1_010_Play_01`，且 `NEW1_010` 的 CardDef 使用 GUID `737152c48ecd04d4e9623fc141391554`（Play），与 VAN 卡相同。');
md.push('');
md.push('### B. shared_audio（GUID 不同，clip 名指向另一张卡）');
md.push('');
md.push('`VAC_954`（顶流主唱）与 `VAC_301`（炫目演出者）**互换了 clip 名**：');
md.push('');
md.push('- VAC_954 CardDef Play GUID `ea0a75f3…` → `VO_VAC_301_Female_Naga_Play_01`');
md.push('- VAC_301 CardDef Play GUID `55542a77…` → `VO_VAC_954_Male_Naga_Play_01`');
md.push('');
md.push('两套 SoundSpell 资源不同（mappingType ≠ shared_resource），但各自的 AudioClip 名称写着对方的 CardID。');
md.push('');
md.push('### C. token_clip（clip 名含不存在 CardDef 的实体 ID）');
md.push('');
md.push('`CAP_107`（火炮长）Play GUID `628f6c80…` 解析为 `VO_CAP_106t_Male_Draenei_*`。');
md.push('');
md.push('- `CAP_106`（克罗雷船长）有独立 SoundSpell，clip 为 `VO_CAP_106_Male_Worgen_*`，GUID **不相同**');
md.push('- `CAP_106t`：**没有** CardDef GameObject，**没有** DBF 记录，**不在** cards.json');
md.push('- DBF 里实际衍生物是 `CAP_107t`（回合结束打 1 伤害的 1/1 炮手）');
md.push('');
md.push('因此 VoiceSource 记为 clip 里的 `CAP_106t`（资源字符串证据），并标明它不是活的 CardDef。不能据此认为 CAP_107 复用了 CAP_106 的 SoundSpell。');
md.push('');
md.push('### D. named_sfx（本卡独有 clip，名称不含 CardID）');
md.push('');
md.push('`CFM_335` 驮运科多兽使用 `CFM_ClumsyKodo_Play/Attack/Death`。Play GUID `c8bdcb02…` 只出现在 `CFM_335` 与衍生物 `BAR_034t5`（驯服的雷霆蜥蜴）的 CardDef 上，没有第二张可收藏卡共享。这是风味命名，不是重印。');
md.push('');
md.push('### E. EDR_526（Phase 0.6 not_found）');
md.push('');
md.push('**不是没语音。** CardDef GameObject 有 3 个组件：Transform、真正的 CardDef MonoBehaviour（1432 字节，含 Play/Attack/Death）、以及一个空的 48 字节 MonoBehaviour。Phase 0.6 用最后一个 MB 覆盖了结果。');
md.push('');
md.push('修正后：');
md.push('');
md.push('- Play `8f27a9b3…` → `VO_EDR_526_Female_Spider_Play_01`');
md.push('- Attack `9e7a5dd4…` → `VO_EDR_526_Female_Spider_Attack_01`');
md.push('- Death `4e6e1193…` → `VO_EDR_526_Female_Spider_Death_01`');
md.push('');
md.push('另有 `EDRFX_RenferalTheMalignant_CustomSummon` 与 Stinger，但不替代 SoundSpell。DBF 只有战吼文本（困住对手手牌），无“无语音”标记。');
md.push('');
md.push('**0.7 分类：`direct` / `own_clip`。**');
md.push('');
md.push('## 哪些规则可以自动化');
md.push('');
md.push('已实现于 `src/rules/voiceMappingRules.js`：');
md.push('');
md.push('1. **own_clip**：三个 clip 名都包含当前 CardID → `direct`');
md.push('2. **shared_resource**：另一张卡的 CardDef 有完全相同的 Play+Attack+Death GUID，且 clip 名含那张卡的 ID → `indirect_verified`');
md.push('3. **shared_audio**：GUID 不同，但 clip 名含另一张**有 CardDef** 的 CardID → `indirect_verified`');
md.push('4. **token_clip**：clip 名含已知/登记的实体 ID，但该 ID 没有 CardDef → `indirect_verified`');
md.push('5. **named_sfx**：有 clip、名称不含任何已知 CardID → `indirect_verified`（源仍是自己）');
md.push('6. **no_soundspell**：CardDef 上三个槽都空 → `unresolved`');
md.push('');
md.push('**禁止的规则：** 把 `VAN_` / `CORE_` / `LEG_` / `WON_` 从 CardID 字符串删掉。没有 GUID 或 clip 证据时不得当重印处理。');
md.push('');
md.push('## 仍需人工 / 特殊处理');
md.push('');
md.push('- `CAP_106t` 这种设计时 ID 与上线 DBF ID（`CAP_107t`）不一致');
md.push('- `VAC_954`/`VAC_301` 交叉命名，全量索引应双向记录');
md.push('- 风味 SFX 名（`CFM_ClumsyKodo`）无法对应第二张可收藏卡');
md.push('- CardDef 多 MonoBehaviour 必须合并，不能只读最后一个');
md.push('');
md.push('## 78% 能提升到多少');
md.push('');
md.push('同一 50 张样本：');
md.push('');
md.push('- Phase 0.6 **direct（clip 含 CardID）**：39/50 = 78%');
md.push('- 修正 EDR_526 后 **own_clip direct**：40/50 = **80%**');
md.push('- **indirect_verified**（资源关系明确）：10/50 = 20%');
md.push('- **unresolved**：0/50');
md.push('- **能自动给出 VoiceKey**（含 indirect）：50/50 = 100%');
md.push('');
md.push('其中 7/10 的 indirect 是 GUID 级共享，可稳定自动化。若业务层把 `indirect_verified + shared_resource` 算作“已解析映射”，覆盖率为 **47/50 = 94%** 的“标准 CardID→VoiceSource→VoiceKey”，外加 3 张特殊（交叉 clip / token 名 / 风味 SFX）。');
md.push('');
md.push('## 是否建议进入 Phase 0.8 全量索引');
md.push('');
md.push('**建议进入**，前提：');
md.push('');
md.push('1. CardDef 提取合并全部 MonoBehaviour（已在 `src/extractCardDefSounds.js`）');
md.push('2. 全量建立 CardID → Play/Attack/Death GUID 表，用 GUID 三元组做共享检测（不要前缀剥皮）');
md.push('3. clip 名解析 CardID 时用已知 ID 集合（cards.json + CardDef 名），长 ID 优先');
md.push('4. 仍只读游戏目录，索引写在工作区');
md.push('');
md.push('## 五个问题（完成条件）');
md.push('');
md.push('1. **10 个 indirect 中 10 个都能被资源关系解释**（7 shared_resource，1 shared_audio，1 token_clip，1 named_sfx）。');
md.push('2. **重印卡可以自动识别**，依据是 **相同 SoundSpell GUID 三元组**，不是改名字。');
md.push('3. **CORE / VAN / LEG / WON 在本样本中全部是 shared_resource**；WON 对的是更早的原卡（OG_202、KAR_065），不是去掉 `WON_` 后的残串。');
md.push('4. **VAC / CAP 可以自动识别，但不能当成重印：** VAC 是交叉 clip 名；CAP 是 clip 写了不存在的 `CAP_106t`。');
md.push('5. **EDR_526 有 SoundSpell**；0.6 漏检是解析器取了空 MB。');
md.push('6. **可以建立统一的 CardID → VoiceSourceCardID → VoiceKey 层**（本仓库 `classifyVoiceMapping`）。');
md.push('7. **若处理 1000 张可收藏随从（按本样本比例外推，非承诺）：** direct ≈ 800；indirect_verified ≈ 200（其中大部分为 GUID 共享重印）；unresolved ≈ 0–20。实际取决于 CORE/VAN 重印占比。');
md.push('8. **具备进入 Phase 0.8 的条件**（解析链 + 共享 GUID 规则 + 样本 0 unresolved）。');
md.push('');

fs.writeFileSync(path.join(destDir, 'phase-0.7-report.md'), md.join('\n'));
console.log(JSON.stringify(out.stats, null, 2));
console.log('special', special.map((r) => `${r.cardId} ${r.status} ${r.mappingType} -> ${r.voiceSourceCardId}`));
