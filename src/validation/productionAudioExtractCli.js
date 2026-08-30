const fs = require('fs');
const path = require('path');
const {
  buildCatalog,
  featuredCards,
  filterLatestCards,
  loadLatestSetConfig,
  parseLatestSetConfig,
  voicePlayable,
  musicPlayable,
} = require('../miniprogram/catalogAdapter.js');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { AudioCache, safeName } = require('../services/audioCache.js');
const { AudioService } = require('../services/audioService.js');
const { EntrancePreviewService } = require('../services/entrancePreviewService.js');
const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
const { ENTRANCE_MIX_VERSION } = require('../music/entranceMixConfig.js');
const {
  productionAudioPaths,
  isPlayableWav,
  buildProductionAudioPackage,
} = require('../services/productionAudioPackage.js');
const { tryCreateSupabaseAdmin } = require('../services/supabaseClient.js');
const { loadLatestRuntime } = require('../services/latestSetRuntime.js');

const ROOT = process.cwd();

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function wavPath(dir, key) {
  return path.join(dir, safeName(key) + '.wav');
}

function hasWav(dir, key) {
  return isPlayableWav(wavPath(dir, key));
}

function copyIfNeeded(src, dest) {
  if (!isPlayableWav(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isPlayableWav(dest)) return true;
  fs.copyFileSync(src, dest);
  return true;
}

function seedWav(searchDirs, destDir, key) {
  const dest = wavPath(destDir, key);
  if (isPlayableWav(dest)) return true;
  for (const dir of searchDirs) {
    if (copyIfNeeded(wavPath(dir, key), dest)) return true;
  }
  return false;
}

function emptyStats() {
  return {
    total: 0,
    already_present: 0,
    newly_extracted: 0,
    unavailable: 0,
    extraction_failed: 0,
    details: [],
  };
}

function note(stats, status, extra) {
  stats[status] += 1;
  stats.details.push(Object.assign({ status }, extra));
}

async function resolveLatestConfig(paths) {
  const jsonPath = path.join(ROOT, 'data', 'index', 'latest-set.json');
  const fileCfg = loadLatestSetConfig(jsonPath);
  const boot = tryCreateSupabaseAdmin();
  if (!boot.ok || !boot.client) {
    return { config: fileCfg, source: 'json' };
  }
  const runtime = await loadLatestRuntime({
    parseLatestSetConfig,
    loadLatestSetConfig,
    jsonPath,
    client: boot.client,
  });
  const cfg = runtime.getLatestSetConfig();
  return { config: cfg || fileCfg, source: runtime.getSource() };
}

async function extractOne(label, fn) {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.code) || 'EXTRACTION_FAILED', message: (e && e.message) || String(e) };
  }
}

async function main() {
  const paths = productionAudioPaths(ROOT);
  const unified = loadJson(paths.cardIndex);
  const audioIndex = loadJson(path.join(ROOT, 'data', 'index', 'audio-index.json'));
  const musicAssets = loadJson(paths.musicAssets);
  const catalog = buildCatalog(unified);
  const cards = unified.cards || {};
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
  const latestInfo = await resolveLatestConfig(paths);
  const latestCfg = latestInfo.config;
  const featured = featuredCards(catalog.cards);
  const latest = filterLatestCards(catalog.cards, latestCfg.set);

  const prodVoice = path.join(paths.dest, 'voice');
  const prodMusic = path.join(paths.dest, 'music');
  const prodEntrance = path.join(paths.dest, 'entrance');
  const extractVoice = path.join(paths.extract, 'voice');
  const extractMusic = path.join(paths.extract, 'music');
  const extractEntrance = path.join(paths.extract, 'entrance');
  fs.mkdirSync(extractVoice, { recursive: true });
  fs.mkdirSync(extractMusic, { recursive: true });
  fs.mkdirSync(extractEntrance, { recursive: true });

  const cache = new AudioCache({
    audioDir: extractVoice,
    musicDir: extractMusic,
    previewDir: extractEntrance,
  });
  const extractor = new HearthstoneAudioExtractor({
    cacheDir: extractVoice,
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
  });
  const audioService = new AudioService({ repo, extractor, cache, sourceMode: 'development' });
  const entrance = new EntrancePreviewService({
    repo,
    audioService,
    cache,
    sourceMode: 'development',
  });

  const voiceSearch = [prodVoice, paths.tmpAudio, extractVoice];
  const musicSearch = [prodMusic, paths.tmpMusic, extractMusic];
  const previewSearch = [prodEntrance, paths.tmpPreview, extractEntrance];

  async function ensureVoice(cardId, type) {
    const raw = cards[cardId];
    const slot = raw && raw.voice && raw.voice[type];
    if (!voicePlayable(slot)) return { status: 'unavailable' };
    if (hasWav(prodVoice, slot.voiceKey) || hasWav(paths.tmpAudio, slot.voiceKey) || hasWav(extractVoice, slot.voiceKey)) {
      seedWav(voiceSearch, extractVoice, slot.voiceKey);
      return { status: 'already_present', voiceKey: slot.voiceKey };
    }
    const out = await extractOne('voice', () => audioService.getVoiceAudio(cardId, type));
    if (!out.ok) return { status: 'extraction_failed', voiceKey: slot.voiceKey, error: out.error, message: out.message };
    return { status: 'newly_extracted', voiceKey: slot.voiceKey };
  }

  async function ensureMusic(cardId) {
    const raw = cards[cardId];
    if (!musicPlayable(raw && raw.music)) return { status: 'unavailable' };
    const keys = [cardId + '_MusicStinger'];
    if (raw.music.audioClipName) keys.push(raw.music.audioClipName);
    if (keys.some((k) => hasWav(prodMusic, k) || hasWav(paths.tmpMusic, k) || hasWav(extractMusic, k))) {
      keys.forEach((k) => seedWav(musicSearch, extractMusic, k));
      return { status: 'already_present' };
    }
    const out = await extractOne('music', () => audioService.getMusicAudio(cardId));
    if (!out.ok) return { status: 'extraction_failed', error: out.error, message: out.message };
    return { status: 'newly_extracted' };
  }

  async function ensureEntrance(cardId) {
    const raw = cards[cardId];
    const playOn = voicePlayable(raw && raw.voice && raw.voice.play);
    const musicOn = musicPlayable(raw && raw.music);
    if (!playOn || !musicOn) return { status: 'unavailable' };
    const key = cardId + '_entrance_v' + ENTRANCE_MIX_VERSION;
    if (hasWav(prodEntrance, key) || hasWav(paths.tmpPreview, key) || hasWav(extractEntrance, key)) {
      seedWav(previewSearch, extractEntrance, key);
      return { status: 'already_present' };
    }
    if (playOn) await ensureVoice(cardId, 'play');
    if (musicOn) await ensureMusic(cardId);
    const out = await extractOne('entrance', () => entrance.getEntrancePreview(cardId));
    if (!out.ok) return { status: 'extraction_failed', error: out.error, message: out.message };
    return { status: 'newly_extracted' };
  }

  const featuredStats = {
    play: emptyStats(),
    music: emptyStats(),
    entrance: emptyStats(),
  };
  for (const card of featured) {
    featuredStats.play.total += 1;
    const play = await ensureVoice(card.id, 'play');
    note(featuredStats.play, play.status, { cardId: card.id, name: card.name, type: 'play', voiceKey: play.voiceKey, error: play.error });
    featuredStats.music.total += 1;
    const music = await ensureMusic(card.id);
    note(featuredStats.music, music.status, { cardId: card.id, name: card.name, type: 'music', error: music.error });
    featuredStats.entrance.total += 1;
    const ent = await ensureEntrance(card.id);
    note(featuredStats.entrance, ent.status, { cardId: card.id, name: card.name, type: 'entrance', error: ent.error });
  }

  const latestStats = emptyStats();
  for (const card of latest) {
    const raw = cards[card.id];
    if (!voicePlayable(raw && raw.voice && raw.voice.play)) {
      latestStats.total += 1;
      note(latestStats, 'unavailable', { cardId: card.id, name: card.name, type: 'play' });
      continue;
    }
    latestStats.total += 1;
    const play = await ensureVoice(card.id, 'play');
    note(latestStats, play.status, { cardId: card.id, name: card.name, type: 'play', voiceKey: play.voiceKey, error: play.error });
  }

  const rebuilt = buildProductionAudioPackage({ root: ROOT });
  const report = {
    latestSet: { set: latestCfg.set, source: latestInfo.source, count: latest.length },
    featuredCount: featured.length,
    featured: featuredStats,
    latestPlay: latestStats,
    package: {
      voice: rebuilt.counts.voice,
      music: rebuilt.counts.music,
      entrance: rebuilt.counts.entrance,
      bytes: rebuilt.bytes,
    },
  };
  const outPath = path.join(ROOT, 'tmp', 'production-audio-extract', 'extract-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
