import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { unpackUnityFS } from '../../unpack-search.mjs';
import { parseSerializedFile, parseGameObject, parseAssetBundleContainer, extractPrintable, extractVoKeys } from '../../unity-serialized.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const {
  extractSoundsFromComponents,
  prefabsFromText,
  wavsFromText,
} = require('./src/extractCardDefSounds.js');
const {
  loadIndexes,
  findCardsByQuery,
  buildIndexInvestigation,
  concludeFromLayers,
  parseArgv,
  ROOT,
  HS_WIN,
} = require('./src/validation/investigateCardAudio.js');

const INTERESTING_FIELDS = [
  'm_PlayEffectDef',
  'm_SoundSpellPaths',
  'm_AttackEffectDef',
  'm_DeathEffectDef',
  'm_CustomSummonSpellPath',
  'm_GoldenPlaySpellPath',
  'm_EmoteDefs',
  'm_HeroPowerEffectDef',
  'm_SpawnSpellPath',
];

const TIMING_HINTS = [
  'm_DelaySec',
  'm_Delay',
  'm_Volume',
  'm_Pitch',
  'm_Loop',
  'AudioMixer',
  'AudioMixerGroup',
  'Fade',
  'Trigger',
  'Timeline',
  'Animation',
  'AudioSource',
  'SoundDef',
  'SoundSpell',
  'VoiceSet',
  'Actor',
  'Effect',
  'Stinger',
];

function unpackSafe(filePath) {
  try {
    return unpackUnityFS(filePath);
  } catch (e) {
    return { error: e.message, files: [] };
  }
}

function fieldHits(text) {
  const hits = {};
  for (const f of INTERESTING_FIELDS) hits[f] = text.includes(f);
  return hits;
}

function timingHints(text) {
  return TIMING_HINTS.filter((t) => text.includes(t));
}

function guidRefs(text) {
  const out = [];
  const re = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;
  let m;
  while ((m = re.exec(text))) out.push({ prefabName: m[1], guid: m[2], sourceField: 'prefab_string' });
  return out;
}

function scanCardDefLive(cardId, cardDefCache) {
  const files = (cardDefCache && cardDefCache.files) || [];
  if (!files.length) return { error: 'no_carddef_file', cardId, monoBehaviours: [], soundReferences: [] };
  const monoBehaviours = [];
  const allText = [];
  let goFound = false;
  for (const name of files) {
    const f = path.join(HS_WIN, name);
    if (!fs.existsSync(f)) {
      monoBehaviours.push({ file: name, error: 'missing_bundle' });
      continue;
    }
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) {
      monoBehaviours.push({ file: name, error: unpacked.error || 'empty' });
      continue;
    }
    const cab = unpacked.files[0].data;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch (e) {
      monoBehaviours.push({ file: name, error: e.message });
      continue;
    }
    const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
    for (const o of parsed.objects) {
      if (o.classId !== 1) continue;
      const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
      if (!go.name || go.name !== cardId) continue;
      goFound = true;
      const bodies = [];
      for (const c of go.comps) {
        const obj = byPath.get(c.pathId);
        if (!obj || obj.classId !== 114) continue;
        const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
        bodies.push(body);
        const text = extractPrintable(body);
        allText.push(text);
        monoBehaviours.push({
          file: name,
          pathId: obj.pathId,
          byteSize: obj.byteSize,
          fields: fieldHits(text),
          timingHints: timingHints(text),
          prefabs: prefabsFromText(text),
          wavs: wavsFromText(text),
          voKeys: extractVoKeys(body),
        });
      }
      const merged = extractSoundsFromComponents(bodies);
      return {
        cardId,
        files,
        goFound: true,
        monoBehaviourCount: monoBehaviours.length,
        monoBehaviours,
        mergedSounds: {
          play: merged.play,
          attack: merged.attack,
          death: merged.death,
          customSummon: merged.customSummon,
          musicStinger: merged.musicStinger,
          allPrefabs: merged.allPrefabs,
          wavRefs: merged.wavRefs,
          musicFieldNames: [...new Set(merged.musicFieldNames)],
        },
        fieldHits: fieldHits(allText.join('\n')),
      };
    }
  }
  return {
    cardId,
    files,
    goFound,
    monoBehaviourCount: monoBehaviours.length,
    monoBehaviours,
    mergedSounds: null,
    error: goFound ? null : 'gameobject_not_found',
  };
}

function loadGuidIndex(root = ROOT) {
  const p = path.join(root, 'data', 'index', 'cache', 'guid-voice-index.json');
  if (!fs.existsSync(p)) return { guidIndex: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function scanPrefabLive(guid, rec) {
  if (!rec || !rec.file) {
    return { guid, indexed: false, voiceKeys: [], hints: [], error: 'guid_not_in_index' };
  }
  const f = path.join(HS_WIN, rec.file);
  if (!fs.existsSync(f)) {
    return { guid, bundle: rec.file, indexed: true, error: 'bundle_missing', voiceKeys: rec.voiceKeys || [] };
  }
  const unpacked = unpackSafe(f);
  if (unpacked.error || !unpacked.files.length) {
    return { guid, bundle: rec.file, error: unpacked.error || 'empty', voiceKeys: rec.voiceKeys || [] };
  }
  const cab = unpacked.files[0].data;
  let parsed;
  try {
    parsed = parseSerializedFile(cab);
  } catch (e) {
    return { guid, bundle: rec.file, error: e.message, voiceKeys: rec.voiceKeys || [] };
  }
  const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
  const texts = [];
  const target = rec.pathId != null ? byPath.get(String(rec.pathId)) : null;
  if (target) {
    texts.push(extractPrintable(cab.subarray(target.absStart, target.absStart + target.byteSize)));
  }
  if (rec.preloadIndex != null && rec.preloadSize) {
    for (const o of parsed.objects) {
      if (o.classId !== 142) continue;
      try {
        const ab = parseAssetBundleContainer(cab.subarray(o.absStart, o.absStart + o.byteSize));
        const end = Math.min((ab.preload || []).length, rec.preloadIndex + rec.preloadSize);
        for (let i = rec.preloadIndex; i < end; i++) {
          const p = ab.preload[i];
          if (!p) continue;
          const obj = byPath.get(p.pathId);
          if (!obj) continue;
          texts.push(extractPrintable(cab.subarray(obj.absStart, obj.absStart + obj.byteSize)));
        }
      } catch {
        // ignore preload walk failures
      }
    }
  }
  if (!texts.length) {
    return {
      guid,
      bundle: rec.file,
      indexed: true,
      voiceKeys: rec.voiceKeys || [],
      hints: [],
      note: 'guid indexed; skipped full-bundle dump',
    };
  }
  const text = texts.join('\n');
  return {
    guid,
    bundle: rec.file,
    indexed: true,
    voiceKeys: rec.voiceKeys || [],
    hints: timingHints(text),
    hasAudioSource: text.includes('AudioSource'),
    hasSoundDef: /SoundDef/i.test(text),
    hasSoundSpell: /SoundSpell/i.test(text),
    hasVoiceSet: /VoiceSet/i.test(text),
    hasActor: /\bActor\b/.test(text),
    hasEffect: /Effect/i.test(text),
    voKeys: extractVoKeys(Buffer.from(text, 'latin1')),
    prefabs: prefabsFromText(text).slice(0, 20),
    wavs: wavsFromText(text).slice(0, 20),
  };
}

function audioRefsFromKeys(keys, audioIndex) {
  const clips = (audioIndex && audioIndex.clips) || {};
  return (keys || []).filter(Boolean).map((name) => {
    const rec = clips[name];
    const bundles = rec
      ? [...new Set([...(rec.zhcnBundles || []), ...(rec.prefabBundles || [])])]
      : [];
    return {
      audioClipName: name,
      indexed: !!rec,
      bundles,
      compression: rec && rec.compression ? rec.compression : null,
      hasFsbHint: bundles.some((b) => /audio|sound/i.test(b)),
    };
  });
}

function uniqueSoundRefs(merged, livePrefabs) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p || !p.guid || seen.has(p.guid + ':' + (p.name || p.prefabName || ''))) return;
    seen.add(p.guid + ':' + (p.name || p.prefabName || ''));
    out.push({
      prefabName: p.name || p.prefabName || null,
      guid: p.guid,
      sourceField: p.sourceField || 'carddef',
      bundle: p.bundle || null,
    });
  };
  if (merged) {
    for (const p of merged.allPrefabs || []) add(p);
    if (merged.play) add({ name: 'Play', guid: merged.play });
    if (merged.attack) add({ name: 'Attack', guid: merged.attack });
    if (merged.death) add({ name: 'Death', guid: merged.death });
    if (merged.customSummon) add(merged.customSummon);
    if (merged.musicStinger) add(merged.musicStinger);
  }
  for (const p of livePrefabs || []) add(p);
  return out;
}

function investigateLive(cardId, indexes, guidIndex, audioIndex) {
  const base = buildIndexInvestigation(cardId, indexes);
  const live = scanCardDefLive(cardId, base.cardDefCache);
  const refs = uniqueSoundRefs(live.mergedSounds, null);
  const prefabContents = [];
  for (const ref of refs) {
    const rec = guidIndex[ref.guid];
    const scanned = scanPrefabLive(ref.guid, rec);
    ref.bundle = scanned.bundle || (rec && rec.file) || null;
    prefabContents.push(scanned);
  }
  const clipNames = [];
  for (const p of prefabContents) {
    for (const k of p.voiceKeys || []) clipNames.push(k);
    for (const k of p.voKeys || []) clipNames.push(k);
  }
  if (base.index.voice) {
    for (const slot of ['play', 'attack', 'death']) {
      const k = base.index.voice[slot] && base.index.voice[slot].voiceKey;
      if (k) clipNames.push(k);
    }
  }
  if (base.index.music && base.index.music.audioClipName) clipNames.push(base.index.music.audioClipName);
  const audioReferences = audioRefsFromKeys([...new Set(clipNames)], audioIndex);

  const variantIndexes = (base.variants || []).slice(0, 40).map((v) => ({
    ...v,
    index: buildIndexInvestigation(v.id, indexes).index,
  }));

  const conclusion = concludeFromLayers({
    card: base.card,
    index: base.index,
    cardDef: live.mergedSounds,
    soundReferences: refs,
    audioReferences,
  });

  return {
    generatedAt: new Date().toISOString(),
    queryCardId: cardId,
    card: base.card,
    currentIndex: base.index,
    variants: variantIndexes,
    prefixCandidates: base.prefixCandidates,
    cardDef: {
      files: live.files,
      goFound: live.goFound,
      monoBehaviourCount: live.monoBehaviourCount,
      monoBehaviours: (live.monoBehaviours || []).map((mb) => ({
        file: mb.file,
        byteSize: mb.byteSize,
        pathId: mb.pathId,
        fields: mb.fields,
        timingHints: mb.timingHints,
        error: mb.error || null,
      })),
      merged: live.mergedSounds,
      fieldHits: live.fieldHits || null,
    },
    soundReferences: refs,
    prefabContents,
    audioReferences,
    timing: base.timing,
    conclusion: conclusion.conclusion,
    recommendedFix: conclusion.recommendedFix,
    leakLayer: conclusion.leakLayer,
    note: conclusion.note || null,
  };
}

async function main() {
  const { cardId, query } = parseArgv(process.argv);
  const indexes = loadIndexes(ROOT);
  const guidPack = loadGuidIndex(ROOT);
  const guidIndex = guidPack.guidIndex || guidPack;
  const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));

  if (query && !cardId) {
    const hits = findCardsByQuery(indexes.cards, query, indexes.enNames);
    console.log(JSON.stringify({ query, hits }, null, 2));
    return;
  }
  if (!cardId) {
    console.error('Usage: node investigateCardAudioLive.mjs --cardId <CardID>');
    process.exit(1);
  }
  const report = investigateLive(cardId, indexes, guidIndex, audioIndex);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
