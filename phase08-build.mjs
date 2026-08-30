import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { unpackUnityFS } from './unpack-search.mjs';
import {
  parseSerializedFile,
  parseAssetBundleContainer,
  parseGameObject,
  extractVoKeys,
} from './unity-serialized.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { extractSoundsFromComponents } = require('./src/extractCardDefSounds.js');
const { classifySlot, pickVoiceKey } = require('./src/rules/voiceMappingRules.js');

const ROOT = process.cwd();
const HS_ROOT = 'C:\\Hearthstone';
const HS_WIN = path.join(HS_ROOT, 'Data', 'Win');
const OUT_INDEX = path.join(ROOT, 'data', 'index');
const OUT_CACHE = path.join(OUT_INDEX, 'cache');
const OUT_VERIFY = path.join(ROOT, 'data', 'voice-verification');
const CARDS_PATH = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
const EXTRACTOR_VERSION = '0.8';
const MAX_CONSECUTIVE_PARSE_FAIL = 25;
const SAMPLE_SEED = 20260828;
const SAMPLE_SIZE = 30;

function now() {
  return Date.now();
}

function listBundles(pred) {
  return fs.readdirSync(HS_WIN)
    .filter((n) => n.endsWith('.unity3d') && pred(n))
    .map((n) => path.join(HS_WIN, n));
}

function unpackSafe(filePath) {
  try {
    return unpackUnityFS(filePath);
  } catch (e) {
    return { error: e.message, files: [] };
  }
}

function concatFileData(unpacked) {
  return Buffer.concat(unpacked.files.map((f) => f.data));
}

function extractPrintableChunk(buf) {
  const parts = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 4) parts.push(Buffer.from(cur).toString('latin1'));
    cur = [];
  };
  for (const byte of buf) {
    if (byte >= 32 && byte <= 126) cur.push(byte);
    else flush();
  }
  flush();
  return parts.join('\n');
}

function readGameBuild() {
  const out = {
    game: 'Hearthstone',
    locale: 'zhCN',
    productVersion: null,
    build: null,
    unityPlayer: null,
    buildGuid: null,
    source: [],
  };
  const productDb = path.join(HS_ROOT, '.product.db');
  if (fs.existsSync(productDb)) {
    const text = fs.readFileSync(productDb).toString('latin1');
    const m = text.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (m) {
      out.productVersion = m[1];
      out.build = m[1].split('.').pop();
      out.source.push('.product.db');
    }
  }
  const boot = path.join(HS_ROOT, 'Hearthstone_Data', 'boot.config');
  if (fs.existsSync(boot)) {
    const t = fs.readFileSync(boot, 'utf8');
    const g = t.match(/build-guid=(.+)/);
    if (g) {
      out.buildGuid = g[1].trim();
      out.source.push('boot.config');
    }
  }
  const exe = path.join(HS_ROOT, 'Hearthstone.exe');
  if (fs.existsSync(exe)) {
    try {
      const { execFileSync } = require('child_process');
      const ps = execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        `(Get-Item '${exe}').VersionInfo.ProductVersion`,
      ], { encoding: 'utf8' }).trim();
      if (ps) {
        out.unityPlayer = ps;
        out.source.push('Hearthstone.exe');
      }
    } catch {
      // ignore
    }
  }
  if (!out.build) out.build = out.productVersion || out.buildGuid || 'unknown';
  return out;
}

function loadCards() {
  const raw = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
  const byId = new Map();
  const duplicates = [];
  for (const c of raw) {
    if (!c || !c.id) continue;
    if (byId.has(c.id)) duplicates.push(c.id);
    else {
      byId.set(c.id, {
        cardId: c.id,
        name: c.name || c.id,
        type: c.type || 'UNKNOWN',
        collectible: c.collectible === true,
        set: c.set || null,
        dbfId: c.dbfId ?? null,
      });
    }
  }
  return { byId, duplicates, totalRaw: raw.length };
}

function isPrefabSoundBundle(n) {
  if (!n.endsWith('.unity3d')) return false;
  if (n.includes('audio')) return false;
  if (n.startsWith('carddef_') || n.startsWith('cardasset_') || n.startsWith('cardtexture_')) return false;
  if (n.includes('texture') || n.includes('material') || n.includes('mesh')) return false;
  return n.includes('prefab') || n.startsWith('playsound_') || n.startsWith('sound') || n.startsWith('essential_');
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
    for (const key of extractVoKeys(body)) vos.push(key);
  }
  return [...new Set(vos)];
}

function buildCardDefIndex() {
  const files = listBundles((n) => n.startsWith('carddef_'));
  console.log('[0.8] scan carddef bundles', files.length);
  const byCard = {};
  let n = 0;
  let parseErrors = 0;
  let consecutive = 0;
  let parsedOk = 0;
  const t0 = now();
  for (const f of files) {
    n++;
    if (n % 40 === 0) console.log('  carddef', n, '/', files.length, 'cards', Object.keys(byCard).length);
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) {
      parseErrors++;
      consecutive++;
      if (consecutive >= MAX_CONSECUTIVE_PARSE_FAIL) {
        throw new Error('abort: ' + consecutive + ' consecutive CardDef unpack failures at ' + path.basename(f));
      }
      continue;
    }
    const cab = unpacked.files[0].data;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch {
      parseErrors++;
      consecutive++;
      if (consecutive >= MAX_CONSECUTIVE_PARSE_FAIL) {
        throw new Error('abort: ' + consecutive + ' consecutive CardDef parse failures at ' + path.basename(f));
      }
      continue;
    }
    consecutive = 0;
    parsedOk++;
    const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
    for (const o of parsed.objects) {
      if (o.classId !== 1) continue;
      const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
      if (!go.name) continue;
      const bodies = [];
      for (const c of go.comps) {
        const obj = byPath.get(c.pathId);
        if (!obj || obj.classId !== 114) continue;
        bodies.push(cab.subarray(obj.absStart, obj.absStart + obj.byteSize));
      }
      if (!bodies.length) continue;
      const sounds = extractSoundsFromComponents(bodies);
      const prev = byCard[go.name];
      if (!prev) {
        byCard[go.name] = {
          files: [path.basename(f)],
          play: sounds.play,
          attack: sounds.attack,
          death: sounds.death,
          customSummon: sounds.customSummon,
          musicStinger: sounds.musicStinger,
          extraPrefabCount: sounds.allPrefabs.length,
        };
      } else {
        if (!prev.files.includes(path.basename(f))) prev.files.push(path.basename(f));
        prev.play = prev.play || sounds.play;
        prev.attack = prev.attack || sounds.attack;
        prev.death = prev.death || sounds.death;
        prev.customSummon = prev.customSummon || sounds.customSummon;
        prev.musicStinger = prev.musicStinger || sounds.musicStinger;
        prev.extraPrefabCount += sounds.allPrefabs.length;
      }
    }
  }
  return {
    byCard,
    stats: {
      files: files.length,
      parsedOk,
      parseErrors,
      cardDefCount: Object.keys(byCard).length,
      ms: now() - t0,
    },
  };
}

function buildGuidVoiceIndex() {
  const files = listBundles(isPrefabSoundBundle);
  console.log('[0.8] scan prefab/sound bundles', files.length);
  const guidIndex = {};
  let n = 0;
  let parsedCount = 0;
  let parseErrors = 0;
  let consecutive = 0;
  const t0 = now();
  for (const f of files) {
    n++;
    if (n % 150 === 0) {
      console.log('  prefab', n, '/', files.length, 'parsed', parsedCount, 'guids', Object.keys(guidIndex).length);
    }
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) {
      parseErrors++;
      consecutive++;
      if (consecutive >= 40) throw new Error('abort: consecutive prefab unpack failures at ' + path.basename(f));
      continue;
    }
    const cab = unpacked.files[0].data;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch {
      parseErrors++;
      consecutive++;
      if (consecutive >= 40) throw new Error('abort: consecutive prefab parse failures at ' + path.basename(f));
      continue;
    }
    consecutive = 0;
    parsedCount++;
    const abObj = parsed.objects.find((o) => o.classId === 142);
    if (!abObj) continue;
    const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
    if (!ab.container) continue;
    const base = path.basename(f);
    for (const rec of ab.container) {
      if (!rec.key || !/^[0-9a-f]{32}$/.test(rec.key)) continue;
      const voiceKeys = vosFromPreload(cab, parsed, ab, rec);
      if (!guidIndex[rec.key] || voiceKeys.length > (guidIndex[rec.key].voiceKeys || []).length) {
        guidIndex[rec.key] = {
          file: base,
          pathId: rec.pathId,
          preloadIndex: rec.preloadIndex,
          preloadSize: rec.preloadSize,
          voiceKeys,
        };
      }
    }
  }
  return {
    guidIndex,
    stats: {
      scannedFiles: files.length,
      parsedCount,
      parseErrors,
      guidHits: Object.keys(guidIndex).length,
      ms: now() - t0,
    },
  };
}

function buildAudioClipIndex(guidIndex, priorAudioIndex) {
  const clips = {};
  const add = (key, field, value) => {
    if (!key) return;
    if (!clips[key]) clips[key] = { zhcnBundles: [], prefabBundles: [] };
    const arr = clips[key][field];
    if (value && arr.length < 6 && !arr.includes(value)) arr.push(value);
  };
  for (const rec of Object.values(guidIndex)) {
    for (const k of rec.voiceKeys || []) add(k, 'prefabBundles', rec.file);
  }
  if (priorAudioIndex?.zhcnAudioClips) {
    for (const [k, bundles] of Object.entries(priorAudioIndex.zhcnAudioClips)) {
      for (const b of bundles || []) add(k, 'zhcnBundles', b);
    }
  }
  if (priorAudioIndex?.guidToVoice) {
    for (const rec of Object.values(priorAudioIndex.guidToVoice)) {
      for (const k of rec.voiceKeys || []) add(k, 'prefabBundles', rec.file);
    }
  }

  const files = listBundles((n) => n.includes('zhcn') && n.includes('audio'));
  console.log('[0.8] scan zhcn audio bundles once', files.length);
  const t0 = now();
  let n = 0;
  let unpackErrors = 0;
  for (const f of files) {
    n++;
    if (n % 80 === 0) console.log('  zhcn audio', n, '/', files.length, 'clips', Object.keys(clips).length);
    const unpacked = unpackSafe(f);
    if (unpacked.error) {
      unpackErrors++;
      continue;
    }
    const buf = concatFileData(unpacked);
    const keys = extractVoKeys(buf);
    const base = path.basename(f);
    for (const k of keys) add(k, 'zhcnBundles', base);
  }
  return {
    clips,
    stats: {
      zhcnFiles: files.length,
      unpackErrors,
      clipCount: Object.keys(clips).length,
      reusedPriorIndex: !!(priorAudioIndex && priorAudioIndex.guidToVoice),
      ms: now() - t0,
    },
  };
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function slotEvidence(slot, guid, hit, audioClipIndex) {
  const key = slot.voiceKey;
  const clipMeta = key && audioClipIndex.clips[key];
  return {
    playPrefabGuid: slot.slotName === 'play' ? guid : undefined,
    attackPrefabGuid: slot.slotName === 'attack' ? guid : undefined,
    deathPrefabGuid: slot.slotName === 'death' ? guid : undefined,
    prefabGuid: guid || null,
    soundSpellGuid: guid || null,
    audioClipName: key || null,
    prefabBundle: hit?.file || null,
    audioBundle: (clipMeta?.zhcnBundles || [])[0] || (clipMeta?.prefabBundles || [])[0] || null,
    mappingMethod: slot.mappingType,
  };
}

function cleanEvidence(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildCardVoiceIndex({ cards, cardDefIndex, guidIndex, audioClipIndex, knownCardIds }) {
  const t0 = now();
  const guidOwners = new Map();
  const cardDefIds = new Set(Object.keys(cardDefIndex));
  for (const [id, def] of Object.entries(cardDefIndex)) {
    for (const slot of ['play', 'attack', 'death']) {
      const g = def[slot];
      if (!g) continue;
      if (!guidOwners.has(g)) guidOwners.set(g, new Set());
      guidOwners.get(g).add(id);
    }
  }

  const cardsOut = {};
  const unresolved = [];
  let processed = 0;
  let errorCount = 0;
  const slotStats = {
    play: { matched: 0, no_voice: 0, unresolved: 0, error: 0 },
    attack: { matched: 0, no_voice: 0, unresolved: 0, error: 0 },
    death: { matched: 0, no_voice: 0, unresolved: 0, error: 0 },
  };
  const mappingCounts = {};
  let sourceDiff = 0;

  for (const meta of cards.byId.values()) {
    processed++;
    const def = cardDefIndex[meta.cardId];
    const rec = {
      name: meta.name,
      type: meta.type,
      collectible: meta.collectible,
      set: meta.set,
      dbfId: meta.dbfId,
      voice: {},
    };
    let cardError = null;
    let cardSourceDiff = false;
    try {
      for (const slotName of ['play', 'attack', 'death']) {
        const guid = def?.[slotName] || null;
        const hit = guid ? guidIndex[guid] : null;
        const voiceKey = hit ? pickVoiceKey(meta.cardId, slotName, hit.voiceKeys || []) : null;
        const classified = classifySlot({
          cardId: meta.cardId,
          voiceKey: guid ? voiceKey : null,
          prefabGuid: guid,
          guidOwners,
          cardDefIds,
          knownCardIds,
        });
        if (guid && !hit) {
          classified.status = 'unresolved';
          classified.mappingType = 'unresolved';
          classified.voiceKey = null;
          classified.voiceSourceCardId = null;
          classified.reason = classified.reason || 'guid_not_in_prefab_container';
        } else if (guid && hit && !(hit.voiceKeys || []).length) {
          classified.status = 'unresolved';
          classified.mappingType = 'unresolved';
          classified.voiceKey = null;
          classified.voiceSourceCardId = null;
          classified.reason = 'soundspell_preload_has_no_vo';
        }
        const slot = {
          status: classified.status,
          mappingType: classified.mappingType,
        };
        if (classified.voiceKey) slot.voiceKey = classified.voiceKey;
        if (classified.voiceSourceCardId) slot.voiceSourceCardId = classified.voiceSourceCardId;
        if (classified.reason) slot.reason = classified.reason;
        slot.evidence = cleanEvidence(slotEvidence(
          { slotName, voiceKey: classified.voiceKey, mappingType: classified.mappingType },
          guid,
          hit,
          audioClipIndex,
        ));
        rec.voice[slotName] = slot;
        slotStats[slotName][classified.status] = (slotStats[slotName][classified.status] || 0) + 1;
        mappingCounts[classified.mappingType] = (mappingCounts[classified.mappingType] || 0) + 1;
        if (classified.status === 'matched' && classified.voiceSourceCardId && classified.voiceSourceCardId !== meta.cardId) {
          cardSourceDiff = true;
        }
        if (classified.status === 'unresolved') {
          unresolved.push({
            cardId: meta.cardId,
            cardName: meta.name,
            cardType: meta.type,
            slot: slotName,
            lastStep: classified.reason || 'unresolved',
            lastGuid: guid,
            lastPrefab: hit?.file || null,
            possibleReason: classified.reason || 'unresolved',
            collectible: meta.collectible,
          });
        }
      }
      if (def?.customSummon) rec.extra = { ...(rec.extra || {}), customSummon: def.customSummon };
      if (def?.musicStinger) rec.extra = { ...(rec.extra || {}), musicStinger: def.musicStinger };
      rec.hasCardDef = !!def;
      rec.evidence = {
        playPrefabGuid: def?.play || null,
        attackPrefabGuid: def?.attack || null,
        deathPrefabGuid: def?.death || null,
        cardDefFiles: def?.files || [],
      };
    } catch (e) {
      cardError = String(e && e.message ? e.message : e);
      errorCount++;
      rec.error = cardError;
      for (const slotName of ['play', 'attack', 'death']) {
        rec.voice[slotName] = {
          status: 'error',
          mappingType: 'unresolved',
          reason: cardError,
        };
        slotStats[slotName].error++;
        mappingCounts.unresolved = (mappingCounts.unresolved || 0) + 1;
      }
    }
    if (cardSourceDiff) sourceDiff++;
    cardsOut[meta.cardId] = rec;
    if (processed % 5000 === 0) console.log('  map cards', processed, '/', cards.byId.size);
  }

  return {
    cards: cardsOut,
    unresolved,
    stats: {
      processed,
      error: errorCount,
      slotStats,
      mappingCounts,
      voiceSourceDiffers: sourceDiff,
      ms: now() - t0,
    },
  };
}

function pickSample(cardsOut, rand) {
  const buckets = {
    direct: [],
    shared_resource: [],
    shared_audio: [],
    token_clip: [],
    named_sfx: [],
    no_voice: [],
    unresolved: [],
  };
  for (const [cardId, rec] of Object.entries(cardsOut)) {
    const types = ['play', 'attack', 'death'].map((s) => rec.voice[s]?.mappingType);
    let bucket = 'no_voice';
    if (types.includes('unresolved')) bucket = 'unresolved';
    else if (types.includes('shared_resource')) bucket = 'shared_resource';
    else if (types.includes('shared_audio')) bucket = 'shared_audio';
    else if (types.includes('token_clip')) bucket = 'token_clip';
    else if (types.includes('named_sfx')) bucket = 'named_sfx';
    else if (types.includes('direct')) bucket = 'direct';
    buckets[bucket].push(cardId);
  }
  const chosen = [];
  const want = {
    direct: 8,
    shared_resource: 6,
    shared_audio: 3,
    token_clip: 3,
    named_sfx: 3,
    no_voice: 5,
    unresolved: 2,
  };
  for (const [k, n] of Object.entries(want)) {
    const pool = shuffle(buckets[k], rand);
    for (const id of pool.slice(0, n)) chosen.push(id);
  }
  const seen = new Set(chosen);
  const rest = shuffle(Object.keys(cardsOut).filter((id) => !seen.has(id)), rand);
  while (chosen.length < SAMPLE_SIZE && rest.length) chosen.push(rest.pop());
  return chosen.slice(0, SAMPLE_SIZE).map((cardId) => ({
    cardId,
    ...cardsOut[cardId],
    sampleBucket: Object.entries(buckets).find(([, ids]) => ids.includes(cardId))?.[0] || null,
  }));
}

function typeCounts(cardsOut) {
  const t = {};
  let collectible = 0;
  let non = 0;
  for (const rec of Object.values(cardsOut)) {
    t[rec.type] = (t[rec.type] || 0) + 1;
    if (rec.collectible) collectible++;
    else non++;
  }
  return { byType: t, collectible, nonCollectible: non };
}

function writeReport({ build, cards, mapped, timings, cardDefStats, guidStats, audioStats, reusedAudioIndex }) {
  const types = typeCounts(mapped.cards);
  const ss = mapped.stats.slotStats;
  const md = [];
  md.push('# Phase 0.8 Full Card Voice Index');
  md.push('');
  md.push('未导出音频。未修改 `C:\\Hearthstone`。未开发网站 / API / 数据库。');
  md.push('');
  md.push('## 版本');
  md.push('');
  md.push(`- extractor: \`${EXTRACTOR_VERSION}\``);
  md.push(`- game: Hearthstone ${build.productVersion || build.build}`);
  md.push(`- build: \`${build.build}\` (from ${build.source.join(', ') || 'unknown'})`);
  md.push(`- locale: zhCN`);
  md.push('');
  md.push('## 卡牌数量');
  md.push('');
  md.push(`- 总卡牌: **${mapped.stats.processed}**`);
  md.push(`- collectible: **${types.collectible}**`);
  md.push(`- non-collectible: **${types.nonCollectible}**`);
  md.push('');
  md.push('| type | count |');
  md.push('|---|---:|');
  for (const [k, v] of Object.entries(types.byType).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${k} | ${v} |`);
  }
  md.push('');
  md.push('## Voice 槽位');
  md.push('');
  md.push('| slot | matched | no_voice | unresolved | error |');
  md.push('|---|---:|---:|---:|---:|');
  for (const slot of ['play', 'attack', 'death']) {
    const s = ss[slot];
    md.push(`| ${slot} | ${s.matched} | ${s.no_voice} | ${s.unresolved} | ${s.error} |`);
  }
  md.push('');
  md.push('## Mapping（三个槽合计）');
  md.push('');
  md.push('| mappingType | count |');
  md.push('|---|---:|');
  for (const [k, v] of Object.entries(mapped.stats.mappingCounts).sort((a, b) => b[1] - a[1])) {
    md.push(`| \`${k}\` | ${v} |`);
  }
  md.push('');
  md.push(`VoiceSourceCardID ≠ CardID 的卡牌数: **${mapped.stats.voiceSourceDiffers}**`);
  md.push('');
  md.push(`error 卡牌数: **${mapped.stats.error}**`);
  md.push('');
  md.push('## 性能');
  md.push('');
  md.push(`- 总耗时: **${(timings.totalMs / 1000).toFixed(1)}s**`);
  md.push(`- CardDef 解析: ${(cardDefStats.ms / 1000).toFixed(1)}s（${cardDefStats.files} bundles, ${cardDefStats.cardDefCount} GameObjects）`);
  md.push(`- GUID / SoundSpell 索引: ${(guidStats.ms / 1000).toFixed(1)}s（${guidStats.scannedFiles} bundles, ${guidStats.guidHits} GUIDs）`);
  md.push(`- AudioClip Index 查询/扫描: ${(audioStats.ms / 1000).toFixed(1)}s（${audioStats.zhcnFiles} zhcn audio bundles, ${audioStats.clipCount} clips）`);
  md.push(`- Voice Mapping: ${(mapped.stats.ms / 1000).toFixed(1)}s`);
  md.push('');
  md.push(`audio-index 复用: ${reusedAudioIndex ? '是（合并 Phase 0.6 sample index，并做一次全量 zhcn clip 名扫描，未按卡重复扫包）' : '否，本次新建'}。`);
  md.push('');
  md.push('## 缓存');
  md.push('');
  md.push('- `data/index/cache/carddef-sounds.json`');
  md.push('- `data/index/cache/guid-voice-index.json`');
  md.push('- `data/index/audio-index.json`');
  md.push('');
  return md.join('\n');
}

function main() {
  fs.mkdirSync(OUT_INDEX, { recursive: true });
  fs.mkdirSync(OUT_CACHE, { recursive: true });
  fs.mkdirSync(OUT_VERIFY, { recursive: true });
  const tAll = now();
  const build = readGameBuild();
  console.log('[0.8] build', JSON.stringify(build));

  const cards = loadCards();
  console.log('[0.8] cards.json', cards.byId.size, 'duplicates', cards.duplicates.length);

  const cardDef = buildCardDefIndex();
  fs.writeFileSync(path.join(OUT_CACHE, 'carddef-sounds.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    stats: cardDef.stats,
    byCard: cardDef.byCard,
  }));
  console.log('[0.8] carddef', cardDef.stats);

  const guid = buildGuidVoiceIndex();
  fs.writeFileSync(path.join(OUT_CACHE, 'guid-voice-index.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    stats: guid.stats,
    guidIndex: guid.guidIndex,
  }));
  console.log('[0.8] guid index', guid.stats);

  let prior = null;
  const priorPath = path.join(OUT_VERIFY, 'audio-index.json');
  if (fs.existsSync(priorPath)) {
    try { prior = JSON.parse(fs.readFileSync(priorPath, 'utf8')); } catch { prior = null; }
  }
  const audio = buildAudioClipIndex(guid.guidIndex, prior);
  fs.writeFileSync(path.join(OUT_INDEX, 'audio-index.json'), JSON.stringify({
    version: EXTRACTOR_VERSION,
    generatedAt: new Date().toISOString(),
    note: 'Metadata only. No FSB/WAV exported. Clip name → bundle lookup.',
    stats: audio.stats,
    clips: audio.clips,
  }));
  console.log('[0.8] audio index', audio.stats);

  const knownCardIds = new Set([...cards.byId.keys(), ...Object.keys(cardDef.byCard)]);
  const mapped = buildCardVoiceIndex({
    cards,
    cardDefIndex: cardDef.byCard,
    guidIndex: guid.guidIndex,
    audioClipIndex: audio,
    knownCardIds,
  });
  console.log('[0.8] mapped', mapped.stats.processed, 'unresolved slots', mapped.unresolved.length);

  const index = {
    version: EXTRACTOR_VERSION,
    source: {
      game: 'Hearthstone',
      build: build.build,
      productVersion: build.productVersion,
      locale: 'zhCN',
    },
    generatedAt: new Date().toISOString(),
    timings: {},
    cards: mapped.cards,
  };
  const totalMs = now() - tAll;
  index.timings = {
    totalMs,
    cardDefMs: cardDef.stats.ms,
    guidIndexMs: guid.stats.ms,
    audioIndexMs: audio.stats.ms,
    voiceMappingMs: mapped.stats.ms,
  };

  fs.writeFileSync(path.join(OUT_INDEX, 'card-voice-index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(OUT_INDEX, 'manifest.json'), JSON.stringify({
    game: 'Hearthstone',
    build: build.build,
    productVersion: build.productVersion,
    locale: 'zhCN',
    cardCount: mapped.stats.processed,
    generatedAt: index.generatedAt,
    extractorVersion: EXTRACTOR_VERSION,
    timings: index.timings,
    audioIndexReused: !!prior,
  }, null, 2));

  const report = writeReport({
    build,
    cards,
    mapped,
    timings: index.timings,
    cardDefStats: cardDef.stats,
    guidStats: guid.stats,
    audioStats: audio.stats,
    reusedAudioIndex: !!prior,
  });
  fs.writeFileSync(path.join(OUT_VERIFY, 'phase-0.8-report.md'), report);

  fs.writeFileSync(path.join(OUT_VERIFY, 'phase-0.8-unresolved.json'), JSON.stringify({
    generatedAt: index.generatedAt,
    count: mapped.unresolved.length,
    records: mapped.unresolved,
  }, null, 2));

  const rand = mulberry32(SAMPLE_SEED);
  const sample = pickSample(mapped.cards, rand);
  fs.writeFileSync(path.join(OUT_VERIFY, 'phase-0.8-sample.json'), JSON.stringify({
    generatedAt: index.generatedAt,
    seed: SAMPLE_SEED,
    size: sample.length,
    cards: sample,
  }, null, 2));

  fs.writeFileSync(path.join(OUT_CACHE, 'phase-0.8-stats.json'), JSON.stringify({
    build,
    cardDef: cardDef.stats,
    guid: guid.stats,
    audio: audio.stats,
    mapped: {
      processed: mapped.stats.processed,
      error: mapped.stats.error,
      slotStats: mapped.stats.slotStats,
      mappingCounts: mapped.stats.mappingCounts,
      voiceSourceDiffers: mapped.stats.voiceSourceDiffers,
      unresolved: mapped.unresolved.length,
      ms: mapped.stats.ms,
    },
    types: typeCounts(mapped.cards),
    timings: index.timings,
  }, null, 2));

  console.log('[0.8] wrote', OUT_INDEX);
  console.log('[0.8] total seconds', (totalMs / 1000).toFixed(1));
}

main();
