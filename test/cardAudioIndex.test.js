const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { unifyVoiceSlot, pickCanonicalCardId, guessClipFromCardId } = require('../src/music/musicStingerRules.js');
const { validateCardAudioIndex } = require('../src/validation/validateCardAudioIndex.js');

const ROOT = path.resolve(__dirname, '..');
const unifiedPath = path.join(ROOT, 'data', 'index', 'card-audio-index.json');
const musicPath = path.join(ROOT, 'data', 'index', 'music-index.json');
const assetsPath = path.join(ROOT, 'data', 'index', 'music-assets.json');

assert.throws(() => guessClipFromCardId('EX1_116'), /CardID/);

const shared = unifyVoiceSlot('VAN_NEW1_010', {
  status: 'matched',
  mappingType: 'shared_resource',
  voiceKey: 'VO_NEW1_010_Play_01',
  voiceSourceCardId: 'NEW1_010',
});
assert.strictEqual(shared.status, 'shared');
assert.strictEqual(shared.sourceCardId, 'NEW1_010');

const token = unifyVoiceSlot('CAP_107', {
  status: 'matched',
  mappingType: 'token_clip',
  voiceKey: 'VO_CAP_106t_Male_Draenei_Play_01',
  voiceSourceCardId: 'CAP_106t',
});
assert.strictEqual(token.status, 'shared');
assert.ok(!String(token.voiceKey).includes('CAP_107'));

const named = unifyVoiceSlot('CFM_335', {
  status: 'matched',
  mappingType: 'named_sfx',
  voiceKey: 'CFM_ClumsyKodo_Play',
  voiceSourceCardId: 'CFM_335',
});
assert.strictEqual(named.status, 'available');

function assertSharedPair(idA, idB) {
  const a = unified.cards[idA];
  const b = unified.cards[idB];
  assert.ok(a, idA + ' missing');
  assert.ok(b, idB + ' missing');
  const aHas = a.music.status === 'available' || a.music.status === 'shared';
  const bHas = b.music.status === 'available' || b.music.status === 'shared';
  if (aHas && bHas) {
    assert.strictEqual(a.music.musicAssetId, b.music.musicAssetId, idA + '/' + idB + ' music asset mismatch');
    assert.strictEqual(a.music.sourceCardId, b.music.sourceCardId, idA + '/' + idB + ' music source mismatch');
  }
}

const canon = pickCanonicalCardId(['CORE_EX1_116', 'VAN_EX1_116', 'EX1_116'], new Map([
  ['EX1_116', { collectible: true, dbfId: 559 }],
  ['CORE_EX1_116', { collectible: true, dbfId: 111462 }],
  ['VAN_EX1_116', { collectible: true, dbfId: 69852 }],
]));
assert.strictEqual(canon, 'EX1_116');

if (!fs.existsSync(unifiedPath) || !fs.existsSync(musicPath) || !fs.existsSync(assetsPath)) {
  console.log('ok cardAudioIndex (unit only; run npm run index:audio to build files)');
  process.exit(0);
}

const unified = JSON.parse(fs.readFileSync(unifiedPath, 'utf8'));
const musicIndex = JSON.parse(fs.readFileSync(musicPath, 'utf8'));
const musicAssets = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), 'utf8'));

const validated = validateCardAudioIndex({
  unified,
  musicIndex,
  musicAssets,
  cards,
  clientVersion: '36.4.0.250339',
});
assert.ok(validated.ok, validated.errors.slice(0, 8).join('; '));

const leeroy = unified.cards.EX1_116;
assert.ok(leeroy);
assert.strictEqual(leeroy.name, '火车王里诺艾');
assert.strictEqual(leeroy.voice.play.status, 'available');
assert.strictEqual(leeroy.voice.attack.status, 'available');
assert.strictEqual(leeroy.voice.death.status, 'available');
assert.ok(leeroy.voice.play.voiceKey);
assert.ok(leeroy.music.status === 'available' || leeroy.music.status === 'shared');
assert.ok(leeroy.music.musicAssetId);
assert.strictEqual(leeroy.entrancePreview.available, true);
assert.strictEqual(leeroy.music.audioClipName, 'Pegasus_Stinger_Leeroy_Jenkins');

const core = unified.cards.CORE_EX1_116;
assert.ok(core);
assert.strictEqual(core.voice.play.status, 'shared');
assert.strictEqual(core.voice.play.sourceCardId, 'EX1_116');
assert.strictEqual(core.music.status, 'shared');
assert.strictEqual(core.music.sourceCardId, 'EX1_116');
assert.strictEqual(core.music.musicAssetId, leeroy.music.musicAssetId);
assert.strictEqual(musicAssets.assets[core.music.musicAssetId].prefabGuid, leeroy.music.musicAssetId);

const vanLeeroy = unified.cards.VAN_EX1_116;
assert.ok(vanLeeroy);
assert.strictEqual(vanLeeroy.music.status, 'shared');
assert.strictEqual(vanLeeroy.music.sourceCardId, 'EX1_116');
assert.strictEqual(vanLeeroy.music.musicAssetId, leeroy.music.musicAssetId);

const van = unified.cards.VAN_NEW1_010;
assert.ok(van);
assert.strictEqual(van.voice.play.status, 'shared');
assert.strictEqual(van.voice.play.sourceCardId, 'NEW1_010');

assertSharedPair('EX1_116', 'CORE_EX1_116');
assertSharedPair('EX1_116', 'VAN_EX1_116');
assertSharedPair('NEW1_010', 'VAN_NEW1_010');
assertSharedPair('DMF_067', 'CORE_DMF_067');
assertSharedPair('OG_202', 'WON_302');
assertSharedPair('KAR_065', 'WON_305');
assertSharedPair('VAC_301', 'VAC_954');

const vac = unified.cards.VAC_954;
assert.ok(vac);
assert.strictEqual(vac.voice.play.status, 'shared');
assert.strictEqual(vac.voice.play.sourceCardId, 'VAC_301');
assert.notStrictEqual(vac.voice.play.voiceKey, 'VO_VAC_954_Play_01');
if (vac.music.status === 'shared') {
  assert.ok(vac.music.sourceCardId);
  assert.notStrictEqual(vac.music.sourceCardId, 'VAC_954');
}
assert.ok(vac.music.status !== 'unresolved' || vac.music.reason);

const cap = unified.cards.CAP_107;
assert.ok(cap);
assert.strictEqual(cap.voice.play.status, 'shared');
assert.ok(cap.voice.play.voiceKey.includes('CAP_106t'));
assert.ok(!cap.voice.play.voiceKey.includes('VO_CAP_107'));

const cfm = unified.cards.CFM_335;
assert.ok(cfm);
assert.strictEqual(cfm.voice.play.status, 'available');
assert.strictEqual(cfm.voice.play.voiceKey, 'CFM_ClumsyKodo_Play');

for (const id of ['ETC_409', 'PRO_001', 'VAN_PRO_001', 'WW_364']) {
  const row = unified.cards[id];
  assert.ok(row, id + ' missing');
  assert.strictEqual(row.music.status, 'unavailable', id + ' music ' + row.music.status);
  assert.strictEqual(row.music.musicAssetId, null);
}

assert.notStrictEqual(unified.cards.VAN_PRO_001.music.status, 'shared');
assert.strictEqual(musicIndex.cards.VAN_PRO_001.musicStatus, 'no_music');

const phase101 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'music-verification', 'phase-1.0.1-results.json'), 'utf8'));
let withMusic = 0;
let noMusic = 0;
for (const row of phase101.cards) {
  const u = unified.cards[row.cardId];
  const has = u.music.status === 'available' || u.music.status === 'shared';
  if (row.musicStatus === 'no_music_reference') {
    noMusic++;
    assert.ok(!has, row.cardId + ' should have no music');
  } else {
    withMusic++;
    assert.ok(has, row.cardId + ' should have music, got ' + u.music.status);
  }
}
assert.strictEqual(withMusic, 1043);
assert.strictEqual(noMusic, 4);

console.log('ok cardAudioIndex');
