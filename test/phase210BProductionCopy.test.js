'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { adaptCard, publicDetail, buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { getCardAudioAvailability } = require('../src/miniprogram/audioAvailability.js');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');
const {
  loadProductionAudioInventory,
  applyProductionToAdaptedCard,
  applyProductionToPublicDetail,
} = require('../src/services/productionAudioAvailability.js');
const {
  createRelatedCardIndex,
  relatedAudioStatus,
  attachRelatedCards,
  resolveDetailCard,
} = require('../src/miniprogram/relatedCards.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const { createProductionExtractorGuard } = require('../src/services/audioSourceMode.js');
const { isPlayableWav, sha256File } = require('../src/services/productionAudioPackage.js');
const {
  TARGET_CARD_IDS,
  EXPECTED_PLAY_VOICE_KEYS,
} = require('../src/audit/relatedAudioProductionCopy.js');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'data', 'production-audio');
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
const catalog = buildCatalog(unified);
const inventory = loadProductionAudioInventory(DEST);
const relatedIndex = createRelatedCardIndex(unified.cards);

assert.strictEqual(catalog.cards.length, 7263);
assert.ok(!catalog.byId.TIME_609t1);
assert.ok(!catalog.byId.TIME_005t9t);
assert.ok(catalog.byId.TIME_609);
assert.ok(catalog.byId.TIME_005);

TARGET_CARD_IDS.forEach(function (cardId) {
  const raw = unified.cards[cardId];
  assert.ok(raw, cardId + ' missing from audio index');
  const playKey = raw.voice && raw.voice.play && raw.voice.play.voiceKey;
  assert.strictEqual(playKey, EXPECTED_PLAY_VOICE_KEYS[cardId], cardId + ' voiceKey');
  const dest = path.join(DEST, 'voice', playKey + '.wav');
  assert.ok(isPlayableWav(dest), cardId + ' production wav');
  const audio = relatedAudioStatus(raw, inventory);
  assert.strictEqual(audio.indexed, true, cardId + ' indexed');
  assert.strictEqual(audio.productionAvailable, true, cardId + ' production');
  assert.strictEqual(audio.playable, true, cardId + ' playable');
  const adapted = applyProductionToAdaptedCard(adaptCard(raw), inventory);
  assert.strictEqual(adapted.voice.play.available, true, cardId + ' play available');
});

function detail(id) {
  const card = resolveDetailCard(id, catalog, unified);
  const raw = unified.cards[id];
  let body = publicDetail(card, getCardAudioAvailability(raw, clips.clips));
  body = applyProductionToPublicDetail(body, inventory);
  return attachRelatedCards(body, relatedIndex, inventory);
}

const syl = detail('TIME_609');
assert.deepStrictEqual(syl.relatedCards.map((r) => r.id).sort(), ['TIME_609t1', 'TIME_609t2']);
syl.relatedCards.forEach(function (row) {
  assert.strictEqual(row.audio.indexed, true);
  assert.strictEqual(row.audio.productionAvailable, true);
  assert.strictEqual(row.audio.playable, true);
});

const raf = detail('TIME_005');
const rafIds = raf.relatedCards.map((r) => r.id);
['TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5', 'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9'].forEach(function (id) {
  assert.ok(rafIds.indexOf(id) >= 0, id);
});
assert.strictEqual(rafIds.indexOf('TIME_005t9t'), -1);
const mage = raf.relatedCards.find((r) => r.id === 'TIME_005t9');
assert.strictEqual(mage.relatedCards[0].id, 'TIME_005t9t');
assert.strictEqual(mage.relatedCards[0].audio.playable, true);

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
  const hit = await audioService.getVoiceAudio('TIME_609t1', 'play');
  assert.ok(hit.path);
  assert.ok(isPlayableWav(hit.path));

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
  assert.strictEqual(audioErrorHttpStatus(jailErr.code), 404);
  assert.strictEqual(audioErrorBody(jailErr).code, 'AUDIO_NOT_AVAILABLE');

  console.log('ok phase210BProductionCopy', {
    catalog: catalog.cards.length,
    copiedSha: sha256File(path.join(DEST, 'voice', EXPECTED_PLAY_VOICE_KEYS.TIME_609t1 + '.wav')),
  });
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
