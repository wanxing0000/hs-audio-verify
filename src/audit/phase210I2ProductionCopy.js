'use strict';

const fs = require('fs');
const path = require('path');
const { voicePlayable, publicDetail, buildCatalog } = require('../miniprogram/catalogAdapter.js');
const { inspectWav } = require('../explorer/wavPcm16.js');
const { isPlayableWav, isRiffWave, sha256File } = require('../services/productionAudioPackage.js');
const {
  snapshotProduction,
  destRelFor,
  appendManifest,
  existingModified,
} = require('./relatedAudioProductionAudit.js');
const { inspectExtractedWav } = require('./phase210I1TargetedExtraction.js');
const { loadProductionAudioInventory } = require('../services/productionAudioAvailability.js');
const { getCardAudioAvailability } = require('../miniprogram/audioAvailability.js');
const {
  createRelatedCardIndex,
  attachRelatedCards,
  resolveDetailCard,
  relatedAudioSlots,
} = require('../miniprogram/relatedCards.js');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { AudioCache } = require('../services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../services/audioService.js');
const { EntrancePreviewService } = require('../services/entrancePreviewService.js');
const { createProductionExtractorGuard } = require('../services/audioSourceMode.js');

const FAMILY = 'GDB_471';
const ROOT_NAME = '沃罗尼招募官';
const EXPECTED_HEAD = '1d7ba785a196ac1e83ed13f5f910086e92467fac';
const SLOTS = ['play', 'attack', 'death'];
const ALLOWED_CARDS = [
  'GDB_471t', 'GDB_471t2', 'GDB_471t3', 'GDB_471t4',
  'GDB_471t5', 'GDB_471t6', 'GDB_471t7', 'GDB_471t8',
];
const CARD_NAMES = {
  GDB_471t: '引擎组乘务员',
  GDB_471t2: '战术组乘务员',
  GDB_471t3: '火力组乘务员',
  GDB_471t4: '舰桥组乘务员',
  GDB_471t5: '通信组乘务员',
  GDB_471t6: '科研组乘务员',
  GDB_471t7: '医疗组乘务员',
  GDB_471t8: '运营组乘务员',
};
const FORBIDDEN_FAMILIES = [
  'TOY_814', 'TTN_480', 'TTN_719', 'WC_034', 'WW_345', 'WW_810', 'ICC_828', 'TRL_343', 'CATA_550',
];
const HISTORICAL_12 = [
  'TIME_609t1', 'TIME_609t2',
  'TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5',
  'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9', 'TIME_005t9t',
];
const EXPECTED_BASELINE = {
  files: 685,
  voice: 386,
  music: 200,
  entrance: 98,
  bytes: 493400551,
  manifestSha256: 'a7cd2e1e923348123064e4f67dafe1aa255a266576871ae47493f90569376bec',
};
const I_JSON = path.join('data', 'card-verification', 'phase-2.10-I-extraction-priority.json');
const I_MD = path.join('data', 'card-verification', 'phase-2.10-I-report.md');
const I1_JSON = path.join('data', 'card-verification', 'phase-2.10-I-1-extraction-result.json');
const I1_MD = path.join('data', 'card-verification', 'phase-2.10-I-1-report.md');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function durationSec(wav, size) {
  if (!wav || !wav.sampleRate || !wav.channels || !wav.bitsPerSample) return 0;
  const bps = wav.sampleRate * wav.channels * (wav.bitsPerSample / 8);
  if (!bps) return 0;
  return Math.max(0, (size - 44) / bps);
}

function loadHistory(root) {
  const required = [I_JSON, I_MD, I1_JSON, I1_MD].map((rel) => path.join(root, rel));
  for (let i = 0; i < required.length; i++) {
    if (!fs.existsSync(required[i])) {
      return { blocked: true, blockReason: 'PHASE_2_10_I_1_HISTORY_INVALID', detail: 'missing ' + required[i] };
    }
  }
  let iJson;
  let i1Json;
  try {
    iJson = loadJson(path.join(root, I_JSON));
    i1Json = loadJson(path.join(root, I1_JSON));
  } catch (e) {
    return { blocked: true, blockReason: 'PHASE_2_10_I_1_HISTORY_INVALID', detail: (e && e.message) || String(e) };
  }
  const batch = iJson.firstBatch || {};
  const family = (batch.families && batch.families[0]) || i1Json.family;
  const cards = batch.cards || (i1Json.validation && i1Json.validation.cards) || [];
  if (family !== FAMILY
    || batch.cardCount !== 8
    || batch.slotCount !== 24
    || cards.length !== 8
    || JSON.stringify(cards) !== JSON.stringify(ALLOWED_CARDS)
    || i1Json.status !== 'COMPLETE_VERIFIED'
    || !Array.isArray(i1Json.results)
    || i1Json.results.length !== 24) {
    return {
      blocked: true,
      blockReason: 'PHASE_2_10_I_1_HISTORY_INVALID',
      detail: { family: family, cardCount: batch.cardCount, slotCount: batch.slotCount, cards: cards, i1Status: i1Json.status },
    };
  }
  return { blocked: false, iJson: iJson, i1Json: i1Json, batch: batch };
}

function baselineMismatch(snap) {
  return snap.files !== EXPECTED_BASELINE.files
    || snap.voice !== EXPECTED_BASELINE.voice
    || snap.music !== EXPECTED_BASELINE.music
    || snap.entrance !== EXPECTED_BASELINE.entrance
    || snap.bytes !== EXPECTED_BASELINE.bytes
    || snap.manifestSha256 !== EXPECTED_BASELINE.manifestSha256;
}

function buildTargets(root, history) {
  const unified = loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const plan = history.iJson.firstBatchSlotPlan || [];
  const byPair = Object.create(null);
  (history.i1Json.results || []).forEach((row) => {
    byPair[row.cardId + ':' + row.slot] = row;
  });
  const targets = [];
  ALLOWED_CARDS.forEach((cardId) => {
    SLOTS.forEach((slot) => {
      const i1 = byPair[cardId + ':' + slot];
      const planRow = plan.find((p) => p.cardId === cardId && p.slot === slot);
      const raw = unified.cards && unified.cards[cardId];
      const indexKey = voicePlayable(raw && raw.voice && raw.voice[slot]) ? raw.voice[slot].voiceKey : null;
      targets.push({
        cardId: cardId,
        name: (raw && raw.name) || CARD_NAMES[cardId] || cardId,
        slot: slot,
        voiceKey: i1 && i1.voiceKey,
        indexKey: indexKey,
        planKey: planRow && planRow.voiceKey,
        i1: i1 || null,
        family: FAMILY,
      });
    });
  });
  return { unified: unified, targets: targets };
}

function dryRunCopy(root) {
  const history = loadHistory(root);
  if (history.blocked) return history;
  const built = buildTargets(root, history);
  const counts = {
    TARGETS_TOTAL: built.targets.length,
    SOURCE_FOUND: 0,
    SOURCE_MISSING: 0,
    WAV_VALID: 0,
    WAV_INVALID: 0,
    ALREADY_PRESENT: 0,
    TO_COPY: 0,
    CONFLICT: 0,
    AMBIGUOUS: 0,
    IDENTITY_CONFLICT: 0,
    DUPLICATE_OUTPUT: 0,
    OTHER_FAMILY: 0,
    BAD_SLOT: 0,
  };
  const seenPair = Object.create(null);
  const seenDest = Object.create(null);
  const seenKey = Object.create(null);
  const rows = [];

  built.targets.forEach((t) => {
    const row = {
      cardId: t.cardId,
      name: t.name,
      slot: t.slot,
      voiceKey: t.voiceKey,
      sourcePath: null,
      destRel: null,
      destAbs: null,
      classify: 'INVALID',
      sourceFound: false,
      wavValid: false,
      size: 0,
      sha256: null,
      durationSec: 0,
      error: null,
    };
    if (FORBIDDEN_FAMILIES.some((f) => String(t.cardId).indexOf(f) === 0) || String(t.cardId).indexOf(FAMILY) !== 0) {
      counts.OTHER_FAMILY += 1;
      row.error = 'OTHER_FAMILY';
      rows.push(row);
      return;
    }
    if (SLOTS.indexOf(t.slot) < 0) {
      counts.BAD_SLOT += 1;
      row.error = 'BAD_SLOT';
      rows.push(row);
      return;
    }
    const pair = t.cardId + ':' + t.slot;
    if (seenPair[pair]) counts.DUPLICATE_OUTPUT += 1;
    seenPair[pair] = true;
    if (!t.i1 || !t.voiceKey || t.voiceKey !== t.indexKey || t.voiceKey !== t.planKey) {
      counts.AMBIGUOUS += 1;
      row.error = 'VOICEKEY_MISMATCH';
      rows.push(row);
      return;
    }
    const srcRel = t.i1.outputPath;
    if (!srcRel || String(srcRel).indexOf('data/production-audio') >= 0) {
      counts.SOURCE_MISSING += 1;
      row.error = 'SOURCE_PATH_INVALID';
      rows.push(row);
      return;
    }
    const srcAbs = path.join(root, srcRel);
    row.sourcePath = srcAbs;
    if (!fs.existsSync(srcAbs)) {
      counts.SOURCE_MISSING += 1;
      row.error = 'SOURCE_MISSING';
      rows.push(row);
      return;
    }
    row.sourceFound = true;
    counts.SOURCE_FOUND += 1;
    const info = inspectExtractedWav(srcAbs);
    let wavMeta = null;
    try { wavMeta = inspectWav(fs.readFileSync(srcAbs)); } catch (e) { wavMeta = null; }
    const dur = durationSec(wavMeta, info.size);
    row.size = info.size;
    row.sha256 = sha256File(srcAbs);
    row.durationSec = dur;
    row.wavValid = !!(info.wavValid && info.riff && isPlayableWav(srcAbs) && isRiffWave(srcAbs) && info.size > 0 && dur > 0 && t.i1.wavValid);
    if (t.i1.sha256 && t.i1.sha256 !== row.sha256) row.wavValid = false;
    if (!row.wavValid) {
      counts.WAV_INVALID += 1;
      row.error = 'WAV_INVALID';
      rows.push(row);
      return;
    }
    counts.WAV_VALID += 1;
    const destRel = destRelFor('voice', t.voiceKey, t.cardId);
    if (destRel.indexOf('music/') === 0 || destRel.indexOf('entrance/') === 0 || destRel.indexOf('voice/') !== 0) {
      counts.AMBIGUOUS += 1;
      row.error = 'DEST_NOT_VOICE';
      rows.push(row);
      return;
    }
    row.destRel = destRel;
    row.destAbs = path.join(root, 'data', 'production-audio', destRel);
    row.mappingKey = t.voiceKey;
    row.kind = 'voice';
    row.audioType = t.slot;
    if (seenDest[destRel] && seenDest[destRel] !== t.voiceKey) {
      counts.IDENTITY_CONFLICT += 1;
      counts.DUPLICATE_OUTPUT += 1;
      row.error = 'DUPLICATE_OUTPUT';
    }
    if (seenKey[t.voiceKey] && seenKey[t.voiceKey] !== destRel) {
      counts.IDENTITY_CONFLICT += 1;
      row.error = 'IDENTITY_CONFLICT';
    }
    seenDest[destRel] = t.voiceKey;
    seenKey[t.voiceKey] = destRel;
    if (fs.existsSync(row.destAbs)) {
      const destSha = sha256File(row.destAbs);
      if (destSha === row.sha256) {
        row.classify = 'ALREADY_PRESENT';
        counts.ALREADY_PRESENT += 1;
      } else {
        row.classify = 'CONFLICT';
        counts.CONFLICT += 1;
        row.error = 'PRODUCTION_FILE_CONFLICT';
      }
    } else {
      row.classify = 'TO_COPY';
      counts.TO_COPY += 1;
    }
    rows.push(row);
  });

  const blocked = counts.TARGETS_TOTAL !== 24
    || counts.SOURCE_FOUND !== 24
    || counts.SOURCE_MISSING !== 0
    || counts.WAV_VALID !== 24
    || counts.WAV_INVALID !== 0
    || counts.CONFLICT !== 0
    || counts.AMBIGUOUS !== 0
    || counts.IDENTITY_CONFLICT !== 0
    || counts.DUPLICATE_OUTPUT !== 0
    || counts.OTHER_FAMILY !== 0
    || counts.BAD_SLOT !== 0
    || (counts.TO_COPY + counts.ALREADY_PRESENT) !== 24;

  let blockReason = null;
  if (blocked) {
    if (counts.CONFLICT > 0) blockReason = 'PRODUCTION_FILE_CONFLICT';
    else if (counts.TARGETS_TOTAL !== 24) blockReason = 'TARGET_LIST_INVALID';
    else blockReason = 'DRY_RUN_FAILED';
  }

  return {
    blocked: blocked,
    blockReason: blockReason,
    counts: counts,
    rows: rows,
    unified: built.unified,
    history: history,
  };
}

function copyOne(src, dest) {
  if (fs.existsSync(dest)) throw new Error('refusing to overwrite ' + dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  fs.copyFileSync(src, tmp);
  if (!isPlayableWav(tmp) || sha256File(tmp) !== sha256File(src)) {
    fs.unlinkSync(tmp);
    throw new Error('temp copy failed validation for ' + dest);
  }
  fs.renameSync(tmp, dest);
}

function executeCopy(dry) {
  const copied = [];
  dry.rows.forEach((row) => {
    if (row.classify !== 'TO_COPY') return;
    copyOne(row.sourcePath, row.destAbs);
    if (!fs.existsSync(row.destAbs) || sha256File(row.destAbs) !== row.sha256) {
      throw new Error('copy sha mismatch ' + row.voiceKey);
    }
    copied.push(row);
  });
  return copied;
}

function coverageByCard(inventory) {
  const out = {};
  ALLOWED_CARDS.forEach((id) => {
    out[id] = {
      play: inventory.hasVoice(id, 'play'),
      attack: inventory.hasVoice(id, 'attack'),
      death: inventory.hasVoice(id, 'death'),
    };
  });
  return out;
}

function verifyAvailability(root) {
  const dest = path.join(root, 'data', 'production-audio');
  const inventory = loadProductionAudioInventory(dest);
  const coverage = coverageByCard(inventory);
  let available = 0;
  ALLOWED_CARDS.forEach((id) => {
    SLOTS.forEach((slot) => {
      if (coverage[id][slot]) available += 1;
    });
  });
  return {
    inventory: inventory,
    coverage: coverage,
    available: available,
    ok: available === 24,
  };
}

function verifyParentDetail(root, inventory) {
  const unified = loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const clips = loadJson(path.join(root, 'data', 'index', 'audio-index.json'));
  const catalog = buildCatalog(unified);
  const relatedIndex = createRelatedCardIndex(unified.cards);
  const card = resolveDetailCard(FAMILY, catalog, unified);
  let body = publicDetail(card, getCardAudioAvailability(unified.cards[FAMILY], clips.clips));
  body = attachRelatedCards(body, relatedIndex, inventory);
  const uiVisible = (body.relatedCards || []).slice(0, 12);
  const ids = uiVisible.map((r) => r.id);
  const missing = ALLOWED_CARDS.filter((id) => ids.indexOf(id) < 0);
  let multi = true;
  uiVisible.forEach((row) => {
    if (ALLOWED_CARDS.indexOf(row.id) < 0) return;
    const slots = row.audioSlots || relatedAudioSlots(unified.cards[row.id], inventory);
    if (!slots.play.available || !slots.attack.available || !slots.death.available) multi = false;
  });
  return {
    ok: missing.length === 0 && uiVisible.length >= 8 && multi && catalog.cards.length === 7263 && !catalog.byId[ALLOWED_CARDS[0]],
    relatedCount: (body.relatedCards || []).length,
    uiVisible: uiVisible.length,
    uiIds: ids,
    missing: missing,
    multiSlot: multi,
    catalogTotal: catalog.cards.length,
  };
}

function historicalCoverage(inventory) {
  const out = {};
  let ok = true;
  HISTORICAL_12.forEach((id) => {
    const rec = {
      play: inventory.hasVoice(id, 'play'),
      attack: inventory.hasVoice(id, 'attack'),
      death: inventory.hasVoice(id, 'death'),
    };
    out[id] = rec;
    if (!rec.play || !rec.attack || !rec.death) ok = false;
  });
  return { cards: out, ok: ok };
}

async function expectCode(fn, code) {
  try {
    await fn();
    return { ok: false, code: null };
  } catch (e) {
    return {
      ok: e && e.code === code && audioErrorHttpStatus(e.code) === 404 && audioErrorBody(e).code === code,
      code: e && e.code,
    };
  }
}

async function verifyRuntime(root) {
  const unified = loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const clips = loadJson(path.join(root, 'data', 'index', 'audio-index.json'));
  const musicAssets = loadJson(path.join(root, 'data', 'index', 'music-assets.json'));
  const dest = path.join(root, 'data', 'production-audio');
  const repo = new UnifiedAudioRepo(unified, clips, musicAssets);
  const cache = new AudioCache({
    audioDir: path.join(dest, 'voice'),
    musicDir: path.join(dest, 'music'),
    previewDir: path.join(dest, 'entrance'),
  });
  const audioService = new AudioService({
    repo: repo,
    extractor: createProductionExtractorGuard(),
    cache: cache,
    sourceMode: 'production',
  });
  const entrance = new EntrancePreviewService({
    repo: repo,
    audioService: audioService,
    cache: cache,
    sourceMode: 'production',
  });
  const hits = [];
  for (let i = 0; i < ALLOWED_CARDS.length; i++) {
    for (let s = 0; s < SLOTS.length; s++) {
      const got = await audioService.getVoiceAudio(ALLOWED_CARDS[i], SLOTS[s]);
      hits.push({ cardId: ALLOWED_CARDS[i], slot: SLOTS[s], path: got.path, ok: !!(got && got.path && isPlayableWav(got.path)) });
    }
  }
  const hist = [];
  for (let i = 0; i < HISTORICAL_12.length; i++) {
    for (let s = 0; s < SLOTS.length; s++) {
      const got = await audioService.getVoiceAudio(HISTORICAL_12[i], SLOTS[s]);
      hist.push({ cardId: HISTORICAL_12[i], slot: SLOTS[s], ok: !!(got && got.path && isPlayableWav(got.path)) });
    }
  }
  const aliasPlay = await audioService.getVoiceAudio('TIME_005t9t', 'play');
  const cap = await expectCode(() => audioService.getVoiceAudio('CAP_107', 'play'), 'AUDIO_NOT_AVAILABLE');
  const jail = await expectCode(() => entrance.getEntrancePreview('JAIL_443'), 'AUDIO_NOT_AVAILABLE');
  const unknown = await expectCode(() => audioService.getVoiceAudio('UNKNOWN_CARD', 'play'), 'NO_VOICE');
  return {
    gdbHits: hits,
    gdbOk: hits.every((h) => h.ok) && hits.length === 24,
    historicalOk: hist.every((h) => h.ok) && hist.length === 36,
    aliasOk: !!(aliasPlay && aliasPlay.path),
    cap: cap,
    jail: jail,
    unknown: unknown,
    ok: hits.every((h) => h.ok) && hist.every((h) => h.ok) && cap.ok && jail.ok && unknown.ok,
  };
}

module.exports = {
  FAMILY,
  ROOT_NAME,
  EXPECTED_HEAD,
  EXPECTED_BASELINE,
  ALLOWED_CARDS,
  CARD_NAMES,
  SLOTS,
  HISTORICAL_12,
  loadHistory,
  baselineMismatch,
  dryRunCopy,
  executeCopy,
  verifyAvailability,
  verifyParentDetail,
  historicalCoverage,
  verifyRuntime,
  snapshotProduction,
  existingModified,
  appendManifest,
  sha256File,
};
