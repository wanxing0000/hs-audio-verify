'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { shouldDisplayRelatedEdge } = require('../src/miniprogram/relatedCards.js');
const { isForbiddenCandidate, isBattlegroundsCard, snapshotProduction } = require('../src/audit/relatedAudioProductionAudit.js');
const {
  MAX_DEPTH,
  FOCUS_12,
  loadHistory,
  walkRelated,
  buildChildren,
  runRelatedAudioDiscovery,
  voiceCompleteness,
} = require('../src/audit/relatedAudioDiscovery.js');
const { inferNameMentions } = require('../src/audit/relatedAudioAudit.js');

const ROOT = path.resolve(__dirname, '..');

assert.strictEqual(MAX_DEPTH, 3);
assert.strictEqual(FOCUS_12.length, 12);
assert.strictEqual(isForbiddenCandidate({ type: 'ENCHANTMENT' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO_POWER' }), true);
assert.strictEqual(isBattlegroundsCard({ type: 'BATTLEGROUND_SPELL' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO', set: 'HERO_SKINS' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'MINION', set: 'TIME_TRAVEL' }), false);

assert.strictEqual(shouldDisplayRelatedEdge({
  relationConfidence: 'INFERRED',
  relationType: 'text_name',
}, { type: 'MINION' }), false);

const inferred = inferNameMentions(
  { id: 'P', name: '父', set: 'TIME_TRAVEL', text: '召唤奥蕾莉亚' },
  { 奥蕾莉亚: [{ id: 'TIME_609t1', name: '奥蕾莉亚', set: 'TIME_TRAVEL' }] },
  {}
);
assert.ok(inferred.length === 0 || inferred[0].relationConfidence === 'INFERRED');

const byParent = buildChildren([
  { parentCardId: 'A', relatedCardId: 'At1', relationType: 'token', relationConfidence: 'STRUCTURED' },
  { parentCardId: 'At1', relatedCardId: 'At1t', relationType: 'token', relationConfidence: 'STRUCTURED' },
  { parentCardId: 'At1t', relatedCardId: 'At1t2', relationType: 'token', relationConfidence: 'STRUCTURED' },
  { parentCardId: 'At1t2', relatedCardId: 'At1t2x', relationType: 'token', relationConfidence: 'STRUCTURED' },
]);
const walked = walkRelated('A', byParent, 3);
assert.ok(walked.some((r) => r.relatedId === 'At1' && r.depth === 1));
assert.ok(walked.some((r) => r.relatedId === 'At1t' && r.depth === 2));
assert.ok(walked.some((r) => r.relatedId === 'At1t2' && r.depth === 3));
assert.ok(!walked.some((r) => r.relatedId === 'At1t2x'));

assert.strictEqual(voiceCompleteness({
  play: { indexed: true, productionPresent: true },
  attack: { indexed: true, productionPresent: true },
  death: { indexed: true, productionPresent: true },
}), 'VOICE_COMPLETE');
assert.strictEqual(voiceCompleteness({
  play: { indexed: true, productionPresent: true },
  attack: { indexed: true, productionPresent: false },
  death: { indexed: true, productionPresent: false },
}), 'PLAY_ONLY');
assert.strictEqual(voiceCompleteness({
  play: { indexed: false },
  attack: { indexed: false },
  death: { indexed: false },
}), 'NO_AUDIO');

const history = loadHistory(ROOT);
assert.ok(history.every((f) => f.status === 'FOUND' || f.status === 'MISSING_HISTORY_FILE'));
assert.ok(!history.some((f) => f.status !== 'FOUND' && f.status !== 'MISSING_HISTORY_FILE'));

const before = snapshotProduction(ROOT);
const live = runRelatedAudioDiscovery({ root: ROOT });
const after = snapshotProduction(ROOT);
assert.strictEqual(before.manifestSha256, after.manifestSha256);
assert.strictEqual(before.files, after.files);
assert.strictEqual(before.bytes, after.bytes);

const catalog = buildCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8')));
assert.strictEqual(catalog.cards.length, 7263);
assert.ok(!catalog.byId.TIME_609t1);

assert.strictEqual(live.regression, false);
FOCUS_12.forEach((id) => {
  const rec = live.historical12[id];
  assert.ok(rec && rec.found, id + ' missing from discovery');
  assert.strictEqual(rec.play.indexed, true, id + ' play indexed');
  assert.strictEqual(rec.attack.indexed, true, id + ' attack indexed');
  assert.strictEqual(rec.death.indexed, true, id + ' death indexed');
  assert.strictEqual(rec.play.production, true, id + ' play production');
  assert.strictEqual(rec.attack.production, true, id + ' attack production');
  assert.strictEqual(rec.death.production, true, id + ' death production');
  assert.strictEqual(rec.ok, true, id + ' regression');
});

const sheep = live.candidates.find((c) => c.relatedCardId === 'TIME_005t9t');
assert.ok(sheep);
assert.strictEqual(sheep.slots.play.voiceKey, 'TIME_005t9t_Play');
assert.strictEqual(sheep.slots.attack.voiceKey, 'TIME_005t9t_Attack');
assert.strictEqual(sheep.slots.death.voiceKey, 'TIME_005t9t_Death');
assert.strictEqual(sheep.slots.play.alias, true);

assert.ok(!live.candidates.some((c) => c.cardType === 'ENCHANTMENT'));
assert.ok(!live.candidates.some((c) => c.cardType === 'HERO_POWER'));
assert.ok(!live.candidates.some((c) => c.relatedCardId === 'TIME_609t2e'));
assert.ok(!live.candidates.some((c) => c.relationSource === 'INFERRED'));
assert.ok(live.filters.enchantment > 0);
assert.strictEqual(live.summary.conflict, 0);
live.readyToCopy.forEach((row) => {
  assert.strictEqual(row.readyToCopy, true);
  assert.ok(row.voiceKey);
  assert.ok(row.sourcePath);
  assert.strictEqual(row.targetExists, false);
});
assert.ok(!live.readyToCopy.some((r) => FOCUS_12.indexOf(r.cardId) >= 0));

const src = fs.readFileSync(path.join(ROOT, 'src', 'audit', 'relatedAudioDiscovery.js'), 'utf8');
assert.ok(!src.includes('C:\\\\Hearthstone') || src.includes('NOT_ACCESSED'));
assert.ok(!src.includes('extractVoice('));

console.log('ok phase210GRelatedAudioDiscovery', {
  cards: live.summary.cardCandidates,
  ready: live.summary.ready,
  catalog: catalog.cards.length,
});
