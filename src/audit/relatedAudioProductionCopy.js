'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { voicePlayable } = require('../miniprogram/catalogAdapter.js');
const {
  isPlayableWav,
  isRiffWave,
  sha256File,
  buildVoiceKeyIndex,
  verifyProductionPackage,
} = require('../services/productionAudioPackage.js');

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

const EXPECTED_BASELINE = {
  files: 649,
  bytes: 483129187,
  voice: 350,
  music: 200,
  entrance: 98,
  manifestSha256: '8def0fcce41ee413a4503e9202b59322be787c71a6330e98015146f81ac1ab08',
};

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  function walk(cur) {
    fs.readdirSync(cur).sort().forEach((name) => {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(full);
    });
  }
  walk(dir);
  return out;
}

function snapshotProduction(root) {
  const dest = path.join(root, 'data', 'production-audio');
  const files = walkFiles(dest).map((full) => {
    const rel = path.relative(dest, full).replace(/\\/g, '/');
    return { rel: rel, bytes: fs.statSync(full).size, sha256: sha256File(full) };
  });
  const manifest = loadJson(path.join(dest, 'manifest.json'));
  return {
    files: files.length,
    bytes: files.reduce((s, f) => s + f.bytes, 0),
    voice: (manifest.voice || []).length,
    music: (manifest.music || []).length,
    entrance: (manifest.entrance || []).length,
    voiceFiles: listFiles(path.join(dest, 'voice')).length,
    musicFiles: listFiles(path.join(dest, 'music')).length,
    entranceFiles: listFiles(path.join(dest, 'entrance')).length,
    manifestSha256: sha256File(path.join(dest, 'manifest.json')),
    fileMap: files.reduce((acc, f) => { acc[f.rel] = f; return acc; }, Object.create(null)),
    schemaVersion: manifest.schemaVersion,
    entranceMixVersion: manifest.entranceMixVersion,
  };
}

function indexPlayKey(raw) {
  const slot = raw && raw.voice && raw.voice.play;
  return voicePlayable(slot) ? slot.voiceKey : null;
}

function b1PlaySlot(target) {
  const slots = (target && target.slots) || [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] && slots[i].type === 'play') return slots[i];
  }
  return null;
}

function sourcePrecheck(root) {
  const unified = loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const b1 = loadJson(path.join(root, 'data', 'card-verification', 'phase-2.10-B-1-targeted-extraction.json'));
  const byId = Object.create(null);
  (b1.targets || []).forEach((row) => { if (row && row.cardId) byId[row.cardId] = row; });
  const seenKeys = Object.create(null);
  const seenPaths = Object.create(null);
  const seenSha = Object.create(null);
  const targets = [];
  let sourceFound = 0;
  let sourceMissing = 0;
  let wavValid = 0;
  let wavInvalid = 0;
  let ambiguous = 0;
  let duplicate = 0;
  let mismatch = 0;

  for (let i = 0; i < TARGET_CARD_IDS.length; i++) {
    const cardId = TARGET_CARD_IDS[i];
    const expected = EXPECTED_PLAY_VOICE_KEYS[cardId];
    const raw = unified.cards && unified.cards[cardId];
    const indexKey = indexPlayKey(raw);
    const b1row = byId[cardId];
    const play = b1PlaySlot(b1row);
    const row = {
      cardId: cardId,
      voiceKey: indexKey,
      expectedVoiceKey: expected,
      sourcePath: play && play.sourcePath ? play.sourcePath : null,
      sourceFound: false,
      wavValid: false,
      size: 0,
      sha256: null,
      status: 'SOURCE_NOT_AVAILABLE',
    };
    if (!raw || !indexKey || !expected || indexKey !== expected) {
      row.status = 'VOICEKEY_MISMATCH';
      mismatch += 1;
      targets.push(row);
      continue;
    }
    if (!b1row || !play || play.voiceKey !== indexKey || play.status !== 'WAV_VALID') {
      row.status = 'B1_MISMATCH';
      mismatch += 1;
      targets.push(row);
      continue;
    }
    const src = play.sourcePath;
    if (!src || !fs.existsSync(src) || path.extname(src).toLowerCase() !== '.wav') {
      sourceMissing += 1;
      targets.push(row);
      continue;
    }
    row.sourceFound = true;
    sourceFound += 1;
    const st = fs.statSync(src);
    row.size = st.size;
    if (st.size !== play.size || st.size <= 0 || !isRiffWave(src) || !isPlayableWav(src)) {
      row.status = 'WAV_INVALID';
      wavInvalid += 1;
      targets.push(row);
      continue;
    }
    row.sha256 = sha256File(src);
    row.wavValid = true;
    wavValid += 1;
    if (seenKeys[indexKey] || seenPaths[path.resolve(src)]) {
      row.status = 'DUPLICATE';
      duplicate += 1;
    } else if (seenSha[row.sha256]) {
      row.status = 'AMBIGUOUS';
      ambiguous += 1;
    } else {
      row.status = 'WAV_VALID';
    }
    seenKeys[indexKey] = cardId;
    seenPaths[path.resolve(src)] = cardId;
    seenSha[row.sha256] = cardId;
    targets.push(row);
  }

  return {
    targets: targets,
    summary: {
      total: TARGET_CARD_IDS.length,
      sourceFound: sourceFound,
      sourceMissing: sourceMissing,
      wavValid: wavValid,
      wavInvalid: wavInvalid,
      ambiguous: ambiguous,
      duplicate: duplicate,
      mismatch: mismatch,
    },
    ok: sourceFound === 12 && wavValid === 12 && ambiguous === 0 && duplicate === 0 && mismatch === 0,
  };
}

function classifyTargets(root, precheck) {
  const destDir = path.join(root, 'data', 'production-audio', 'voice');
  const rows = precheck.targets.map((src) => {
    const destName = src.voiceKey + '.wav';
    const dest = path.join(destDir, destName);
    const exists = fs.existsSync(dest);
    let status = 'TO_COPY';
    if (exists) {
      const destSha = sha256File(dest);
      status = destSha === src.sha256 ? 'ALREADY_PRESENT' : 'CONFLICT';
    }
    return Object.assign({}, src, {
      destPath: dest,
      destRel: 'voice/' + destName,
      classify: status,
    });
  });
  return {
    targets: rows,
    alreadyPresent: rows.filter((r) => r.classify === 'ALREADY_PRESENT').length,
    toCopy: rows.filter((r) => r.classify === 'TO_COPY').length,
    conflict: rows.filter((r) => r.classify === 'CONFLICT').length,
  };
}

function copyOne(src, dest) {
  if (fs.existsSync(dest)) {
    throw new Error('refusing to overwrite ' + dest);
  }
  const tmp = dest + '.part';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  fs.copyFileSync(src, tmp);
  if (!isPlayableWav(tmp) || sha256File(tmp) !== sha256File(src)) {
    fs.unlinkSync(tmp);
    throw new Error('temp copy failed validation for ' + dest);
  }
  fs.renameSync(tmp, dest);
}

function copyTargets(classified) {
  const copied = [];
  for (let i = 0; i < classified.targets.length; i++) {
    const row = classified.targets[i];
    if (row.classify !== 'TO_COPY') continue;
    copyOne(row.sourcePath, row.destPath);
    copied.push(row.cardId);
  }
  return copied;
}

function verifyCopies(classified) {
  const rows = [];
  for (let i = 0; i < classified.targets.length; i++) {
    const t = classified.targets[i];
    const exists = fs.existsSync(t.destPath);
    const productionBytes = exists ? fs.statSync(t.destPath).size : 0;
    const productionSha = exists ? sha256File(t.destPath) : null;
    const ok = exists
      && productionBytes > 0
      && isPlayableWav(t.destPath)
      && productionBytes === t.size
      && productionSha === t.sha256;
    rows.push({
      cardId: t.cardId,
      voiceKey: t.voiceKey,
      sourcePath: t.sourcePath,
      productionPath: t.destPath,
      sourceBytes: t.size,
      productionBytes: productionBytes,
      sourceSha256: t.sha256,
      productionSha256: productionSha,
      ok: ok,
    });
  }
  return {
    rows: rows,
    ok: rows.every((r) => r.ok),
  };
}

function appendManifestVoice(root, classified) {
  const dest = path.join(root, 'data', 'production-audio');
  const manifestPath = path.join(dest, 'manifest.json');
  const manifest = loadJson(manifestPath);
  if (manifest.schemaVersion !== 1) throw new Error('unexpected schemaVersion');
  const unified = loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const voiceIndex = buildVoiceKeyIndex((unified && unified.cards) || {});
  const existingFiles = Object.create(null);
  (manifest.voice || []).forEach((row) => { existingFiles[row.file] = true; });
  const added = [];
  for (let i = 0; i < classified.targets.length; i++) {
    const t = classified.targets[i];
    if (existingFiles[t.destRel]) continue;
    const rec = voiceIndex.get(t.voiceKey);
    if (!rec) throw new Error('voiceKey not in audio index: ' + t.voiceKey);
    added.push({
      file: t.destRel,
      bytes: t.size,
      sha256: t.sha256,
      voiceKey: rec.voiceKey,
      cardIds: rec.cardIds.slice(),
      types: rec.types.slice(),
    });
  }
  manifest.voice = (manifest.voice || []).concat(added).sort((a, b) => String(a.file).localeCompare(String(b.file)));
  manifest.generatedAt = new Date().toISOString();
  const tmp = manifestPath + '.part';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, manifestPath);
  verifyProductionPackage(dest);
  return { added: added.length, manifest: loadJson(manifestPath) };
}

function existingModified(before, after) {
  let modified = 0;
  Object.keys(before.fileMap).forEach((rel) => {
    if (rel === 'manifest.json') return;
    const prev = before.fileMap[rel];
    const next = after.fileMap[rel];
    if (!next || next.sha256 !== prev.sha256 || next.bytes !== prev.bytes) modified += 1;
  });
  return modified;
}

module.exports = {
  TARGET_CARD_IDS,
  EXPECTED_PLAY_VOICE_KEYS,
  EXPECTED_BASELINE,
  snapshotProduction,
  sourcePrecheck,
  classifyTargets,
  copyTargets,
  verifyCopies,
  appendManifestVoice,
  existingModified,
};
