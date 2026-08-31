'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { adaptCard, publicDetail, buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { getCardAudioAvailability } = require('../src/miniprogram/audioAvailability.js');
const {
  loadProductionAudioInventory,
  applyProductionToPublicDetail,
} = require('../src/services/productionAudioAvailability.js');
const {
  createRelatedCardIndex,
  attachRelatedCards,
  resolveDetailCard,
} = require('../src/miniprogram/relatedCards.js');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const { createProductionExtractorGuard } = require('../src/services/audioSourceMode.js');
const { isPlayableWav, sha256File } = require('../src/services/productionAudioPackage.js');
const {
  FAMILY,
  EXPECTED_HEAD,
  ALLOWED_CARDS,
  SLOTS,
  HISTORICAL_12,
  loadHistory,
  snapshotProduction,
} = require('../src/audit/phase210I2ProductionCopy.js');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'data', 'production-audio');
const RESULT = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-2-production-result.json');
const I1 = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-1-extraction-result.json');

assert.strictEqual(FAMILY, 'GDB_471');
assert.strictEqual(ALLOWED_CARDS.length, 8);
assert.strictEqual(SLOTS.length, 3);

const history = loadHistory(ROOT);
assert.strictEqual(history.blocked, false, history.blockReason);
assert.deepStrictEqual(history.batch.cards, ALLOWED_CARDS);
assert.strictEqual(history.i1Json.status, 'COMPLETE_VERIFIED');
assert.strictEqual(history.i1Json.results.length, 24);

const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
assert.strictEqual(result.status, 'COMPLETE_VERIFIED');
assert.strictEqual(result.git.head, EXPECTED_HEAD);
assert.strictEqual(result.dryRun.counts.SOURCE_FOUND, 24);
assert.strictEqual(result.dryRun.counts.WAV_VALID, 24);
assert.strictEqual(result.dryRun.counts.CONFLICT, 0);
assert.strictEqual(result.dryRun.counts.AMBIGUOUS, 0);
assert.strictEqual(result.dryRun.counts.IDENTITY_CONFLICT, 0);
assert.strictEqual(result.copy.copied + result.dryRun.counts.ALREADY_PRESENT, 24);
assert.strictEqual(result.copy.existingModified, 0);
assert.strictEqual(result.copy.shaMatch, true);
assert.strictEqual(result.before.files, 685);
assert.strictEqual(result.before.voice, 386);
assert.strictEqual(result.after.files, result.before.files + result.copy.copied);
assert.strictEqual(result.after.voice, result.before.voice + result.copy.copied);
assert.strictEqual(result.after.music, 200);
assert.strictEqual(result.after.entrance, 98);

const prod = snapshotProduction(ROOT);
assert.strictEqual(prod.files, result.after.files);
assert.strictEqual(prod.voice, result.after.voice);
assert.strictEqual(prod.music, 200);
assert.strictEqual(prod.entrance, 98);
assert.strictEqual(prod.manifestSha256, result.after.manifestSha256);
assert.notStrictEqual(prod.manifestSha256, result.before.manifestSha256);

const i1 = JSON.parse(fs.readFileSync(I1, 'utf8'));
const inventory = loadProductionAudioInventory(DEST);
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
const catalog = buildCatalog(unified);

assert.strictEqual(catalog.cards.length, 7263);
ALLOWED_CARDS.forEach((id) => {
  assert.ok(!catalog.byId[id], id + ' must not enter catalog');
});

i1.results.forEach((row) => {
  assert.ok(ALLOWED_CARDS.indexOf(row.cardId) >= 0, 'other family ' + row.cardId);
  assert.ok(SLOTS.indexOf(row.slot) >= 0);
  const destRel = 'voice/' + row.voiceKey + '.wav';
  const abs = path.join(DEST, destRel);
  assert.ok(isPlayableWav(abs), row.voiceKey + ' missing production wav');
  assert.strictEqual(sha256File(abs), row.sha256, row.voiceKey + ' sha mismatch');
  assert.strictEqual(inventory.hasVoice(row.cardId, row.slot), true, row.cardId + ' ' + row.slot);
});

const relatedIndex = createRelatedCardIndex(unified.cards);
const parent = resolveDetailCard('GDB_471', catalog, unified);
let detail = publicDetail(parent, getCardAudioAvailability(unified.cards.GDB_471, clips.clips));
detail = attachRelatedCards(detail, relatedIndex, inventory);
const ui = (detail.relatedCards || []).slice(0, 12);
const uiIds = ui.map((r) => r.id);
ALLOWED_CARDS.forEach((id) => {
  assert.ok(uiIds.indexOf(id) >= 0, 'UI missing ' + id);
  const row = ui.find((r) => r.id === id);
  assert.strictEqual(row.audioSlots.play.available, true, id + ' play');
  assert.strictEqual(row.audioSlots.attack.available, true, id + ' attack');
  assert.strictEqual(row.audioSlots.death.available, true, id + ' death');
});

HISTORICAL_12.forEach((id) => {
  assert.strictEqual(inventory.hasVoice(id, 'play'), true, id + ' play regression');
  assert.strictEqual(inventory.hasVoice(id, 'attack'), true, id + ' attack regression');
  assert.strictEqual(inventory.hasVoice(id, 'death'), true, id + ' death regression');
});

const cap = applyProductionToPublicDetail(
  publicDetail(adaptCard(unified.cards.CAP_107), getCardAudioAvailability(unified.cards.CAP_107, clips.clips)),
  inventory
);
assert.strictEqual(cap.voice.play.available, false);

const jail = applyProductionToPublicDetail(
  publicDetail(adaptCard(unified.cards.JAIL_443), getCardAudioAvailability(unified.cards.JAIL_443, clips.clips)),
  inventory
);
assert.strictEqual(jail.entrancePreview.available, false);

const repo = new UnifiedAudioRepo(unified, clips, musicAssets);
const cache = new AudioCache({
  audioDir: path.join(DEST, 'voice'),
  musicDir: path.join(DEST, 'music'),
  previewDir: path.join(DEST, 'entrance'),
});
const audioService = new AudioService({
  repo: repo,
  extractor: createProductionExtractorGuard(),
  cache: cache,
  sourceMode: 'production',
});
const entrance = new EntrancePreviewService({
  repo: repo,
  audioService: audioService,
  cache: cache,
  sourceMode: 'production',
});

(async function () {
  for (let i = 0; i < ALLOWED_CARDS.length; i++) {
    for (let s = 0; s < SLOTS.length; s++) {
      const hit = await audioService.getVoiceAudio(ALLOWED_CARDS[i], SLOTS[s]);
      assert.ok(hit.path, ALLOWED_CARDS[i] + ' ' + SLOTS[s]);
      assert.ok(isPlayableWav(hit.path));
    }
  }
  const sheep = await audioService.getVoiceAudio('TIME_005t9t', 'play');
  assert.ok(sheep.path);
  const sheepA = await audioService.getVoiceAudio('TIME_005t9t', 'attack');
  const sheepD = await audioService.getVoiceAudio('TIME_005t9t', 'death');
  assert.ok(sheepA.path && sheepD.path);

  let capErr = null;
  try { await audioService.getVoiceAudio('CAP_107', 'play'); } catch (e) { capErr = e; }
  assert.ok(capErr);
  assert.strictEqual(capErr.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(audioErrorHttpStatus(capErr.code), 404);
  assert.strictEqual(audioErrorBody(capErr).code, 'AUDIO_NOT_AVAILABLE');

  let jailErr = null;
  try { await entrance.getEntrancePreview('JAIL_443'); } catch (e) { jailErr = e; }
  assert.ok(jailErr);
  assert.strictEqual(jailErr.code, 'AUDIO_NOT_AVAILABLE');

  let unknownErr = null;
  try { await audioService.getVoiceAudio('UNKNOWN_CARD', 'play'); } catch (e) { unknownErr = e; }
  assert.ok(unknownErr);
  assert.strictEqual(unknownErr.code, 'NO_VOICE');

  const after = snapshotProduction(ROOT);
  assert.strictEqual(after.manifestSha256, prod.manifestSha256);

  console.log('ok phase210I2ProductionCopy', {
    copied: result.copy.copied,
    files: prod.files,
    voice: prod.voice,
    catalog: catalog.cards.length,
  });
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
