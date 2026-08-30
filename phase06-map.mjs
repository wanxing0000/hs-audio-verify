import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';
import {
  parseSerializedFile,
  parseAssetBundleContainer,
  parseGameObject,
  extractVoKeys,
  extractPrintable,
} from './unity-serialized.mjs';

const HS_WIN = 'C:\\Hearthstone\\Data\\Win';
const OUT_DIR = path.resolve('data', 'voice-verification');
const CARDS_PATH = path.resolve('data', 'hearthstonejson', 'zhCN', 'cards.collectible.json');
const SEED = 20260828;
const SAMPLE_SIZE = 50;
const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;

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

function prefabsFromText(text) {
  const out = [];
  PREFAB_RE.lastIndex = 0;
  let m;
  while ((m = PREFAB_RE.exec(text))) out.push({ name: m[1], guid: m[2] });
  return out;
}

function soundsFromCardDefBody(body) {
  const text = extractPrintable(body);
  const merged = {
    foundInCardDef: true,
    playPrefab: null,
    attackPrefab: null,
    deathPrefab: null,
    customSummon: null,
    musicStinger: null,
    otherPrefabs: [],
  };
  for (const p of prefabsFromText(text)) {
    const n = p.name.toLowerCase();
    if (n === 'play' && !merged.playPrefab) merged.playPrefab = p;
    else if (n === 'attack' && !merged.attackPrefab) merged.attackPrefab = p;
    else if (n === 'death' && !merged.deathPrefab) merged.deathPrefab = p;
    else if (/musichstinger/i.test(p.name) && !merged.musicStinger) merged.musicStinger = p;
    else if (/summon/i.test(p.name) && !merged.customSummon) merged.customSummon = p;
    else if (merged.otherPrefabs.length < 8) merged.otherPrefabs.push(p);
  }
  return merged;
}

function buildCardDefIndex(cardIds) {
  const files = listBundles((n) => n.startsWith('carddef_'));
  console.log('scan carddef bundles', files.length);
  const want = new Set(cardIds);
  const byCard = {};
  for (const id of cardIds) byCard[id] = { files: [], sounds: null };
  let n = 0;
  let parseErrors = 0;
  for (const f of files) {
    n++;
    if (n % 50 === 0) console.log('  carddef', n, '/', files.length);
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) continue;
    const cab = unpacked.files[0].data;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch {
      parseErrors++;
      continue;
    }
    const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
    for (const o of parsed.objects) {
      if (o.classId !== 1) continue;
      const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
      if (!go.name || !want.has(go.name)) continue;
      const id = go.name;
      byCard[id].files.push(path.basename(f));
      for (const c of go.comps) {
        const obj = byPath.get(c.pathId);
        if (!obj || obj.classId !== 114) continue;
        const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
        byCard[id].sounds = soundsFromCardDefBody(body);
      }
    }
  }
  console.log('  carddef parseErrors', parseErrors);
  return byCard;
}

function selectCards() {
  const all = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
  const pool = all.filter((c) => {
    if (c.type !== 'MINION') return false;
    if (c.collectible !== true) return false;
    if (!c.id || !c.name) return false;
    if (c.set === 'CORE_HIDDEN' || c.set === 'BATTLEGROUNDS') return false;
    if (/^BG\d|^BGS_|^TB_|^BOM_|^DALA_|^GILA_|^BTA_|^Story_|^KARA_00|^LOOTA_|^RLK_Prologue|^CRED_/i.test(c.id)) return false;
    return true;
  });
  const rand = mulberry32(SEED);
  return {
    poolSize: pool.length,
    cards: shuffle(pool, rand).slice(0, SAMPLE_SIZE).map((c) => ({
      cardId: c.id,
      dbfId: c.dbfId,
      name: c.name,
      type: c.type,
      set: c.set,
      rarity: c.rarity || null,
    })),
  };
}

function buildManifestIndex() {
  const file = path.join(HS_WIN, 'asset_manifest.unity3d');
  console.log('index manifest');
  const unpacked = unpackUnityFS(file);
  const text = extractPrintableChunk(concatFileData(unpacked));
  const cardToPrefab = {};
  PREFAB_RE.lastIndex = 0;
  let m;
  while ((m = PREFAB_RE.exec(text))) {
    if (!cardToPrefab[m[1]]) cardToPrefab[m[1]] = [];
    if (!cardToPrefab[m[1]].includes(m[2])) cardToPrefab[m[1]].push(m[2]);
  }
  return { cardCount: Object.keys(cardToPrefab).length, cardToPrefab };
}

function neededGuids(cardDefIndex) {
  const set = new Set();
  for (const rec of Object.values(cardDefIndex)) {
    for (const slot of ['playPrefab', 'attackPrefab', 'deathPrefab']) {
      const g = rec.sounds?.[slot]?.guid;
      if (g) set.add(g);
    }
  }
  return set;
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
    for (const key of extractVoKeys(body)) {
      vos.push({ key, classId: obj.classId, pathId: p.pathId });
    }
  }
  return vos;
}

function buildGuidVoIndex(guids) {
  const files = listBundles((n) => {
    if (!n.endsWith('.unity3d')) return false;
    if (n.startsWith('carddef_') || n.startsWith('cardasset_') || n.startsWith('cardtexture_')) return false;
    if (n.includes('texture') || n.includes('material') || n.includes('mesh')) return false;
    return n.includes('prefab') || n.startsWith('initial_') || n.startsWith('playsound_') || n.startsWith('sound');
  });
  console.log('scan prefab/sound bundles', files.length, 'needed guids', guids.size);
  const guidIndex = {};
  let n = 0;
  let parsedCount = 0;
  let parseErrors = 0;
  for (const f of files) {
    n++;
    if (n % 150 === 0) console.log('  prefab', n, '/', files.length, 'parsed', parsedCount);
    const st = fs.statSync(f);
    if (st.size > 12 * 1024 * 1024) continue;
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) continue;
    const cab = unpacked.files[0].data;
    let hit = false;
    for (const g of guids) {
      if (cab.includes(Buffer.from(g))) { hit = true; break; }
    }
    if (!hit) continue;
    parsedCount++;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch (e) {
      parseErrors++;
      continue;
    }
    const abObj = parsed.objects.find((o) => o.classId === 142);
    if (!abObj) continue;
    const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
    if (!ab.container) continue;
    for (const rec of ab.container) {
      if (!guids.has(rec.key)) continue;
      const vos = vosFromPreload(cab, parsed, ab, rec);
      guidIndex[rec.key] = {
        file: path.basename(f),
        pathId: rec.pathId,
        preloadIndex: rec.preloadIndex,
        preloadSize: rec.preloadSize,
        voiceKeys: [...new Set(vos.map((v) => v.key))],
        voDetails: vos,
      };
    }
  }
  return { guidIndex, scannedFiles: files.length, parsedCount, parseErrors };
}

function buildAudioNameIndex(voiceKeys) {
  const want = new Set(voiceKeys);
  const files = listBundles((n) => n.includes('zhcn') && n.includes('audio'));
  console.log('scan zhcn audio for', want.size, 'keys in', files.length, 'bundles');
  const nameToBundles = {};
  for (const k of want) nameToBundles[k] = [];
  let n = 0;
  for (const f of files) {
    n++;
    if (n % 80 === 0) console.log('  audio', n, '/', files.length);
    const unpacked = unpackSafe(f);
    if (unpacked.error) continue;
    const buf = concatFileData(unpacked);
    const base = path.basename(f);
    for (const k of want) {
      if (buf.includes(Buffer.from(k))) {
        if (nameToBundles[k].length < 4) nameToBundles[k].push(base);
      }
    }
  }
  return nameToBundles;
}

function classify(cardId, key, slot) {
  if (!key) return 'not_found';
  const hasId = key.includes(cardId);
  const slotRe = {
    play: /_Play(_\d+)?$/i,
    attack: /_Attack(_\d+)?$/i,
    death: /_Death(_\d+)?$/i,
  }[slot];
  if (hasId) return 'matched';
  if (slotRe.test(key)) return 'indirect';
  return 'indirect';
}

function pickVoice(cardId, slot, keys) {
  if (!keys.length) return null;
  const slotRe = {
    play: /_Play(_\d+)?$/i,
    attack: /_Attack(_\d+)?$/i,
    death: /_Death(_\d+)?$/i,
  }[slot];
  const dedicatedSlot = keys.find((k) => k.includes(cardId) && slotRe.test(k));
  if (dedicatedSlot) return dedicatedSlot;
  const dedicated = keys.find((k) => k.includes(cardId));
  if (dedicated) return dedicated;
  const slotOnly = keys.find((k) => slotRe.test(k));
  return slotOnly || keys[0];
}

function resolveSlot(cardId, slot, prefab, guidIndex, audioIndex) {
  const result = {
    voiceKey: null,
    status: 'not_found',
    prefabGuid: prefab?.guid || null,
    prefabName: prefab?.name || null,
    evidence: [],
  };
  if (!prefab?.guid) {
    result.evidence.push('carddef_missing_' + slot + '_prefab');
    return result;
  }
  result.evidence.push('carddef_' + slot + '_prefab:' + prefab.guid);
  const hit = guidIndex[prefab.guid];
  if (!hit) {
    result.evidence.push('guid_not_in_prefab_container');
    return result;
  }
  result.evidence.push('assetbundle_container:' + hit.file);
  if (!hit.voiceKeys.length) {
    result.evidence.push('soundspell_preload_has_no_vo');
    return result;
  }
  const key = pickVoice(cardId, slot, hit.voiceKeys);
  result.voiceKey = key;
  result.status = classify(cardId, key, slot);
  if (hit.voiceKeys.length > 1) {
    result.evidence.push('multiple_vo:' + hit.voiceKeys.join(','));
  }
  if (result.status === 'indirect') {
    result.evidence.push('vo_key_does_not_contain_cardId');
  } else {
    result.evidence.push('vo_from_soundspell_preload');
    if (key && !key.startsWith('VO_')) result.evidence.push('clip_name_not_vo_prefixed');
  }
  const bundles = audioIndex[key] || [];
  if (bundles.length) {
    result.zhcnAudioBundles = bundles;
    result.evidence.push('zhcn_audioclip_present');
  } else {
    result.evidence.push('zhcn_audioclip_not_found');
  }
  return result;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const selected = selectCards();
  const cardIds = selected.cards.map((c) => c.cardId);
  console.log('selected', selected.cards.length, 'from pool', selected.poolSize);

  const manifest = buildManifestIndex();
  const cardDefIndex = buildCardDefIndex(cardIds);
  const guids = neededGuids(cardDefIndex);
  const { guidIndex, scannedFiles, parsedCount, parseErrors } = buildGuidVoIndex(guids);

  const pendingKeys = new Set();
  for (const g of Object.values(guidIndex)) {
    for (const k of g.voiceKeys) pendingKeys.add(k);
  }
  const audioIndex = buildAudioNameIndex(pendingKeys);

  const results = [];
  for (const card of selected.cards) {
    const def = cardDefIndex[card.cardId] || {};
    const sounds = def.sounds || {};
    const rec = {
      cardId: card.cardId,
      name: card.name,
      type: card.type,
      set: card.set,
      dbfId: card.dbfId,
      manifestPrefabGuids: manifest.cardToPrefab[card.cardId] || [],
      cardDefFiles: def.files || [],
      play: null,
      attack: null,
      death: null,
      extra: {
        customSummon: sounds.customSummon || null,
        musicStinger: sounds.musicStinger || null,
      },
    };
    try {
      rec.play = resolveSlot(card.cardId, 'play', sounds.playPrefab, guidIndex, audioIndex);
      rec.attack = resolveSlot(card.cardId, 'attack', sounds.attackPrefab, guidIndex, audioIndex);
      rec.death = resolveSlot(card.cardId, 'death', sounds.deathPrefab, guidIndex, audioIndex);
    } catch (e) {
      rec.play = { voiceKey: null, status: 'error', error: String(e.message || e) };
      rec.attack = { voiceKey: null, status: 'error', error: String(e.message || e) };
      rec.death = { voiceKey: null, status: 'error', error: String(e.message || e) };
    }
    results.push(rec);
    console.log(
      card.cardId,
      card.name,
      'P=' + rec.play.status + ':' + (rec.play.voiceKey || '-'),
      'A=' + rec.attack.status + ':' + (rec.attack.voiceKey || '-'),
      'D=' + rec.death.status + ':' + (rec.death.voiceKey || '-'),
    );
  }

  const count = (slot, st) => results.filter((r) => r[slot]?.status === st).length;
  const stats = {};
  for (const slot of ['play', 'attack', 'death']) {
    stats[slot] = {
      matched: count(slot, 'matched'),
      not_found: count(slot, 'not_found'),
      indirect: count(slot, 'indirect'),
      error: count(slot, 'error'),
    };
    stats[slot].rateMatched = +((stats[slot].matched / results.length) * 100).toFixed(1);
  }

  const failTypes = {};
  for (const r of results) {
    for (const slot of ['play', 'attack', 'death']) {
      const st = r[slot].status;
      const last = (r[slot].evidence || []).filter((e) => !e.startsWith('carddef_') && !e.startsWith('zhcn_') && !e.startsWith('assetbundle')).pop()
        || (r[slot].evidence || [])[0]
        || st;
      const key = st === 'matched' ? 'matched' : `${st}:${last}`;
      failTypes[slot + '/' + key] = (failTypes[slot + '/' + key] || 0) + 1;
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'phase-0.6-results.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    seed: SEED,
    poolSize: selected.poolSize,
    stats,
    results,
  }, null, 2));

  fs.writeFileSync(path.join(OUT_DIR, 'audio-index.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: 'Metadata only. No FSB/WAV exported.',
    seed: SEED,
    manifestCardCount: manifest.cardCount,
    prefabScan: { scannedFiles, parsedCount, parseErrors, guidHits: Object.keys(guidIndex).length },
    guidToVoice: guidIndex,
    zhcnAudioClips: audioIndex,
  }, null, 2));

  const md = [];
  md.push('# Phase 0.6 语音映射验证报告');
  md.push('');
  md.push(`- 随机种子：\`${SEED}\``);
  md.push(`- 测试卡牌数量：${results.length}`);
  md.push(`- 候选可收藏随从池：${selected.poolSize}`);
  md.push(`- asset_manifest 中的 \`.prefab:GUID\` 条目：${manifest.cardCount}`);
  md.push(`- 扫描 prefab/sound bundle：${scannedFiles}，解析含目标 GUID 的 bundle：${parsedCount}，解析失败：${parseErrors}`);
  md.push('');
  md.push('## 成功率');
  md.push('');
  md.push('| 槽位 | matched | not_found | indirect | error | 成功率 |');
  md.push('|---|---:|---:|---:|---:|---:|');
  for (const slot of ['play', 'attack', 'death']) {
    const s = stats[slot];
    md.push(`| ${slot} | ${s.matched} | ${s.not_found} | ${s.indirect} | ${s.error} | ${s.rateMatched}% |`);
  }
  md.push('');
  md.push('## 失败类型分布');
  md.push('');
  for (const [k, v] of Object.entries(failTypes).sort((a, b) => b[1] - a[1])) {
    md.push(`- \`${k}\`: ${v}`);
  }
  md.push('');
  md.push('## 样本明细');
  md.push('');
  md.push('| CardID | 名称 | Play | Attack | Death |');
  md.push('|---|---|---|---|---|');
  for (const r of results) {
    const fmt = (x) => `${x.status}${x.voiceKey ? ' / ' + x.voiceKey : ''}`;
    md.push(`| \`${r.cardId}\` | ${r.name} | ${fmt(r.play)} | ${fmt(r.attack)} | ${fmt(r.death)} |`);
  }
  md.push('');
  md.push('## 判定规则');
  md.push('');
  md.push('链路：`CardDef m_SoundSpellPaths` → `Play/Attack/Death.prefab:GUID` → 目标 bundle 的 `AssetBundle.m_Container[GUID]` → `preloadTable` 范围内对象上的 `VO_*`。');
  md.push('');
  md.push('- **matched**：SoundSpell prefab 的 preload 对象里出现 VO Key，且 Key 包含该 CardID。');
  md.push('- **indirect**：preload 里有 VO，但 Key 不含 CardID（共享语音 / VoiceSet / 错绑）。');
  md.push('- **not_found**：CardDef 没有对应 prefab，或 GUID 未出现在任何 AssetBundle.m_Container，或 preload 范围内没有 VO。即使别处存在 `VO_{CardID}_*` 也不猜测。');
  md.push('- **error**：解析异常。');
  md.push('');
  md.push('未导出任何 FSB/WAV。Hearthstone 安装目录仅读取。');
  md.push('');
  fs.writeFileSync(path.join(OUT_DIR, 'phase-0.6-report.md'), md.join('\n'));
  console.log('stats', JSON.stringify(stats, null, 2));
  console.log('wrote', OUT_DIR);
}

main();
