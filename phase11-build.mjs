import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { scanCardDefs, buildShareCounts } from './src/music/cardDefMusicScan.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const {
  musicClipsFromKeys,
  uniquePrefabs,
  collectMusicMappings,
  pickPrimaryMusic,
  pickCanonicalCardId,
  unifyVoiceSlot,
} = require('./src/music/musicStingerRules.js');
const { ART_BASE } = require('./src/explorer/CardVoiceRepository.js');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'data', 'index');
const SCHEMA = '1.0';

function nowIso() {
  return new Date().toISOString();
}

function musicGuidsFromIndex(guidIndex) {
  const set = new Set();
  for (const [guid, rec] of Object.entries(guidIndex)) {
    if (musicClipsFromKeys(rec.voiceKeys).length) set.add(guid);
  }
  return set;
}

function playableVoice(slot) {
  return slot && (slot.status === 'available' || slot.status === 'shared') && !!slot.voiceKey;
}

function playableMusic(music) {
  return music && (music.status === 'available' || music.status === 'shared') && !!music.musicAssetId;
}

function previewableMusic(music) {
  return playableMusic(music) && !!music.audioClipName;
}

function loadMeta() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), 'utf8'));
  const collectible = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.collectible.json'), 'utf8'));
  const extra = new Map();
  for (const c of collectible) {
    if (!c || !c.id) continue;
    extra.set(c.id, {
      cardClass: c.cardClass || null,
      rarity: c.rarity || null,
      text: c.text || null,
      flavor: c.flavor || null,
      collectible: c.collectible === true,
      name: c.name || null,
      cost: c.cost != null ? c.cost : null,
    });
  }
  const byId = new Map();
  for (const c of raw) {
    if (!c || !c.id || byId.has(c.id)) continue;
    const x = extra.get(c.id) || {};
    byId.set(c.id, {
      id: c.id,
      name: c.name || x.name || c.id,
      text: c.text || x.text || null,
      flavor: c.flavor || x.flavor || null,
      type: c.type || 'UNKNOWN',
      class: c.cardClass || x.cardClass || null,
      rarity: c.rarity || x.rarity || null,
      collectible: c.collectible === true || x.collectible === true,
      set: c.set || null,
      dbfId: c.dbfId ?? null,
    });
  }
  return byId;
}

function writeReport({ unified, musicIndex, musicAssets, timings, diff, phase101 }) {
  const cards = Object.values(unified.cards);
  const collectible = cards.filter((c) => c.collectible);
  const legendMinion = collectible.filter((c) => c.type === 'MINION' && c.rarity === 'LEGENDARY');
  const voicePlay = cards.filter((c) => playableVoice(c.voice.play)).length;
  const voiceAttack = cards.filter((c) => playableVoice(c.voice.attack)).length;
  const voiceDeath = cards.filter((c) => playableVoice(c.voice.death)).length;
  const voiceShared = cards.filter((c) => ['play', 'attack', 'death'].some((s) => c.voice[s].status === 'shared')).length;
  const voiceUnresolved = cards.filter((c) => ['play', 'attack', 'death'].some((s) => c.voice[s].status === 'unresolved')).length;
  const musicAvail = cards.filter((c) => playableMusic(c.music)).length;
  const musicOwn = cards.filter((c) => c.music.status === 'available').length;
  const musicShared = cards.filter((c) => c.music.status === 'shared').length;
  const musicUnavail = cards.filter((c) => c.music.status === 'unavailable').length;
  const musicUnresolved = cards.filter((c) => c.music.status === 'unresolved').length;
  const entranceYes = cards.filter((c) => c.entrancePreview.available).length;
  const playNoMusic = cards.filter((c) => playableVoice(c.voice.play) && !playableMusic(c.music)).length;
  const musicNoPlay = cards.filter((c) => playableMusic(c.music) && !playableVoice(c.voice.play)).length;
  const entranceUnresolved = cards.filter((c) => c.entrancePreview.reason === 'unresolved').length;
  const legendWithMusic = legendMinion.filter((c) => playableMusic(c.music)).length;
  const legendNoMusic = legendMinion.filter((c) => !playableMusic(c.music)).length;

  const lines = [];
  lines.push('# Card Audio Index (Phase 1.1)');
  lines.push('');
  lines.push(`clientVersion: **${unified.clientVersion}**`);
  lines.push(`schemaVersion: **${unified.schemaVersion}**`);
  lines.push(`generatedAt: ${unified.generatedAt}`);
  lines.push('');
  lines.push('未修改 `C:\\Hearthstone`。未覆盖 `card-voice-index.json` / `audio-index.json`。未批量导出 WAV。未改 Explorer UI。');
  lines.push('');
  lines.push('## Cards');
  lines.push('');
  lines.push(`- total: ${cards.length}`);
  lines.push(`- collectible: ${collectible.length}`);
  lines.push(`- collectible legendary minion: ${legendMinion.length}`);
  lines.push('');
  lines.push('## Voice');
  lines.push('');
  lines.push(`- cards with play: ${voicePlay}`);
  lines.push(`- cards with attack: ${voiceAttack}`);
  lines.push(`- cards with death: ${voiceDeath}`);
  lines.push(`- cards with any shared voice slot: ${voiceShared}`);
  lines.push(`- cards with any unresolved voice slot: ${voiceUnresolved}`);
  lines.push('');
  lines.push('## Music');
  lines.push('');
  lines.push(`- cards with music (available+shared): ${musicAvail}`);
  lines.push(`- own / available: ${musicOwn}`);
  lines.push(`- shared: ${musicShared}`);
  lines.push(`- unavailable: ${musicUnavail}`);
  lines.push(`- unresolved: ${musicUnresolved}`);
  lines.push(`- unique music assets: ${Object.keys(musicAssets.assets).length}`);
  lines.push(`- collectible legendary minions with music: ${legendWithMusic}`);
  lines.push(`- collectible legendary minions without music: ${legendNoMusic}`);
  lines.push('');
  lines.push('## Entrance preview (logic only, no WAV batch)');
  lines.push('');
  lines.push(`- Play + Music: ${entranceYes}`);
  lines.push(`- Play but no Music: ${playNoMusic}`);
  lines.push(`- Music but no Play: ${musicNoPlay}`);
  lines.push(`- unresolved reason: ${entranceUnresolved}`);
  lines.push('');
  lines.push('## Phase 1.0.1 cross-check');
  lines.push('');
  if (phase101) {
    lines.push(`- Phase 1.0.1 legendary minions: ${phase101.legendaryCollectibleMinions.total}`);
    lines.push(`- Phase 1.0.1 with music: ${phase101.legendaryCollectibleMinions.musicStingerFound + phase101.legendaryCollectibleMinions.sharedMusicFound + phase101.legendaryCollectibleMinions.otherMusicFound}`);
    lines.push(`- Phase 1.0.1 no music: ${phase101.legendaryCollectibleMinions.noMusicReference}`);
  }
  lines.push(`- diff mismatches: ${diff.mismatches.length}`);
  lines.push(diff.mismatches.length ? '见 `data/index/card-audio-index-diff.json`。' : '与 Phase 1.0.1 覆盖率 **100% 一致**。');
  lines.push('');
  lines.push('## Timings');
  lines.push('');
  lines.push(JSON.stringify(timings, null, 2));
  fs.writeFileSync(path.join(OUT, 'card-audio-index-report.md'), lines.join('\n'), 'utf8');
}

function crossCheckPhase101(unified, phase101) {
  const mismatches = [];
  if (!phase101 || !Array.isArray(phase101.cards)) {
    return { ok: false, mismatches: [{ reason: 'phase-1.0.1-results.json missing cards' }] };
  }
  for (const row of phase101.cards) {
    const u = unified.cards[row.cardId];
    if (!u) {
      mismatches.push({ cardId: row.cardId, reason: 'missing_in_unified' });
      continue;
    }
    const had = row.musicStatus !== 'no_music_reference' && row.musicStatus !== 'parse_error';
    const has = playableMusic(u.music);
    const none = row.musicStatus === 'no_music_reference';
    if (had && !has) mismatches.push({ cardId: row.cardId, phase101: row.musicStatus, unified: u.music.status, reason: 'lost_music' });
    if (none && has) mismatches.push({ cardId: row.cardId, phase101: row.musicStatus, unified: u.music.status, reason: 'gained_music' });
    if (row.musicStatus === 'unresolved' && u.music.status !== 'unresolved') {
      mismatches.push({ cardId: row.cardId, phase101: row.musicStatus, unified: u.music.status, reason: 'unresolved_mismatch' });
    }
    if (row.musicStatus === 'parse_error' && u.music.status !== 'unresolved') {
      mismatches.push({ cardId: row.cardId, phase101: row.musicStatus, unified: u.music.status, reason: 'parse_error_mismatch' });
    }
  }
  const p = phase101.legendaryCollectibleMinions;
  const legendIds = phase101.cards.map((c) => c.cardId);
  const legend = legendIds.map((id) => unified.cards[id]).filter(Boolean);
  const withMusic = legend.filter((c) => playableMusic(c.music)).length;
  const expectedWith = p.musicStingerFound + p.sharedMusicFound + p.otherMusicFound;
  if (legend.length !== p.total) mismatches.push({ reason: 'legendary_count', expected: p.total, actual: legend.length });
  if (withMusic !== expectedWith) mismatches.push({ reason: 'legendary_with_music', expected: expectedWith, actual: withMusic });
  const noMusic = legend.filter((c) => !playableMusic(c.music)).length;
  if (noMusic !== p.noMusicReference + p.unresolved + p.parseError) {
    mismatches.push({ reason: 'legendary_without_music', expected: p.noMusicReference, actual: noMusic });
  }
  return { ok: mismatches.length === 0, mismatches };
}

const tAll = Date.now();
const timings = {};

console.log('[1.1] loading indexes (no audio-bundle scan)...');
let t0 = Date.now();
const voiceIndex = JSON.parse(fs.readFileSync(path.join(OUT, 'card-voice-index.json'), 'utf8'));
const audioIndex = JSON.parse(fs.readFileSync(path.join(OUT, 'audio-index.json'), 'utf8'));
const guidIndex = JSON.parse(fs.readFileSync(path.join(OUT, 'cache', 'guid-voice-index.json'), 'utf8')).guidIndex;
const metaById = loadMeta();
const phase101Path = path.join(ROOT, 'data', 'music-verification', 'phase-1.0.1-results.json');
const phase101 = fs.existsSync(phase101Path) ? JSON.parse(fs.readFileSync(phase101Path, 'utf8')) : null;
const clientVersion = voiceIndex.source?.productVersion || '36.4.0.250339';
timings.loadMs = Date.now() - t0;

t0 = Date.now();
console.log('[1.1] scan CardDef prefabs (reuse Phase 1.0.1 logic)...');
const scanned = scanCardDefs();
timings.cardDefMs = Date.now() - t0;
console.log('[1.1] carddef', scanned.stats);

t0 = Date.now();
const shareCounts = buildShareCounts(scanned.byCard, uniquePrefabs);
const indexMusicGuids = musicGuidsFromIndex(guidIndex);

const ownersByGuid = new Map();
const primaryByCard = new Map();
for (const cardId of Object.keys(voiceIndex.cards)) {
  const def = scanned.byCard[cardId];
  if (!def) {
    primaryByCard.set(cardId, { missingDef: true, mapping: null });
    continue;
  }
  const mappings = collectMusicMappings(def, guidIndex, shareCounts, indexMusicGuids);
  const primary = pickPrimaryMusic(mappings);
  primaryByCard.set(cardId, { missingDef: false, mapping: primary, mappings });
  if (primary && primary.prefabGuid && !primary.unresolved) {
    if (!ownersByGuid.has(primary.prefabGuid)) ownersByGuid.set(primary.prefabGuid, []);
    ownersByGuid.get(primary.prefabGuid).push(cardId);
  }
}

const canonicalByGuid = new Map();
for (const [guid, ids] of ownersByGuid) {
  const metaList = new Map();
  for (const id of ids) {
    const v = voiceIndex.cards[id];
    const m = metaById.get(id) || {};
    metaList.set(id, {
      collectible: m.collectible === true || v?.collectible === true,
      dbfId: m.dbfId ?? v?.dbfId ?? null,
    });
  }
  canonicalByGuid.set(guid, pickCanonicalCardId(ids, metaList));
}

const knownLengths = {};
if (phase101 && Array.isArray(phase101.extractSamples)) {
  for (const s of phase101.extractSamples) {
    if (s.audioClipName && s.wav && s.wav.bytes && s.wav.sampleRate && s.wav.channels) {
      const dataBytes = s.wav.bytes - 44;
      knownLengths[s.audioClipName] = dataBytes / (s.wav.sampleRate * s.wav.channels * 2);
    }
  }
}

const assets = {};
for (const [guid, ids] of ownersByGuid) {
  const source = canonicalByGuid.get(guid) || ids[0];
  const mapping = primaryByCard.get(source)?.mapping || primaryByCard.get(ids[0])?.mapping;
  if (!mapping) continue;
  const clip = mapping.audioClipName;
  const clipRec = clip && audioIndex.clips ? audioIndex.clips[clip] : null;
  assets[guid] = {
    audioClipName: clip,
    prefabGuid: guid,
    prefabName: mapping.prefabName || null,
    bundle: mapping.bundle || (clipRec && ((clipRec.prefabBundles && clipRec.prefabBundles[0]) || (clipRec.zhcnBundles && clipRec.zhcnBundles[0]))) || null,
    format: clip ? 'FSB5/Vorbis' : null,
    frequency: null,
    channels: null,
    lengthSec: clip && knownLengths[clip] != null ? knownLengths[clip] : null,
    loop: false,
    volume: 1,
    delaySec: 0,
    timingVerified: false,
  };
}

const musicCards = {};
const unifiedCards = {};
let ownMusic = 0;
let sharedMusic = 0;
let noMusic = 0;
let unresolvedMusic = 0;
let otherMusic = 0;

for (const cardId of Object.keys(voiceIndex.cards)) {
  const rec = voiceIndex.cards[cardId];
  const meta = metaById.get(cardId) || {};
  const info = primaryByCard.get(cardId);
  let music;
  if (!info || info.missingDef) {
    music = { status: 'unresolved', musicAssetId: null, sourceCardId: null, reason: 'carddef_missing' };
    unresolvedMusic++;
  } else if (!info.mapping) {
    music = { status: 'unavailable', musicAssetId: null, sourceCardId: null };
    noMusic++;
  } else if (info.mapping.unresolved || !info.mapping.prefabGuid) {
    music = {
      status: 'unresolved',
      musicAssetId: null,
      sourceCardId: null,
      reason: info.mapping.unresolved ? 'music_guid_unresolved' : 'music_guid_missing',
    };
    unresolvedMusic++;
  } else {
    const guid = info.mapping.prefabGuid;
    const source = canonicalByGuid.get(guid) || cardId;
    const isOwn = source === cardId;
    let kind;
    if (info.mapping.musicType === 'other_music_reference') {
      kind = 'other_music';
      otherMusic++;
    } else if (isOwn) {
      kind = 'own_music';
      ownMusic++;
    } else {
      kind = 'shared_music';
      sharedMusic++;
    }
    const asset = assets[guid];
    music = {
      status: isOwn ? 'available' : 'shared',
      musicAssetId: guid,
      sourceCardId: source,
      audioClipName: asset.audioClipName,
      loop: false,
      volume: 1,
      delaySec: 0,
      timingVerified: false,
    };
    musicCards[cardId] = {
      musicStatus: kind,
      musicAssetId: guid,
      sourceCardId: source,
    };
  }
  if (music.status === 'unavailable' || music.status === 'unresolved') {
    musicCards[cardId] = {
      musicStatus: music.status === 'unresolved' ? 'unresolved' : 'no_music',
      musicAssetId: null,
      sourceCardId: null,
      reason: music.reason || null,
    };
  }

  const voice = {
    play: unifyVoiceSlot(cardId, rec.voice && rec.voice.play),
    attack: unifyVoiceSlot(cardId, rec.voice && rec.voice.attack),
    death: unifyVoiceSlot(cardId, rec.voice && rec.voice.death),
  };

  let entrance;
  if (voice.play.status === 'unresolved' || music.status === 'unresolved') {
    entrance = { available: false, reason: 'unresolved' };
  } else if (!playableVoice(voice.play)) {
    entrance = { available: false, reason: 'no_play_voice' };
  } else if (!previewableMusic(music)) {
    entrance = { available: false, reason: playableMusic(music) ? 'unresolved' : 'no_music' };
  } else {
    entrance = {
      available: true,
      musicAssetId: music.musicAssetId,
      voiceKey: voice.play.voiceKey,
    };
  }

  unifiedCards[cardId] = {
    id: cardId,
    name: meta.name || rec.name || cardId,
    text: meta.text || null,
    flavor: meta.flavor || null,
    type: meta.type || rec.type || 'UNKNOWN',
    class: meta.class || null,
    rarity: meta.rarity || null,
    collectible: meta.collectible === true || rec.collectible === true,
    set: meta.set || rec.set || null,
    dbfId: meta.dbfId ?? rec.dbfId ?? null,
    cardImageKey: cardId,
    voice,
    music,
    entrancePreview: entrance,
  };
}

timings.mapMs = Date.now() - t0;

const musicIndex = {
  schemaVersion: SCHEMA,
  clientVersion,
  generatedAt: nowIso(),
  stats: {
    totalCards: Object.keys(musicCards).length,
    cardsWithMusic: ownMusic + sharedMusic + otherMusic,
    ownMusic,
    sharedMusic,
    otherMusic,
    noMusic,
    unresolved: unresolvedMusic,
  },
  musicAssets: assets,
  cards: musicCards,
};

const musicAssetsDoc = {
  schemaVersion: SCHEMA,
  clientVersion,
  generatedAt: musicIndex.generatedAt,
  assets,
};

const unified = {
  schemaVersion: SCHEMA,
  clientVersion,
  generatedAt: musicIndex.generatedAt,
  locale: 'zhCN',
  imageUrlTemplate: ART_BASE + '/{id}.png',
  cards: unifiedCards,
};

t0 = Date.now();
const diff = crossCheckPhase101(unified, phase101);
timings.diffMs = Date.now() - t0;

t0 = Date.now();
fs.writeFileSync(path.join(OUT, 'music-assets.json'), JSON.stringify(musicAssetsDoc));
fs.writeFileSync(path.join(OUT, 'music-index.json'), JSON.stringify(musicIndex));
fs.writeFileSync(path.join(OUT, 'card-audio-index.json'), JSON.stringify(unified));
if (diff.mismatches.length) {
  fs.writeFileSync(path.join(OUT, 'card-audio-index-diff.json'), JSON.stringify(diff, null, 2));
} else if (fs.existsSync(path.join(OUT, 'card-audio-index-diff.json'))) {
  fs.unlinkSync(path.join(OUT, 'card-audio-index-diff.json'));
}
timings.writeMs = Date.now() - t0;
timings.totalMs = Date.now() - tAll;

writeReport({ unified, musicIndex, musicAssets: musicAssetsDoc, timings, diff, phase101 });

console.log('[1.1] music assets', Object.keys(assets).length);
console.log('[1.1] unified cards', Object.keys(unifiedCards).length);
console.log('[1.1] legendary music check', diff);
console.log('[1.1] timings', timings);
console.log('[1.1] wrote music-index.json music-assets.json card-audio-index.json');
