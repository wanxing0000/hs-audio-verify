'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  stripOneTokenSuffix,
  isStructuredTokenChild,
  immediateStructuredParent,
  collectStructuredRelations,
  collectExplicitRelations,
  mergePrimaryRelations,
  exclusiveCategory,
  relationGapKind,
  inferNameMentions,
  runRelatedAudioAudit,
} = require('../src/audit/relatedAudioAudit.js');

const ROOT = path.resolve(__dirname, '..');

assert.deepStrictEqual(stripOneTokenSuffix('TIME_609t1'), { parentId: 'TIME_609', suffix: 't1' });
assert.deepStrictEqual(stripOneTokenSuffix('TIME_609t2e'), { parentId: 'TIME_609t2', suffix: 'e' });
assert.deepStrictEqual(stripOneTokenSuffix('TIME_005t9t'), { parentId: 'TIME_005t9', suffix: 't' });
assert.strictEqual(stripOneTokenSuffix('TIME_609'), null);
assert.strictEqual(stripOneTokenSuffix('HERO_05z'), null);

assert.strictEqual(isStructuredTokenChild('TIME_609', 'TIME_609t1'), true);
assert.strictEqual(isStructuredTokenChild('TIME_609', 'TIME_609t2e'), true);
assert.strictEqual(isStructuredTokenChild('TIME_005', 'TIME_005t9t'), true);
assert.strictEqual(isStructuredTokenChild('TIME_609', 'HERO_05z'), false);
assert.strictEqual(isStructuredTokenChild('TIME_005', 'TIME_031'), false);
assert.strictEqual(isStructuredTokenChild('TIME_609', 'TIME_609'), false);

const idSet = { TIME_609: true, TIME_609t2: true, TIME_609t2e: true };
assert.strictEqual(immediateStructuredParent('TIME_609t2e', idSet).parentId, 'TIME_609t2');
assert.strictEqual(immediateStructuredParent('HERO_05z', { HERO_05: true }), null);

const structured = collectStructuredRelations([
  { id: 'TIME_609', name: '游侠将军希尔瓦娜斯' },
  { id: 'TIME_609t1', name: '游侠队长奥蕾莉亚' },
  { id: 'TIME_609t2', name: '游侠新兵温蕾萨' },
  { id: 'TIME_609t2e', name: '风行者之誓' },
  { id: 'HERO_05z', name: '游侠将军希尔瓦娜斯' },
]);
assert.strictEqual(structured.length, 3);
assert.ok(structured.every((e) => e.relationConfidence === 'STRUCTURED'));
assert.ok(!structured.some((e) => e.relatedCardId === 'HERO_05z'));

const explicit = collectExplicitRelations([
  { id: 'HERO_05z', name: '游侠将军希尔瓦娜斯', heroPowerDbfId: 97863, dbfId: 1 },
  { id: 'HERO_05z_hp', name: '稳固射击', dbfId: 97863, type: 'HERO_POWER' },
  { id: 'UNG_028', questReward: 'UNG_028t', dbfId: 2 },
  { id: 'UNG_028t', dbfId: 3 },
]);
assert.ok(explicit.some((e) => e.relationType === 'hero_power' && e.parentCardId === 'HERO_05z'));
assert.ok(explicit.some((e) => e.relationType === 'quest_reward' && e.relatedCardId === 'UNG_028t'));

const primary = mergePrimaryRelations(structured, explicit);
assert.ok(primary.every((e) => e.relationType !== 'hero_power'));
assert.ok(primary.some((e) => e.relatedCardId === 'UNG_028t'));
const dup = mergePrimaryRelations(
  [{ parentCardId: 'UNG_028', relatedCardId: 'UNG_028t', relationType: 'token', relationConfidence: 'STRUCTURED', source: 'suffix' }],
  [{ parentCardId: 'UNG_028', relatedCardId: 'UNG_028t', relationType: 'quest_reward', relationConfidence: 'EXPLICIT', source: 'questReward' }]
);
assert.strictEqual(dup.length, 1);

const inferred = inferNameMentions(
  { id: 'PARENT', name: '父卡', set: 'TIME_TRAVEL', text: '召唤游侠队长奥蕾莉亚。' },
  { 游侠队长奥蕾莉亚: [{ id: 'TIME_609t1', name: '游侠队长奥蕾莉亚', set: 'TIME_TRAVEL' }] },
  {}
);
assert.strictEqual(inferred[0].relationConfidence, 'INFERRED');
const inferredSkipped = inferNameMentions(
  { id: 'TIME_609', name: '游侠将军希尔瓦娜斯', set: 'TIME_TRAVEL', text: '如果你使用过奥蕾莉亚或温蕾萨' },
  { 游侠队长奥蕾莉亚: [{ id: 'TIME_609t1', name: '游侠队长奥蕾莉亚', set: 'TIME_TRAVEL' }] },
  { 'TIME_609->TIME_609t1': true }
);
assert.strictEqual(inferredSkipped.length, 0);

function rawVoice(id) {
  return {
    id: id,
    collectible: id.indexOf('t') === -1,
    type: 'MINION',
    voice: {
      play: { status: 'available', voiceKey: 'VO_' + id + '_Play', sourceCardId: id },
      attack: { status: 'unavailable', voiceKey: null, sourceCardId: null },
      death: { status: 'unavailable', voiceKey: null, sourceCardId: null },
    },
    music: { status: 'unavailable' },
    entrancePreview: { available: false },
  };
}

const fixture = runRelatedAudioAudit({
  hsCards: [
    { id: 'TIME_609', name: '游侠将军希尔瓦娜斯', collectible: true, type: 'MINION', set: 'TIME_TRAVEL', dbfId: 1 },
    { id: 'TIME_609t1', name: '游侠队长奥蕾莉亚', type: 'MINION', set: 'TIME_TRAVEL', dbfId: 2 },
    { id: 'TIME_609t2e', name: '风行者之誓', type: 'ENCHANTMENT', set: 'TIME_TRAVEL', dbfId: 3 },
  ],
  audioIndex: {
    cards: {
      TIME_609: rawVoice('TIME_609'),
      TIME_609t1: rawVoice('TIME_609t1'),
      TIME_609t2e: {
        id: 'TIME_609t2e',
        collectible: false,
        type: 'ENCHANTMENT',
        voice: {
          play: { status: 'unavailable', voiceKey: null, sourceCardId: null },
          attack: { status: 'unavailable', voiceKey: null, sourceCardId: null },
          death: { status: 'unavailable', voiceKey: null, sourceCardId: null },
        },
        music: { status: 'unavailable' },
        entrancePreview: { available: false },
      },
    },
  },
  manifest: { voice: [], music: [], entrance: [] },
});

assert.strictEqual(fixture.summary.primaryEdges, 2);
assert.strictEqual(fixture._rows.TIME_609.exclusiveCategory, 'MAPPING_EXISTS_PRODUCTION_MISSING');
assert.strictEqual(fixture._rows.TIME_609t1.exclusiveCategory, 'MAPPING_EXISTS_PRODUCTION_MISSING');
assert.strictEqual(fixture._rows.TIME_609t2e.exclusiveCategory, 'NO_AUDIO_EXPECTED');
assert.strictEqual(relationGapKind(fixture._rows.TIME_609t1), 'AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING');
assert.strictEqual(relationGapKind(fixture._rows.TIME_609t2e), 'AUDIO_TRULY_ABSENT');

const prodHit = exclusiveCategory({
  catalog: { present: true },
  index: { hasAny: true },
  production: { hasAny: true },
  isPrimaryRelated: false,
  hs: { type: 'MINION' },
});
assert.strictEqual(prodHit, 'FULLY_AVAILABLE');

const advertised = exclusiveCategory({
  catalog: { present: false },
  index: { hasAny: false },
  production: { hasAny: true },
  isPrimaryRelated: true,
  hs: { type: 'MINION' },
});
assert.strictEqual(advertised, 'AUDIO_EXISTS_NOT_ADVERTISED');

const liveCardsPath = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
const liveIndexPath = path.join(ROOT, 'data', 'index', 'card-audio-index.json');
const liveManifestPath = path.join(ROOT, 'data', 'production-audio', 'manifest.json');
if (fs.existsSync(liveCardsPath) && fs.existsSync(liveIndexPath) && fs.existsSync(liveManifestPath)) {
  const live = runRelatedAudioAudit({
    hsCards: JSON.parse(fs.readFileSync(liveCardsPath, 'utf8')),
    audioIndex: JSON.parse(fs.readFileSync(liveIndexPath, 'utf8')),
    manifest: JSON.parse(fs.readFileSync(liveManifestPath, 'utf8')),
  });
  const syl = live.cases[0].detail;
  const raf = live.cases[1].detail;
  assert.strictEqual(syl.parent.cardId, 'TIME_609');
  assert.strictEqual(syl.parent.name, '游侠将军希尔瓦娜斯');
  const sylIds = syl.related.map((r) => r.cardId).sort();
  assert.deepStrictEqual(sylIds, ['TIME_609t1', 'TIME_609t2', 'TIME_609t2e']);
  assert.ok(syl.related.filter((r) => r.type === 'MINION').every((r) => r.audioIndex.indexOf('play') >= 0));
  assert.ok(syl.related.every((r) => !(r.catalog && r.catalog.present)));
  assert.ok(syl.related.filter((r) => r.type === 'MINION').every((r) => (r.production || []).indexOf('play') >= 0));
  assert.ok(syl.related.filter((r) => r.type === 'ENCHANTMENT').every((r) => (r.production || []).length === 0));
  assert.ok(syl.sameNameUnrelated.some((c) => c.cardId === 'HERO_05z'));

  assert.strictEqual(raf.parent.cardId, 'TIME_005');
  assert.strictEqual(raf.parent.name, '时空大盗拉法姆');
  const rafMinions = raf.related.filter((r) => r.type === 'MINION').map((r) => r.cardId).sort();
  assert.ok(rafMinions.indexOf('TIME_005t1') >= 0);
  assert.ok(rafMinions.indexOf('TIME_005t9') >= 0);
  assert.ok(rafMinions.indexOf('TIME_005t9t') >= 0);
  assert.ok(raf.related.filter((r) => r.type === 'MINION').every((r) => (r.audioIndex || []).length > 0));
  assert.ok(raf.related.filter((r) => r.type === 'MINION').every((r) => (r.production || []).indexOf('play') >= 0));
  assert.ok(raf.sameNameUnrelated.some((c) => c.cardId === 'HERO_07bk'));
  assert.ok(live.summary.primaryParents > 0);
  assert.ok(live.summary.mappingProductionMissing > 0);
}

console.log('ok phase210RelatedAudioAudit');
