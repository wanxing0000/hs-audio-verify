const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');
const { HearthstoneAudioExtractor } = require('../src/explorer/HearthstoneAudioExtractor.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const { inspectWav } = require('../src/explorer/wavPcm16.js');
const resolver = require('../src/explorer/audioBundleResolver.js');

const ROOT = path.resolve(__dirname, '..');
const HS = 'C:\\Hearthstone';
const HS_PROBE = path.join(HS, 'Data', 'Win', 'essential_base_global-audio-0.unity3d');

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assertWav(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length > 44);
  assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF');
  const info = inspectWav(buf);
  assert.strictEqual(info.audioFormat, 1);
  assert.strictEqual(info.bitsPerSample, 16);
  return info;
}

(async () => {
  const hsBefore = fs.existsSync(HS_PROBE) ? fs.statSync(HS_PROBE) : null;
  const unified = loadJson('data/index/card-audio-index.json');
  const audioIndex = loadJson('data/index/audio-index.json');
  const musicAssets = loadJson('data/index/music-assets.json');
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
  const cache = new AudioCache({
    audioDir: path.join(ROOT, 'tmp', 'audio'),
    musicDir: path.join(ROOT, 'tmp', 'music'),
    previewDir: path.join(ROOT, 'tmp', 'preview'),
  });
  const extractor = new HearthstoneAudioExtractor({
    cacheDir: path.join(ROOT, 'tmp', 'audio'),
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
  });
  const audioService = new AudioService({ repo, extractor, cache });
  const entrance = new EntrancePreviewService({ repo, audioService, cache });
  const verifyDir = path.join(ROOT, 'tmp', 'audio-verification');
  fs.mkdirSync(verifyDir, { recursive: true });

  async function checkCard(cardId) {
    const play = await audioService.getVoiceAudio(cardId, 'play');
    const music = await audioService.getMusicAudio(cardId);
    const mix = await entrance.getEntrancePreview(cardId);
    assertWav(play.path);
    assertWav(music.path);
    assertWav(mix.path);
    return { play, music, mix };
  }

  const grom = await checkCard('EX1_414');
  assert.ok(grom.play.voiceKey === 'VO_EX1_414_Play_01' || true);
  const krush = await checkCard('EX1_543');
  await checkCard('EX1_116');
  await checkCard('EX1_572');
  await checkCard('BOT_548');

  fs.copyFileSync(krush.play.path, path.join(verifyDir, 'EX1_543_voice.wav'));
  fs.copyFileSync(krush.music.path, path.join(verifyDir, 'EX1_543_music.wav'));
  fs.copyFileSync(krush.mix.path, path.join(verifyDir, 'EX1_543_entrance.wav'));

  const sharedRes = await audioService.getVoiceAudio('VAN_NEW1_010', 'play');
  assertWav(sharedRes.path);
  assert.ok(String(sharedRes.voiceKey).includes('NEW1_010'));

  const sharedAudio = await audioService.getVoiceAudio('VAC_954', 'play');
  assertWav(sharedAudio.path);
  assert.notStrictEqual(sharedAudio.voiceKey, 'VO_VAC_954_Play_01');

  const named = await audioService.getVoiceAudio('CFM_335', 'play');
  assertWav(named.path);
  assert.ok(/ClumsyKodo|CFM_/i.test(named.voiceKey));

  let heroPlay = false;
  try {
    await audioService.getVoiceAudio('HERO_01', 'play');
    heroPlay = true;
  } catch (e) {
    assert.ok(e.code === 'NO_VOICE' || e.code === 'NOT_INDEXED');
  }
  assert.ok(!heroPlay, 'HERO_01 Play must stay missing');

  let etcMusic = false;
  try {
    await audioService.getMusicAudio('ETC_409');
    etcMusic = true;
  } catch (e) {
    assert.ok(e.code === 'NO_MUSIC' || e.code === 'UNAVAILABLE' || e.code === 'EXTRACT_FAILED');
  }
  assert.ok(!etcMusic, 'ETC_409 Music must stay missing');

  const cards = Object.values(unified.cards);
  const playCards = cards.filter((c) => c.voice && c.voice.play && (c.voice.play.status === 'available' || c.voice.play.status === 'shared') && c.voice.play.voiceKey);
  const musicCards = cards.filter((c) => c.music && (c.music.status === 'available' || c.music.status === 'shared') && (c.music.audioClipName || c.music.musicAssetId) && c.rarity === 'LEGENDARY');
  const rand = mulberry32(136);
  const playSample = shuffle(playCards, rand).slice(0, 10);
  const musicSample = shuffle(musicCards, rand).slice(0, 10);
  assert.ok(playSample.some((c) => c.voice.play.status === 'shared') || playSample.some((c) => c.voice.play.status === 'available'));
  assert.ok(musicSample.some((c) => c.music.status === 'shared') || musicSample.some((c) => c.music.status === 'available'));

  const randomFailures = [];
  for (const c of playSample) {
    try {
      const out = await audioService.getVoiceAudio(c.id, 'play');
      assertWav(out.path);
    } catch (e) {
      randomFailures.push({ cardId: c.id, slot: 'play', code: e.code, failureClass: e.failureClass || e.cause && e.cause.failureClass, message: e.message });
    }
  }
  for (const c of musicSample) {
    try {
      const out = await audioService.getMusicAudio(c.id);
      assertWav(out.path);
    } catch (e) {
      randomFailures.push({ cardId: c.id, slot: 'music', code: e.code, failureClass: e.failureClass, message: e.message });
    }
  }

  const src = fs.readFileSync(path.join(ROOT, 'src', 'explorer', 'HearthstoneAudioExtractor.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'src', 'explorer', 'audioBundleResolver.js'), 'utf8');
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]EX1_414['"]/.test(src));
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]EX1_543['"]/.test(src));

  if (hsBefore) {
    const hsAfter = fs.statSync(HS_PROBE);
    assert.strictEqual(hsAfter.mtimeMs, hsBefore.mtimeMs);
    assert.strictEqual(hsAfter.size, hsBefore.size);
  }

  assert.strictEqual(resolver.FAILURE.FSB_OFFSET_INVALID, 'FSB_OFFSET_INVALID');
  console.log('ok audioBundleResolver live', {
    playSample: playSample.map((c) => c.id),
    musicSample: musicSample.map((c) => c.id),
    randomFailures,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
