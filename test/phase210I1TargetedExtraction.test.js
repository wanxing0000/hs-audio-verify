'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isForbiddenCandidate, isBattlegroundsCard, snapshotProduction } = require('../src/audit/relatedAudioProductionAudit.js');
const {
  EXPECTED_FAMILY,
  EXPECTED_CARD_COUNT,
  EXPECTED_SLOT_COUNT,
  loadFirstBatch,
  loadAndValidateTargets,
  inspectExtractedWav,
  identityCheck,
} = require('../src/audit/phase210I1TargetedExtraction.js');

const ROOT = path.resolve(__dirname, '..');
const PRIORITY = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-extraction-priority.json');
const RESULT = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-1-extraction-result.json');
const EXPECTED_SHA = 'a7cd2e1e923348123064e4f67dafe1aa255a266576871ae47493f90569376bec';
const SLOTS = ['play', 'attack', 'death'];

assert.strictEqual(EXPECTED_FAMILY, 'GDB_471');
assert.strictEqual(EXPECTED_CARD_COUNT, 8);
assert.strictEqual(EXPECTED_SLOT_COUNT, 24);
assert.strictEqual(isForbiddenCandidate({ type: 'ENCHANTMENT' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO_POWER' }), true);
assert.strictEqual(isBattlegroundsCard({ type: 'BATTLEGROUND_HERO_BUDDY' }), true);

const loaded = loadFirstBatch(ROOT);
assert.strictEqual(loaded.blocked, false, 'firstBatch must parse');
assert.strictEqual((loaded.batch.families || [])[0], 'GDB_471');
assert.strictEqual(loaded.batch.cardCount, 8);
assert.strictEqual(loaded.batch.slotCount, 24);
assert.strictEqual(loaded.plan.length, 24);
assert.deepStrictEqual(loaded.batch.cards, [
  'GDB_471t', 'GDB_471t2', 'GDB_471t3', 'GDB_471t4',
  'GDB_471t5', 'GDB_471t6', 'GDB_471t7', 'GDB_471t8',
]);
assert.strictEqual(loaded.batch.play, 8);
assert.strictEqual(loaded.batch.attack, 8);
assert.strictEqual(loaded.batch.death, 8);

loaded.plan.forEach((row) => {
  assert.ok(SLOTS.indexOf(row.slot) >= 0, 'slot must be play/attack/death: ' + row.slot);
  assert.strictEqual(row.family, 'GDB_471');
  assert.ok(row.voiceKey, 'voiceKey required');
  assert.ok(String(row.cardId).indexOf('GDB_471') === 0, 'other family: ' + row.cardId);
});

const priority = JSON.parse(fs.readFileSync(PRIORITY, 'utf8'));
assert.ok(!JSON.stringify(priority.firstBatch).includes('TOY_814'), 'must not include second family in firstBatch');
assert.strictEqual(priority.firstBatch.families.length, 1);

const validated = loadAndValidateTargets(ROOT);
assert.strictEqual(validated.blocked, false, validated.blockReason);
assert.strictEqual(validated.stats.INDEXED, 24);
assert.strictEqual(validated.stats.VOICEKEY_RESOLVED, 24);
assert.strictEqual(validated.stats.AMBIGUOUS, 0);
assert.strictEqual(validated.stats.NO_MAPPING, 0);
assert.strictEqual(validated.stats.INVALID_TYPE, 0);
assert.strictEqual(validated.stats.HERO_SKIN_COLLISION, 0);
assert.strictEqual(validated.targets.length, 24);
assert.strictEqual(validated.cards.length, 8);

const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
validated.targets.forEach((t) => {
  const raw = unified.cards[t.cardId];
  assert.ok(raw, 'index missing ' + t.cardId);
  assert.notStrictEqual(raw.type, 'ENCHANTMENT');
  assert.notStrictEqual(raw.type, 'HERO_POWER');
  assert.ok(!isBattlegroundsCard(raw));
  assert.ok(!isForbiddenCandidate(raw));
  const indexKey = raw.voice[t.slot].voiceKey;
  assert.strictEqual(indexKey, t.voiceKey);
  const planRow = loaded.plan.find((p) => p.cardId === t.cardId && p.slot === t.slot);
  assert.ok(planRow, 'plan missing ' + t.cardId + ':' + t.slot);
  assert.strictEqual(planRow.voiceKey, t.voiceKey);
});

const prod = snapshotProduction(ROOT);
assert.strictEqual(prod.music, 200);
assert.strictEqual(prod.entrance, 98);

assert.ok(fs.existsSync(RESULT), 'extraction result JSON missing');
const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
assert.strictEqual(result.family, 'GDB_471');
assert.ok(result.status === 'COMPLETE_VERIFIED' || result.status === 'PARTIAL_VERIFIED');
assert.ok(Array.isArray(result.results));
assert.strictEqual(result.results.length, 24);
assert.strictEqual(result.dryRun.counts.AMBIGUOUS || 0, 0);
assert.strictEqual(result.dryRun.counts.INVALID || 0, 0);
assert.strictEqual(result.identity.IDENTITY_CONFLICT, 0);
assert.strictEqual(result.identity.DUPLICATE_OUTPUT, 0);
assert.strictEqual(result.identity.SHA_CONFLICT, 0);
assert.strictEqual(result.productionChanged, false);
assert.strictEqual(result.productionBefore.manifestSha256, EXPECTED_SHA);
assert.strictEqual(result.productionAfter.manifestSha256, EXPECTED_SHA);
assert.strictEqual(result.productionBefore.files, 685);
assert.strictEqual(result.productionBefore.voice, 386);
assert.strictEqual(result.safety.FULL_EXTRACTOR, 'NOT_CALLED');
assert.strictEqual(result.safety.TARGETED_ONLY, 'YES');
assert.ok(String(result.destDir).indexOf('data/production-audio') < 0);

const identity = identityCheck(result.results);
assert.strictEqual(identity.IDENTITY_CONFLICT, 0);
assert.strictEqual(identity.DUPLICATE_OUTPUT, 0);
assert.strictEqual(identity.SHA_CONFLICT, 0);

result.results.forEach((row) => {
  assert.ok(SLOTS.indexOf(row.slot) >= 0);
  assert.ok(String(row.cardId).indexOf('GDB_471') === 0);
  if (row.extracted) {
    assert.ok(row.outputPath, row.voiceKey + ' missing outputPath');
    assert.ok(row.outputPath.indexOf('data/production-audio') < 0, 'must not write production');
    const abs = path.join(ROOT, row.outputPath);
    const wav = inspectExtractedWav(abs);
    assert.strictEqual(wav.wavValid, true, row.voiceKey + ' wav invalid');
    assert.ok(wav.size > 0);
    assert.ok(row.wavValid);
  }
});

const after = snapshotProduction(ROOT);
assert.strictEqual(after.manifestSha256, prod.manifestSha256);
assert.strictEqual(after.files, prod.files);
assert.strictEqual(after.bytes, prod.bytes);
assert.strictEqual(after.voice, prod.voice);

console.log('ok phase210I1TargetedExtraction', {
  family: EXPECTED_FAMILY,
  cards: validated.cards.length,
  slots: validated.targets.length,
  status: result.status,
  found: result.dryRun.counts.FOUND,
  extracted: result.extraction.success,
});
