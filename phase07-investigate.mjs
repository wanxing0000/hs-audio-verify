import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';
import {
  parseSerializedFile,
  parseGameObject,
  extractPrintable,
} from './unity-serialized.mjs';

const HS_WIN = 'C:\\Hearthstone\\Data\\Win';
const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;

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
    found: true,
    play: null,
    attack: null,
    death: null,
    customSummon: null,
    musicStinger: null,
    allPrefabs: [],
    wavNames: [...text.matchAll(/([A-Za-z0-9_]+)\.wav/g)].map((x) => x[1]),
    cardIdHits: [],
  };
  for (const p of prefabsFromText(text)) {
    merged.allPrefabs.push(p);
    const n = p.name.toLowerCase();
    if (n === 'play' && !merged.play) merged.play = p.guid;
    else if (n === 'attack' && !merged.attack) merged.attack = p.guid;
    else if (n === 'death' && !merged.death) merged.death = p.guid;
    else if (/musichstinger/i.test(p.name) && !merged.musicStinger) merged.musicStinger = p;
    else if (/summon/i.test(p.name) && !merged.customSummon) merged.customSummon = p;
  }
  return { ...merged, asciiSample: text.replace(/[^\x20-\x7e]+/g, '.').slice(0, 2500) };
}

function loadCardDefs(cardIds) {
  const want = new Set(cardIds);
  const byCard = {};
  for (const id of cardIds) byCard[id] = { files: [], sounds: null, goFound: false };
  const files = listBundles((n) => n.startsWith('carddef_'));
  console.log('scan carddef', files.length, 'for', cardIds.length, 'ids');
  let n = 0;
  for (const f of files) {
    n++;
    if (n % 60 === 0) console.log('  ', n, '/', files.length);
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) continue;
    const cab = unpacked.files[0].data;
    let parsed;
    try { parsed = parseSerializedFile(cab); } catch { continue; }
    const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
    for (const o of parsed.objects) {
      if (o.classId !== 1) continue;
      const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
      if (!go.name || !want.has(go.name)) continue;
      const id = go.name;
      byCard[id].files.push(path.basename(f));
      byCard[id].goFound = true;
      for (const c of go.comps) {
        const obj = byPath.get(c.pathId);
        if (!obj || obj.classId !== 114) continue;
        const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
        byCard[id].sounds = soundsFromCardDefBody(body);
      }
    }
  }
  return byCard;
}

function extractPrintableChunk(buf) {
  let s = '';
  for (const b of buf) s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : (b === 0 ? '|' : '.');
  return s.replace(/\|{2,}/g, ' || ');
}

function searchBundle(file, needles) {
  const unpacked = unpackSafe(file);
  if (unpacked.error) return { error: unpacked.error };
  const buf = Buffer.concat(unpacked.files.map((f) => f.data));
  const hits = {};
  for (const n of needles) {
    const pat = Buffer.from(n);
    const ctxs = [];
    let i = buf.indexOf(pat);
    let count = 0;
    while (i !== -1 && count < 4) {
      ctxs.push(extractPrintableChunk(buf.subarray(Math.max(0, i - 180), Math.min(buf.length, i + 280))));
      count++;
      i = buf.indexOf(pat, i + 1);
    }
    hits[n] = { count: count + (i === -1 ? 0 : 1), ctxs };
    // recount properly
    let c = 0;
    let j = buf.indexOf(pat);
    while (j !== -1) { c++; j = buf.indexOf(pat, j + 1); }
    hits[n].count = c;
  }
  return hits;
}

const targets = JSON.parse(fs.readFileSync('tmp/phase07-targets.json', 'utf8'));
const candidates = [
  'EX1_116', 'EX1_250', 'CS3_031', 'OG_202', 'NEW1_010', 'NEW1_024',
  'VAC_301', 'CAP_106', 'CAP_106t', 'CAP_107', 'KAR_065', 'DMF_067',
  'CFM_335', 'VAC_954', 'WON_302', 'WON_305', 'VAN_NEW1_010', 'VAN_NEW1_024',
  'CORE_EX1_250', 'CORE_DMF_067', 'LEG_CS3_031', 'EDR_526', 'EDR_493',
];
const uniqueIds = [...new Set([...targets.map((t) => t.cardId), ...candidates])];
const defs = loadCardDefs(uniqueIds);

const compare = [];
for (const t of targets) {
  if (t.status === 'not_found') continue;
  const src = defs[t.cardId]?.sounds;
  const fromKey = [];
  for (const slot of ['play', 'attack', 'death']) {
    const k = t[slot].voiceKey || '';
    const m = k.match(/^(?:VO_|SFX_)?([A-Z][A-Z0-9]+_[0-9A-Za-z]+)/);
    if (m) fromKey.push(m[1]);
  }
  compare.push({
    cardId: t.cardId,
    voiceKeys: { play: t.play.voiceKey, attack: t.attack.voiceKey, death: t.death.voiceKey },
    ownGuids: src ? { play: src.play, attack: src.attack, death: src.death } : null,
    ownMatchesPhase06: src ? {
      play: src.play === t.play.guid,
      attack: src.attack === t.attack.guid,
      death: src.death === t.death.guid,
    } : null,
    parsedIdsFromVoiceKey: [...new Set(fromKey)],
  });
}

const guidCompare = [];
for (const row of compare) {
  const own = defs[row.cardId]?.sounds;
  const others = {};
  for (const otherId of uniqueIds) {
    if (otherId === row.cardId) continue;
    const s = defs[otherId]?.sounds;
    if (!s || !own) continue;
    const samePlay = own.play && s.play && own.play === s.play;
    const sameAtk = own.attack && s.attack && own.attack === s.attack;
    const sameDeath = own.death && s.death && own.death === s.death;
    if (samePlay || sameAtk || sameDeath) {
      others[otherId] = {
        samePlay, sameAtk, sameDeath,
        play: s.play, attack: s.attack, death: s.death,
        goFound: defs[otherId].goFound,
        files: defs[otherId].files,
      };
    }
  }
  guidCompare.push({ ...row, sharedWith: others, goFound: defs[row.cardId]?.goFound, files: defs[row.cardId]?.files });
}

const dbfNeedles = uniqueIds.concat(['DECK_RULE', 'COPY_OF', 'PARENT', 'RELATED', 'VOICE', 'SoundSpell', 'm_DeckCopy']);
const dbfHits = searchBundle(path.join(HS_WIN, 'dbf.unity3d'), uniqueIds);

const edr = defs['EDR_526'];
const out = {
  guidCompare,
  edr526: {
    files: edr?.files,
    goFound: edr?.goFound,
    sounds: edr?.sounds ? {
      play: edr.sounds.play,
      attack: edr.sounds.attack,
      death: edr.sounds.death,
      customSummon: edr.sounds.customSummon,
      musicStinger: edr.sounds.musicStinger,
      allPrefabs: edr.sounds.allPrefabs,
      wavNames: edr.sounds.wavNames,
      asciiSample: edr.sounds.asciiSample,
    } : null,
  },
  missingCardDefs: uniqueIds.filter((id) => !defs[id]?.goFound),
  dbfCounts: Object.fromEntries(Object.entries(dbfHits).map(([k, v]) => [k, v.count])),
  dbfCtx: Object.fromEntries(Object.entries(dbfHits).filter(([, v]) => v.count > 0).map(([k, v]) => [k, v.ctxs[0]])),
};

fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/phase07-investigate.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  missingCardDefs: out.missingCardDefs,
  edrPrefabs: out.edr526.sounds?.allPrefabs,
  edrPlay: out.edr526.sounds?.play,
  shares: guidCompare.map((g) => ({ id: g.cardId, sharedWith: Object.keys(g.sharedWith), fromKey: g.parsedIdsFromVoiceKey })),
  dbfCounts: out.dbfCounts,
}, null, 2));
