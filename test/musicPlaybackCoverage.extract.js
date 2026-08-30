const fs = require('fs');
const path = require('path');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');
const { adaptCard, publicDetail } = require('../src/miniprogram/catalogAdapter.js');
const { HearthstoneAudioExtractor } = require('../src/explorer/HearthstoneAudioExtractor.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService } = require('../src/services/audioService.js');
const { inspectWav } = require('../src/explorer/wavPcm16.js');

const ROOT = process.cwd();
const listPath = process.argv[2];
if (!listPath) {
  console.error('usage: music-coverage-extract.cjs <ids.json>');
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
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

function inspectFile(p) {
  const buf = fs.readFileSync(p);
  const wav = inspectWav(buf);
  return {
    riff: buf.toString('ascii', 0, 4) === 'RIFF',
    audioFormat: wav.audioFormat,
    bitsPerSample: wav.bitsPerSample,
    sampleRate: wav.sampleRate,
    size: buf.length,
  };
}

async function extractOne(cardId) {
  const raw = unified.cards[cardId];
  const adapted = raw ? adaptCard(raw) : null;
  const pub = adapted ? publicDetail(adapted) : null;
  const meta = repo.getMusicMeta(cardId);
  const row = {
    cardId,
    name: raw ? raw.name : null,
    indexStatus: raw && raw.music ? raw.music.status : null,
    miniStatus: pub && pub.music ? pub.music.status : null,
    musicAssetId: meta && meta.prefabGuid,
    audioClipName: meta && meta.audioClip,
    bundle: meta && meta.bundle,
    ok: false,
    statusCode: null,
    wav: null,
    reason: null,
  };
  if (!meta) {
    row.statusCode = 404;
    row.reason = 'NO_MUSIC';
    return row;
  }
  try {
    const out = await audioService.getMusicAudio(cardId);
    const wav = inspectFile(out.path);
    row.ok = wav.riff && wav.audioFormat === 1 && wav.bitsPerSample === 16;
    row.statusCode = row.ok ? 200 : 500;
    row.wav = wav;
    row.audioClipName = out.audioClip || row.audioClipName;
    if (!row.ok) row.reason = 'WAV_NOT_PCM16';
  } catch (e) {
    row.statusCode = (e.code === 'NO_MUSIC' || e.code === 'NO_VOICE' || e.code === 'UNAVAILABLE' || e.code === 'NOT_INDEXED') ? 404 : 500;
    row.reason = (e.code || 'EXTRACT_FAILED') + ': ' + (e.causeMessage || e.message);
  }
  return row;
}

(async () => {
  const ids = spec.ids || [];
  const results = [];
  for (const id of ids) results.push(await extractOne(id));
  const outPath = spec.outPath || path.join(ROOT, 'tmp', 'music-coverage-extract.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, outPath, count: results.length }) + '\n');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
