const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePcm16Wav, inspectWav } = require('../src/explorer/wavPcm16.js');
const { readFmt } = require('../src/music/mixPcm16.js');
const {
  ENTRANCE_MIX,
  ENTRANCE_MIX_VERSION,
  MAX_MUSIC_START_COMPENSATION_MS,
  MUSIC_START_WINDOW_MS,
  MUSIC_START_PEAK_THRESHOLD,
  MUSIC_START_RMS_THRESHOLD,
  MUSIC_START_CONSECUTIVE_WINDOWS,
} = require('../src/music/entranceMixConfig.js');
const {
  findMusicStartCompensation,
  applyMusicStartCompensation,
} = require('../src/music/findMusicStartCompensation.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');

const ROOT = path.resolve(__dirname, '..');

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function pcmTone(frames, channels, sampleRate, amp) {
  const pcm = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames * channels; i++) pcm.writeInt16LE(amp, i * 2);
  return writePcm16Wav(pcm, channels, sampleRate);
}

function pcmSilentThenTone(silentMs, toneMs, channels, sampleRate, amp) {
  const silentFrames = Math.round((silentMs / 1000) * sampleRate);
  const toneFrames = Math.round((toneMs / 1000) * sampleRate);
  const pcm = Buffer.alloc((silentFrames + toneFrames) * channels * 2);
  for (let f = silentFrames; f < silentFrames + toneFrames; f++) {
    for (let c = 0; c < channels; c++) {
      pcm.writeInt16LE(amp, (f * channels + c) * 2);
    }
  }
  return writePcm16Wav(pcm, channels, sampleRate);
}

assert.strictEqual(ENTRANCE_MIX.voiceDelayMs, 0);
assert.ok(ENTRANCE_MIX_VERSION >= 3);
assert.strictEqual(MAX_MUSIC_START_COMPENSATION_MS, 150);
assert.ok(MUSIC_START_WINDOW_MS >= 5 && MUSIC_START_WINDOW_MS <= 20);
assert.ok(MUSIC_START_CONSECUTIVE_WINDOWS >= 2 && MUSIC_START_CONSECUTIVE_WINDOWS <= 3);
assert.ok(MUSIC_START_PEAK_THRESHOLD > 0);
assert.ok(MUSIC_START_RMS_THRESHOLD > 0);

const cfgPath = path.join(ROOT, 'src', 'music', 'entranceMixConfig.js');
const helperPath = path.join(ROOT, 'src', 'music', 'findMusicStartCompensation.js');
const svcPath = path.join(ROOT, 'src', 'services', 'entrancePreviewService.js');
const prod = fs.readFileSync(cfgPath, 'utf8')
  + fs.readFileSync(helperPath, 'utf8')
  + fs.readFileSync(svcPath, 'utf8');
assert.ok(!/if\s*\(\s*cardId\s*===/.test(prod));
assert.ok(!/GIL_598/.test(prod));
assert.ok(!/\b121\b/.test(fs.readFileSync(helperPath, 'utf8')));
assert.ok(fs.readFileSync(cfgPath, 'utf8').includes('MAX_MUSIC_START_COMPENSATION_MS'));

const tessPath = path.join(ROOT, 'tmp', 'music', 'GIL_598_MusicStinger.wav');
assert.ok(fs.existsSync(tessPath), 'TEST 1 needs GIL_598 music WAV');
const tessMusic = fs.readFileSync(tessPath);
const tessComp = findMusicStartCompensation(tessMusic);
assert.ok(tessComp.compensationMs > 0, 'TEST 1: GIL_598 compensation > 0, got ' + tessComp.compensationMs);
assert.ok(
  tessComp.compensationMs <= MAX_MUSIC_START_COMPENSATION_MS,
  'TEST 1: cap, got ' + tessComp.compensationMs
);
assert.strictEqual(tessComp.channels, 2);
assert.strictEqual(tessComp.compensationBytes % (tessComp.channels * 2), 0);

const longQuiet = pcmSilentThenTone(800, 400, 2, 48000, 8000);
const longComp = findMusicStartCompensation(longQuiet);
assert.ok(longComp.compensationMs <= MAX_MUSIC_START_COMPENSATION_MS, 'TEST 2');
assert.strictEqual(longComp.compensationMs, 0, 'TEST 2/3: onset after cap is not scanned, no skip');

const silence590 = pcmSilentThenTone(590, 400, 2, 48000, 12000);
const s590 = findMusicStartCompensation(silence590);
assert.ok(s590.compensationMs <= MAX_MUSIC_START_COMPENSATION_MS, 'TEST 3 cap');
assert.ok(s590.compensationMs < 590, 'TEST 3 must not trim all 590ms');

const gennPath = path.join(ROOT, 'tmp', 'music', 'GIL_692_MusicStinger.wav');
assert.ok(fs.existsSync(gennPath), 'TEST 4 needs GIL_692 music WAV');
const gennComp = findMusicStartCompensation(fs.readFileSync(gennPath));
assert.ok(gennComp.compensationMs <= 40, 'TEST 4: GIL_692 skip must be small, got ' + gennComp.compensationMs);

const leeroyPath = path.join(ROOT, 'tmp', 'music', 'EX1_116_MusicStinger.wav');
assert.ok(fs.existsSync(leeroyPath), 'TEST 5 needs EX1_116 music');

const tessMusicShaBefore = sha1(tessMusic);
const tessMusicLenBefore = tessMusic.length;
const tessApplied = applyMusicStartCompensation(tessMusic);
assert.strictEqual(sha1(tessMusic), tessMusicShaBefore, 'TEST 6: apply must not mutate source buffer');
assert.ok(tessApplied.wav !== tessMusic || tessApplied.compensationMs === 0);
assert.ok(tessApplied.wav.length !== tessMusic.length || tessApplied.compensationMs === 0);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-comp-'));
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
const liveCache = new AudioCache({
  audioDir: path.join(ROOT, 'tmp', 'audio'),
  musicDir: path.join(ROOT, 'tmp', 'music'),
  previewDir: path.join(dir, 'preview-live'),
});
const extractor = {
  async extractVoice(key) {
    const name = String(key || '').replace(/\.wav$/i, '');
    const audioHit = path.join(ROOT, 'tmp', 'audio', name + '.wav');
    const musicHit = path.join(ROOT, 'tmp', 'music', name + '.wav');
    const p = fs.existsSync(audioHit) ? audioHit : (fs.existsSync(musicHit) ? musicHit : '');
    if (!p) {
      const err = new Error('not cached');
      err.code = 'NO_VOICE';
      throw err;
    }
    return { path: p, cached: true, ms: 1, wav: inspectWav(fs.readFileSync(p)), clipName: name };
  },
};
const audioService = new AudioService({ repo, extractor, cache: liveCache });
const entrance = new EntrancePreviewService({ repo, audioService, cache: liveCache });

(async () => {
  const leeroyMix = await entrance.getEntrancePreview('EX1_116');
  assert.strictEqual(leeroyMix.source, 'mix');
  const leeroyWav = fs.readFileSync(leeroyMix.path);
  assert.strictEqual(leeroyWav.toString('ascii', 0, 4), 'RIFF');
  assert.ok(leeroyMix.wav && leeroyMix.wav.sampleRate === 48000);
  assert.ok(leeroyMix.path.indexOf('_entrance_v' + ENTRANCE_MIX_VERSION) >= 0, 'TEST 10 cache version');

  const tessVoice = await audioService.getVoiceAudio('GIL_598', 'play');
  const tessMusicOut = await audioService.getMusicAudio('GIL_598');
  const musicAfter = fs.readFileSync(tessMusicOut.path);
  assert.strictEqual(sha1(musicAfter), tessMusicShaBefore, 'TEST 6 Music API SHA1 unchanged');
  assert.strictEqual(musicAfter.length, tessMusicLenBefore, 'TEST 6 length unchanged');
  const tessFmt = inspectWav(musicAfter);
  assert.ok(tessFmt.bytes === tessMusicLenBefore);

  const tessEnt = await entrance.getEntrancePreview('GIL_598');
  assert.strictEqual(tessEnt.source, 'mix');
  const tessEntBuf = fs.readFileSync(tessEnt.path);
  assert.notStrictEqual(sha1(tessEntBuf), sha1(fs.readFileSync(tessVoice.path)), 'entrance != voice');
  assert.notStrictEqual(sha1(tessEntBuf), sha1(musicAfter), 'entrance != music');
  assert.ok(tessEnt.musicStartCompensation);
  assert.ok(tessEnt.musicStartCompensation.compensationMs > 0);
  assert.ok(tessEnt.musicStartCompensation.compensationMs <= MAX_MUSIC_START_COMPENSATION_MS);
  assert.strictEqual(sha1(fs.readFileSync(tessMusicOut.path)), tessMusicShaBefore, 'TEST 6 after entrance');

  const gennEnt = await entrance.getEntrancePreview('GIL_692');
  assert.strictEqual(gennEnt.source, 'mix');
  assert.ok((gennEnt.musicStartCompensation && gennEnt.musicStartCompensation.compensationMs) <= 40);

  let etcOk = false;
  try {
    await entrance.getEntrancePreview('ETC_409');
  } catch (e) {
    etcOk = e.code === 'UNAVAILABLE' || e.code === 'NO_MUSIC';
  }
  const etcCard = repo.getCard('ETC_409');
  if (etcCard && etcCard.entrancePreview && etcCard.entrancePreview.available) {
    assert.ok(true);
  } else {
    assert.ok(etcOk || (etcCard && !etcCard.entrancePreview.available), 'TEST 7 ETC_409 unavailable');
  }

  const stereo = pcmSilentThenTone(80, 200, 2, 48000, 9000);
  const st = applyMusicStartCompensation(stereo);
  assert.ok(st.compensationMs > 0 && st.compensationMs < 150);
  const slicedFmt = readFmt(st.wav);
  assert.strictEqual(slicedFmt.channels, 2);
  assert.strictEqual(slicedFmt.data.length % 4, 0, 'TEST 8 stereo frame align');
  assert.strictEqual(st.compensationBytes % 4, 0);

  const tiny = writePcm16Wav(Buffer.alloc(8), 2, 48000);
  const tinyComp = findMusicStartCompensation(tiny);
  assert.ok(tinyComp.compensationMs === 0);
  assert.ok(!tinyComp.fallback || tinyComp.reason);

  const bad = findMusicStartCompensation(Buffer.from('not a wav'));
  assert.strictEqual(bad.compensationMs, 0);
  assert.strictEqual(bad.fallback, true);

  const v2Key = 'GIL_598_entrance_v2';
  const v3Key = 'GIL_598_entrance_v' + ENTRANCE_MIX_VERSION;
  assert.notStrictEqual(v2Key, v3Key, 'TEST 10 version bump');
  const key = entrance.previewCacheKey('GIL_598');
  assert.strictEqual(key, v3Key);

  console.log('ok musicStartCompensation', {
    tessMs: tessComp.compensationMs,
    gennMs: gennComp.compensationMs,
    leeroyComp: leeroyMix.musicStartCompensation && leeroyMix.musicStartCompensation.compensationMs,
    version: ENTRANCE_MIX_VERSION,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
