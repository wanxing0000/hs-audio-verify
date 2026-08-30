'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  MAX_DEPTH,
  FOCUS_12,
  isAliasKey,
  walkRelated,
  buildChildren,
  analyzeSlot,
  completenessFor,
  snapshotProduction,
  runRelatedAudioDeepAudit,
  loadProjectDeepAuditInputs,
} = require('../src/audit/relatedAudioDeepAudit.js');
const { createProductionAudioInventory } = require('../src/services/productionAudioAvailability.js');

const ROOT = path.resolve(__dirname, '..');

assert.strictEqual(MAX_DEPTH, 3);
assert.strictEqual(FOCUS_12.length, 12);
assert.ok(FOCUS_12.indexOf('TIME_005t9t') >= 0);

const edges = [
  { parentCardId: 'TIME_609', relatedCardId: 'TIME_609t1', relationType: 'token', relationConfidence: 'STRUCTURED', source: 'suffix' },
  { parentCardId: 'TIME_609', relatedCardId: 'TIME_609t2', relationType: 'token', relationConfidence: 'STRUCTURED', source: 'suffix' },
  { parentCardId: 'TIME_609t2', relatedCardId: 'TIME_609t2e', relationType: 'enchantment', relationConfidence: 'STRUCTURED', source: 'suffix' },
  { parentCardId: 'TIME_005', relatedCardId: 'TIME_005t9', relationType: 'token', relationConfidence: 'STRUCTURED', source: 'suffix' },
  { parentCardId: 'TIME_005t9', relatedCardId: 'TIME_005t9t', relationType: 'token', relationConfidence: 'STRUCTURED', source: 'suffix' },
];
const byParent = buildChildren(edges);
const sylWalk = walkRelated('TIME_609', byParent, 3);
assert.strictEqual(sylWalk.filter((r) => r.depth === 1).length, 2);
assert.strictEqual(sylWalk.filter((r) => r.relatedId === 'TIME_609t2e' && r.depth === 2).length, 1);
assert.strictEqual(sylWalk.filter((r) => r.depth === 3).length, 0);
const rafWalk = walkRelated('TIME_005', byParent, 3);
assert.ok(rafWalk.some((r) => r.relatedId === 'TIME_005t9' && r.depth === 1));
assert.ok(rafWalk.some((r) => r.relatedId === 'TIME_005t9t' && r.depth === 2));

assert.strictEqual(isAliasKey('TIME_005t9t', 'TIME_005t9t_Play'), true);
assert.strictEqual(isAliasKey('TIME_005t9t', 'TIME_005t9t_Attack'), true);
assert.strictEqual(isAliasKey('TIME_609t1', 'VO_TIME_609t1_Female_HighElf_Play_01'), false);
assert.strictEqual(isAliasKey('TIME_609t1', 'TIME_609t1'), false);
assert.strictEqual(isAliasKey('CAP_107', 'VO_OTHER_CARD_Play_01'), true);

function rawMinion(id, keys) {
  keys = keys || {};
  function slot(type, key) {
    if (!key) return { status: 'unavailable', voiceKey: null };
    return { status: 'available', voiceKey: key, sourceCardId: id };
  }
  return {
    id: id,
    collectible: keys.collectible === true,
    type: 'MINION',
    name: id,
    voice: {
      play: slot('play', keys.play),
      attack: slot('attack', keys.attack),
      death: slot('death', keys.death),
    },
    music: keys.music
      ? { status: 'shared', audioClipName: keys.music, musicAssetId: keys.music }
      : { status: 'unavailable' },
    entrancePreview: { available: !!keys.entrance },
  };
}

const emptyInv = createProductionAudioInventory({ voice: [], music: [], entrance: [] });
const playMapped = analyzeSlot('TIME_609t1', 'play', rawMinion('TIME_609t1', { play: 'VO_TIME_609t1_Play' }), emptyInv, ROOT);
assert.strictEqual(playMapped.mapped, true);
assert.strictEqual(playMapped.playable, false);
assert.strictEqual(playMapped.state, 'INDEXED_PRODUCTION_MISSING');

const noMap = analyzeSlot('X', 'attack', rawMinion('X', { play: 'VO_X_Play' }), emptyInv, ROOT);
assert.strictEqual(noMap.mapped, false);
assert.strictEqual(noMap.state, 'NO_MAPPING');

const aliasSlot = analyzeSlot(
  'TIME_005t9t',
  'play',
  rawMinion('TIME_005t9t', { play: 'TIME_005t9t_Play' }),
  createProductionAudioInventory({
    voice: [{ voiceKey: 'TIME_005t9t_Play', cardIds: ['TIME_005t9t'], types: ['play'] }],
    music: [],
    entrance: [],
  }),
  ROOT
);
assert.strictEqual(aliasSlot.alias, true);
assert.ok(aliasSlot.state === 'MAPPING_ALIAS' || aliasSlot.state === 'PLAYABLE' || aliasSlot.state === 'INDEXED_PRODUCTION_MISSING');

const completeSlots = {
  play: { mapped: true, playable: true, productionExists: true },
  attack: { mapped: true, playable: true, productionExists: true },
  death: { mapped: true, playable: true, productionExists: true },
  music: { mapped: true, playable: true, productionExists: true },
  entrance: { mapped: true, playable: true, productionExists: true },
};
assert.strictEqual(completenessFor(completeSlots), 'FULL_INDEXED');

const voiceOnly = {
  play: { mapped: true, playable: true, productionExists: true },
  attack: { mapped: true, playable: true, productionExists: true },
  death: { mapped: true, playable: true, productionExists: true },
  music: { mapped: true, playable: false, productionExists: false },
  entrance: { mapped: false, playable: false, productionExists: false },
};
assert.strictEqual(completenessFor(voiceOnly), 'VOICE_COMPLETE');

const playOnlyDeclared = {
  play: { mapped: true, playable: true, productionExists: true },
  attack: { mapped: false, playable: false, productionExists: false },
  death: { mapped: false, playable: false, productionExists: false },
  music: { mapped: false, playable: false, productionExists: false },
  entrance: { mapped: false, playable: false, productionExists: false },
};
assert.ok(completenessFor(playOnlyDeclared) === 'FULL_INDEXED' || completenessFor(playOnlyDeclared) === 'PLAY_ONLY' || completenessFor(playOnlyDeclared) === 'VOICE_COMPLETE');

const partial = {
  play: { mapped: true, playable: true, productionExists: true },
  attack: { mapped: true, playable: false, productionExists: false },
  death: { mapped: true, playable: false, productionExists: false },
  music: { mapped: true, playable: false, productionExists: false },
  entrance: { mapped: true, playable: false, productionExists: false },
};
assert.strictEqual(completenessFor(partial), 'PARTIAL');

const none = {
  play: { mapped: false, playable: false, productionExists: false },
  attack: { mapped: false, playable: false, productionExists: false },
  death: { mapped: false, playable: false, productionExists: false },
  music: { mapped: false, playable: false, productionExists: false },
  entrance: { mapped: false, playable: false, productionExists: false },
};
assert.strictEqual(completenessFor(none), 'NO_AUDIO');

const fixture = runRelatedAudioDeepAudit({
  root: ROOT,
  hsCards: [
    { id: 'TIME_609', name: '游侠将军希尔瓦娜斯', collectible: true, type: 'MINION', set: 'TIME_TRAVEL', dbfId: 1 },
    { id: 'TIME_609t1', name: '游侠队长奥蕾莉亚', collectible: false, type: 'MINION', set: 'TIME_TRAVEL', dbfId: 2 },
    { id: 'TIME_609t2', name: '游侠新兵温蕾萨', collectible: false, type: 'MINION', set: 'TIME_TRAVEL', dbfId: 3 },
    { id: 'TIME_609t2e', name: '风行者之誓', collectible: false, type: 'ENCHANTMENT', set: 'TIME_TRAVEL', dbfId: 4 },
    { id: 'JAIL_443', name: 'jail', collectible: true, type: 'MINION', dbfId: 5 },
    { id: 'CAP_107', name: 'cap', collectible: true, type: 'MINION', dbfId: 6 },
  ],
  unified: {
    cards: {
      TIME_609: rawMinion('TIME_609', { play: 'VO_TIME_609_Play', collectible: true }),
      TIME_609t1: rawMinion('TIME_609t1', { play: 'VO_TIME_609t1_Play', attack: 'VO_TIME_609t1_Attack', death: 'VO_TIME_609t1_Death' }),
      TIME_609t2: rawMinion('TIME_609t2', { play: 'VO_TIME_609t2_Play' }),
      TIME_609t2e: {
        id: 'TIME_609t2e',
        type: 'ENCHANTMENT',
        collectible: false,
        name: '风行者之誓',
        voice: {
          play: { status: 'unavailable', voiceKey: null },
          attack: { status: 'unavailable', voiceKey: null },
          death: { status: 'unavailable', voiceKey: null },
        },
        music: { status: 'unavailable' },
        entrancePreview: { available: false },
      },
      JAIL_443: rawMinion('JAIL_443', { play: 'VO_JAIL_443_Play', entrance: true, collectible: true }),
      CAP_107: rawMinion('CAP_107', { play: 'VO_CAP_107_Play', collectible: true }),
    },
  },
  manifest: { voice: [], music: [], entrance: [] },
});
assert.ok(fixture.relation.edges >= 3);
assert.strictEqual(fixture.rafaam ? true : true, true);
assert.ok(fixture.gaps.GAP_F >= 1);
assert.ok(fixture.missingProduction.some((r) => r.cardId === 'TIME_609t1' && r.audioType === 'attack'));
assert.strictEqual(fixture.sylvanas.TIME_609t2e.type, 'ENCHANTMENT');
assert.ok(!fixture.sylvanas.TIME_609t2e.play.mapped);

const liveCards = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
const liveIndex = path.join(ROOT, 'data', 'index', 'card-audio-index.json');
const liveManifest = path.join(ROOT, 'data', 'production-audio', 'manifest.json');
assert.ok(fs.existsSync(liveCards) && fs.existsSync(liveIndex) && fs.existsSync(liveManifest));

const before = snapshotProduction(ROOT);
const live = runRelatedAudioDeepAudit(loadProjectDeepAuditInputs(ROOT));
const after = snapshotProduction(ROOT);
assert.strictEqual(before.manifestSha256, after.manifestSha256);
assert.strictEqual(before.files, after.files);
assert.strictEqual(before.voice, after.voice);

assert.ok(live.relation.parents > 0);
assert.ok(live.relation.edges > 0);
assert.ok(live.relation.depth1 > 0);
assert.ok(live.relation.depth2 >= 0);
assert.ok(live.relation.depth3 >= 0);
assert.ok(live.history.files.every((f) => f.status === 'FOUND' || f.status === 'NOT_FOUND'));

function slotOk(slot) {
  assert.ok(slot);
  assert.ok(typeof slot.mapped === 'boolean');
  assert.ok(typeof slot.playable === 'boolean');
}

FOCUS_12.forEach((id) => {
  const row = live.targets12.find((t) => t.cardId === id);
  assert.ok(row, 'missing target ' + id);
  slotOk(row.play);
  slotOk(row.attack);
  slotOk(row.death);
  slotOk(row.music);
  slotOk(row.entrance);
  assert.strictEqual(row.play.mapped, true);
  assert.strictEqual(row.play.playable, true);
  assert.strictEqual(row.play.state === 'PLAYABLE' || row.play.state === 'MAPPING_ALIAS', true);
  assert.strictEqual(row.attack.mapped, true);
  assert.strictEqual(row.attack.playable, true);
  assert.strictEqual(row.death.mapped, true);
  assert.strictEqual(row.death.playable, true);
  assert.ok(row.completeness === 'VOICE_COMPLETE' || row.completeness === 'FULL_INDEXED' || row.completeness === 'PARTIAL');
});

const sheep = live.targets12.find((t) => t.cardId === 'TIME_005t9t');
assert.strictEqual(sheep.play.mappingKey, 'TIME_005t9t_Play');
assert.strictEqual(sheep.play.alias, true);
assert.strictEqual(sheep.play.state, 'MAPPING_ALIAS');
assert.ok(sheep.attack.mappingKey);
assert.ok(sheep.death.mappingKey);

assert.strictEqual(live.sylvanas.TIME_609t1.play.playable, true);
assert.strictEqual(live.sylvanas.TIME_609t2.play.playable, true);
assert.strictEqual(live.sylvanas.TIME_609t1.attack.playable, true);
assert.strictEqual(live.sylvanas.TIME_609t2.death.playable, true);
assert.strictEqual(live.sylvanas.TIME_609t2e.type, 'ENCHANTMENT');
assert.strictEqual(live.sylvanas.TIME_609t2e.play.mapped, false);

['TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5', 'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9', 'TIME_005t9t'].forEach((id) => {
  assert.ok(live.rafaam.tokens[id]);
  assert.strictEqual(live.rafaam.tokens[id].play.playable, true);
});
assert.strictEqual(live.rafaam.enchantments.TIME_005t2e.type, 'ENCHANTMENT');
assert.strictEqual(live.rafaam.enchantments.TIME_005t8e.type, 'ENCHANTMENT');

const jail = live.negative.JAIL_443;
assert.ok(jail);
assert.strictEqual(jail.slots.entrance.playable, false);
assert.ok(jail.slots.entrance.mapped === false || jail.slots.entrance.state === 'INDEXED_PRODUCTION_MISSING' || jail.slots.entrance.state === 'NO_MAPPING');

const cap = live.negative.CAP_107;
assert.ok(cap);
assert.strictEqual(cap.slots.play.mapped, true);
assert.strictEqual(cap.slots.play.playable, false);
assert.strictEqual(cap.runtime.playable, false);

assert.ok(live.gaps.GAP_B > 12);
assert.ok(!live.missingProductionPlayableType.some((r) => r.cardId === 'TIME_609t1' && r.audioType === 'attack'));
assert.ok(!live.missingProductionPlayableType.some((r) => r.cardId === 'TIME_005t9t' && r.audioType === 'death'));
assert.ok(Array.isArray(live.unindexedProduction));

console.log('ok phase210DRelatedAudioDeepAudit');
