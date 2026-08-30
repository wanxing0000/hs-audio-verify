const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePcm16Wav } = require('../src/explorer/wavPcm16.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');
const {
  resolveAudioSourceMode,
  resolveAudioDirs,
} = require('../src/services/audioSourceMode.js');
const {
  requiredProductionRelativePaths,
  prepareProductionMiniEnv,
  assertProductionRuntimeReady,
} = require('../src/services/productionRuntime.js');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

assert.strictEqual(resolveAudioSourceMode(undefined), 'development');
assert.strictEqual(resolveAudioSourceMode('production'), 'production');
let invalid = false;
try {
  resolveAudioSourceMode('abc');
} catch (e) {
  invalid = e.code === 'HS_AUDIO_SOURCE_INVALID';
}
assert.ok(invalid, 'invalid HS_AUDIO_SOURCE must throw');

const prodDirs = resolveAudioDirs(ROOT, 'production');
assert.ok(prodDirs.audioDir.replace(/\\/g, '/').endsWith('data/production-audio/voice'));
assert.ok(prodDirs.musicDir.replace(/\\/g, '/').endsWith('data/production-audio/music'));
assert.ok(prodDirs.previewDir.replace(/\\/g, '/').endsWith('data/production-audio/entrance'));
assert.ok(!prodDirs.audioDir.includes('tmp'));

const pkg = read('package.json');
assert.ok(pkg.includes('"start:production"'));
assert.ok(pkg.includes('scripts/run-production-mini.cjs'));
assert.ok(!/set\s+NODE_ENV/.test(pkg), 'package.json must not hardcode Windows set NODE_ENV');
assert.ok(pkg.includes('"mini": "node scripts/run-mini.cjs"'));

const startSrc = read('scripts/run-production-mini.cjs');
assert.ok(!/C:\\Hearthstone/.test(startSrc));
assert.ok(!/Data\\Win/.test(startSrc));
assert.ok(startSrc.includes('prepareProductionMiniEnv'));
assert.ok(startSrc.includes('miniServer.js'));
assert.ok(!startSrc.includes('esbuild'));
assert.ok(!startSrc.includes('HearthstoneAudioExtractor'));

const prepared = prepareProductionMiniEnv({});
assert.strictEqual(prepared.NODE_ENV, 'production');
assert.strictEqual(prepared.HS_AUDIO_SOURCE, 'production');
assert.strictEqual(prepared.MINI_SKIP_LAN_WRITE, '1');

let blockedDev = false;
try {
  prepareProductionMiniEnv({ HS_AUDIO_SOURCE: 'development' });
} catch (e) {
  blockedDev = e.code === 'HS_AUDIO_SOURCE_INVALID';
}
assert.ok(blockedDev, 'start:production must not accept development');

assertProductionRuntimeReady(ROOT);
requiredProductionRelativePaths().forEach((rel) => {
  assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
});

const example = read('.env.example');
assert.ok(example.includes('SUPABASE_URL='));
assert.ok(example.includes('SUPABASE_ANON_KEY='));
assert.ok(example.includes('SUPABASE_SERVICE_ROLE_KEY='));
assert.ok(example.includes('HS_AUDIO_SOURCE=production'));
assert.ok(example.includes('MINI_HOST=0.0.0.0'));
assert.ok(example.includes('MINI_PORT=8767'));
assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(example));
assert.ok(!/sb_secret_/.test(example));
assert.ok(!/https:\/\/[a-z0-9]+\.supabase\.co/.test(example));
assert.ok(!/C:\\Hearthstone/.test(example));

const ignore = read('.gitignore');
assert.ok(ignore.includes('.env'));
assert.ok(ignore.includes('!.env.example'));
assert.ok(ignore.includes('node_modules/'));
assert.ok(ignore.includes('tmp/'));
assert.ok(ignore.includes('data/production-audio/'));
assert.ok(!/data\/index\/\s*$/m.test(ignore), 'data/index must not be gitignored');

const pcm = Buffer.alloc(16);
pcm.writeInt16LE(800, 0);
const wav = writePcm16Wav(pcm, 1, 8000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-linux-ready-'));
const cache = new AudioCache({
  audioDir: path.join(dir, 'voice'),
  musicDir: path.join(dir, 'music'),
  previewDir: path.join(dir, 'entrance'),
});
cache.write('voice', 'VO_HIT', wav);
cache.write('music', 'HIT_MusicStinger', wav);
cache.write('preview', 'HIT_entrance_v3', wav);

const calls = { extractVoice: 0, extractFirstMusicClipInBundle: 0 };
const extractor = {
  async extractVoice() {
    calls.extractVoice += 1;
    throw new Error('HS must not be read');
  },
  async extractFirstMusicClipInBundle() {
    calls.extractFirstMusicClipInBundle += 1;
    throw new Error('bundle scan');
  },
};
const repo = {
  getCardVoice(id) {
    if (id === 'HIT') return { playable: true, voiceKey: 'VO_HIT' };
    if (id === 'MISS') return { playable: true, voiceKey: 'VO_MISS' };
    return { playable: false, voiceKey: null };
  },
  getMusicMeta(id) {
    if (id === 'HIT' || id === 'MISS') return { audioClip: 'Clip' };
    return null;
  },
  getCard(id) {
    return id === 'HIT' || id === 'MISS'
      ? { entrancePreview: { available: true }, tracks: { play: { available: true }, music: { available: true } } }
      : null;
  },
};
const audioService = new AudioService({ repo, extractor, cache, sourceMode: 'production' });
const entrance = new EntrancePreviewService({ repo, audioService, cache, sourceMode: 'production' });

(async () => {
  const voiceHit = await audioService.getVoiceAudio('HIT', 'play');
  assert.ok(voiceHit.cached);
  assert.strictEqual(calls.extractVoice, 0);

  let voiceMiss = null;
  try {
    await audioService.getVoiceAudio('MISS', 'play');
  } catch (e) {
    voiceMiss = e;
  }
  assert.strictEqual(voiceMiss.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(audioErrorHttpStatus(voiceMiss.code), 404);
  assert.strictEqual(audioErrorBody(voiceMiss).code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(calls.extractVoice, 0);

  const musicHit = await audioService.getMusicAudio('HIT');
  assert.ok(musicHit.cached);
  assert.strictEqual(calls.extractFirstMusicClipInBundle, 0);

  let musicMiss = null;
  try {
    await audioService.getMusicAudio('MISS');
  } catch (e) {
    musicMiss = e;
  }
  assert.strictEqual(musicMiss.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(calls.extractVoice, 0);

  const entranceHit = await entrance.getEntrancePreview('HIT');
  assert.strictEqual(entranceHit.source, 'cache');

  let entranceMiss = null;
  try {
    await entrance.getEntrancePreview('MISS');
  } catch (e) {
    entranceMiss = e;
  }
  assert.strictEqual(entranceMiss.code, 'AUDIO_NOT_AVAILABLE');
  assert.strictEqual(calls.extractVoice, 0);

  const serverSrc = read('src/miniprogram/miniServer.js');
  assert.ok(serverSrc.includes('isProductionAudioSource(audioSourceMode)'));
  assert.ok(serverSrc.includes('createProductionExtractorGuard'));
  assert.ok(!/DEFAULT_HS_WIN/.test(serverSrc));

  console.log('ok productionLinuxReadiness');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
