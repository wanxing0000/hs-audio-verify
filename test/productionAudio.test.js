const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { writePcm16Wav, inspectWav } = require('../src/explorer/wavPcm16.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const {
  resolveAudioSourceMode,
  isProductionAudioSource,
  createProductionExtractorGuard,
} = require('../src/services/audioSourceMode.js');
const {
  buildProductionAudioPackage,
  verifyProductionPackage,
  stableManifestView,
  productionAudioPaths,
  isPlayableWav,
} = require('../src/services/productionAudioPackage.js');

const ROOT = path.resolve(__dirname, '..');

function toneWav() {
  const pcm = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) pcm.writeInt16LE(i % 2 ? 1200 : -1200, i * 2);
  return writePcm16Wav(pcm, 1, 8000);
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
}

function trackingExtractor() {
  const calls = { extractVoice: 0, extractFirstMusicClipInBundle: 0, keys: [] };
  return {
    calls,
    async extractVoice(key) {
      calls.extractVoice += 1;
      calls.keys.push(key);
      const err = new Error('mock extract should not hit Hearthstone');
      err.code = 'EXTRACT_FAILED';
      throw err;
    },
    async extractFirstMusicClipInBundle() {
      calls.extractFirstMusicClipInBundle += 1;
      const err = new Error('mock bundle scan');
      err.code = 'EXTRACT_FAILED';
      throw err;
    },
  };
}

function fixtureRepo() {
  return {
    getCardVoice(cardId, type) {
      if (cardId === 'HIT' && type === 'play') return { playable: true, voiceKey: 'VO_HIT_PLAY' };
      if (cardId === 'MISS' && type === 'play') return { playable: true, voiceKey: 'VO_MISS_PLAY' };
      return { playable: false, voiceKey: null };
    },
    getMusicMeta(cardId) {
      if (cardId === 'HIT') return { audioClip: 'Clip_Hit' };
      if (cardId === 'MISS') return { audioClip: 'Clip_Miss' };
      return null;
    },
    getCard(cardId) {
      if (cardId === 'HIT' || cardId === 'MISS') {
        return {
          entrancePreview: { available: true },
          tracks: { play: { available: true }, music: { available: true } },
        };
      }
      return null;
    },
  };
}

function request(base, pathname) {
  return new Promise((resolve, reject) => {
    http.get(base + pathname, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (String(res.headers['content-type'] || '').indexOf('json') >= 0) {
          json = JSON.parse(buf.toString('utf8'));
        }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    }).on('error', reject);
  });
}

function startTestServer({ audioService, entrance, repo }) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const sendErr = (e) => {
        const body = audioErrorBody(e);
        res.writeHead(audioErrorHttpStatus(e && e.code), { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      };
      try {
        if (url.pathname.startsWith('/api/audio/voice/')) {
          const rest = decodeURIComponent(url.pathname.slice('/api/audio/voice/'.length));
          const [cardId, type] = rest.split('/');
          const out = await audioService.getVoiceAudio(cardId, type);
          const data = fs.readFileSync(out.path);
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length) });
          return res.end(data);
        }
        if (url.pathname.startsWith('/api/audio/music/')) {
          const cardId = decodeURIComponent(url.pathname.slice('/api/audio/music/'.length));
          const out = await audioService.getMusicAudio(cardId);
          const data = fs.readFileSync(out.path);
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length) });
          return res.end(data);
        }
        if (url.pathname.startsWith('/api/audio/entrance/')) {
          const cardId = decodeURIComponent(url.pathname.slice('/api/audio/entrance/'.length));
          const card = repo.getCard(cardId);
          if (!card || !card.entrancePreview || !card.entrancePreview.available) {
            const err = new Error('暂无完整登场音频');
            err.code = 'UNAVAILABLE';
            err.userMessage = '暂无完整登场音频';
            return sendErr(err);
          }
          const out = await entrance.getEntrancePreview(cardId);
          const data = fs.readFileSync(out.path);
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length) });
          return res.end(data);
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      } catch (e) {
        sendErr(e);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

function fixtureIndex() {
  return {
    cards: {
      HIT: {
        id: 'HIT',
        voice: {
          play: { status: 'available', voiceKey: 'VO_HIT_PLAY' },
        },
        music: { status: 'available', audioClipName: 'Clip_Hit', musicAssetId: 'guid-hit' },
      },
      MISS: {
        id: 'MISS',
        voice: {
          play: { status: 'available', voiceKey: 'VO_MISS_PLAY' },
        },
        music: { status: 'available', audioClipName: 'Clip_Miss', musicAssetId: 'guid-miss' },
      },
    },
  };
}

(async () => {
  assert.strictEqual(resolveAudioSourceMode(undefined), 'development');
  assert.strictEqual(resolveAudioSourceMode(''), 'development');
  assert.strictEqual(resolveAudioSourceMode('development'), 'development');
  assert.strictEqual(resolveAudioSourceMode('production'), 'production');
  assert.strictEqual(isProductionAudioSource('production'), true);
  let invalid = false;
  try {
    resolveAudioSourceMode('abc');
  } catch (e) {
    invalid = e.code === 'HS_AUDIO_SOURCE_INVALID';
  }
  assert.ok(invalid, 'TEST 9: illegal HS_AUDIO_SOURCE must throw');

  const wav = toneWav();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-prod-audio-'));
  const cache = new AudioCache({
    audioDir: path.join(dir, 'voice'),
    musicDir: path.join(dir, 'music'),
    previewDir: path.join(dir, 'entrance'),
  });
  cache.write('voice', 'VO_HIT_PLAY', wav);
  cache.write('music', 'HIT_MusicStinger', wav);
  cache.write('preview', 'HIT_entrance_v3', wav);

  const extractor = trackingExtractor();
  const repo = fixtureRepo();
  const audioService = new AudioService({
    repo,
    extractor,
    cache,
    sourceMode: 'production',
  });
  const entrance = new EntrancePreviewService({
    repo,
    audioService,
    cache,
    sourceMode: 'production',
  });
  const httpSrv = await startTestServer({ audioService, entrance, repo });

  const voiceHit = await request(httpSrv.base, '/api/audio/voice/HIT/play');
  assert.strictEqual(voiceHit.status, 200, 'TEST 1');
  assert.strictEqual(voiceHit.headers['content-type'], 'audio/wav');
  assert.strictEqual(inspectWav(voiceHit.buf).bitsPerSample, 16);
  assert.strictEqual(extractor.calls.extractVoice, 0, 'TEST 1 extractor not called');

  const voiceMiss = await request(httpSrv.base, '/api/audio/voice/MISS/play');
  assert.strictEqual(voiceMiss.status, 404, 'TEST 2');
  assert.strictEqual(voiceMiss.json.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(voiceMiss.json.error, '暂时无法播放');
  assert.ok(!JSON.stringify(voiceMiss.json).includes(dir));
  assert.strictEqual(extractor.calls.extractVoice, 0, 'TEST 2 extractVoice not called');

  const musicHit = await request(httpSrv.base, '/api/audio/music/HIT');
  assert.strictEqual(musicHit.status, 200, 'TEST 3');
  assert.strictEqual(extractor.calls.extractVoice, 0);
  assert.strictEqual(extractor.calls.extractFirstMusicClipInBundle, 0);

  const musicMiss = await request(httpSrv.base, '/api/audio/music/MISS');
  assert.strictEqual(musicMiss.status, 404, 'TEST 4');
  assert.strictEqual(musicMiss.json.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(extractor.calls.extractVoice, 0);
  assert.strictEqual(extractor.calls.extractFirstMusicClipInBundle, 0);

  const entranceHit = await request(httpSrv.base, '/api/audio/entrance/HIT');
  assert.strictEqual(entranceHit.status, 200, 'TEST 5');

  const entranceMiss = await request(httpSrv.base, '/api/audio/entrance/MISS');
  assert.strictEqual(entranceMiss.status, 404, 'TEST 6');
  assert.strictEqual(entranceMiss.json.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(extractor.calls.extractVoice, 0);

  const guard = createProductionExtractorGuard();
  let guardThrew = false;
  try {
    await guard.extractVoice('VO_X');
  } catch (e) {
    guardThrew = e.code === 'AUDIO_NOT_AVAILABLE';
  }
  assert.ok(guardThrew);

  httpSrv.server.close();

  const devDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-dev-audio-'));
  const devCache = new AudioCache({
    audioDir: path.join(devDir, 'audio'),
    musicDir: path.join(devDir, 'music'),
    previewDir: path.join(devDir, 'preview'),
  });
  devCache.write('voice', 'VO_HIT_PLAY', wav);
  const devExtract = trackingExtractor();
  const devSvc = new AudioService({
    repo,
    extractor: devExtract,
    cache: devCache,
    sourceMode: 'development',
  });
  const devHit = await devSvc.getVoiceAudio('HIT', 'play');
  assert.strictEqual(devHit.cached, true, 'TEST 7');
  assert.strictEqual(devExtract.calls.extractVoice, 0, 'TEST 7 no extractor on cache hit');

  let devMissCalled = false;
  try {
    await devSvc.getVoiceAudio('MISS', 'play');
  } catch (e) {
    devMissCalled = e.code === 'EXTRACT_FAILED';
  }
  assert.ok(devMissCalled, 'TEST 8 development miss may call extractor');
  assert.strictEqual(devExtract.calls.extractVoice, 1, 'TEST 8 extractor called');

  const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-prod-pkg-'));
  const tmpAudio = path.join(pkgRoot, 'tmp', 'audio');
  const tmpMusic = path.join(pkgRoot, 'tmp', 'music');
  const tmpPreview = path.join(pkgRoot, 'tmp', 'preview');
  fs.mkdirSync(tmpAudio, { recursive: true });
  fs.mkdirSync(tmpMusic, { recursive: true });
  fs.mkdirSync(tmpPreview, { recursive: true });
  fs.writeFileSync(path.join(tmpAudio, 'VO_HIT_PLAY.wav'), wav);
  fs.writeFileSync(path.join(tmpAudio, 'Clip_Hit.wav'), wav);
  fs.writeFileSync(path.join(tmpMusic, 'HIT_MusicStinger.wav'), wav);
  fs.writeFileSync(path.join(tmpMusic, 'EX1_116_entrance_preview.wav'), wav);
  fs.writeFileSync(path.join(tmpMusic, 'EX1_116_MusicStinger.fsb'), Buffer.from('FSB5junk'));
  fs.writeFileSync(path.join(tmpPreview, 'HIT_entrance_v3.wav'), wav);
  fs.writeFileSync(path.join(tmpPreview, 'HIT_entrance.wav'), wav);
  fs.writeFileSync(path.join(tmpPreview, 'HIT_entrance_v2.wav'), wav);
  writeJson(path.join(pkgRoot, 'data', 'index', 'card-audio-index.json'), fixtureIndex());

  const built = buildProductionAudioPackage({
    root: pkgRoot,
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.strictEqual(built.counts.voice, 1);
  assert.strictEqual(built.counts.music, 1);
  assert.strictEqual(built.counts.entrance, 1);
  const verified = verifyProductionPackage(built.dest);
  assert.strictEqual(verified.voice[0].sha256, built.manifest.voice[0].sha256, 'TEST 10');
  assert.ok(isPlayableWav(path.join(built.dest, verified.voice[0].file)), 'TEST 11');
  const entranceNames = fs.readdirSync(path.join(built.dest, 'entrance'));
  assert.deepStrictEqual(entranceNames, ['HIT_entrance_v3.wav'], 'TEST 12');
  const musicNames = fs.readdirSync(path.join(built.dest, 'music'));
  assert.ok(musicNames.every((n) => !/\.fsb$/i.test(n)), 'TEST 13');
  assert.ok(!musicNames.some((n) => /entrance_preview/i.test(n)), 'TEST 13 no test previews');

  const dest = path.join(pkgRoot, 'data', 'production-audio');
  fs.writeFileSync(path.join(dest, 'KEEP.txt'), 'original');
  let failed = false;
  try {
    buildProductionAudioPackage({
      root: pkgRoot,
      generatedAt: '2026-01-02T00:00:00.000Z',
      failAfterStaging: function () {
        throw new Error('forced staging failure');
      },
    });
  } catch (e) {
    failed = e.message === 'forced staging failure';
  }
  assert.ok(failed, 'TEST 14 staging failure thrown');
  assert.ok(fs.existsSync(path.join(dest, 'KEEP.txt')), 'TEST 14 old package kept');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'KEEP.txt'), 'utf8'), 'original');

  fs.unlinkSync(path.join(dest, 'KEEP.txt'));
  const first = buildProductionAudioPackage({
    root: pkgRoot,
    generatedAt: '2026-02-01T00:00:00.000Z',
  });
  const second = buildProductionAudioPackage({
    root: pkgRoot,
    generatedAt: '2026-03-01T00:00:00.000Z',
  });
  assert.notStrictEqual(first.manifest.generatedAt, second.manifest.generatedAt);
  assert.deepStrictEqual(stableManifestView(first.manifest), stableManifestView(second.manifest), 'TEST 15');

  const realDest = productionAudioPaths(ROOT).dest;
  if (fs.existsSync(path.join(realDest, 'manifest.json'))) {
    const real = verifyProductionPackage(realDest);
    assert.ok(real.voice.length >= 0);
    for (const row of real.voice) {
      assert.ok(isPlayableWav(path.join(realDest, row.file)));
    }
    for (const name of fs.readdirSync(path.join(realDest, 'entrance'))) {
      assert.ok(/_entrance_v3\.wav$/i.test(name));
    }
    for (const name of fs.readdirSync(path.join(realDest, 'music'))) {
      assert.ok(!/\.fsb$/i.test(name));
    }
  }

  console.log('ok productionAudio');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
