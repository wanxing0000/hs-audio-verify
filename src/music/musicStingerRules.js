const VOICE_SLOTS = new Set(['play', 'attack', 'death']);

function classifyPrefabName(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'play') return 'play';
  if (n === 'attack') return 'attack';
  if (n === 'death') return 'death';
  if (/stinger/.test(n)) return 'music_stinger';
  if (/music/.test(n)) return 'other_music_name';
  if (/summon/.test(n)) return 'summon';
  return 'other';
}

function isVoiceClipName(key) {
  return /^VO_/i.test(String(key || ''));
}

function isMusicClipName(key) {
  const k = String(key || '');
  if (!k || isVoiceClipName(k)) return false;
  if (/stinger/i.test(k)) return true;
  if (/_music($|_)/i.test(k)) return true;
  if (/^pegasus_stinger/i.test(k)) return true;
  return false;
}

function musicClipsFromKeys(keys) {
  return [...new Set((keys || []).filter(isMusicClipName))];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleItems(items, count, seed) {
  const rng = mulberry32(seed);
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function guessClipFromCardId() {
  throw new Error('music clip names must come from resource GUID relations, not CardID');
}

function mappingFromPrefab(prefab, guidRec, shareCount) {
  const nameKind = classifyPrefabName(prefab.name);
  const clips = musicClipsFromKeys(guidRec && guidRec.voiceKeys);
  const indexed = !!(guidRec && guidRec.file);
  const emptyKeys = indexed && !(guidRec.voiceKeys || []).length;
  const isStingerName = nameKind === 'music_stinger';
  const isOtherMusicName = nameKind === 'other_music_name';
  const isMusic = isStingerName || isOtherMusicName || clips.length > 0;
  const shared = isMusic && (shareCount || 1) > 1;
  let musicType = null;
  if (isStingerName) musicType = 'music_stinger';
  else if (isMusic) musicType = 'other_music_reference';
  return {
    mappingType: shared ? 'shared_music' : (musicType === 'music_stinger' ? 'own_music' : (isMusic ? 'other_music_reference' : 'not_music')),
    prefabName: prefab.name,
    prefabGuid: prefab.guid,
    nameKind,
    isMusic,
    musicType,
    audioClipName: clips[0] || null,
    audioClipNames: clips,
    bundle: guidRec ? guidRec.file : null,
    indexed,
    emptyKeys,
    unresolved: isMusic && (!indexed || (isStingerName && !clips.length && emptyKeys)),
  };
}

function mappingsFromWavRef(wav, guidRec, shareCount) {
  if (!isMusicClipName(wav.name) && !musicClipsFromKeys(guidRec && guidRec.voiceKeys).length) {
    return null;
  }
  const clips = [...new Set([wav.name, ...musicClipsFromKeys(guidRec && guidRec.voiceKeys)])].filter(isMusicClipName);
  const shared = (shareCount || 1) > 1;
  return {
    mappingType: shared ? 'shared_music' : 'other_music_reference',
    prefabName: null,
    prefabGuid: wav.guid,
    nameKind: 'wav_ref',
    isMusic: true,
    musicType: 'other_music_reference',
    audioClipName: clips[0] || wav.name,
    audioClipNames: clips,
    bundle: guidRec ? guidRec.file : null,
    indexed: !!(guidRec && guidRec.file),
    emptyKeys: false,
    unresolved: false,
  };
}

function rollupStatus(parseError, mappings) {
  if (parseError) return 'parse_error';
  const music = (mappings || []).filter((m) => m.isMusic);
  if (music.some((m) => m.unresolved) && !music.some((m) => m.isMusic && !m.unresolved)) {
    return 'unresolved';
  }
  if (!music.length) return 'no_music_reference';
  if (music.some((m) => m.mappingType === 'shared_music')) return 'shared_music_found';
  if (music.some((m) => m.musicType === 'music_stinger')) return 'music_stinger_found';
  if (music.some((m) => m.musicType === 'other_music_reference')) return 'other_music_found';
  return 'no_music_reference';
}

function uniquePrefabs(list) {
  const seen = new Set();
  const out = [];
  for (const p of list || []) {
    if (!p || !p.guid || seen.has(p.guid + ':' + p.name)) continue;
    seen.add(p.guid + ':' + p.name);
    out.push(p);
  }
  return out;
}

const VOICE_SLOT_SKIP = new Set(['play', 'attack', 'death']);

function collectMusicMappings(def, guidIndex, shareCounts, indexMusicGuids) {
  const mappings = [];
  const seen = new Set();
  const add = (m) => {
    if (!m || !m.prefabGuid || seen.has(m.prefabGuid + ':' + (m.prefabName || '') + ':' + (m.audioClipName || ''))) return;
    seen.add(m.prefabGuid + ':' + (m.prefabName || '') + ':' + (m.audioClipName || ''));
    mappings.push(m);
  };
  const musicGuidSet = indexMusicGuids instanceof Set ? indexMusicGuids : new Set(indexMusicGuids || []);

  for (const p of uniquePrefabs(def && def.allPrefabs)) {
    const rec = guidIndex[p.guid];
    const share = (shareCounts.get && shareCounts.get(p.guid)) || shareCounts[p.guid] || 1;
    const mapped = mappingFromPrefab(p, rec, share);
    if (VOICE_SLOT_SKIP.has(mapped.nameKind) && !mapped.isMusic) continue;
    if (mapped.nameKind === 'summon' && !mapped.isMusic) continue;
    if (mapped.nameKind === 'other' && !mapped.isMusic && !musicGuidSet.has(p.guid)) continue;
    if (mapped.isMusic || musicGuidSet.has(p.guid)) {
      if (!mapped.isMusic && musicGuidSet.has(p.guid)) {
        mapped.isMusic = true;
        mapped.musicType = mapped.musicType || 'other_music_reference';
        mapped.mappingType = share > 1 ? 'shared_music' : 'other_music_reference';
        mapped.audioClipNames = musicClipsFromKeys(rec && rec.voiceKeys);
        mapped.audioClipName = mapped.audioClipNames[0] || null;
        mapped.bundle = rec ? rec.file : mapped.bundle;
      }
      add(mapped);
    }
  }

  for (const w of (def && def.wavRefs) || []) {
    const share = (shareCounts.get && shareCounts.get(w.guid)) || shareCounts[w.guid] || 1;
    add(mappingsFromWavRef(w, guidIndex[w.guid], share));
  }

  for (const slot of ['play', 'attack', 'death']) {
    const guid = def && def[slot];
    if (!guid) continue;
    const rec = guidIndex[guid];
    const clips = musicClipsFromKeys(rec && rec.voiceKeys);
    if (!clips.length) continue;
    const share = (shareCounts.get && shareCounts.get(guid)) || shareCounts[guid] || 1;
    add({
      mappingType: share > 1 ? 'shared_music' : 'other_music_reference',
      prefabName: slot,
      prefabGuid: guid,
      nameKind: slot,
      isMusic: true,
      musicType: 'other_music_reference',
      audioClipName: clips[0],
      audioClipNames: clips,
      bundle: rec ? rec.file : null,
      indexed: !!rec,
      emptyKeys: false,
      unresolved: false,
      nestedInVoiceSlot: true,
    });
  }
  return mappings;
}

function pickPrimaryMusic(mappings) {
  const music = (mappings || []).filter((m) => m.isMusic);
  if (!music.length) return null;
  const resolved = music.filter((m) => !m.unresolved);
  const pool = resolved.length ? resolved : music;
  const named = pool.find((m) => m.prefabName === 'MusicStinger')
    || pool.find((m) => m.musicType === 'music_stinger')
    || pool[0];
  return named;
}

function pickCanonicalCardId(ids, metaById) {
  const list = [...new Set(ids)].filter(Boolean);
  const get = (id) => {
    if (!metaById) return {};
    if (typeof metaById.get === 'function') return metaById.get(id) || {};
    return metaById[id] || {};
  };
  list.sort((a, b) => {
    const ma = get(a);
    const mb = get(b);
    const ca = ma.collectible === true ? 0 : 1;
    const cb = mb.collectible === true ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const da = ma.dbfId != null ? Number(ma.dbfId) : Number.MAX_SAFE_INTEGER;
    const db = mb.dbfId != null ? Number(mb.dbfId) : Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return String(a).localeCompare(String(b));
  });
  return list[0] || null;
}

function unifyVoiceSlot(cardId, slot) {
  if (!slot) {
    return { status: 'unavailable', voiceKey: null, sourceCardId: null, delaySec: 0, timingVerified: false };
  }
  const map = slot.mappingType;
  const key = slot.voiceKey || null;
  const src = slot.voiceSourceCardId || null;
  if (slot.status === 'unresolved' || map === 'unresolved') {
    return {
      status: 'unresolved',
      voiceKey: key,
      sourceCardId: src,
      reason: slot.reason || slot.possibleReason || 'unresolved',
      delaySec: 0,
      timingVerified: false,
    };
  }
  if (slot.status === 'no_voice' || map === 'no_voice' || !key) {
    return { status: 'unavailable', voiceKey: null, sourceCardId: null, delaySec: 0, timingVerified: false };
  }
  const sharedTypes = new Set(['shared_resource', 'shared_audio', 'token_clip']);
  const isShared = sharedTypes.has(map) || (src && src !== cardId);
  return {
    status: isShared ? 'shared' : 'available',
    voiceKey: key,
    sourceCardId: src || cardId,
    delaySec: 0,
    timingVerified: false,
  };
}

function countStatuses(rows) {
  const out = {
    total: rows.length,
    musicStingerFound: 0,
    sharedMusicFound: 0,
    otherMusicFound: 0,
    noMusicReference: 0,
    unresolved: 0,
    parseError: 0,
  };
  for (const row of rows) {
    if (row.musicStatus === 'music_stinger_found') out.musicStingerFound++;
    else if (row.musicStatus === 'shared_music_found') out.sharedMusicFound++;
    else if (row.musicStatus === 'other_music_found') out.otherMusicFound++;
    else if (row.musicStatus === 'unresolved') out.unresolved++;
    else if (row.musicStatus === 'parse_error') out.parseError++;
    else out.noMusicReference++;
  }
  return out;
}

module.exports = {
  VOICE_SLOTS,
  classifyPrefabName,
  isVoiceClipName,
  isMusicClipName,
  musicClipsFromKeys,
  mulberry32,
  sampleItems,
  guessClipFromCardId,
  mappingFromPrefab,
  mappingsFromWavRef,
  rollupStatus,
  countStatuses,
  uniquePrefabs,
  collectMusicMappings,
  pickPrimaryMusic,
  pickCanonicalCardId,
  unifyVoiceSlot,
};
