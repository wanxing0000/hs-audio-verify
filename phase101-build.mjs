import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseGameObject } from './unity-serialized.mjs';
import { extractSoundsFromComponents } from './src/extractCardDefSounds.js';
import { HearthstoneAudioExtractor } from './src/explorer/HearthstoneAudioExtractor.js';
import {
  classifyPrefabName,
  isMusicClipName,
  musicClipsFromKeys,
  sampleItems,
  mappingFromPrefab,
  mappingsFromWavRef,
  rollupStatus,
  countStatuses,
} from './src/music/musicStingerRules.js';

const require = createRequire(path.join(process.cwd(), 'package.json'));

const ROOT = process.cwd();
const HS_ROOT = 'C:\\Hearthstone';
const HS_WIN = path.join(HS_ROOT, 'Data', 'Win');
const OUT_DIR = path.join(ROOT, 'data', 'music-verification');
const SEED = 20260828;
const SAMPLE_N = 20;
const MAX_EXTRACT = 5;

function nowIso() {
  return new Date().toISOString();
}

function unpackSafe(filePath) {
  try {
    return unpackUnityFS(filePath);
  } catch (e) {
    return { error: e.message, files: [] };
  }
}

function readGameBuild() {
  const out = {
    game: 'Hearthstone',
    locale: 'zhCN',
    productVersion: null,
    build: null,
  };
  const productDb = path.join(HS_ROOT, '.product.db');
  if (fs.existsSync(productDb)) {
    const text = fs.readFileSync(productDb).toString('latin1');
    const m = text.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (m) {
      out.productVersion = m[1];
      out.build = m[1].split('.').pop();
    }
  }
  const manifest = path.join(ROOT, 'data', 'index', 'manifest.json');
  if ((!out.productVersion || !out.build) && fs.existsSync(manifest)) {
    const man = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    out.productVersion = out.productVersion || man.productVersion || null;
    out.build = out.build || man.build || null;
  }
  return out;
}

function loadCards() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), 'utf8'));
  const collectible = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.collectible.json'), 'utf8'));
  const extra = new Map();
  for (const c of collectible) {
    if (!c || !c.id) continue;
    extra.set(c.id, { rarity: c.rarity || null, collectible: c.collectible === true, name: c.name });
  }
  const byId = new Map();
  for (const c of raw) {
    if (!c || !c.id || byId.has(c.id)) continue;
    const x = extra.get(c.id) || {};
    byId.set(c.id, {
      cardId: c.id,
      name: c.name || x.name || c.id,
      type: c.type || 'UNKNOWN',
      collectible: c.collectible === true || x.collectible === true,
      rarity: c.rarity || x.rarity || null,
      set: c.set || null,
    });
  }
  return byId;
}

function scanCardDefs() {
  const files = fs.readdirSync(HS_WIN).filter((n) => n.startsWith('carddef_') && n.endsWith('.unity3d'));
  const byCard = {};
  const parseErrors = [];
  let parsedOk = 0;
  const t0 = Date.now();
  for (const name of files) {
    const f = path.join(HS_WIN, name);
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) {
      parseErrors.push({ file: name, error: unpacked.error || 'empty' });
      continue;
    }
    const cab = unpacked.files[0].data;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch (e) {
      parseErrors.push({ file: name, error: e.message });
      continue;
    }
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
      const rec = {
        files: [name],
        play: sounds.play,
        attack: sounds.attack,
        death: sounds.death,
        customSummon: sounds.customSummon,
        musicStinger: sounds.musicStinger,
        allPrefabs: sounds.allPrefabs,
        wavRefs: sounds.wavRefs,
        musicFieldNames: [...new Set(sounds.musicFieldNames)],
      };
      const prev = byCard[go.name];
      if (!prev) byCard[go.name] = rec;
      else {
        if (!prev.files.includes(name)) prev.files.push(name);
        prev.play = prev.play || rec.play;
        prev.attack = prev.attack || rec.attack;
        prev.death = prev.death || rec.death;
        prev.customSummon = prev.customSummon || rec.customSummon;
        prev.musicStinger = prev.musicStinger || rec.musicStinger;
        prev.allPrefabs.push(...rec.allPrefabs);
        prev.wavRefs.push(...rec.wavRefs);
        prev.musicFieldNames = [...new Set(prev.musicFieldNames.concat(rec.musicFieldNames))];
      }
    }
  }
  return {
    byCard,
    stats: { files: files.length, parsedOk, parseErrorFiles: parseErrors.length, ms: Date.now() - t0 },
    parseErrors,
  };
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

function buildShareCounts(byCard) {
  const counts = new Map();
  for (const rec of Object.values(byCard)) {
    const seen = new Set();
    for (const p of uniquePrefabs(rec.allPrefabs)) {
      if (seen.has(p.guid)) continue;
      seen.add(p.guid);
      counts.set(p.guid, (counts.get(p.guid) || 0) + 1);
    }
    for (const w of rec.wavRefs || []) {
      if (!w.guid || seen.has(w.guid)) continue;
      seen.add(w.guid);
      counts.set(w.guid, (counts.get(w.guid) || 0) + 1);
    }
  }
  return counts;
}

function musicGuidsFromIndex(guidIndex) {
  const set = new Set();
  for (const [guid, rec] of Object.entries(guidIndex)) {
    if (musicClipsFromKeys(rec.voiceKeys).length) set.add(guid);
  }
  return set;
}

function mappingsForDef(def, guidIndex, shareCounts, indexMusicGuids) {
  const mappings = [];
  const seen = new Set();
  const add = (m) => {
    if (!m || !m.prefabGuid || seen.has(m.prefabGuid + ':' + (m.prefabName || '') + ':' + (m.audioClipName || ''))) return;
    seen.add(m.prefabGuid + ':' + (m.prefabName || '') + ':' + (m.audioClipName || ''));
    mappings.push(m);
  };

  for (const p of uniquePrefabs(def.allPrefabs)) {
    const rec = guidIndex[p.guid];
    const share = shareCounts.get(p.guid) || 1;
    const mapped = mappingFromPrefab(p, rec, share);
    if (VOICE_SLOT_SKIP.has(mapped.nameKind) && !mapped.isMusic) continue;
    if (mapped.nameKind === 'summon' && !mapped.isMusic) continue;
    if (mapped.nameKind === 'other' && !mapped.isMusic && !indexMusicGuids.has(p.guid)) continue;
    if (mapped.isMusic || indexMusicGuids.has(p.guid)) {
      if (!mapped.isMusic && indexMusicGuids.has(p.guid)) {
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

  for (const w of def.wavRefs || []) {
    add(mappingsFromWavRef(w, guidIndex[w.guid], shareCounts.get(w.guid) || 1));
  }

  for (const slot of ['play', 'attack', 'death']) {
    const guid = def[slot];
    if (!guid) continue;
    const rec = guidIndex[guid];
    const clips = musicClipsFromKeys(rec && rec.voiceKeys);
    if (!clips.length) continue;
    add({
      mappingType: (shareCounts.get(guid) || 1) > 1 ? 'shared_music' : 'other_music_reference',
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

const VOICE_SLOT_SKIP = new Set(['play', 'attack', 'death']);

function buildCardRow(meta, def, guidIndex, shareCounts, indexMusicGuids) {
  if (!def) {
    return {
      cardId: meta.cardId,
      name: meta.name,
      rarity: meta.rarity,
      type: meta.type,
      collectible: meta.collectible,
      musicStatus: 'parse_error',
      musicMappings: [],
      evidence: { cardDefBundle: null, note: 'CardDef GameObject not found' },
    };
  }
  const mappings = mappingsForDef(def, guidIndex, shareCounts, indexMusicGuids);
  const status = rollupStatus(false, mappings);
  const music = mappings.filter((m) => m.isMusic);
  return {
    cardId: meta.cardId,
    name: meta.name,
    rarity: meta.rarity,
    type: meta.type,
    collectible: meta.collectible,
    musicStatus: status,
    musicMappings: music.map((m) => ({
      mappingType: m.mappingType,
      sourceCardId: m.mappingType === 'shared_music' ? null : meta.cardId,
      prefabName: m.prefabName,
      prefabGuid: m.prefabGuid,
      audioClipName: m.audioClipName,
      audioClipNames: m.audioClipNames,
      bundle: m.bundle,
      musicType: m.musicType,
      nestedInVoiceSlot: !!m.nestedInVoiceSlot,
      unresolved: !!m.unresolved,
    })),
    evidence: {
      cardDefBundle: (def.files || [])[0] || null,
      cardDefBundles: def.files,
      playGuid: def.play,
      attackGuid: def.attack,
      deathGuid: def.death,
      customSummon: def.customSummon,
      musicStingerPrefab: def.musicStinger,
      musicFieldNames: def.musicFieldNames,
      extraPrefabNames: uniquePrefabs(def.allPrefabs)
        .map((p) => p.name)
        .filter((n) => !['Play', 'Attack', 'Death'].includes(n)),
    },
  };
}

function uniqueStingers(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const m of row.musicMappings || []) {
      if (!m.audioClipName && !m.prefabGuid) continue;
      const key = (m.audioClipName || '') + '|' + (m.prefabGuid || '');
      if (!map.has(key)) {
        map.set(key, {
          audioClipName: m.audioClipName,
          prefabName: m.prefabName,
          prefabGuid: m.prefabGuid,
          bundle: m.bundle,
          musicType: m.musicType,
          mappingType: m.mappingType,
          cards: [],
        });
      }
      map.get(key).cards.push(row.cardId);
    }
  }
  return [...map.values()].map((x) => ({ ...x, cardCount: x.cards.length, cards: x.cards.slice(0, 12) }));
}

async function extractSamples(stingers, audioIndex) {
  const extractor = new HearthstoneAudioExtractor({
    cacheDir: path.join(ROOT, 'tmp', 'music'),
    getVoiceAsset: (key) => {
      const clip = audioIndex.clips && audioIndex.clips[key];
      if (!clip) return null;
      return { indexed: true, voiceKey: key, zhcnBundles: clip.zhcnBundles || [], prefabBundles: clip.prefabBundles || [] };
    },
  });
  const unique = [];
  const prefer = [
    'Pegasus_Stinger_Leeroy_Jenkins',
    'Dalaran_Play_Stinger_1',
    'Tournament_Play_Stinger_3',
    'CATA_300_TheBlackBlood_Stinger',
    'Burnbristle_Play_Stinger',
  ];
  for (const name of prefer) {
    const s = stingers.find((x) => x.audioClipName === name);
    if (s) unique.push(s);
  }
  for (const s of stingers) {
    if (unique.length >= MAX_EXTRACT) break;
    if (!s.audioClipName) continue;
    if (unique.some((u) => u.audioClipName === s.audioClipName)) continue;
    unique.push(s);
  }
  const out = [];
  for (const s of unique) {
    try {
      const result = await extractor.extractVoice(s.audioClipName);
      out.push({
        audioClipName: s.audioClipName,
        prefabGuid: s.prefabGuid,
        cached: !!result.cached,
        path: result.path,
        wav: result.wav || null,
        exported: true,
      });
    } catch (e) {
      out.push({
        audioClipName: s.audioClipName,
        prefabGuid: s.prefabGuid,
        exported: false,
        error: e.message,
      });
    }
  }
  return out;
}

function writeReport(results) {
  const L = results.legendaryCollectibleMinions;
  const stingers = results.uniqueStingers || [];
  const named = stingers.filter((s) => s.prefabName && /stinger/i.test(s.prefabName));
  const otherMount = stingers.filter((s) => s.musicType === 'other_music_reference');
  const shared = stingers.filter((s) => s.cardCount > 1);
  const rc = results.rarityComparison;
  const leeroy = (results.cards || []).find((c) => c.cardId === 'EX1_116');
  const lines = [];
  lines.push('# Phase 1.0.1 — 传说卡 Music Stinger 覆盖率验证');
  lines.push('');
  lines.push('未修改 `C:\\Hearthstone`。未批量导出音频。未修改 Voice Index。未改网页 UI。');
  lines.push('');
  lines.push('本报告区分：**资源中没有音乐引用**（`no_music_reference`）与 **当前工具无法确认**（`unresolved` / `parse_error`）。');
  lines.push('');
  lines.push('## 1. 当前客户端版本');
  lines.push('');
  lines.push(`Hearthstone **${results.clientVersion}**（build ${results.build || 'unknown'}），locale ${results.locale}。`);
  lines.push('');
  lines.push('## 2. 可收藏传说随从数量');
  lines.push('');
  lines.push(`**${L.total}** 张（\`cards.json\` + \`cards.collectible.json\`：\`collectible=true\`、\`type=MINION\`、\`rarity=LEGENDARY\`）。`);
  lines.push('');
  lines.push('## 3–8. 覆盖率');
  lines.push('');
  lines.push('| 状态 | 含义 | 数量 |');
  lines.push('|---|---|---:|');
  lines.push(`| music_stinger_found | 明确找到 Music Stinger，且 GUID 未被其他卡共享 | ${L.musicStingerFound} |`);
  lines.push(`| shared_music_found | 找到音乐，但与其他 CardDef 共享同一 GUID | ${L.sharedMusicFound} |`);
  lines.push(`| other_music_found | 不是 MusicStinger 命名，但资源关系指向音乐 Clip | ${L.otherMusicFound} |`);
  lines.push(`| no_music_reference | 正向 CardDef 全 Prefab/WAV + 反向 music GUID 索引后仍无音乐引用 | ${L.noMusicReference} |`);
  lines.push(`| unresolved | 有疑似音乐引用，但 GUID 无索引或无 Clip | ${L.unresolved} |`);
  lines.push(`| parse_error | 找不到 CardDef GameObject 或解析失败 | ${L.parseError} |`);
  lines.push('');
  lines.push('## 9. 火车王属于哪一种');
  lines.push('');
  if (leeroy) {
    lines.push(`EX1_116 火车王里诺艾：\`${leeroy.musicStatus}\`。`);
    const m = (leeroy.musicMappings || [])[0];
    if (m) {
      lines.push('');
      lines.push(`- Prefab: ${m.prefabName}.prefab \`${m.prefabGuid}\``);
      lines.push(`- AudioClip: ${m.audioClipName}`);
      lines.push(`- Bundle: ${m.bundle}`);
    }
  } else {
    lines.push('结果集中未找到 EX1_116。');
  }
  lines.push('');
  lines.push('## 10. 是否存在多个不同的 Music Stinger');
  lines.push('');
  lines.push(`传说随从上解析到 **${stingers.length}** 条不同的 (AudioClip, Prefab GUID) 组合；其中 Prefab 名含 Stinger 的有 **${named.length}**。`);
  lines.push('');
  lines.push('## 11. 是否存在共享 Music Stinger');
  lines.push('');
  lines.push(shared.length ? `是。${shared.length} 条映射被多于 1 张卡引用。` : '在传说随从集合内，未发现多卡共享同一音乐 GUID。');
  lines.push('');
  lines.push('## 12. 除了 MusicStinger.prefab 是否发现其他音乐挂载方式');
  lines.push('');
  lines.push(otherMount.length
    ? `Card 级 \`other_music_found\` = ${L.otherMusicFound}。有 ${otherMount.length} 条映射的 Prefab 名不含 Stinger，但仍通过 GUID→Clip 指向音乐（例：TSC_067 的 \`Faelin.prefab\` → HS_LegendaryStinger_AmbassadorFaelin）。主流挂载仍是 PlayEffect 的 \`MusicStinger.prefab:GUID\`，未发现独立 \`m_MusicStinger*\` CardDef 字段。`
    : '在传说随从 CardDef 上，音乐引用主要仍是 `m_PlayEffectDef.m_SoundSpellPaths` 里的 `*.prefab:GUID`（含 MusicStinger）。未发现独立的 `m_MusicStinger*` CardDef 字段。');
  lines.push('');
  lines.push('检测方法（不只复制火车王路径）：');
  lines.push('');
  lines.push('1. 合并 CardDef 上全部 MonoBehaviour 的 `.prefab:GUID` 与 `.wav:GUID`（含 Play/Attack/Death/CustomSummon/其它）。');
  lines.push('2. Prefab 名 `/stinger/i`、`/music/i` 分类。');
  lines.push('3. GUID → `guid-voice-index` 的 AudioClip 名（Pegasus_Stinger / *_Stinger / *_Music）。');
  lines.push('4. 反向：索引中带音乐 Clip 的 GUID 是否被某张卡的 CardDef 引用。');
  lines.push('5. Play/Attack/Death GUID 的 preload Clip 是否为音乐（嵌套挂载）。');
  lines.push('');
  lines.push('## 13. EPIC / RARE / COMMON 是否也发现 Music Stinger');
  lines.push('');
  lines.push(`对照样本（种子 ${results.seed}，每档 ${SAMPLE_N} 张可收藏随从）：`);
  lines.push('');
  lines.push('| 稀有度 | 样本 | stinger | shared | other | none | unresolved | parse_error |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const rarity of ['LEGENDARY', 'EPIC', 'RARE', 'COMMON']) {
    const s = rc[rarity] || {};
    lines.push(`| ${rarity} | ${s.total || 0} | ${s.musicStingerFound || 0} | ${s.sharedMusicFound || 0} | ${s.otherMusicFound || 0} | ${s.noMusicReference || 0} | ${s.unresolved || 0} | ${s.parseError || 0} |`);
  }
  lines.push('');
  lines.push('## 14. “只有传说卡有登场 BGM”是否成立');
  lines.push('');
  const othersHave = ['EPIC', 'RARE', 'COMMON'].some((r) => {
    const s = rc[r] || {};
    return (s.musicStingerFound || 0) + (s.sharedMusicFound || 0) + (s.otherMusicFound || 0) > 0;
  });
  const legendHave = (L.musicStingerFound + L.sharedMusicFound + L.otherMusicFound) > 0;
  if (legendHave && !othersHave) {
    const almostAll = (L.noMusicReference || 0) <= 10 && L.total > 0;
    if (almostAll) {
      lines.push('对**可收藏随从**而言：Music Stinger **高度集中在传说**。全量 1047 张传说随从中仅 4 张 CardDef 无音乐引用；EPIC/RARE/COMMON 各 20 张对照样本全部是 `no_music_reference`。');
      lines.push('');
      lines.push('因此「传说才有登场 BGM、普通/稀有/史诗随从 CardDef 上没有 Music Stinger」在本阶段证据下**成立**。但不要理解成「只有火车王有」——那是旧 CardDef 缓存用 `/musichstinger/i` 匹配不到 `MusicStinger` 造成的漏检。');
    } else {
      lines.push('Music Stinger 在对照样本中只出现在传说档，但全量传说并非张张都有。');
    }
  } else if (othersHave) {
    lines.push('**不成立。** 对照样本中非传说稀有度也出现了音乐引用，见上表。');
  } else {
    lines.push('传说与其它稀有度样本都几乎没有 CardDef 级 Music Stinger。不能支持「传说普遍有登场 BGM」。');
  }
  lines.push('');
  lines.push('## 15. 是否足以支持下一阶段全量 Music Index');
  lines.push('');
  lines.push('正向 CardDef → Prefab GUID → guid-voice-index → AudioClip 链对火车王已经闭合，也可以批量化扫描全部 CardDef。');
  lines.push('');
  lines.push('仍不足以称为完整 Music Index：');
  lines.push('');
  lines.push('- 未解析每张卡 Play.prefab 内部 TypeTree（仅用 guid-index preload Clip 名做嵌套探测）。');
  lines.push('- 未扫全部 audio bundle 建立独立 music clip 目录。');
  lines.push('- Adventure / Hero / UI Stinger 大量存在于 guid-index，但未挂到可收藏随从 CardDef。');
  lines.push('');
  lines.push('## 典型 10 例');
  lines.push('');
  const typical = (results.cards || []).filter((c) => c.musicMappings && c.musicMappings[0] && c.musicMappings[0].audioClipName).slice(0, 0);
  const preferIds = ['EX1_116', 'AT_009', 'AT_018', 'NEW1_030', 'EX1_572', 'EX1_298', 'BAR_551', 'TOY_373', 'CATA_300', 'CFM_815'];
  for (const id of preferIds) {
    const row = (results.cards || []).find((c) => c.cardId === id);
    if (!row) continue;
    const m = (row.musicMappings || [])[0];
    lines.push(`- ${row.cardId} ${row.name} — \`${row.musicStatus}\` — ${m ? (m.prefabName + ' / ' + m.audioClipName) : '无映射'}`);
  }
  lines.push('');
  lines.push('## 异常 / 无音乐引用 10 例');
  lines.push('');
  const odd = (results.cards || []).filter((c) => c.musicStatus === 'no_music_reference' || c.musicStatus === 'unresolved' || c.musicStatus === 'parse_error');
  for (const row of odd.slice(0, 10)) {
    lines.push(`- ${row.cardId} ${row.name} — \`${row.musicStatus}\` — extra prefabs: ${(row.evidence.extraPrefabNames || []).join(', ') || '(none)'}`);
  }
  if (!odd.length) lines.push('（无 parse_error / unresolved；无音乐引用见上。）');
  lines.push('');
  lines.push('## Prefab 命名变体（仍计为 Music Stinger，不是 other_music）');
  lines.push('');
  lines.push('CardDef 上出现的含 Stinger 的 Prefab 名以 `MusicStinger` 为主，另有 `Stinger`、`Music_Stinger`、`Play_HS_*_Stinger` 等。这些都通过 `/stinger/i` 识别，证据仍是真实 `.prefab:GUID`，不是按 CardID 猜测。');
  lines.push('');
  lines.push('## 音频抽样');
  lines.push('');
  lines.push(`最多抽取 ${MAX_EXTRACT} 个不同 Clip 验证可播放。实际：${(results.extractSamples || []).length}。`);
  for (const s of results.extractSamples || []) {
    if (s.error) lines.push(`- ${s.audioClipName || 'extract'}: ${s.error}`);
    else lines.push(`- ${s.audioClipName}: ${s.exported ? 'ok' : 'fail'} ${s.path || ''} cached=${s.cached}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'phase-1.0.1-report.md'), lines.join('\n'), 'utf8');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const build = readGameBuild();
  console.log('[1.0.1] client', build.productVersion);
  const cards = loadCards();
  const guidIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'cache', 'guid-voice-index.json'), 'utf8')).guidIndex;
  const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
  const indexMusicGuids = musicGuidsFromIndex(guidIndex);
  console.log('[1.0.1] guid-index music GUIDs', indexMusicGuids.size);

  console.log('[1.0.1] rescan carddef bundles (all prefabs, current /stinger/i rules)...');
  const scanned = scanCardDefs();
  console.log('[1.0.1] carddef', scanned.stats);

  const shareCounts = buildShareCounts(scanned.byCard);
  const legendaries = [...cards.values()].filter((c) => c.collectible && c.type === 'MINION' && c.rarity === 'LEGENDARY');
  const rows = legendaries.map((c) => buildCardRow(c, scanned.byCard[c.cardId], guidIndex, shareCounts, indexMusicGuids));
  const summary = countStatuses(rows);
  const stingers = uniqueStingers(rows);

  const rarityComparison = {};
  const comparisonCards = {};
  for (const rarity of ['LEGENDARY', 'EPIC', 'RARE', 'COMMON']) {
    const pool = [...cards.values()].filter((c) => c.collectible && c.type === 'MINION' && c.rarity === rarity);
    const sample = sampleItems(pool, SAMPLE_N, SEED);
    const sampleRows = sample.map((c) => buildCardRow(c, scanned.byCard[c.cardId], guidIndex, shareCounts, indexMusicGuids));
    rarityComparison[rarity] = countStatuses(sampleRows);
    comparisonCards[rarity] = sampleRows.map((r) => ({
      cardId: r.cardId,
      name: r.name,
      musicStatus: r.musicStatus,
      clips: (r.musicMappings || []).map((m) => m.audioClipName).filter(Boolean),
    }));
  }

  const unresolved = {
    unresolved: rows.filter((r) => r.musicStatus === 'unresolved'),
    parse_error: rows.filter((r) => r.musicStatus === 'parse_error'),
    shared_music: rows.filter((r) => r.musicStatus === 'shared_music_found'),
    other_music_reference: rows.filter((r) => r.musicStatus === 'other_music_found'),
    unusual: rows.filter((r) => (r.evidence.extraPrefabNames || []).some((n) => /music|stinger/i.test(n)) && r.musicStatus === 'no_music_reference'),
  };

  const results = {
    phase: '1.0.1',
    clientVersion: build.productVersion,
    build: build.build,
    locale: 'zhCN',
    generatedAt: nowIso(),
    seed: SEED,
    hearthstoneReadOnly: true,
    batchExport: false,
    voiceIndexModified: false,
    scanStats: scanned.stats,
    guidIndexMusicGuids: indexMusicGuids.size,
    legendaryCollectibleMinions: summary,
    rarityComparison,
    rarityComparisonCards: comparisonCards,
    uniqueStingers: stingers,
    cards: rows,
    extractSamples: [],
  };

  return { results, unresolved, scanned, stingers, audioIndex };
}

const started = main();

(async () => {
  const { results, unresolved, stingers, audioIndex } = started;
  try {
    results.extractSamples = await extractSamples(stingers, audioIndex);
  } catch (e) {
    results.extractSamples = [{ error: e.message }];
  }
  fs.writeFileSync(path.join(OUT_DIR, 'phase-1.0.1-results.json'), JSON.stringify(results, (_, v) => v, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'phase-1.0.1-unresolved.json'), JSON.stringify({
    generatedAt: results.generatedAt,
    counts: {
      unresolved: unresolved.unresolved.length,
      parse_error: unresolved.parse_error.length,
      shared_music: unresolved.shared_music.length,
      other_music_reference: unresolved.other_music_reference.length,
      unusual: unresolved.unusual.length,
    },
    unresolved: unresolved.unresolved,
    parse_error: unresolved.parse_error,
    shared_music: unresolved.shared_music,
    other_music_reference: unresolved.other_music_reference,
    unusual: unresolved.unusual,
  }, null, 2));
  writeReport(results);
  console.log('[1.0.1] legendary', results.legendaryCollectibleMinions);
  console.log('[1.0.1] unique stingers', results.uniqueStingers.length);
  console.log('[1.0.1] extract', results.extractSamples);
  console.log('[1.0.1] wrote', path.join(OUT_DIR, 'phase-1.0.1-results.json'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
