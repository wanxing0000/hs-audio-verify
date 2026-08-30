const assert = require('assert');
const known = new Set([
  'EX1_116', 'VAN_NEW1_010', 'NEW1_010', 'CORE_DMF_067', 'DMF_067',
  'VAC_954', 'VAC_301', 'CAP_107', 'CAP_106', 'CAP_106t', 'EDR_526',
  'EX1_250', 'CORE_EX1_250', 'CFM_335', 'BAR_034t5',
  'WON_302', 'OG_202', 'CS3_031', 'LEG_CS3_031',
]);
const { extractSoundsFromComponents } = require('../src/extractCardDefSounds.js');

const {
  cardIdsInVoiceKey,
  classifyVoiceMapping,
  classifySlot,
} = require('../src/rules/voiceMappingRules.js');

function slots(playKey, playGuid, attackKey, attackGuid, deathKey, deathGuid) {
  return {
    play: { voiceKey: playKey, prefabGuid: playGuid },
    attack: { voiceKey: attackKey, prefabGuid: attackGuid },
    death: { voiceKey: deathKey, prefabGuid: deathGuid },
  };
}

// --- voice key parsing (resource strings, not CardID prefix stripping) ---
assert.deepStrictEqual(
  cardIdsInVoiceKey('VO_NEW1_010_Play_01', known),
  ['NEW1_010'],
);
assert.deepStrictEqual(
  cardIdsInVoiceKey('VO_DMF_067_Male_Murloc_Play_01', known),
  ['DMF_067'],
);
assert.deepStrictEqual(
  cardIdsInVoiceKey('VO_VAC_301_Female_Naga_Play_01', known),
  ['VAC_301'],
);
assert.deepStrictEqual(
  cardIdsInVoiceKey('VO_CAP_106t_Male_Draenei_Play_01', known),
  ['CAP_106t'],
);
assert.deepStrictEqual(
  cardIdsInVoiceKey('VO_EX1_116_Play_01', known),
  ['EX1_116'],
);
assert.deepStrictEqual(
  cardIdsInVoiceKey('CFM_ClumsyKodo_Play', known),
  [],
);

const G_NEW1 = {
  play: '737152c48ecd04d4e9623fc141391554',
  attack: '9efe27516d0f5f146860ef61119e32d3',
  death: '1872f97bc8ac5de4d8485d5387b6f569',
};
const G_DMF = {
  play: 'b9ab0fe4a5e5f7749a7b032fd6a0f592',
  attack: '776c223a77216bc4bbe9414bb9ea2299',
  death: '9e4ed0d344f3d7c4281ca4a2c23d25c5',
};
const G_VAC954 = {
  play: 'ea0a75f3b2de73c4688e099186460c84',
  attack: 'f5098f79da6cd9743a990edad26168d6',
  death: 'e36ad85ad621968459c993c5dc53fee9',
};
const G_VAC301 = {
  play: '55542a7738c558445888b02498a9ceb0',
  attack: '5840b9a6236bb2843bdfa4239228a39a',
  death: '7585095f0754da04f8b8c3f403ee6fcb',
};
const G_CAP107 = {
  play: '628f6c805fa8d4a47ada7e3c2b9371ba',
  attack: 'df1f4d0dbad8ed94a927d887bbf5de5d',
  death: 'bae920020d9a0fd43ac9872ce8859d18',
};
const G_EX1_116 = {
  play: 'abd4cfd794032624785f78a5de7da354',
  attack: '99e7209c52d3cee49ac49ba864faf78b',
  death: '3601ea7b697d3dc4891a30c665676139',
};
const G_EDR = {
  play: '8f27a9b3dce29514a8bfc439baceeac5',
  attack: '9e7a5dd459d736a48b870ce0ee10dc99',
  death: '4e6e119387e6df4468bb24b17d7ed549',
};
const G_OG202 = {
  play: '731b090123a634bdfad3f33babaca31c',
  attack: '35ebcf04bf25f4347be64d3f3d479b22',
  death: '9497d63310b4b4e018f8186f1975b43b',
};
const G_EX1_250 = {
  play: '87a1267891d8ee4418d0d539c873221e',
  attack: '84de11879c3d4674e88632f22282d9a0',
  death: '4f4bfb54d7bc37c40ba016079a82ebf1',
};
const G_CFM = {
  play: 'c8bdcb02f5b00ad429f12d38d252c729',
  attack: 'd9bc9f64674fdb6488b82740cc0836f5',
  death: '8ef9f15cafd4f1c47991804cf1b761dd',
};

const cardDefGuidsById = {
  NEW1_010: G_NEW1,
  VAN_NEW1_010: G_NEW1,
  DMF_067: G_DMF,
  CORE_DMF_067: G_DMF,
  VAC_954: G_VAC954,
  VAC_301: G_VAC301,
  CAP_107: G_CAP107,
  EX1_116: G_EX1_116,
  EDR_526: G_EDR,
  OG_202: G_OG202,
  WON_302: G_OG202,
  EX1_250: G_EX1_250,
  CORE_EX1_250: G_EX1_250,
  CFM_335: G_CFM,
};

function classify(cardId, s) {
  return classifyVoiceMapping({
    cardId,
    slots: s,
    cardDefGuidsById,
    knownCardIds: known,
  });
}

const ex1 = classify('EX1_116', slots(
  'VO_EX1_116_Play_01', G_EX1_116.play,
  'VO_EX1_116_Attack_02', G_EX1_116.attack,
  'VO_EX1_116_Death_03', G_EX1_116.death,
));
assert.strictEqual(ex1.status, 'direct');
assert.strictEqual(ex1.voiceSourceCardId, 'EX1_116');
assert.strictEqual(ex1.mappingType, 'own_clip');

const van = classify('VAN_NEW1_010', slots(
  'VO_NEW1_010_Play_01', G_NEW1.play,
  'VO_NEW1_010_Attack_02', G_NEW1.attack,
  'VO_NEW1_010_Death_03', G_NEW1.death,
));
assert.strictEqual(van.status, 'indirect_verified');
assert.strictEqual(van.voiceSourceCardId, 'NEW1_010');
assert.strictEqual(van.mappingType, 'shared_resource');
assert.ok(van.evidence.sharedGuidCardIds.includes('NEW1_010'));

const core = classify('CORE_DMF_067', slots(
  'VO_DMF_067_Male_Murloc_Play_01', G_DMF.play,
  'VO_DMF_067_Male_Murloc_Attack_02', G_DMF.attack,
  'VO_DMF_067_Male_Murloc_Death_01', G_DMF.death,
));
assert.strictEqual(core.status, 'indirect_verified');
assert.strictEqual(core.voiceSourceCardId, 'DMF_067');
assert.strictEqual(core.mappingType, 'shared_resource');

const vac = classify('VAC_954', slots(
  'VO_VAC_301_Female_Naga_Play_01', G_VAC954.play,
  'VO_VAC_301_Female_Naga_Attack_01', G_VAC954.attack,
  'VO_VAC_301_Female_Naga_Death_01', G_VAC954.death,
));
assert.strictEqual(vac.status, 'indirect_verified');
assert.strictEqual(vac.voiceSourceCardId, 'VAC_301');
assert.strictEqual(vac.mappingType, 'shared_audio');
assert.notStrictEqual(G_VAC954.play, G_VAC301.play);

const cap = classify('CAP_107', slots(
  'VO_CAP_106t_Male_Draenei_Play_01', G_CAP107.play,
  'VO_CAP_106t_Male_Draenei_Attack_01', G_CAP107.attack,
  'VO_CAP_106t_Male_Draenei_Death_01', G_CAP107.death,
));
assert.strictEqual(cap.status, 'indirect_verified');
assert.strictEqual(cap.voiceSourceCardId, 'CAP_106t');
assert.strictEqual(cap.mappingType, 'token_clip');

const edr = classify('EDR_526', slots(
  'VO_EDR_526_Female_Spider_Play_01', G_EDR.play,
  'VO_EDR_526_Female_Spider_Attack_01', G_EDR.attack,
  'VO_EDR_526_Female_Spider_Death_01', G_EDR.death,
));
assert.strictEqual(edr.status, 'direct');
assert.strictEqual(edr.voiceSourceCardId, 'EDR_526');
assert.strictEqual(edr.mappingType, 'own_clip');

const emptyEdr = classify('EDR_526', slots(null, null, null, null, null, null));
assert.strictEqual(emptyEdr.status, 'unresolved');
assert.strictEqual(emptyEdr.mappingType, 'no_soundspell');

// Prefix stripping must NOT be used: VAN_NEW1_010 with unique GUIDs and
// clips that do not mention NEW1_010 would not become a reprint.
const fakeVan = classify('VAN_NEW1_010', slots(
  'VO_VAN_NEW1_010_Play_01', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'VO_VAN_NEW1_010_Attack_01', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'VO_VAN_NEW1_010_Death_01', 'cccccccccccccccccccccccccccccccc',
));
assert.strictEqual(fakeVan.status, 'direct');
assert.strictEqual(fakeVan.voiceSourceCardId, 'VAN_NEW1_010');

// CardDef extractor must keep Play from the large MB when a tiny MB follows.
const playBody = Buffer.from('Play.prefab:8f27a9b3dce29514a8bfc439baceeac5 Attack.prefab:9e7a5dd459d736a48b870ce0ee10dc99 Death.prefab:4e6e119387e6df4468bb24b17d7ed549');
const tinyBody = Buffer.from('pLQ');
const merged = extractSoundsFromComponents([playBody, tinyBody]);
assert.strictEqual(merged.play, '8f27a9b3dce29514a8bfc439baceeac5');
assert.strictEqual(merged.attack, '9e7a5dd459d736a48b870ce0ee10dc99');
assert.strictEqual(merged.death, '4e6e119387e6df4468bb24b17d7ed549');
const lastOnly = extractSoundsFromComponents([tinyBody]);
assert.strictEqual(lastOnly.play, null);

const won = classify('WON_302', slots(
  'VO_OG_202_Male_Keeper_Play_01', G_OG202.play,
  'VO_OG_202_Male_Keeper_Attack_01', G_OG202.attack,
  'VO_OG_202_Male_Keeper_Death_01', G_OG202.death,
));
assert.strictEqual(won.status, 'indirect_verified');
assert.strictEqual(won.voiceSourceCardId, 'OG_202');
assert.strictEqual(won.mappingType, 'shared_resource');

const coreEx = classify('CORE_EX1_250', slots(
  'EX1_250_Earth_Elemental_EnterPlay2', G_EX1_250.play,
  'EX1_250_Earth_Elemental_Attack3', G_EX1_250.attack,
  'EX1_250_Earth_Elemental_Death2', G_EX1_250.death,
));
assert.strictEqual(coreEx.mappingType, 'shared_resource');
assert.strictEqual(coreEx.voiceSourceCardId, 'EX1_250');

const cfm = classify('CFM_335', slots(
  'CFM_ClumsyKodo_Play', G_CFM.play,
  'CFM_ClumsyKodo_Attack', G_CFM.attack,
  'CFM_ClumsyKodo_Death', G_CFM.death,
));
assert.strictEqual(cfm.mappingType, 'named_sfx');
assert.strictEqual(cfm.voiceSourceCardId, 'CFM_335');

const guidOwners = new Map([
  [G_NEW1.play, new Set(['NEW1_010', 'VAN_NEW1_010'])],
  [G_VAC954.play, new Set(['VAC_954'])],
  [G_CAP107.play, new Set(['CAP_107'])],
  [G_CFM.play, new Set(['CFM_335', 'BAR_034t5'])],
]);
const cardDefIds = new Set(['NEW1_010', 'VAN_NEW1_010', 'VAC_954', 'VAC_301', 'CAP_107', 'CFM_335', 'BAR_034t5']);

assert.strictEqual(classifySlot({
  cardId: 'VAN_NEW1_010',
  voiceKey: 'VO_NEW1_010_Play_01',
  prefabGuid: G_NEW1.play,
  guidOwners,
  cardDefIds,
  knownCardIds: known,
}).mappingType, 'shared_resource');

assert.strictEqual(classifySlot({
  cardId: 'VAC_954',
  voiceKey: 'VO_VAC_301_Female_Naga_Play_01',
  prefabGuid: G_VAC954.play,
  guidOwners,
  cardDefIds,
  knownCardIds: known,
}).mappingType, 'shared_audio');

assert.strictEqual(classifySlot({
  cardId: 'CAP_107',
  voiceKey: 'VO_CAP_106t_Male_Draenei_Play_01',
  prefabGuid: G_CAP107.play,
  guidOwners,
  cardDefIds,
  knownCardIds: known,
}).mappingType, 'token_clip');

assert.strictEqual(classifySlot({
  cardId: 'CFM_335',
  voiceKey: 'CFM_ClumsyKodo_Play',
  prefabGuid: G_CFM.play,
  guidOwners,
  cardDefIds,
  knownCardIds: known,
}).mappingType, 'named_sfx');

assert.strictEqual(classifySlot({
  cardId: 'SPELL_1',
  voiceKey: null,
  prefabGuid: null,
  guidOwners,
  cardDefIds,
  knownCardIds: known,
}).status, 'no_voice');

console.log('ok', {
  EX1_116: ex1.status,
  VAN_NEW1_010: `${van.status} -> ${van.voiceSourceCardId}`,
  CORE_DMF_067: `${core.status} -> ${core.voiceSourceCardId}`,
  VAC_954: `${vac.status} -> ${vac.voiceSourceCardId}`,
  CAP_107: `${cap.status} -> ${cap.voiceSourceCardId}`,
  EDR_526: edr.status,
});
