const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeName } = require('./audioCache.js');
const { ENTRANCE_MIX_VERSION } = require('../music/entranceMixConfig.js');
const { voicePlayable, musicPlayable } = require('../miniprogram/catalogAdapter.js');

const SCHEMA_VERSION = 1;
const VOICE_TYPES = ['play', 'attack', 'death'];
const FORBIDDEN_MANIFEST = [
  'unity3d',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'SERVICE_ROLE',
];

function productionAudioPaths(root) {
  const dest = path.join(root, 'data', 'production-audio');
  return {
    dest,
    staging: path.join(root, 'data', '.production-audio-staging'),
    backup: path.join(root, 'data', '.production-audio-backup'),
    extract: path.join(root, 'tmp', 'production-audio-extract'),
    tmpAudio: path.join(root, 'tmp', 'audio'),
    tmpMusic: path.join(root, 'tmp', 'music'),
    tmpPreview: path.join(root, 'tmp', 'preview'),
    cardIndex: path.join(root, 'data', 'index', 'card-audio-index.json'),
    musicAssets: path.join(root, 'data', 'index', 'music-assets.json'),
  };
}

function isRiffWave(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, 12, 0);
    if (n < 12) return false;
    return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE';
  } catch (e) {
    return false;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function isPlayableWav(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 44) return false;
    return isRiffWave(filePath);
  } catch (e) {
    return false;
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => {
    const p = path.join(dir, name);
    return fs.statSync(p).isFile();
  });
}

function rmIfExists(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function renameOrCopy(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildVoiceKeyIndex(cards) {
  const byKey = new Map();
  for (const [cardId, raw] of Object.entries(cards || {})) {
    for (const type of VOICE_TYPES) {
      const slot = raw && raw.voice && raw.voice[type];
      if (!voicePlayable(slot)) continue;
      const key = slot.voiceKey;
      if (!byKey.has(key)) byKey.set(key, { voiceKey: key, cardIds: [], types: [] });
      const rec = byKey.get(key);
      if (rec.cardIds.indexOf(cardId) < 0) rec.cardIds.push(cardId);
      if (rec.types.indexOf(type) < 0) rec.types.push(type);
    }
  }
  for (const rec of byKey.values()) {
    rec.cardIds.sort();
    rec.types.sort();
  }
  return byKey;
}

function buildMusicIndex(cards) {
  const byCardId = new Map();
  const byClip = new Map();
  for (const [cardId, raw] of Object.entries(cards || {})) {
    if (!musicPlayable(raw && raw.music)) continue;
    const clip = raw.music.audioClipName || null;
    byCardId.set(cardId, clip);
    if (clip) {
      if (!byClip.has(clip)) byClip.set(clip, []);
      const ids = byClip.get(clip);
      if (ids.indexOf(cardId) < 0) ids.push(cardId);
    }
  }
  for (const ids of byClip.values()) ids.sort();
  return { byCardId, byClip };
}

function isExcludedMusicName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.fsb')) return true;
  if (lower.includes('entrance_preview')) return true;
  return false;
}

function collectVoiceFiles(audioDirs, voiceIndex) {
  const chosen = new Map();
  for (const dir of audioDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of listFiles(dir)) {
      if (!/\.wav$/i.test(name)) continue;
      const src = path.join(dir, name);
      if (!isPlayableWav(src)) continue;
      const stem = name.replace(/\.wav$/i, '');
      const rec = voiceIndex.get(stem);
      if (!rec) continue;
      if (!chosen.has(stem)) chosen.set(stem, { src, name: safeName(stem) + '.wav', rec });
    }
  }
  return [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectMusicFiles(musicDirs, musicIndex) {
  const chosen = new Map();
  for (const dir of musicDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of listFiles(dir)) {
      if (isExcludedMusicName(name)) continue;
      if (!/\.wav$/i.test(name)) continue;
      const src = path.join(dir, name);
      if (!isPlayableWav(src)) continue;
      const stem = name.replace(/\.wav$/i, '');
      let cardId = null;
      let audioClip = null;
      let cardIds = [];
      if (/_MusicStinger$/i.test(stem)) {
        const id = stem.replace(/_MusicStinger$/i, '');
        if (!musicIndex.byCardId.has(id)) continue;
        cardId = id;
        audioClip = musicIndex.byCardId.get(id);
        cardIds = [id];
      } else if (musicIndex.byClip.has(stem)) {
        audioClip = stem;
        cardIds = musicIndex.byClip.get(stem).slice();
        cardId = cardIds[0] || null;
      } else {
        continue;
      }
      const file = safeName(stem) + '.wav';
      if (!chosen.has(file)) {
        chosen.set(file, { src, name: file, cardId, audioClip, cardIds });
      }
    }
  }
  return [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectEntranceFiles(previewDirs) {
  if (ENTRANCE_MIX_VERSION !== 3) {
    throw new Error('ENTRANCE_MIX_VERSION must be 3 to build production entrance files');
  }
  const suffix = '_entrance_v' + ENTRANCE_MIX_VERSION + '.wav';
  const chosen = new Map();
  const re = new RegExp('_entrance_v' + ENTRANCE_MIX_VERSION + '\\.wav$', 'i');
  for (const dir of previewDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of listFiles(dir)) {
      if (!re.test(name)) continue;
      const src = path.join(dir, name);
      if (!isPlayableWav(src)) continue;
      const cardId = name.slice(0, name.length - suffix.length);
      if (!cardId || /_entrance_v\d+$/i.test(cardId)) continue;
      const file = cardId + suffix;
      if (!chosen.has(file)) chosen.set(file, { src, name: file, cardId });
    }
  }
  return [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function copySelected(files, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  return files.map((item) => {
    const dest = path.join(destDir, item.name);
    fs.copyFileSync(item.src, dest);
    const st = fs.statSync(dest);
    return {
      item,
      file: path.basename(destDir) + '/' + item.name,
      bytes: st.size,
      sha256: sha256File(dest),
    };
  });
}

function assertSafeManifest(manifest) {
  const text = JSON.stringify(manifest);
  for (const needle of FORBIDDEN_MANIFEST) {
    if (text.indexOf(needle) >= 0) {
      throw new Error('production manifest must not contain ' + needle);
    }
  }
  if (/[A-Za-z]:\\/.test(text) || /\/Hearthstone\//i.test(text)) {
    throw new Error('production manifest must not contain absolute game paths');
  }
}

function buildManifest({ voice, music, entrance, generatedAt }) {
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    source: 'local-production-audio',
    entranceMixVersion: ENTRANCE_MIX_VERSION,
    generatedAt: generatedAt || new Date().toISOString(),
    voice: voice.map((row) => ({
      file: row.file,
      bytes: row.bytes,
      sha256: row.sha256,
      voiceKey: row.item.rec.voiceKey,
      cardIds: row.item.rec.cardIds.slice(),
      types: row.item.rec.types.slice(),
    })),
    music: music.map((row) => ({
      file: row.file,
      bytes: row.bytes,
      sha256: row.sha256,
      cardId: row.item.cardId,
      audioClip: row.item.audioClip || null,
      cardIds: row.item.cardIds.slice(),
    })),
    entrance: entrance.map((row) => ({
      file: row.file,
      bytes: row.bytes,
      sha256: row.sha256,
      cardId: row.item.cardId,
    })),
  };
  assertSafeManifest(manifest);
  return manifest;
}

function verifyProductionPackage(packageDir) {
  const manifestPath = path.join(packageDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('missing manifest.json');
  const manifest = loadJson(manifestPath);
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('unexpected manifest schemaVersion');
  }
  if (manifest.entranceMixVersion !== ENTRANCE_MIX_VERSION) {
    throw new Error('entranceMixVersion mismatch');
  }
  assertSafeManifest(manifest);
  const kinds = [
    ['voice', manifest.voice || []],
    ['music', manifest.music || []],
    ['entrance', manifest.entrance || []],
  ];
  for (const [kind, rows] of kinds) {
    for (const row of rows) {
      if (!row || !row.file) throw new Error('manifest ' + kind + ' missing file');
      const abs = path.join(packageDir, row.file);
      if (!fs.existsSync(abs)) throw new Error('missing ' + row.file);
      const st = fs.statSync(abs);
      if (st.size !== row.bytes) throw new Error('bytes mismatch ' + row.file);
      if (sha256File(abs) !== row.sha256) throw new Error('sha256 mismatch ' + row.file);
      if (kind !== 'music' || /\.wav$/i.test(row.file)) {
        if (!isPlayableWav(abs)) throw new Error('invalid wav ' + row.file);
      }
      if (/\.fsb$/i.test(row.file)) throw new Error('fsb is not a production wav: ' + row.file);
    }
  }
  for (const name of listFiles(path.join(packageDir, 'entrance'))) {
    if (/_entrance\.wav$/i.test(name) && !/_entrance_v\d+\.wav$/i.test(name)) {
      throw new Error('production entrance must not include v1 file ' + name);
    }
    if (/_entrance_v2\.wav$/i.test(name)) {
      throw new Error('production entrance must not include v2 file ' + name);
    }
    if (/_entrance_v\d+\.wav$/i.test(name) && !new RegExp('_entrance_v' + ENTRANCE_MIX_VERSION + '\\.wav$', 'i').test(name)) {
      throw new Error('production entrance version not current: ' + name);
    }
  }
  for (const name of listFiles(path.join(packageDir, 'music'))) {
    if (/\.fsb$/i.test(name)) throw new Error('production music contains fsb: ' + name);
  }
  return manifest;
}

function atomicReplace(staging, dest, backup) {
  const destExisted = fs.existsSync(dest);
  if (destExisted) {
    rmIfExists(backup);
    renameOrCopy(dest, backup);
  }
  try {
    renameOrCopy(staging, dest);
  } catch (e) {
    if (destExisted && fs.existsSync(backup) && !fs.existsSync(dest)) {
      try {
        renameOrCopy(backup, dest);
      } catch (restoreErr) {
        e.restoreError = restoreErr && restoreErr.message;
      }
    }
    throw e;
  }
  rmIfExists(backup);
}

function sourceDirs(root, paths) {
  return {
    audio: [paths.tmpAudio, path.join(paths.extract, 'voice')],
    music: [paths.tmpMusic, path.join(paths.extract, 'music')],
    preview: [paths.tmpPreview, path.join(paths.extract, 'entrance')],
  };
}

function buildProductionAudioPackage(opts) {
  opts = opts || {};
  const root = opts.root;
  if (!root) throw new Error('root required');
  const paths = productionAudioPaths(root);
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const unified = loadJson(opts.cardIndexPath || paths.cardIndex);
  const cards = (unified && unified.cards) || {};
  const voiceIndex = buildVoiceKeyIndex(cards);
  const musicIndex = buildMusicIndex(cards);
  const dirs = sourceDirs(root, paths);
  if (Array.isArray(opts.audioDirs)) dirs.audio = opts.audioDirs;
  if (Array.isArray(opts.musicDirs)) dirs.music = opts.musicDirs;
  if (Array.isArray(opts.previewDirs)) dirs.preview = opts.previewDirs;

  const dest = opts.destDir || paths.dest;
  const staging = opts.stagingDir || paths.staging;
  const backup = opts.backupDir || paths.backup;

  const voiceFiles = collectVoiceFiles(dirs.audio, voiceIndex);
  const musicFiles = collectMusicFiles(dirs.music, musicIndex);
  const entranceFiles = collectEntranceFiles(dirs.preview);

  rmIfExists(staging);
  fs.mkdirSync(path.join(staging, 'voice'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'music'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'entrance'), { recursive: true });

  const voice = copySelected(voiceFiles, path.join(staging, 'voice'));
  const music = copySelected(musicFiles, path.join(staging, 'music'));
  const entrance = copySelected(entranceFiles, path.join(staging, 'entrance'));
  const manifest = buildManifest({ voice, music, entrance, generatedAt });
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  verifyProductionPackage(staging);

  if (typeof opts.failAfterStaging === 'function') {
    opts.failAfterStaging({ staging, dest, manifest });
  }

  atomicReplace(staging, dest, backup);
  const verified = verifyProductionPackage(dest);
  return {
    dest,
    manifest: verified,
    counts: {
      voice: verified.voice.length,
      music: verified.music.length,
      entrance: verified.entrance.length,
    },
    bytes: [...verified.voice, ...verified.music, ...verified.entrance].reduce((s, r) => s + r.bytes, 0),
  };
}

function stableManifestView(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    source: manifest.source,
    entranceMixVersion: manifest.entranceMixVersion,
    voice: manifest.voice,
    music: manifest.music,
    entrance: manifest.entrance,
  };
}

module.exports = {
  SCHEMA_VERSION,
  productionAudioPaths,
  isRiffWave,
  isPlayableWav,
  sha256File,
  buildVoiceKeyIndex,
  buildMusicIndex,
  collectVoiceFiles,
  collectMusicFiles,
  collectEntranceFiles,
  buildProductionAudioPackage,
  verifyProductionPackage,
  stableManifestView,
  isExcludedMusicName,
};
