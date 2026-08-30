'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { adaptCard, publicDetail, buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { getCardAudioAvailability } = require('../src/miniprogram/audioAvailability.js');
const { LATEST_BATCH_SIZE } = require('../miniprogram/utils/latestGroups.js');
const {
  loadProductionAudioInventory,
  applyProductionToPublicDetail,
} = require('../src/services/productionAudioAvailability.js');
const { createProductionAudioInventory } = require('../src/services/productionAudioAvailability.js');
const {
  relatedAudioSlots,
  canPlayRelatedSlot,
  createRelatedCardIndex,
  attachRelatedCards,
  resolveDetailCard,
} = require('../src/miniprogram/relatedCards.js');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const { createProductionExtractorGuard } = require('../src/services/audioSourceMode.js');
const { sha256File } = require('../src/services/productionAudioPackage.js');
const audio = require('../miniprogram/utils/audio.js');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'data', 'production-audio');
const MANIFEST = path.join(DEST, 'manifest.json');
const beforeSha = sha256File(MANIFEST);

const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
const catalog = buildCatalog(unified);
const relatedIndex = createRelatedCardIndex(unified.cards);
const inventory = loadProductionAudioInventory(DEST);

assert.strictEqual(catalog.cards.length, 7263);
assert.ok(!catalog.byId.TIME_609t1);
assert.ok(!catalog.byId.TIME_005t9t);
assert.strictEqual(LATEST_BATCH_SIZE, 20);
assert.strictEqual(audio.getVoiceUrl('AT_003', 'play'), 'https://api.hsvoiceguide.online/api/audio/voice/AT_003/play');
assert.strictEqual(audio.getVoiceUrl('TIME_609t1', 'attack'), 'https://api.hsvoiceguide.online/api/audio/voice/TIME_609t1/attack');
assert.strictEqual(audio.getVoiceUrl('TIME_609t1', 'death'), 'https://api.hsvoiceguide.online/api/audio/voice/TIME_609t1/death');

const emptyInv = createProductionAudioInventory({ voice: [], music: [], entrance: [] });
const mappedOnly = relatedAudioSlots({
  id: 'FAKE_T',
  voice: {
    play: { status: 'available', voiceKey: 'VO_FAKE_T_Play' },
    attack: { status: 'available', voiceKey: 'VO_FAKE_T_Attack' },
    death: { status: 'unavailable', voiceKey: null },
  },
}, emptyInv);
assert.strictEqual(mappedOnly.play.available, false);
assert.strictEqual(mappedOnly.play.voiceKey, 'VO_FAKE_T_Play');
assert.strictEqual(mappedOnly.attack.available, false);
assert.strictEqual(mappedOnly.death.available, false);
assert.strictEqual(mappedOnly.death.voiceKey, null);

const presentInv = createProductionAudioInventory({
  voice: [{ voiceKey: 'VO_FAKE_T_Play', cardIds: ['FAKE_T'], types: ['play'] }],
  music: [],
  entrance: [],
});
const playOnly = relatedAudioSlots({
  id: 'FAKE_T',
  voice: {
    play: { status: 'available', voiceKey: 'VO_FAKE_T_Play' },
    attack: { status: 'available', voiceKey: 'VO_FAKE_T_Attack' },
    death: { status: 'available', voiceKey: 'VO_FAKE_T_Death' },
  },
}, presentInv);
assert.strictEqual(playOnly.play.available, true);
assert.strictEqual(playOnly.attack.available, false);
assert.strictEqual(playOnly.death.available, false);
assert.strictEqual(canPlayRelatedSlot({ audioSlots: playOnly }, 'play'), true);
assert.strictEqual(canPlayRelatedSlot({ audioSlots: playOnly }, 'attack'), false);
assert.strictEqual(canPlayRelatedSlot({ audioSlots: playOnly }, 'music'), false);
assert.strictEqual(canPlayRelatedSlot({ audioSlots: playOnly }, 'entrance'), false);
assert.strictEqual(canPlayRelatedSlot(null, 'play'), false);

function cardPayload(id) {
  const card = resolveDetailCard(id, catalog, unified);
  if (!card) return null;
  const raw = unified.cards[id];
  let body = publicDetail(card, getCardAudioAvailability(raw, clips.clips));
  if (inventory) body = applyProductionToPublicDetail(body, inventory);
  return attachRelatedCards(body, relatedIndex, inventory);
}

function findRelated(list, id) {
  for (let i = 0; i < (list || []).length; i++) {
    if (list[i].id === id) return list[i];
    const kids = list[i].relatedCards || [];
    for (let j = 0; j < kids.length; j++) {
      if (kids[j].id === id) return kids[j];
    }
  }
  return null;
}

function assertSlots(row, play, attack, death) {
  assert.ok(row, 'missing related row');
  assert.ok(row.audioSlots);
  assert.strictEqual(row.audioSlots.play.available, play, row.id + ' play');
  assert.strictEqual(row.audioSlots.attack.available, attack, row.id + ' attack');
  assert.strictEqual(row.audioSlots.death.available, death, row.id + ' death');
  assert.strictEqual(canPlayRelatedSlot(row, 'play'), play);
  assert.strictEqual(canPlayRelatedSlot(row, 'attack'), attack);
  assert.strictEqual(canPlayRelatedSlot(row, 'death'), death);
}

const syl = cardPayload('TIME_609');
assertSlots(findRelated(syl.relatedCards, 'TIME_609t1'), true, true, true);
assertSlots(findRelated(syl.relatedCards, 'TIME_609t2'), true, true, true);
assert.ok(findRelated(syl.relatedCards, 'TIME_609t1').audioSlots.play.voiceKey);
assert.ok(findRelated(syl.relatedCards, 'TIME_609t1').audioSlots.attack.voiceKey);
assert.ok(findRelated(syl.relatedCards, 'TIME_609t1').audioSlots.death.voiceKey);

const raf = cardPayload('TIME_005');
['TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5', 'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9'].forEach(function (id) {
  assertSlots(findRelated(raf.relatedCards, id), true, true, true);
});
const sheep = findRelated(raf.relatedCards, 'TIME_005t9t');
assertSlots(sheep, true, true, true);
assert.strictEqual(sheep.audioSlots.play.voiceKey, 'TIME_005t9t_Play');
assert.strictEqual(sheep.audioSlots.attack.voiceKey, 'TIME_005t9t_Attack');
assert.strictEqual(sheep.audioSlots.death.voiceKey, 'TIME_005t9t_Death');

const at003 = cardPayload('AT_003');
assert.strictEqual(at003.voice.play.available, true);
const at027 = cardPayload('AT_027');
assert.strictEqual(at027.music.available, true);
const at072 = cardPayload('AT_072');
assert.strictEqual(at072.entrancePreview.available, true);

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

const cardJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.js'), 'utf8');
const cardWxml = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.wxml'), 'utf8');
assert.ok(!cardJs.includes('data/production-audio'));
assert.ok(!cardJs.includes('manifest.json'));
assert.ok(!/available:\s*true/.test(cardJs));
assert.ok(cardJs.includes('getVoiceUrl'));
assert.ok(cardJs.includes('rec.available !== true'));
assert.ok(cardWxml.includes('data-slot="attack"'));
assert.ok(cardWxml.includes('data-slot="death"'));
assert.ok(!cardWxml.includes('C:\\\\Hearthstone'));

assert.strictEqual(catalog.cards.length, 7263);

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
  const play = await audioService.getVoiceAudio('TIME_609t1', 'play');
  const attack = await audioService.getVoiceAudio('TIME_609t1', 'attack');
  const death = await audioService.getVoiceAudio('TIME_609t1', 'death');
  assert.ok(play.path && attack.path && death.path);

  const sheepPlay = await audioService.getVoiceAudio('TIME_005t9t', 'play');
  assert.ok(sheepPlay.path);

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

  let unknownErr = null;
  try { await audioService.getVoiceAudio('UNKNOWN_CARD_ZZZ', 'play'); } catch (e) { unknownErr = e; }
  assert.ok(unknownErr);
  assert.strictEqual(unknownErr.code, 'NO_VOICE');
  assert.strictEqual(audioErrorHttpStatus(unknownErr.code), 404);

  assert.strictEqual(sha256File(MANIFEST), beforeSha);
  console.log('ok phase210FRelatedAudioUi');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
