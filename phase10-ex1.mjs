import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { unpackUnityFS } from './unpack-search.mjs';
import {
  parseSerializedFile,
  parseAssetBundleContainer,
  parseGameObject,
  extractVoKeys,
  extractPrintable,
  readObjectTypeTree,
} from './unity-serialized.mjs';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';
import { convertFsb, FsbConvertFormat } from '@arkntools/unity-js/audio';
import { extractSoundsFromComponents } from './src/extractCardDefSounds.js';
import { wavToPcm16, inspectWav } from './src/explorer/wavPcm16.js';
import { mixPcm16, readFmt } from './src/music/mixPcm16.js';
import { HearthstoneAudioExtractor } from './src/explorer/HearthstoneAudioExtractor.js';

const require = createRequire(path.join(process.cwd(), 'package.json'));

const HS_WIN = 'C:\\Hearthstone\\Data\\Win';
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'tmp', 'music');
const VERIFY_DIR = path.join(ROOT, 'data', 'music-verification');
const GUID = 'c6aaf3440b38a664db44d8870f3864d1';
const CARD_ID = 'EX1_116';
const CLASS_NAME = {
  1: 'GameObject',
  4: 'Transform',
  82: 'AudioSource',
  83: 'AudioClip',
  114: 'MonoBehaviour',
  115: 'MonoScript',
  142: 'AssetBundle',
};

function jsonSafe(v) {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
}

function sniff(buf) {
  if (!buf || buf.length < 4) return 'empty';
  const s = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (s === 'FSB5') return 'FSB5';
  if (s === 'FSB4') return 'FSB4';
  if (s === 'OggS') return 'ogg';
  if (s === 'RIFF') return 'wav';
  return 'bin';
}

function durationSecFromWav(buf) {
  const info = readFmt(buf);
  return info.data.length / (info.sampleRate * info.channels * (info.bits / 8));
}

function relatedAudioBundles(hashes) {
  const names = fs.readdirSync(HS_WIN);
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.unity3d')) continue;
    if (!hashes.some((h) => n.includes(h))) continue;
    const lower = n.toLowerCase();
    if (!(lower.includes('audio') || lower.includes('music') || lower.includes('soundlegend') || lower.includes('heromusic'))) continue;
    out.push(n);
  }
  const rank = (n) => {
    const l = n.toLowerCase();
    if (l.includes('soundlegend')) return 0;
    if (l.includes('heromusic')) return 1;
    if (l.includes('initial') && l.includes('audio')) return 2;
    return 3;
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function vosFromPreload(cab, parsed, ab, rec) {
  const vos = [];
  if (!rec || !ab.preload) return vos;
  const end = Math.min(ab.preload.length, rec.preloadIndex + rec.preloadSize);
  const byPath = parsed._byPath || (parsed._byPath = new Map(parsed.objects.map((o) => [o.pathId, o])));
  for (let i = rec.preloadIndex; i < end; i++) {
    const p = ab.preload[i];
    if (!p) continue;
    const obj = byPath.get(p.pathId);
    if (!obj) continue;
    if (obj.absStart < 0 || obj.absStart + obj.byteSize > cab.length) continue;
    const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
    let go = null;
    if (obj.classId === 1) {
      try { go = parseGameObject(body); } catch { go = null; }
    }
    const printable = extractPrintable(body).replace(/\0/g, '');
    const wavGuid = [...printable.matchAll(/([A-Za-z0-9_]+)\.wav:([0-9a-f]{32})/g)].map((m) => ({ name: m[1], guid: m[2] }));
    vos.push({
      classId: obj.classId,
      typeName: CLASS_NAME[obj.classId] || ('classId_' + obj.classId),
      pathId: p.pathId,
      byteSize: obj.byteSize,
      gameObjectName: go?.name || null,
      componentPathIds: go?.comps?.map((c) => c.pathId) || null,
      voiceKeys: extractVoKeys(body),
      wavGuids: wavGuid,
      printableSample: printable.slice(0, 1200),
    });
  }
  return vos;
}

function pickKnownParams(tree) {
  if (!tree || typeof tree !== 'object' || tree.error) {
    return { found: false, note: '未发现该参数', keys: [], values: {}, missing: [] };
  }
  const keys = Object.keys(tree);
  const lower = Object.fromEntries(keys.map((k) => [k.toLowerCase(), k]));
  const get = (...names) => {
    for (const n of names) {
      if (n in tree) return { present: true, value: tree[n] };
      const k = lower[n.toLowerCase()];
      if (k) return { present: true, value: tree[k] };
    }
    return { present: false, value: null };
  };
  const delay = get('m_DelaySec', 'delay', 'm_Delay', 'm_StartDelaySec');
  if (!delay.present && tree.m_CardSoundData && typeof tree.m_CardSoundData === 'object' && tree.m_CardSoundData.m_DelaySec !== undefined) {
    delay.present = true;
    delay.value = tree.m_CardSoundData.m_DelaySec;
  }
  const wanted = {
    m_Volume: get('m_Volume', 'volume'),
    m_Pitch: get('m_Pitch', 'pitch'),
    m_Loop: get('m_Loop', 'Loop', 'loop'),
    m_PlayOnAwake: get('m_PlayOnAwake', 'playOnAwake'),
    m_OutputAudioMixerGroup: get('m_OutputAudioMixerGroup', 'OutputAudioMixerGroup'),
    m_Priority: get('m_Priority', 'Priority', 'priority'),
    m_DopplerLevel: get('m_DopplerLevel', 'DopplerLevel'),
    m_SpatialBlend: get('m_SpatialBlend'),
    m_MinDistance: get('m_MinDistance', 'MinDistance'),
    m_MaxDistance: get('m_MaxDistance', 'MaxDistance'),
    m_DelaySec: delay,
    duration: get('duration', 'm_Duration'),
    fade: get('fade', 'm_Fade', 'm_CrossFadeSec'),
    trigger: get('trigger', 'm_Trigger'),
    timing: get('timing', 'm_Timing'),
  };
  const values = {};
  const missing = [];
  for (const [k, rec] of Object.entries(wanted)) {
    if (rec.present) values[k] = rec.value;
    else {
      values[k] = null;
      missing.push(k);
    }
  }
  return {
    found: missing.length !== Object.keys(wanted).length,
    keys,
    values,
    missing,
    note: missing.length ? ('未发现该参数: ' + missing.join(', ')) : 'listed fields present',
  };
}

function musicRelatedFields(tree) {
  if (!tree || typeof tree !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(tree)) {
    if (/music|stinger|playeffect|attackeffect|deatheffect|soundspell|audio|clip|delay|volume|loop/i.test(k)) {
      out[k] = v;
    }
  }
  return out;
}

function dumpSerializedObjects(cab, parsed, pathIds) {
  const wanted = new Set(pathIds.map((id) => String(id)));
  const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
  const dumped = [];
  for (const pid of wanted) {
    const obj = byPath.get(pid);
    if (!obj) continue;
    const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
    const nodes = parsed.types[obj.typeId]?.nodes || null;
    let go = null;
    if (obj.classId === 1) {
      try { go = parseGameObject(body); } catch { go = null; }
    }
    const tree = nodes ? readObjectTypeTree(body, nodes) : { error: 'no type tree for classId ' + obj.classId };
    dumped.push({
      type: obj.classId,
      typeName: CLASS_NAME[obj.classId] || ('classId_' + obj.classId),
      name: go?.name || tree?.m_Name || '',
      pathId: pid,
      classId: obj.classId,
      typeTreeKeys: tree && typeof tree === 'object' ? Object.keys(tree) : [],
      musicRelated: musicRelatedFields(tree),
      playbackParams: pickKnownParams(tree),
      typeTree: tree,
    });
  }
  return { dumped };
}

async function extractClipNamed(clipName, candidateFiles) {
  const extractor = new HearthstoneAudioExtractor({
    hsWin: HS_WIN,
    cacheDir: OUT_DIR,
    getVoiceAsset: () => ({ indexed: true, zhcnBundles: [], prefabBundles: [] }),
  });
  let lastErr = null;
  for (const name of candidateFiles) {
    const bundlePath = path.join(HS_WIN, name);
    if (!fs.existsSync(bundlePath)) continue;
    try {
      const bundle = await loadAssetBundle(fs.readFileSync(bundlePath));
      const obj = bundle.objects.find(
        (o) => o.type === AssetType.AudioClip && (
          o.name === clipName
          || o.name === clipName + '.wav'
          || (o.name && o.name.replace(/\.wav$/i, '') === clipName)
        ),
      );
      if (!obj) continue;
      const clip = await extractor.findClip(bundlePath, clipName);
      if (!clip) continue;
      let tree = null;
      try { tree = obj.getTypeTree(); } catch (e) { tree = { error: e.message }; }
      const magic = sniff(clip.data);
      const fsbPath = path.join(OUT_DIR, CARD_ID + '_MusicStinger.fsb');
      if (magic === 'FSB5' || magic === 'FSB4') fs.writeFileSync(fsbPath, Buffer.from(clip.data));
      else fs.writeFileSync(path.join(OUT_DIR, CARD_ID + '_MusicStinger.' + magic), Buffer.from(clip.data));
      const resource = tree && tree.m_Resource ? {
        m_Source: tree.m_Resource.m_Source || null,
        m_Offset: tree.m_Resource.m_Offset != null ? String(tree.m_Resource.m_Offset) : null,
        m_Size: tree.m_Resource.m_Size != null ? Number(tree.m_Resource.m_Size) : null,
      } : null;
      const meta = {
        name: obj.name,
        pathId: obj.pathId?.toString?.() || null,
        container: obj.container || null,
        typeTreeKeys: tree && typeof tree === 'object' ? Object.keys(tree) : [],
        m_Name: tree?.m_Name ?? obj.name,
        m_Frequency: tree?.m_Frequency ?? obj.meta?.frequency ?? null,
        m_Channels: tree?.m_Channels ?? obj.meta?.channels ?? clip.channels,
        m_Length: tree?.m_Length ?? obj.meta?.length ?? null,
        m_BitsPerSample: tree?.m_BitsPerSample ?? obj.meta?.bitsPerSample ?? null,
        m_CompressionFormat: tree?.m_CompressionFormat ?? obj.meta?.compressionFormat ?? null,
        m_Resource: resource,
        magic,
        size: clip.size,
      };
      if (magic !== 'FSB5' && magic !== 'FSB4') {
        return { clip, magic, wavPath: null, fsbPath: magic.startsWith('FSB') ? fsbPath : null, bundle: name, meta, tree };
      }
      const converted = await convertFsb(
        { data: clip.data, size: clip.size, channels: clip.channels },
        FsbConvertFormat.WAV,
      );
      const wav = wavToPcm16(Buffer.from(converted));
      const wavPath = path.join(OUT_DIR, CARD_ID + '_MusicStinger.wav');
      fs.writeFileSync(wavPath, wav);
      return {
        clip,
        magic,
        wavPath,
        fsbPath,
        bundle: name,
        wav: inspectWav(wav),
        durationSec: durationSecFromWav(wav),
        meta,
        tree,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  return { clip: null, magic: null, error: lastErr ? lastErr.message : 'clip not found in related bundles' };
}

function statSnapshot(filePath) {
  try {
    const st = fs.statSync(filePath);
    return { path: filePath, mtimeMs: st.mtimeMs, size: st.size };
  } catch (e) {
    return { path: filePath, error: e.message };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(VERIFY_DIR, { recursive: true });

  const carddefFile = 'carddef_base_global-775a814d-prefab-0.unity3d';
  const hsProbe = path.join(HS_WIN, carddefFile);
  const hsBefore = statSnapshot(hsProbe);

  const unpackedDef = unpackUnityFS(path.join(HS_WIN, carddefFile));
  const cabDef = unpackedDef.files[0].data;
  const parsedDef = parseSerializedFile(cabDef, { typeTrees: true });
  const byPathDef = new Map(parsedDef.objects.map((o) => [o.pathId, o]));
  let cardDefSounds = null;
  let cardDefGo = null;
  let cardDefGoPathId = null;
  let cardDefMbPathIds = [];
  for (const o of parsedDef.objects) {
    if (o.classId !== 1) continue;
    const go = parseGameObject(cabDef.subarray(o.absStart, o.absStart + o.byteSize));
    if (go.name !== CARD_ID) continue;
    cardDefGo = go;
    cardDefGoPathId = o.pathId;
    const bodies = [];
    for (const c of go.comps) {
      const obj = byPathDef.get(c.pathId);
      if (!obj || obj.classId !== 114) continue;
      cardDefMbPathIds.push(c.pathId);
      bodies.push(cabDef.subarray(obj.absStart, obj.absStart + obj.byteSize));
    }
    cardDefSounds = extractSoundsFromComponents(bodies);
  }
  if (cardDefSounds && !cardDefSounds.musicStinger) {
    cardDefSounds.musicStinger = (cardDefSounds.allPrefabs || []).find((p) => /stinger/i.test(p.name)) || null;
  }

  const abDefObj = parsedDef.objects.find((o) => o.classId === 142);
  let cardDefContainer = null;
  if (abDefObj) {
    const abDef = parseAssetBundleContainer(cabDef.subarray(abDefObj.absStart, abDefObj.absStart + abDefObj.byteSize));
    cardDefContainer = (abDef.container || []).find((c) => c.pathId === cardDefGoPathId)
      || (abDef.container || []).find((c) => c.key === CARD_ID)
      || null;
  }

  const guidIndex = require(path.join(ROOT, 'data', 'index', 'cache', 'guid-voice-index.json')).guidIndex;
  const guidHit = guidIndex[GUID] || null;
  const prefabBundle = guidHit?.file || 'initial_base_global-775a814d-prefab-1.unity3d';
  const prefabPath = path.join(HS_WIN, prefabBundle);

  const unpackedPrefab = unpackUnityFS(prefabPath);
  const cab = unpackedPrefab.files[0].data;
  const parsed = parseSerializedFile(cab, { typeTrees: true });
  const abObj = parsed.objects.find((o) => o.classId === 142);
  const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
  const rec = (ab.container || []).find((c) => c.key === GUID);
  const preloadDump = rec ? vosFromPreload(cab, parsed, ab, rec) : [];
  const preloadPathIds = preloadDump.map((p) => p.pathId);
  if (rec?.pathId) preloadPathIds.push(rec.pathId);
  for (const p of preloadDump) {
    if (p.componentPathIds) preloadPathIds.push(...p.componentPathIds);
  }

  let unityDump = dumpSerializedObjects(cab, parsed, preloadPathIds);
  unityDump.file = path.basename(prefabPath);
  let cardDefTypeTree = dumpSerializedObjects(cabDef, parsedDef, cardDefMbPathIds).dumped.map((o) => ({
    type: o.type,
    name: o.name,
    pathId: o.pathId,
    musicRelated: o.musicRelated,
    typeTreeKeys: o.typeTreeKeys,
    playbackParams: o.playbackParams,
  }));

  let audioSourceFields = { found: false, note: '未发现该参数', missing: ['m_Volume', 'm_Pitch', 'm_Loop', 'm_PlayOnAwake', 'm_OutputAudioMixerGroup', 'm_Priority', 'm_DopplerLevel', 'm_SpatialBlend', 'm_MinDistance', 'm_MaxDistance'] };
  let musicStingerFields = { found: false, note: '未发现该参数', missing: ['delay', 'duration', 'fade', 'volume', 'loop', 'priority', 'trigger', 'timing'] };
  let soundDefFields = null;
  if (unityDump && unityDump.dumped) {
    for (const o of unityDump.dumped) {
      if (o.classId === 82 && o.playbackParams) audioSourceFields = o.playbackParams;
      if (o.classId === 114 && o.typeTree && o.typeTree.m_MusicStingerData !== undefined) {
        musicStingerFields = o.playbackParams;
        musicStingerFields.m_CardSoundData = o.typeTree.m_CardSoundData ?? null;
        musicStingerFields.m_MusicStingerData = o.typeTree.m_MusicStingerData ?? null;
        musicStingerFields.typeTreeKeys = o.typeTreeKeys;
      }
      if (o.classId === 114 && o.typeTree && o.typeTree.m_AudioClip) {
        soundDefFields = {
          m_AudioClip: o.typeTree.m_AudioClip,
          m_RandomPitchMin: o.typeTree.m_RandomPitchMin ?? null,
          m_RandomPitchMax: o.typeTree.m_RandomPitchMax ?? null,
          m_RandomVolumeMin: o.typeTree.m_RandomVolumeMin ?? null,
          m_RandomVolumeMax: o.typeTree.m_RandomVolumeMax ?? null,
          m_IgnoreDucking: o.typeTree.m_IgnoreDucking ?? null,
          typeTreeKeys: o.typeTreeKeys,
        };
      }
    }
  }

  const clipName = (guidHit?.voiceKeys || []).find((k) => /stinger|leeroy|music/i.test(k))
    || preloadDump.flatMap((p) => p.wavGuids || []).find((w) => /stinger|leeroy/i.test(w.name))?.name
    || (guidHit?.voiceKeys || [])[0]
    || null;
  const clipGuidFromPrefab = preloadDump.flatMap((p) => p.wavGuids || []).find((w) => w.name === clipName)?.guid || null;

  const hashes = ['775a814d', '6c782fd0'];
  const audioCandidates = relatedAudioBundles(hashes);
  const extracted = clipName ? await extractClipNamed(clipName, audioCandidates) : { error: 'no clip name' };

  const voiceIndex = require(path.join(ROOT, 'data', 'index', 'card-voice-index.json'));
  const card = voiceIndex.cards[CARD_ID];
  const playKey = card.voice.play.voiceKey;
  const playWavPath = path.join(ROOT, 'tmp', 'audio', playKey + '.wav');
  let playWavReady = fs.existsSync(playWavPath);
  if (!playWavReady) {
    const audioIndex = require(path.join(ROOT, 'data', 'index', 'audio-index.json'));
    const ex = new HearthstoneAudioExtractor({
      cacheDir: path.join(ROOT, 'tmp', 'audio'),
      getVoiceAsset: (k) => {
        const c = audioIndex.clips[k];
        return c ? { indexed: true, ...c } : { indexed: false };
      },
    });
    await ex.extractVoice(playKey);
    playWavReady = fs.existsSync(playWavPath);
  }

  const previews = [];
  let mixError = null;
  if (extracted.wavPath && playWavReady) {
    const music = fs.readFileSync(extracted.wavPath);
    const voice = fs.readFileSync(playWavPath);
    try {
      for (const delay of [0, 100, 200, 300]) {
        const mixed = mixPcm16(music, voice, delay);
        const out = path.join(OUT_DIR, delay === 0 ? 'EX1_116_entrance_preview.wav' : 'EX1_116_entrance_preview_d' + delay + '.wav');
        fs.writeFileSync(out, mixed.wav);
        previews.push({
          delayMs: delay,
          path: out,
          durationSec: mixed.durationSec,
          sampleRate: mixed.sampleRate,
          channels: mixed.channels,
          bytes: mixed.wav.length,
          resampled: mixed.resampled,
          sourceRates: mixed.sourceRates,
          note: 'verification preview only; originals unchanged',
        });
      }
    } catch (e) {
      mixError = e.message;
    }
  }

  const hsAfter = statSnapshot(hsProbe);
  const wavBuf = extracted.wavPath && fs.existsSync(extracted.wavPath) ? fs.readFileSync(extracted.wavPath) : null;
  const wavInfo = wavBuf ? inspectWav(wavBuf) : null;
  const durationSec = wavBuf ? durationSecFromWav(wavBuf) : null;

  const results = {
    phase: '0.10',
    cardId: CARD_ID,
    cardName: card.name,
    success: !!(extracted.wavPath && playWavReady && previews.length),
    hearthstoneModified: hsBefore.mtimeMs !== hsAfter.mtimeMs || hsBefore.size !== hsAfter.size,
    hearthstoneReadOnlyProbe: { before: hsBefore, after: hsAfter },
    batchExport: false,
    cardDef: {
      bundle: carddefFile,
      guid: cardDefContainer?.key || null,
      goName: cardDefGo?.name || null,
      play: cardDefSounds?.play || null,
      attack: cardDefSounds?.attack || null,
      death: cardDefSounds?.death || null,
      customSummon: cardDefSounds?.customSummon || null,
      musicStinger: (cardDefSounds?.allPrefabs || []).find((p) => p.guid === GUID) || { name: 'MusicStinger', guid: GUID },
      m_MusicStinger: null,
      m_MusicStingerPath: null,
      m_MusicStingerDef: null,
      playEffectSoundSpellPaths: Array.isArray(cardDefTypeTree)
        ? (cardDefTypeTree.find((o) => o.musicRelated && o.musicRelated.m_PlayEffectDef)?.musicRelated?.m_PlayEffectDef?.m_SoundSpellPaths || null)
        : null,
      allPrefabs: cardDefSounds?.allPrefabs || [],
      typeTreeMusicFields: cardDefTypeTree,
    },
    musicStinger: {
      prefab: 'MusicStinger.prefab',
      guid: GUID,
      bundle: prefabBundle,
      bundleHash: '775a814d',
      pathId: guidHit?.pathId || rec?.pathId || null,
      preloadIndex: guidHit?.preloadIndex ?? rec?.preloadIndex ?? null,
      preloadSize: guidHit?.preloadSize ?? rec?.preloadSize ?? null,
      containerKey: rec?.key || null,
      voiceKeysFromPreload: guidHit?.voiceKeys || [],
      gameObjectTypes: preloadDump.map((p) => ({ typeName: p.typeName, classId: p.classId, pathId: p.pathId, gameObjectName: p.gameObjectName })),
    },
    prefabPreload: preloadDump,
    unityDumpSummary: unityDump && unityDump.error ? { error: unityDump.error } : {
      file: unityDump?.file,
      wrappedObjectCount: unityDump?.wrappedObjectCount,
      nodePaths: unityDump?.nodePaths,
      dumped: (unityDump?.dumped || []).map((o) => ({
        type: o.type,
        typeName: o.typeName,
        name: o.name,
        pathId: o.pathId,
        classId: o.classId,
        typeTreeKeys: o.typeTreeKeys,
        musicRelated: o.musicRelated,
        playbackParams: o.playbackParams,
      })),
    },
    playbackParams: {
      audioSource: audioSourceFields,
      musicStingerSpell: musicStingerFields,
      soundDef: soundDefFields,
    },
    audioClip: {
      name: clipName,
      guid: clipGuidFromPrefab,
      fileID: extracted.meta?.pathId || extracted.clip?.pathId || null,
      bundle: extracted.bundle || null,
      container: extracted.meta?.container || null,
      relatedBundlesTried: audioCandidates,
      format: extracted.magic || null,
      compression: extracted.meta?.m_CompressionFormat === 1 ? 'Vorbis' : extracted.meta?.m_CompressionFormat ?? null,
      frequency: extracted.meta?.m_Frequency ?? null,
      channels: extracted.meta?.m_Channels ?? null,
      samplesOrLength: extracted.meta?.m_Length ?? null,
      resource: extracted.meta?.m_Resource || (extracted.clip ? { size: extracted.clip.size, channels: extracted.clip.channels } : null),
    },
    conversion: {
      result: extracted.wavPath ? 'ok' : (extracted.error || 'failed'),
      fsbPath: extracted.fsbPath || null,
      wavPath: extracted.wavPath || null,
      sampleRate: wavInfo?.sampleRate || null,
      channels: wavInfo?.channels || null,
      bitsPerSample: wavInfo?.bitsPerSample || null,
      audioFormat: wavInfo?.audioFormat || null,
      bytes: wavInfo?.bytes || null,
      durationSec,
    },
    playVoice: {
      voiceKey: playKey,
      wavPath: playWavReady ? playWavPath : null,
    },
    combinedPreview: previews,
    mixError,
  };

  fs.writeFileSync(path.join(VERIFY_DIR, 'phase-0.10-results.json'), JSON.stringify(jsonSafe(results), null, 2));
  fs.writeFileSync(path.join(VERIFY_DIR, 'music-sample-index.json'), JSON.stringify({
    cardId: CARD_ID,
    cardName: card.name,
    musicStinger: {
      prefab: 'MusicStinger.prefab',
      guid: GUID,
      bundle: prefabBundle,
      audioClip: clipName,
      resource: extracted.meta?.m_Resource?.m_Source || extracted.bundle || null,
      format: extracted.magic || null,
      duration: durationSec,
    },
  }, null, 2));
  fs.writeFileSync(path.join(VERIFY_DIR, 'phase-0.10-unity-dump.json'), JSON.stringify(jsonSafe(unityDump), null, 2));
  console.log(JSON.stringify({
    success: results.success,
    clipName,
    clipGuid: clipGuidFromPrefab,
    bundle: extracted.bundle,
    magic: extracted.magic,
    wav: extracted.wavPath,
    duration: durationSec,
    sampleRate: wavInfo?.sampleRate,
    channels: wavInfo?.channels,
    bits: wavInfo?.bitsPerSample,
    previews: previews.map((p) => p.path),
    mixError,
    musicStingerFromCardDef: (cardDefSounds?.allPrefabs || []).find((p) => /stinger/i.test(p.name)),
    audioSourceNote: audioSourceFields.note,
    musicStingerNote: musicStingerFields.note,
    hearthstoneModified: results.hearthstoneModified,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
