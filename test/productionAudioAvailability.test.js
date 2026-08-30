'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  createProductionAudioInventory,
  loadProductionAudioInventory,
  applyProductionToAdaptedCard,
  applyProductionToPublicDetail,
} = require('../src/services/productionAudioAvailability.js');
const { adaptCard, publicDetail, toListCard, buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { getCardAudioAvailability } = require('../src/miniprogram/audioAvailability.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'production-audio', 'manifest.json');
const AUDIO_INDEX = path.join(ROOT, 'data', 'index', 'card-audio-index.json');
const CLIPS_INDEX = path.join(ROOT, 'data', 'index', 'audio-index.json');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function countFiles(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

const fakeInventory = createProductionAudioInventory({
  voice: [
    { file: 'voice/HIT_Play.wav', cardIds: ['HIT'], types: ['play'] },
  ],
  music: [
    { file: 'music/HIT_MusicStinger.wav', cardId: 'HIT' },
  ],
  entrance: [
    { file: 'entrance/HIT_entrance_v3.wav', cardId: 'HIT' },
  ],
});

assert.strictEqual(fakeInventory.hasVoice('HIT', 'play'), true);
assert.strictEqual(fakeInventory.hasMusic('HIT'), true);
assert.strictEqual(fakeInventory.hasEntrance('HIT'), true);
assert.strictEqual(fakeInventory.hasVoice('MISS', 'play'), false);
assert.strictEqual(fakeInventory.hasMusic('MISS'), false);
assert.strictEqual(fakeInventory.hasEntrance('MISS'), false);

const mapped = {
  id: 'MISS',
  voice: { play: { available: true, voiceKey: 'VO_MISS' }, attack: { available: false }, death: { available: false } },
  music: { available: true, musicAssetId: 'asset', audioClipName: 'Clip' },
  entrancePreview: { available: true },
};
const after = applyProductionToAdaptedCard(mapped, fakeInventory);
assert.strictEqual(after.voice.play.available, false);
assert.strictEqual(after.voice.play.voiceKey, 'VO_MISS');
assert.strictEqual(after.music.available, false);
assert.strictEqual(after.music.musicAssetId, 'asset');
assert.strictEqual(after.entrancePreview.available, false);

const hitCard = {
  id: 'HIT',
  voice: { play: { available: true, voiceKey: 'VO_HIT' }, attack: { available: false }, death: { available: false } },
  music: { available: true, musicAssetId: 'hit-asset' },
  entrancePreview: { available: true },
};
const hitAfter = applyProductionToAdaptedCard(hitCard, fakeInventory);
assert.strictEqual(hitAfter.voice.play.available, true);
assert.strictEqual(hitAfter.music.available, true);
assert.strictEqual(hitAfter.entrancePreview.available, true);

const noneMapped = applyProductionToAdaptedCard({
  id: 'NONE',
  voice: { play: { available: false }, attack: { available: false }, death: { available: false } },
  music: { available: false },
  entrancePreview: { available: false },
}, fakeInventory);
assert.strictEqual(noneMapped.entrancePreview.available, false);

const unchanged = applyProductionToAdaptedCard(mapped, null);
assert.strictEqual(unchanged.entrancePreview.available, true);

const leeroy = adaptCard(JSON.parse(fs.readFileSync(AUDIO_INDEX, 'utf8')).cards.EX1_116);
const leeroyDetail = publicDetail(leeroy);
assert.ok(leeroyDetail.entrancePreview.available);
assert.ok(applyProductionToPublicDetail(leeroyDetail, null).entrancePreview.available);

if (!fs.existsSync(MANIFEST)) {
  console.log('ok productionAudioAvailability isolated (no local production-audio)');
  process.exit(0);
}

const beforeSha = sha256File(MANIFEST);
const beforeCount = countFiles(path.join(ROOT, 'data', 'production-audio'));
const inventory = loadProductionAudioInventory(path.join(ROOT, 'data', 'production-audio'));
assert.ok(inventory);

const unified = JSON.parse(fs.readFileSync(AUDIO_INDEX, 'utf8'));
const clips = JSON.parse(fs.readFileSync(CLIPS_INDEX, 'utf8')).clips;
const catalog = buildCatalog(unified);

function advertised(id) {
  const raw = unified.cards[id];
  const adapted = applyProductionToAdaptedCard(adaptCard(raw), inventory);
  const detail = applyProductionToPublicDetail(
    publicDetail(adapted, getCardAudioAvailability(raw, clips)),
    inventory
  );
  const list = toListCard(adapted);
  return { adapted: adapted, detail: detail, list: list };
}

const jail = advertised('JAIL_443');
assert.ok(jail.adapted.voice.play.voiceKey);
assert.strictEqual(jail.detail.entrancePreview.available, false);
assert.strictEqual(jail.list.hasEntrance, false);
assert.notStrictEqual(jail.list.quickPlay.type, 'entrance');
assert.ok(jail.detail.music.musicAssetId || jail.adapted.music.musicAssetId);

const cap = advertised('CAP_107');
assert.strictEqual(cap.detail.voice.play.available, false);
assert.strictEqual(cap.list.hasPlay, false);

const voiceHit = advertised('AT_003');
assert.strictEqual(voiceHit.detail.voice.play.available, true);
assert.strictEqual(voiceHit.list.hasPlay, true);

const musicHit = advertised('AT_027');
assert.strictEqual(musicHit.detail.music.available, true);
assert.strictEqual(musicHit.list.hasMusic, true);

const entranceHit = advertised('AT_072');
assert.strictEqual(entranceHit.detail.entrancePreview.available, true);
assert.strictEqual(entranceHit.list.hasEntrance, true);
assert.strictEqual(entranceHit.list.quickPlay.type, 'entrance');

assert.ok(catalog.cards.length >= 1);
assert.strictEqual(sha256File(MANIFEST), beforeSha);
assert.strictEqual(countFiles(path.join(ROOT, 'data', 'production-audio')), beforeCount);

console.log('ok productionAudioAvailability', {
  jailEntrance: jail.detail.entrancePreview.available,
  capPlay: cap.detail.voice.play.available,
  files: beforeCount,
});
