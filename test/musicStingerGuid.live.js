const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');
const { HearthstoneAudioExtractor } = require('../src/explorer/HearthstoneAudioExtractor.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService } = require('../src/services/audioService.js');
const { inspectWav } = require('../src/explorer/wavPcm16.js');
const resolver = require('../src/explorer/audioBundleResolver.js');

const ROOT = path.resolve(__dirname, '..');

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
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

  const tessMeta = repo.getMusicMeta('GIL_598');
  assert.ok(tessMeta && tessMeta.audioClip);
  const tessGuid = await extractor.recoverSoundDefClipGuid(
    tessMeta.bundle,
    tessMeta.prefabGuid,
    tessMeta.audioClip,
  );
  assert.ok(tessGuid);

  const tessAsset = repo.getVoiceAsset(tessMeta.audioClip);
  const tessCands = extractor.resolveCandidates(tessAsset, tessMeta.audioClip);
  assert.ok(tessCands.length > 0);

  let tessWinner = null;
  for (const candidate of tessCands) {
    const inspection = await extractor.inspectCandidate(candidate, tessMeta.audioClip, {
      decode: true,
      audioClipGuid: tessGuid,
    });
    if (inspection.valid && inspection.decode === 'success') {
      tessWinner = { candidate, inspection };
      break;
    }
  }
  assert.ok(tessWinner, 'TEST 1-4: Tess BGM must resolve and decode');
  assert.ok(tessWinner.candidate.bundleName, 'TEST 3: bundle is not null');
  assert.strictEqual(tessWinner.inspection.decode, 'success', 'TEST 4');
  assert.ok(tessWinner.inspection.wav && tessWinner.inspection.wav.length > 44, 'TEST 5');
  inspectWav(tessWinner.inspection.wav);

  const tessVoice = await audioService.getVoiceAudio('GIL_598', 'play');
  assertWav(tessVoice.path);
  const tessMusic = await audioService.getMusicAudio('GIL_598');
  assertWav(tessMusic.path);

  const gennMeta = repo.getMusicMeta('GIL_692');
  const genn = await audioService.getMusicAudio('GIL_692');
  assertWav(genn.path);
  assert.strictEqual(genn.audioClip, gennMeta.audioClip);

  const shared = await audioService.getMusicAudio('CORE_GIL_598');
  assertWav(shared.path);

  const leeroy = await audioService.getMusicAudio('EX1_116');
  assertWav(leeroy.path);

  let missingOk = false;
  try {
    await extractor.extractVoice('Pegasus_Stinger_DoesNotExist_ZZZ');
  } catch (e) {
    missingOk = e.failureClass === resolver.FAILURE.CLIP_NOT_FOUND
      || e.code === 'EXTRACT_FAILED'
      || e.code === 'NOT_INDEXED';
    if (e.failureClass) assert.strictEqual(e.failureClass, resolver.FAILURE.CLIP_NOT_FOUND);
  }
  assert.ok(missingOk, 'TEST 7: missing clip must fail');

  const src = fs.readFileSync(path.join(ROOT, 'src', 'explorer', 'audioBundleResolver.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'src', 'explorer', 'HearthstoneAudioExtractor.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'src', 'services', 'audioService.js'), 'utf8');
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]GIL_598['"]/.test(src));
  assert.ok(!/if\s*\(\s*clipName\s*===\s*['"]Gilneas_Play_Stinger_6['"]/.test(src));

  console.log('ok musicStingerGuid live', {
    tessBundle: tessWinner.candidate.bundleName,
    tessReason: tessWinner.candidate.reason,
    tessGuid,
    tessWavBytes: tessMusic.wav && tessMusic.wav.dataBytes,
    gennClip: genn.audioClip,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
