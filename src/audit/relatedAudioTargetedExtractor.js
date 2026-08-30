'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { voicePlayable } = require('../miniprogram/catalogAdapter.js');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
const { inspectWav } = require('../explorer/wavPcm16.js');
const { safeName } = require('../services/audioCache.js');
const { isPlayableWav, isRiffWave } = require('../services/productionAudioPackage.js');

const TARGET_CARD_IDS = [
  'TIME_609t1',
  'TIME_609t2',
  'TIME_005t1',
  'TIME_005t2',
  'TIME_005t3',
  'TIME_005t4',
  'TIME_005t5',
  'TIME_005t6',
  'TIME_005t7',
  'TIME_005t8',
  'TIME_005t9',
  'TIME_005t9t',
];

const EXPECTED_PLAY_VOICE_KEYS = {
  TIME_609t1: 'VO_TIME_609t1_Female_HighElf_Play_01',
  TIME_609t2: 'VO_TIME_609t2_Female_HighElf_Play_01',
  TIME_005t1: 'VO_TIME_005t1_Male_Ethereal_Play_01',
  TIME_005t2: 'VO_TIME_005t2_Male_Ethereal_Play_01',
  TIME_005t3: 'VO_TIME_005t3_Male_Ethereal_Play_01',
  TIME_005t4: 'VO_TIME_005t4_Male_Ethereal_Play_01',
  TIME_005t5: 'VO_TIME_005t5_Male_EtherealFaceless_Play_01',
  TIME_005t6: 'VO_TIME_005t6_Male_EtherealDemon_Play_01',
  TIME_005t7: 'VO_TIME_005t7_Male_Ethereal_Play_01',
  TIME_005t8: 'VO_TIME_005t8_Male_EtherealMurloc_Play_01',
  TIME_005t9: 'VO_TIME_005t9_Female_Ethereal_Play_01',
  TIME_005t9t: 'TIME_005t9t_Play',
};

const SLOT_TYPES = ['play', 'attack', 'death'];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function candidatePlayKey(row) {
  if (!row) return null;
  if (Array.isArray(row.slots)) {
    const play = row.slots.find((s) => s && s.type === 'play');
    if (play && play.voiceKey) return play.voiceKey;
  }
  return row.playVoiceKey || null;
}

function indexSlotKey(raw, type) {
  const slot = raw && raw.voice && raw.voice[type];
  return voicePlayable(slot) ? slot.voiceKey : null;
}

function validateTargets(candidates, unified) {
  const rows = (candidates && candidates.candidates) || [];
  const byId = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].cardId) byId[rows[i].cardId] = rows[i];
  }
  const targets = [];
  for (let i = 0; i < TARGET_CARD_IDS.length; i++) {
    const cardId = TARGET_CARD_IDS[i];
    const expected = EXPECTED_PLAY_VOICE_KEYS[cardId];
    const cand = byId[cardId];
    const raw = unified.cards && unified.cards[cardId];
    const candPlay = candidatePlayKey(cand);
    const play = indexSlotKey(raw, 'play');
    if (!cand) {
      throw new Error('candidate missing ' + cardId);
    }
    if (!raw) {
      throw new Error('audio index missing ' + cardId);
    }
    if (!expected || !candPlay || !play || play !== expected || candPlay !== expected) {
      const err = new Error('voiceKey mismatch for ' + cardId);
      err.code = 'VOICEKEY_MISMATCH';
      err.details = { cardId, expected, candidate: candPlay, index: play };
      throw err;
    }
    const slots = [];
    for (let s = 0; s < SLOT_TYPES.length; s++) {
      const type = SLOT_TYPES[s];
      const voiceKey = indexSlotKey(raw, type);
      if (!voiceKey) continue;
      slots.push({ type, voiceKey });
    }
    targets.push({
      cardId,
      name: raw.name || cardId,
      playVoiceKey: play,
      slots,
    });
  }
  return targets;
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
    exists,
    size,
    riff,
    wavValid: !!(playable && wav && !wav.error),
    channels: wav && wav.channels != null ? wav.channels : null,
    sampleRate: wav && wav.sampleRate != null ? wav.sampleRate : null,
    bitsPerSample: wav && wav.bitsPerSample != null ? wav.bitsPerSample : null,
    durationSec: wav && wav.durationSec != null ? wav.durationSec : null,
  };
}

function findLooseWavHits(hsWin, voiceKey) {
  const names = [safeName(voiceKey) + '.wav', voiceKey + '.wav'];
  const hits = [];
  const dirs = [hsWin, path.dirname(hsWin)];
  for (let d = 0; d < dirs.length; d++) {
    for (let i = 0; i < names.length; i++) {
      const full = path.join(dirs[d], names[i]);
      if (fs.existsSync(full) && hits.indexOf(full) === -1) hits.push(full);
    }
  }
  return hits;
}

async function extractVoiceKey(extractor, destDir, voiceKey) {
  const dest = path.join(destDir, safeName(voiceKey) + '.wav');
  const out = await extractor.extractVoice(voiceKey);
  if (!out || !out.path || !isPlayableWav(out.path)) {
    const err = new Error('extracted file is not a valid WAV');
    err.code = 'WAV_INVALID';
    throw err;
  }
  if (path.resolve(out.path) !== path.resolve(dest)) {
    fs.copyFileSync(out.path, dest);
  }
  return dest;
}

function createTargetedExtractor(opts) {
  opts = opts || {};
  const root = opts.root;
  const destDir = opts.destDir || path.join(root, 'tmp', 'production-audio-extract', 'voice');
  const hsWin = opts.hsWin || 'C:\\Hearthstone\\Data\\Win';
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const audioIndex = opts.audioIndex || loadJson(path.join(root, 'data', 'index', 'audio-index.json'));
  const musicAssets = opts.musicAssets || loadJson(path.join(root, 'data', 'index', 'music-assets.json'));
  const candidates = opts.candidates || loadJson(path.join(root, 'data', 'card-verification', 'phase-2.10-B-candidates.json'));
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
  fs.mkdirSync(destDir, { recursive: true });
  const extractor = new HearthstoneAudioExtractor({
    hsWin,
    cacheDir: destDir,
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
    resolutionCachePath: path.join(root, 'tmp', 'phase-2.10-B-1-resolution-cache.json'),
  });
  return {
    root,
    destDir,
    hsWin,
    unified,
    candidates,
    repo,
    extractor,
    targets: validateTargets(candidates, unified),
  };
}

async function runTargetedExtraction(session) {
  const results = [];
  for (let i = 0; i < session.targets.length; i++) {
    const target = session.targets[i];
    const slots = [];
    let cardFound = 0;
    let cardMissing = 0;
    let cardValid = 0;
    let cardInvalid = 0;
    let cardAmbiguous = 0;
    for (let s = 0; s < target.slots.length; s++) {
      const slot = target.slots[s];
      const row = {
        cardId: target.cardId,
        type: slot.type,
        voiceKey: slot.voiceKey,
        sourcePath: null,
        sourceFound: false,
        wavValid: false,
        size: 0,
        status: 'SOURCE_NOT_AVAILABLE',
      };
      try {
        const loose = fs.existsSync(session.hsWin) ? findLooseWavHits(session.hsWin, slot.voiceKey) : [];
        if (loose.length > 1) {
          row.status = 'AMBIGUOUS';
          row.sourceFound = true;
          row.candidates = loose;
          cardAmbiguous += 1;
          slots.push(row);
          continue;
        }
        if (loose.length === 1 && isPlayableWav(loose[0])) {
          const dest = path.join(session.destDir, safeName(slot.voiceKey) + '.wav');
          fs.copyFileSync(loose[0], dest);
          const info = inspectExtractedWav(dest);
          Object.assign(row, info, {
            sourcePath: loose[0],
            sourceFound: true,
            status: info.wavValid ? 'WAV_VALID' : 'WAV_INVALID',
          });
        } else {
          const dest = await extractVoiceKey(session.extractor, session.destDir, slot.voiceKey);
          const info = inspectExtractedWav(dest);
          Object.assign(row, info, {
            sourcePath: dest,
            sourceFound: true,
            status: info.wavValid ? 'WAV_VALID' : 'WAV_INVALID',
          });
        }
        if (row.sourceFound) cardFound += 1;
        else cardMissing += 1;
        if (row.wavValid) cardValid += 1;
        else if (row.sourceFound) cardInvalid += 1;
      } catch (e) {
        row.status = e && e.code === 'WAV_INVALID' ? 'WAV_INVALID' : 'SOURCE_NOT_AVAILABLE';
        row.error = (e && e.message) || String(e);
        cardMissing += 1;
      }
      slots.push(row);
    }
    results.push({
      cardId: target.cardId,
      name: target.name,
      playVoiceKey: target.playVoiceKey,
      status: cardValid > 0 && cardMissing === 0 && cardInvalid === 0 && cardAmbiguous === 0
        ? 'WAV_VALID'
        : (cardAmbiguous ? 'AMBIGUOUS' : (cardValid ? 'PARTIAL' : 'SOURCE_NOT_AVAILABLE')),
      sourceFound: cardFound,
      sourceMissing: cardMissing,
      wavValid: cardValid,
      wavInvalid: cardInvalid,
      ambiguous: cardAmbiguous,
      slots,
    });
  }
  return results;
}

function summarize(results) {
  const summary = {
    total: results.length,
    sourceFound: 0,
    sourceMissing: 0,
    wavValid: 0,
    wavInvalid: 0,
    ambiguous: 0,
  };
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.sourceFound > 0) summary.sourceFound += 1;
    if (r.sourceFound === 0) summary.sourceMissing += 1;
    if (r.status === 'WAV_VALID') summary.wavValid += 1;
    if (r.wavInvalid > 0 && r.wavValid === 0) summary.wavInvalid += 1;
    if (r.ambiguous > 0) summary.ambiguous += 1;
  }
  return summary;
}

function snapshotProduction(root) {
  const dest = path.join(root, 'data', 'production-audio');
  const files = [];
  function walk(dir) {
    const names = fs.readdirSync(dir).sort();
    for (let i = 0; i < names.length; i++) {
      const p = path.join(dir, names[i]);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else files.push({ rel: path.relative(dest, p).replace(/\\/g, '/'), bytes: st.size, sha256: sha256File(p) });
    }
  }
  walk(dest);
  const manifest = path.join(dest, 'manifest.json');
  return {
    files: files.length,
    bytes: files.reduce((s, f) => s + f.bytes, 0),
    manifestSha256: sha256File(manifest),
    fileListSha256: crypto.createHash('sha256').update(files.map((f) => f.rel + ':' + f.sha256).join('\n')).digest('hex'),
  };
}

module.exports = {
  TARGET_CARD_IDS,
  EXPECTED_PLAY_VOICE_KEYS,
  validateTargets,
  inspectExtractedWav,
  createTargetedExtractor,
  runTargetedExtraction,
  summarize,
  snapshotProduction,
  sha256File,
};
