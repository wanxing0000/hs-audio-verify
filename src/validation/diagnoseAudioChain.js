const fs = require('fs');
const http = require('http');
const path = require('path');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { adaptCard, publicDetail, resolveQuickPlay } = require('../miniprogram/catalogAdapter.js');
const { getCardAudioAvailability } = require('../miniprogram/audioAvailability.js');
const { createAudioUrls } = require('../miniprogram/audioUrls.js');
const { analyzeWav, compareVoiceStartInMix } = require('./audioIntegrity.js');
const { inspectWav } = require('../explorer/wavPcm16.js');

const ROOT = process.cwd();
const HS_WIN = path.join('C:\\Hearthstone', 'Data', 'Win');
const VERIFY_DIR = path.join(ROOT, 'tmp', 'audio-verification');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function layer(name, status, extra) {
  return Object.assign({ name: name, status: status }, extra || {});
}

function createDiagnosticSession(opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const tLoad = Date.now();
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const audioIndex = opts.audioIndex || loadJson(path.join(root, 'data', 'index', 'audio-index.json'));
  const musicAssetsFile = opts.musicAssets || loadJson(path.join(root, 'data', 'index', 'music-assets.json'));
  let cardDefSounds = { byCard: {} };
  const defPath = path.join(root, 'data', 'index', 'cache', 'carddef-sounds.json');
  if (fs.existsSync(defPath)) cardDefSounds = loadJson(defPath);
  const loadMs = Date.now() - tLoad;
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssetsFile);
  const musicBag = musicAssetsFile.assets && typeof musicAssetsFile.assets === 'object'
    ? musicAssetsFile.assets
    : musicAssetsFile;
  const apiBase = opts.apiBase || 'http://127.0.0.1:8767';
  const urls = createAudioUrls(apiBase);
  let services = null;

  function ensureServices() {
    if (services) return services;
    const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
    const { AudioCache } = require('../services/audioCache.js');
    const { AudioService } = require('../services/audioService.js');
    const { EntrancePreviewService } = require('../services/entrancePreviewService.js');
    const cache = new AudioCache({
      audioDir: path.join(root, 'tmp', 'audio'),
      musicDir: path.join(root, 'tmp', 'music'),
      previewDir: path.join(root, 'tmp', 'preview'),
    });
    const extractor = new HearthstoneAudioExtractor({
      cacheDir: path.join(root, 'tmp', 'audio'),
      getVoiceAsset: (key) => repo.getVoiceAsset(key),
    });
    const audioService = new AudioService({ repo, extractor, cache });
    const entrance = new EntrancePreviewService({ repo, audioService, cache });
    services = { cache, extractor, audioService, entrance };
    return services;
  }

  return {
    root,
    unified,
    audioIndex,
    musicBag,
    cardDefSounds,
    repo,
    urls,
    apiBase,
    loadMs,
    ensureServices,
  };
}

function findCardsByName(session, name) {
  const q = String(name || '').trim();
  const out = [];
  const cards = session.unified.cards || {};
  Object.keys(cards).forEach((id) => {
    const c = cards[id];
    if (c && c.name === q) {
      out.push({
        id: c.id,
        name: c.name,
        dbfId: c.dbfId == null ? null : c.dbfId,
        type: c.type || null,
        rarity: c.rarity || null,
        collectible: c.collectible === true,
        set: c.set || null,
        class: c.class || null,
      });
    }
  });
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

function pickDeterministic(ids, n) {
  const sorted = ids.slice().sort();
  const out = [];
  if (!sorted.length || n <= 0) return out;
  if (sorted.length <= n) return sorted;
  const step = sorted.length / n;
  for (let i = 0; i < n; i++) {
    const idx = Math.min(sorted.length - 1, Math.floor(i * step));
    const id = sorted[idx];
    if (out.indexOf(id) < 0) out.push(id);
  }
  for (let i = 0; out.length < n && i < sorted.length; i++) {
    if (out.indexOf(sorted[i]) < 0) out.push(sorted[i]);
  }
  return out;
}

function pickRandomSamples(session) {
  const cards = session.unified.cards || {};
  const full = [];
  const playNoMusic = [];
  const playExtractGap = [];
  Object.keys(cards).forEach((id) => {
    const raw = cards[id];
    if (!raw || raw.collectible !== true) return;
    const adapted = adaptCard(raw);
    if (!adapted) return;
    const playOn = !!(adapted.voice.play && adapted.voice.play.available);
    const musicOn = !!(adapted.music && adapted.music.available);
    const entranceOn = !!(adapted.entrancePreview && adapted.entrancePreview.available);
    if (raw.type === 'MINION' && raw.rarity === 'LEGENDARY' && playOn && musicOn && entranceOn) full.push(id);
    if (playOn && !musicOn) playNoMusic.push(id);
    const diag = getCardAudioAvailability(raw, session.audioIndex.clips);
    if (diag.play && diag.play.status === 'extraction_failed') playExtractGap.push(id);
  });
  return {
    legendaryFull: pickDeterministic(full, 10),
    playNoMusic: pickDeterministic(playNoMusic, 10),
    playFailed: pickDeterministic(playExtractGap, 10),
  };
}

function inspectHeader(buf) {
  if (!buf || buf.length < 44) {
    return { ok: false, riff: false, reason: 'too_small' };
  }
  const riff = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
  let fmt = null;
  try { fmt = inspectWav(buf); } catch (e) {
    return { ok: false, riff: riff, reason: e.message };
  }
  return {
    ok: riff && fmt.audioFormat === 1 && fmt.bitsPerSample === 16,
    riff: riff,
    format: fmt.audioFormat,
    pcm: fmt.audioFormat === 1,
    bitDepth: fmt.bitsPerSample,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bytes: fmt.bytes,
  };
}

function extraPeak(buf, ms) {
  const a = analyzeWav(buf);
  const frames = Math.round((ms / 1000) * a.sampleRate);
  const end = Math.min(buf.length, 44 + frames * a.channels * 2);
  let peak = 0;
  for (let i = 44; i + 2 <= end; i += 2) {
    const s = Math.abs(buf.readInt16LE(i));
    if (s > peak) peak = s;
  }
  return peak;
}

function extraRms(buf, ms) {
  const a = analyzeWav(buf);
  const frames = Math.round((ms / 1000) * a.sampleRate);
  const end = Math.min(buf.length, 44 + frames * a.channels * 2);
  let sum = 0;
  let n = 0;
  for (let i = 44; i + 2 <= end; i += 2) {
    const s = buf.readInt16LE(i);
    sum += s * s;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

function firstSoundAnalysis(buf) {
  const header = inspectHeader(buf);
  if (!header.riff) return { header: header };
  const a = analyzeWav(buf);
  return {
    header: header,
    sampleCount: a.frameCount,
    durationMs: a.durationMs,
    durationSec: a.durationSec,
    sampleRate: a.sampleRate,
    channels: a.channels,
    bitDepth: a.bitsPerSample,
    voiceFirstSoundMs: a.leadingSilenceMs,
    leadingSilenceMs: a.leadingSilenceMs,
    peak100ms: a.peak100ms,
    rms100ms: a.rms100ms,
    peak200ms: a.peak200ms,
    rms200ms: a.rms200ms,
    peak300ms: extraPeak(buf, 300),
    rms300ms: extraRms(buf, 300),
  };
}

function httpProbe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 20000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode === 200,
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          bytes: buf.length,
          header: res.statusCode === 200 ? inspectHeader(buf) : null,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
  });
}

function bundleProbe(session, voiceKey) {
  const asset = session.repo.getVoiceAsset(voiceKey);
  const names = [];
  const add = (n) => { if (n && names.indexOf(n) < 0) names.push(n); };
  (asset.zhcnBundles || []).forEach(add);
  (asset.prefabBundles || []).forEach(add);
  const existing = [];
  const missing = [];
  names.forEach((n) => {
    const p = path.join(HS_WIN, path.basename(n));
    if (fs.existsSync(p)) existing.push(path.basename(n));
    else missing.push(path.basename(n));
  });
  return {
    indexed: !!asset.indexed,
    voiceKey: asset.voiceKey,
    zhcnBundles: asset.zhcnBundles || [],
    prefabBundles: asset.prefabBundles || [],
    existingBundles: existing,
    missingBundles: missing,
    hitBundle: existing[0] || null,
  };
}

function classify(indexHas, extract, api, uiAvailable) {
  if (!indexHas) return 'No Audio Data';
  if (extract && extract.status === 'FAILED') return 'Audio Exists but Extraction Failed';
  if (api && api.probed && !api.ok) return 'API Failed';
  if (uiAvailable === false) return 'UI Hidden';
  if (extract && extract.status === 'SUCCESS' && uiAvailable && (!api || !api.probed || api.ok)) {
    return 'Successfully Playable';
  }
  if (indexHas && uiAvailable) return 'Successfully Playable';
  return 'No Audio Data';
}

function uniqueFailure(indexHas, extract, api, uiAvailable) {
  if (!indexHas) return 'Index';
  if (extract && extract.status === 'FAILED') return 'Extractor';
  if (api && api.probed && !api.ok) return 'API';
  if (uiAvailable === false) return 'UI';
  return null;
}

async function diagnoseVoiceSlot(session, cardId, slotName, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const raw = session.unified.cards[cardId];
  const slot = raw && raw.voice && raw.voice[slotName];
  const indexHas = !!(slot && (slot.status === 'available' || slot.status === 'shared') && slot.voiceKey);
  const voiceKey = indexHas ? slot.voiceKey : null;
  const sourceCardId = indexHas ? (slot.sourceCardId || cardId) : null;
  const cardDef = (session.cardDefSounds.byCard || {})[cardId] || null;
  const defGuid = cardDef && cardDef[slotName] ? cardDef[slotName] : null;
  const clipRec = voiceKey && session.audioIndex.clips ? session.audioIndex.clips[voiceKey] : null;
  const bundles = voiceKey ? bundleProbe(session, voiceKey) : null;
  let extract = { status: 'SKIPPED' };
  if (opts.extract && indexHas) {
    const tEx = Date.now();
    try {
      const svc = session.ensureServices();
      const out = await svc.audioService.getVoiceAudio(cardId, slotName);
      const buf = fs.readFileSync(out.path);
      extract = {
        status: 'SUCCESS',
        path: out.path,
        cached: !!out.cached,
        extractMs: Date.now() - tEx,
        bundle: out.bundle || (bundles && bundles.hitBundle) || null,
        wav: firstSoundAnalysis(buf),
      };
    } catch (e) {
      extract = {
        status: 'FAILED',
        extractMs: Date.now() - tEx,
        code: e.code || 'EXTRACT_FAILED',
        reason: e.causeMessage || e.message,
      };
    }
  } else if (!indexHas) {
    extract = { status: 'SKIPPED', reason: 'no_voice_key' };
  }
  let api = { probed: false };
  if (opts.probeApi && indexHas) {
    const url = session.urls.getVoiceUrl(cardId, slotName);
    api = Object.assign({ probed: true, url: url }, await httpProbe(url));
  }
  const adapted = raw ? adaptCard(raw) : null;
  const uiSlot = adapted && adapted.voice && adapted.voice[slotName];
  const avail = raw ? getCardAudioAvailability(raw, session.audioIndex.clips) : null;
  const uiAvailable = !!(uiSlot && uiSlot.available && !(avail && avail[slotName] && avail[slotName].status === 'extraction_failed'));
  return {
    slot: slotName,
    index: {
      status: indexHas ? 'FOUND' : 'MISSING',
      voiceKey: voiceKey,
      sourceCardId: sourceCardId,
      mappingStatus: slot && slot.status || null,
    },
    cardDef: layer('CardDef', cardDef ? 'FOUND' : 'MISSING', { guid: defGuid || null, files: cardDef && cardDef.files || null }),
    clip: layer('AudioClip', clipRec ? 'FOUND' : (voiceKey ? 'MISSING' : 'SKIP'), {
      voiceKey: voiceKey,
      zhcnBundles: clipRec && clipRec.zhcnBundles || [],
      prefabBundles: clipRec && clipRec.prefabBundles || [],
    }),
    bundle: bundles ? layer('Bundle', bundles.hitBundle ? 'FOUND' : (bundles.indexed ? 'MISSING' : 'SKIP'), bundles) : layer('Bundle', 'SKIP'),
    fsb: layer('FSB', extract.status === 'SUCCESS' ? 'FOUND' : (extract.status === 'FAILED' ? 'MISSING_OR_FAILED' : 'SKIP'), {
      reason: extract.reason || null,
      hitBundle: extract.bundle || (bundles && bundles.hitBundle) || null,
    }),
    wav: extract.status === 'SUCCESS' ? layer('WAV', 'SUCCESS', extract.wav) : layer('WAV', extract.status === 'FAILED' ? 'FAILED' : 'SKIP', { reason: extract.reason || null }),
    extract: extract,
    api: api,
    ui: {
      available: !!(uiSlot && uiSlot.available),
      shared: !!(uiSlot && uiSlot.shared),
      diagnosticStatus: avail && avail[slotName] && avail[slotName].status || null,
    },
    classification: classify(indexHas, extract, api, uiAvailable),
    failurePoint: uniqueFailure(indexHas, extract, api, uiAvailable),
    totalMs: Date.now() - t0,
  };
}

async function diagnoseMusic(session, cardId, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const raw = session.unified.cards[cardId];
  const music = raw && raw.music;
  const indexHas = !!(music && (music.status === 'available' || music.status === 'shared') && (music.audioClipName || music.musicAssetId));
  const guid = indexHas ? music.musicAssetId : null;
  const asset = guid ? session.musicBag[guid] : null;
  const clipName = (music && music.audioClipName) || (asset && asset.audioClipName) || null;
  const meta = session.repo.getMusicMeta(cardId);
  const prefabBundle = asset && asset.bundle ? path.basename(asset.bundle) : (meta && meta.bundle) || null;
  const prefabExists = !!(prefabBundle && fs.existsSync(path.join(HS_WIN, prefabBundle)));
  const clipRec = clipName && session.audioIndex.clips ? session.audioIndex.clips[clipName] : null;
  const bundles = clipName ? bundleProbe(session, clipName) : null;
  const stripped = clipName ? clipName.replace(/'/g, '') : null;
  const nameNotes = {
    raw: clipName,
    hasApostrophe: !!(clipName && clipName.indexOf("'") >= 0),
    strippedApostrophe: stripped !== clipName ? stripped : null,
    shared: !!(music && music.status === 'shared'),
  };
  let extract = { status: 'SKIPPED' };
  if (opts.extract && indexHas) {
    const tEx = Date.now();
    try {
      const svc = session.ensureServices();
      const out = await svc.audioService.getMusicAudio(cardId);
      const buf = fs.readFileSync(out.path);
      extract = {
        status: 'SUCCESS',
        path: out.path,
        cached: !!out.cached,
        extractMs: Date.now() - tEx,
        clipName: out.audioClip || clipName,
        bundle: out.bundle || prefabBundle || (bundles && bundles.hitBundle),
        wav: firstSoundAnalysis(buf),
      };
    } catch (e) {
      extract = {
        status: 'FAILED',
        extractMs: Date.now() - tEx,
        code: e.code || 'EXTRACT_FAILED',
        reason: e.causeMessage || e.message,
      };
    }
  }
  let api = { probed: false };
  if (opts.probeApi && indexHas) {
    const url = session.urls.getMusicUrl(cardId);
    api = Object.assign({ probed: true, url: url }, await httpProbe(url));
  }
  const adapted = raw ? adaptCard(raw) : null;
  const uiAvailable = !!(adapted && adapted.music && adapted.music.available);
  return {
    index: {
      status: indexHas ? 'FOUND' : 'MISSING',
      musicAssetId: guid,
      audioClipName: clipName,
      sourceCardId: music && music.sourceCardId || null,
      mappingStatus: music && music.status || null,
    },
    prefab: layer('Prefab', guid ? (asset || prefabExists ? 'FOUND' : 'MISSING') : 'SKIP', {
      guid: guid,
      prefabName: asset && asset.prefabName || null,
      bundle: prefabBundle,
      bundleExists: prefabExists,
    }),
    soundDef: layer('SoundDef', asset ? 'FOUND' : (guid ? 'MISSING' : 'SKIP'), {
      audioClipName: clipName,
      nameNotes: nameNotes,
    }),
    clip: layer('AudioClip', clipName ? 'FOUND' : 'MISSING', { audioClipName: clipName, indexed: !!clipRec }),
    bundle: bundles ? layer('Bundle', bundles.hitBundle || prefabExists ? 'FOUND' : 'MISSING', {
      indexBundle: prefabBundle,
      hitBundle: bundles.hitBundle || (prefabExists ? prefabBundle : null),
      zhcnBundles: bundles.zhcnBundles,
      prefabBundles: bundles.prefabBundles,
      existingBundles: bundles.existingBundles,
    }) : layer('Bundle', prefabExists ? 'FOUND' : 'SKIP', { indexBundle: prefabBundle }),
    fsb: layer('FSB', extract.status === 'SUCCESS' ? 'FOUND' : (extract.status === 'FAILED' ? 'MISSING_OR_FAILED' : 'SKIP'), {
      reason: extract.reason || null,
    }),
    wav: extract.status === 'SUCCESS' ? layer('WAV', 'SUCCESS', extract.wav) : layer('WAV', extract.status === 'FAILED' ? 'FAILED' : 'SKIP'),
    extract: extract,
    api: api,
    ui: { available: uiAvailable, shared: !!(adapted && adapted.music && adapted.music.shared) },
    classification: classify(indexHas, extract, api, uiAvailable),
    failurePoint: uniqueFailure(indexHas, extract, api, uiAvailable),
    totalMs: Date.now() - t0,
  };
}

async function diagnoseEntrance(session, cardId, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const raw = session.unified.cards[cardId];
  const adapted = raw ? adaptCard(raw) : null;
  const available = !!(adapted && adapted.entrancePreview && adapted.entrancePreview.available);
  let extract = { status: 'SKIPPED' };
  if (opts.extract && available) {
    const tEx = Date.now();
    try {
      const svc = session.ensureServices();
      const out = await svc.entrance.getEntrancePreview(cardId);
      const buf = fs.readFileSync(out.path);
      extract = {
        status: 'SUCCESS',
        path: out.path,
        cached: !!out.cached,
        source: out.source,
        extractMs: Date.now() - tEx,
        wav: firstSoundAnalysis(buf),
      };
    } catch (e) {
      extract = {
        status: 'FAILED',
        extractMs: Date.now() - tEx,
        code: e.code || 'EXTRACT_FAILED',
        reason: e.causeMessage || e.message,
      };
    }
  }
  let api = { probed: false };
  if (opts.probeApi) {
    const url = session.urls.getEntranceUrl(cardId);
    api = Object.assign({ probed: true, url: url }, await httpProbe(url));
  }
  return {
    index: { status: available ? 'FOUND' : 'MISSING', available: available },
    extract: extract,
    api: api,
    ui: { available: available },
    classification: classify(available, extract, api, available),
    failurePoint: uniqueFailure(available, extract, api, available),
    totalMs: Date.now() - t0,
  };
}

async function diagnoseCard(session, cardId, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const raw = session.unified.cards[cardId];
  if (!raw) {
    return {
      cardId: cardId,
      missing: true,
      failurePoint: { play: 'Index', music: 'Index', entrance: 'Index' },
      classification: { play: 'No Audio Data', music: 'No Audio Data', entrance: 'No Audio Data' },
      totalMs: Date.now() - t0,
    };
  }
  const adapted = adaptCard(raw);
  const detail = publicDetail(adapted, getCardAudioAvailability(raw, session.audioIndex.clips));
  const quickPlay = resolveQuickPlay(adapted);
  const play = await diagnoseVoiceSlot(session, cardId, 'play', opts);
  const attack = await diagnoseVoiceSlot(session, cardId, 'attack', opts);
  const death = await diagnoseVoiceSlot(session, cardId, 'death', opts);
  const music = await diagnoseMusic(session, cardId, opts);
  const entrance = await diagnoseEntrance(session, cardId, opts);
  const uiHiddenPlay = detail.voice.play.available !== true && play.index.status === 'FOUND';
  return {
    cardId: raw.id,
    name: raw.name,
    dbfId: raw.dbfId == null ? null : raw.dbfId,
    type: raw.type,
    rarity: raw.rarity,
    collectible: raw.collectible === true,
    set: raw.set,
    class: raw.class,
    loadMs: session.loadMs,
    extractMs: (play.extract && play.extract.extractMs || 0)
      + (music.extract && music.extract.extractMs || 0)
      + (entrance.extract && entrance.extract.extractMs || 0),
    totalMs: Date.now() - t0,
    voice: { play: play, attack: attack, death: death },
    music: music,
    entrance: entrance,
    api: {
      voicePlay: play.api,
      music: music.api,
      entrance: entrance.api,
    },
    ui: {
      voicePlay: detail.voice.play,
      music: detail.music,
      entrancePreview: detail.entrancePreview,
      quickPlay: quickPlay,
      audio: detail.audio,
      buttonHidden: {
        play: detail.voice.play.available !== true,
        music: detail.music.available !== true,
        entrance: detail.entrancePreview.available !== true,
      },
      noButtonVsPlayFail: uiHiddenPlay ? 'UI Hidden' : (detail.voice.play.available ? 'button_shown' : 'no_data'),
    },
    classification: {
      play: play.classification,
      music: music.classification,
      entrance: entrance.classification,
    },
    failurePoint: {
      play: play.failurePoint,
      music: music.failurePoint,
      entrance: entrance.failurePoint,
    },
    urls: {
      voice: session.urls.getVoiceUrl(cardId, 'play'),
      music: session.urls.getMusicUrl(cardId),
      entrance: session.urls.getEntranceUrl(cardId),
    },
  };
}

function copyIfExists(src, dest) {
  if (!src || !fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function parseArgv(argv) {
  const out = { extract: true, probeApi: true, report: false, cardId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cardId' || a === '--card') out.cardId = argv[++i];
    else if (a === '--report') out.report = true;
    else if (a === '--no-extract') out.extract = false;
    else if (a === '--no-api') out.probeApi = false;
    else if (a === '--apiBase') out.apiBase = argv[++i];
  }
  return out;
}

async function runCli(argv) {
  const args = parseArgv(argv);
  const apiBase = args.apiBase || 'http://127.0.0.1:8767';
  const session = createDiagnosticSession({ apiBase: apiBase });
  if (args.cardId) {
    const result = await diagnoseCard(session, args.cardId, { extract: args.extract, probeApi: args.probeApi });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  console.error('Usage: npm run diagnose:audio -- --cardId BOT_548');
  process.exitCode = 1;
}

module.exports = {
  ROOT,
  HS_WIN,
  VERIFY_DIR,
  createDiagnosticSession,
  findCardsByName,
  pickRandomSamples,
  diagnoseCard,
  diagnoseVoiceSlot,
  diagnoseMusic,
  inspectHeader,
  firstSoundAnalysis,
  compareVoiceStartInMix,
  copyIfExists,
  parseArgv,
  runCli,
  httpProbe,
};
