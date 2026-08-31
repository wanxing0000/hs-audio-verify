'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { voicePlayable } = require('../miniprogram/catalogAdapter.js');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { inspectWav } = require('../explorer/wavPcm16.js');
const { safeName } = require('../services/audioCache.js');
const { isPlayableWav, isRiffWave } = require('../services/productionAudioPackage.js');
const {
  snapshotProduction,
  isForbiddenCandidate,
  isBattlegroundsCard,
} = require('./relatedAudioProductionAudit.js');

const EXPECTED_FAMILY = 'GDB_471';
const EXPECTED_CARD_COUNT = 8;
const EXPECTED_SLOT_COUNT = 24;
const SLOT_TYPES = ['play', 'attack', 'death'];
const PRIORITY_JSON = path.join('data', 'card-verification', 'phase-2.10-I-extraction-priority.json');
const HS_WIN = 'C:\\Hearthstone\\Data\\Win';

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isHeroSkin(raw) {
  return !!(raw && raw.set === 'HERO_SKINS');
}

function inspectExtractedWav(filePath) {
  const exists = fs.existsSync(filePath);
  const size = exists ? fs.statSync(filePath).size : 0;
  const riff = exists && size > 0 && isRiffWave(filePath);
  const playable = isPlayableWav(filePath);
  let wav = null;
  if (playable) {
    try { wav = inspectWav(fs.readFileSync(filePath)); } catch (e) { wav = { error: e.message }; }
  }
  return {
    exists: exists,
    size: size,
    riff: riff,
    wavValid: !!(playable && wav && !wav.error),
    channels: wav && wav.channels != null ? wav.channels : null,
    sampleRate: wav && wav.sampleRate != null ? wav.sampleRate : null,
    bitsPerSample: wav && wav.bitsPerSample != null ? wav.bitsPerSample : null,
  };
}

function durationSec(wav, size) {
  if (!wav || !wav.sampleRate || !wav.channels || !wav.bitsPerSample) return 0;
  const bps = wav.sampleRate * wav.channels * (wav.bitsPerSample / 8);
  if (!bps) return 0;
  return Math.max(0, (size - 44) / bps);
}

function sampleRateOk(rate) {
  return rate === 22050 || rate === 24000 || rate === 32000 || rate === 44100 || rate === 48000;
}

function findLooseWavHits(hsWin, voiceKey) {
  const names = [safeName(voiceKey) + '.wav', voiceKey + '.wav'];
  const hits = [];
  const dirs = [hsWin, path.dirname(hsWin)];
  for (let d = 0; d < dirs.length; d++) {
    for (let i = 0; i < names.length; i++) {
      const full = path.join(dirs[d], names[i]);
      if (fs.existsSync(full) && hits.indexOf(full) < 0) hits.push(full);
    }
  }
  return hits;
}

function loadFirstBatch(root) {
  const full = path.join(root, PRIORITY_JSON);
  if (!fs.existsSync(full)) {
    return { blocked: true, blockReason: 'PHASE_2_10_I_INPUT_INVALID', detail: 'priority json missing' };
  }
  const g = loadJson(full);
  const batch = g.firstBatch || {};
  const plan = g.firstBatchSlotPlan || [];
  const family = (batch.families && batch.families[0]) || null;
  if (family !== EXPECTED_FAMILY || batch.cardCount !== EXPECTED_CARD_COUNT || batch.slotCount !== EXPECTED_SLOT_COUNT || plan.length !== EXPECTED_SLOT_COUNT) {
    return {
      blocked: true,
      blockReason: 'PHASE_2_10_I_INPUT_INVALID',
      detail: {
        family: family,
        cardCount: batch.cardCount,
        slotCount: batch.slotCount,
        planLength: plan.length,
      },
    };
  }
  return { blocked: false, json: g, batch: batch, plan: plan };
}

function buildVoiceKeyOwners(cards) {
  const byKey = Object.create(null);
  Object.keys(cards || {}).forEach((id) => {
    const raw = cards[id];
    SLOT_TYPES.forEach((type) => {
      const slot = raw && raw.voice && raw.voice[type];
      if (!voicePlayable(slot) || !slot.voiceKey) return;
      if (!byKey[slot.voiceKey]) byKey[slot.voiceKey] = [];
      byKey[slot.voiceKey].push({ cardId: id, type: type, set: raw.set, cardType: raw.type });
    });
  });
  return byKey;
}

function loadAndValidateTargets(root, opts) {
  opts = opts || {};
  const loaded = loadFirstBatch(root);
  if (loaded.blocked) return loaded;
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const cards = (unified && unified.cards) || {};
  const owners = buildVoiceKeyOwners(cards);
  const seenPair = Object.create(null);
  const seenKey = Object.create(null);
  const targets = [];
  const stats = {
    INDEXED: 0,
    VOICEKEY_RESOLVED: 0,
    ALIAS_MAPPING: 0,
    AMBIGUOUS: 0,
    NO_MAPPING: 0,
    INVALID_TYPE: 0,
    HERO_SKIN_COLLISION: 0,
    DUPLICATE: 0,
    EMPTY_KEY: 0,
    OTHER_FAMILY: 0,
  };

  loaded.plan.forEach((row) => {
    const cardId = row.cardId;
    const slot = row.slot;
    const pair = cardId + ':' + slot;
    if (seenPair[pair]) stats.DUPLICATE += 1;
    seenPair[pair] = true;
    if (row.family && row.family !== EXPECTED_FAMILY) stats.OTHER_FAMILY += 1;
    if (SLOT_TYPES.indexOf(slot) < 0) stats.INVALID_TYPE += 1;
    const raw = cards[cardId];
    if (!raw) {
      stats.NO_MAPPING += 1;
      targets.push(Object.assign({}, row, { valid: false, reason: 'CARD_MISSING' }));
      return;
    }
    if (isForbiddenCandidate(raw) || raw.type === 'ENCHANTMENT' || raw.type === 'HERO_POWER' || isBattlegroundsCard(raw) || isHeroSkin(raw)) {
      stats.INVALID_TYPE += 1;
      targets.push(Object.assign({}, row, { valid: false, reason: 'INVALID_TYPE', cardType: raw.type, set: raw.set }));
      return;
    }
    const mapped = voicePlayable(raw.voice && raw.voice[slot]);
    const indexKey = mapped ? raw.voice[slot].voiceKey : null;
    if (!mapped || !indexKey) {
      stats.NO_MAPPING += 1;
      targets.push(Object.assign({}, row, { valid: false, reason: 'NO_MAPPING' }));
      return;
    }
    if (!row.voiceKey) {
      stats.EMPTY_KEY += 1;
      targets.push(Object.assign({}, row, { valid: false, reason: 'EMPTY_VOICEKEY' }));
      return;
    }
    if (indexKey !== row.voiceKey) {
      stats.AMBIGUOUS += 1;
      targets.push(Object.assign({}, row, { valid: false, reason: 'VOICEKEY_MISMATCH', indexKey: indexKey }));
      return;
    }
    stats.INDEXED += 1;
    stats.VOICEKEY_RESOLVED += 1;
    if (indexKey !== cardId) stats.ALIAS_MAPPING += 1;
    if (seenKey[indexKey] && seenKey[indexKey] !== pair) stats.AMBIGUOUS += 1;
    seenKey[indexKey] = pair;
    const skinHit = (owners[indexKey] || []).some((o) => o.set === 'HERO_SKINS');
    if (skinHit) stats.HERO_SKIN_COLLISION += 1;
    targets.push({
      cardId: cardId,
      name: raw.name || cardId,
      slot: slot,
      voiceKey: indexKey,
      family: EXPECTED_FAMILY,
      cardType: raw.type,
      set: raw.set,
      alias: indexKey !== cardId,
      valid: !skinHit,
      reason: skinHit ? 'HERO_SKIN_COLLISION' : null,
    });
  });

  const uniqueCards = Array.from(new Set(targets.map((t) => t.cardId)));
  const blocked = uniqueCards.length !== EXPECTED_CARD_COUNT
    || targets.length !== EXPECTED_SLOT_COUNT
    || stats.INDEXED !== EXPECTED_SLOT_COUNT
    || stats.VOICEKEY_RESOLVED !== EXPECTED_SLOT_COUNT
    || stats.AMBIGUOUS > 0
    || stats.NO_MAPPING > 0
    || stats.INVALID_TYPE > 0
    || stats.HERO_SKIN_COLLISION > 0
    || stats.DUPLICATE > 0
    || stats.EMPTY_KEY > 0
    || stats.OTHER_FAMILY > 0
    || targets.some((t) => !t.valid);

  return {
    blocked: blocked,
    blockReason: blocked ? (uniqueCards.length !== 8 || targets.length !== 24 ? 'TARGET_LIST_INVALID' : 'PRE_EXTRACTION_VALIDATION_FAILED') : null,
    family: EXPECTED_FAMILY,
    cards: uniqueCards,
    targets: targets,
    stats: stats,
    batch: loaded.batch,
  };
}

function createSession(root, opts) {
  opts = opts || {};
  const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
  const destDir = opts.destDir || path.join(root, 'tmp', 'phase-2.10-I-1-extract');
  const hsWin = opts.hsWin || HS_WIN;
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const audioIndex = opts.audioIndex || loadJson(path.join(root, 'data', 'index', 'audio-index.json'));
  const musicAssets = opts.musicAssets || loadJson(path.join(root, 'data', 'index', 'music-assets.json'));
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
  fs.mkdirSync(destDir, { recursive: true });
  const extractor = new HearthstoneAudioExtractor({
    hsWin: hsWin,
    cacheDir: destDir,
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
    resolutionCachePath: path.join(root, 'tmp', 'phase-2.10-I-1-resolution-cache.json'),
  });
  return { root: root, destDir: destDir, hsWin: hsWin, unified: unified, repo: repo, extractor: extractor };
}

async function locateSource(session, voiceKey) {
  if (!voiceKey) return { status: 'INVALID', reason: 'EMPTY_VOICEKEY' };
  try {
    if (fs.existsSync(session.hsWin)) {
      const loose = findLooseWavHits(session.hsWin, voiceKey);
      if (loose.length > 1) return { status: 'AMBIGUOUS', reason: 'LOOSE_WAV', candidates: loose };
      if (loose.length === 1) {
        if (!isPlayableWav(loose[0])) return { status: 'INVALID', reason: 'LOOSE_WAV_INVALID', path: loose[0] };
        return { status: 'FOUND', kind: 'loose-wav', path: loose[0] };
      }
    }
    const asset = session.extractor.getVoiceAsset(voiceKey);
    if (!asset || !asset.indexed) return { status: 'MISSING', reason: 'NOT_INDEXED' };
    const candidates = session.extractor.resolveCandidates(asset, voiceKey);
    if (!candidates.length) return { status: 'MISSING', reason: 'BUNDLE_NOT_FOUND' };
    let found = null;
    for (let i = 0; i < candidates.length; i++) {
      const inspection = await session.extractor.inspectCandidate(candidates[i], voiceKey, { decode: false });
      if (inspection && inspection.found && inspection.offsetValid) {
        found = { status: 'FOUND', kind: 'bundle', bundle: candidates[i].bundleName, reason: candidates[i].reason };
        break;
      }
    }
    if (!found) return { status: 'MISSING', reason: 'CLIP_NOT_FOUND' };
    return found;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/ambiguous/i.test(msg)) return { status: 'AMBIGUOUS', reason: msg };
    return { status: 'INVALID', reason: msg };
  }
}

async function dryRunTargets(session, targets) {
  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const loc = await locateSource(session, t.voiceKey);
    rows.push({
      cardId: t.cardId,
      name: t.name,
      slot: t.slot,
      voiceKey: t.voiceKey,
      sourceStatus: loc.status,
      sourceKind: loc.kind || null,
      sourcePath: loc.path || null,
      sourceBundle: loc.bundle || null,
      sourceReason: loc.reason || null,
    });
  }
  const counts = { FOUND: 0, MISSING: 0, AMBIGUOUS: 0, INVALID: 0 };
  rows.forEach((r) => { counts[r.sourceStatus] = (counts[r.sourceStatus] || 0) + 1; });
  return { rows: rows, counts: counts };
}

async function extractFound(session, dryRows) {
  const results = [];
  for (let i = 0; i < dryRows.length; i++) {
    const row = dryRows[i];
    const rec = {
      cardId: row.cardId,
      name: row.name,
      slot: row.slot,
      voiceKey: row.voiceKey,
      sourceStatus: row.sourceStatus,
      sourceFound: row.sourceStatus === 'FOUND',
      extracted: false,
      wavValid: false,
      outputPath: null,
      bytes: 0,
      sha256: null,
      sampleRate: null,
      durationSec: null,
      error: null,
    };
    if (row.sourceStatus !== 'FOUND') {
      results.push(rec);
      continue;
    }
    try {
      const dest = path.join(session.destDir, safeName(row.voiceKey) + '.wav');
      if (row.sourceKind === 'loose-wav' && row.sourcePath) {
        fs.copyFileSync(row.sourcePath, dest);
      } else {
        const out = await session.extractor.extractVoice(row.voiceKey);
        if (!out || !out.path) throw new Error('extractVoice returned no path');
        if (path.resolve(out.path) !== path.resolve(dest)) fs.copyFileSync(out.path, dest);
      }
      const info = inspectExtractedWav(dest);
      const wavMeta = info.wavValid ? inspectWav(fs.readFileSync(dest)) : null;
      const dur = durationSec(wavMeta, info.size);
      rec.extracted = true;
      rec.outputPath = path.relative(session.root, dest).replace(/\\/g, '/');
      rec.bytes = info.size;
      rec.sha256 = sha256File(dest);
      rec.sampleRate = wavMeta && wavMeta.sampleRate;
      rec.durationSec = dur;
      rec.riff = info.riff;
      rec.wavValid = !!(info.wavValid && info.size > 0 && dur > 0 && sampleRateOk(rec.sampleRate));
      if (!rec.wavValid) rec.error = 'WAV_INVALID';
    } catch (e) {
      rec.error = (e && e.message) || String(e);
    }
    results.push(rec);
  }
  return results;
}

function identityCheck(results) {
  const byPath = Object.create(null);
  const byKey = Object.create(null);
  let identityConflict = 0;
  let duplicateOutput = 0;
  let shaConflict = 0;
  results.forEach((r) => {
    if (!r.extracted || !r.outputPath) return;
    if (byPath[r.outputPath] && byPath[r.outputPath] !== r.voiceKey) {
      identityConflict += 1;
      duplicateOutput += 1;
    }
    byPath[r.outputPath] = r.voiceKey;
    if (byKey[r.voiceKey] && byKey[r.voiceKey] !== r.sha256) shaConflict += 1;
    byKey[r.voiceKey] = r.sha256;
  });
  return {
    IDENTITY_CONFLICT: identityConflict,
    DUPLICATE_OUTPUT: duplicateOutput,
    SHA_CONFLICT: shaConflict,
  };
}

function groupByCard(results) {
  const map = Object.create(null);
  results.forEach((r) => {
    if (!map[r.cardId]) map[r.cardId] = { cardId: r.cardId, name: r.name, slots: {} };
    map[r.cardId].slots[r.slot] = r;
  });
  return Object.keys(map).sort().map((id) => map[id]);
}

module.exports = {
  EXPECTED_FAMILY,
  EXPECTED_CARD_COUNT,
  EXPECTED_SLOT_COUNT,
  HS_WIN,
  PRIORITY_JSON,
  loadFirstBatch,
  loadAndValidateTargets,
  createSession,
  locateSource,
  dryRunTargets,
  extractFound,
  identityCheck,
  groupByCard,
  inspectExtractedWav,
  snapshotProduction,
  sha256File,
};
