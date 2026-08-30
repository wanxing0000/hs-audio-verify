import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';
import {
  parseSerializedFile,
  parseAssetBundleContainer,
  parseGameObject,
  extractPrintable,
  extractVoKeys,
} from './unity-serialized.mjs';

const HS_WIN = 'C:\\Hearthstone\\Data\\Win';
const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;

function dumpCard(file, cardId) {
  const u = unpackUnityFS(path.join(HS_WIN, file));
  const cab = u.files[0].data;
  const p = parseSerializedFile(cab);
  const byPath = new Map(p.objects.map((o) => [o.pathId, o]));
  for (const o of p.objects) {
    if (o.classId !== 1) continue;
    const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
    if (go.name !== cardId) continue;
    const slots = { play: null, attack: null, death: null, all: [] };
    for (const c of go.comps) {
      const obj = byPath.get(c.pathId);
      if (!obj || obj.classId !== 114) continue;
      const text = extractPrintable(cab.subarray(obj.absStart, obj.absStart + obj.byteSize));
      PREFAB_RE.lastIndex = 0;
      let m;
      while ((m = PREFAB_RE.exec(text))) {
        slots.all.push({ name: m[1], guid: m[2] });
        const n = m[1].toLowerCase();
        if (n === 'play') slots.play = m[2];
        if (n === 'attack') slots.attack = m[2];
        if (n === 'death') slots.death = m[2];
      }
    }
    return slots;
  }
  return null;
}

function vosFromPreload(cab, parsed, ab, rec) {
  const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
  const vos = [];
  const end = Math.min(ab.preload.length, rec.preloadIndex + rec.preloadSize);
  for (let i = rec.preloadIndex; i < end; i++) {
    const obj = byPath.get(ab.preload[i].pathId);
    if (!obj) continue;
    const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
    for (const k of extractVoKeys(body)) vos.push(k);
  }
  return [...new Set(vos)];
}

function resolveGuids(guids) {
  const want = new Set(guids);
  const files = fs.readdirSync(HS_WIN).filter((n) => {
    if (!n.endsWith('.unity3d')) return false;
    if (n.startsWith('carddef_') || n.startsWith('cardasset_') || n.startsWith('cardtexture_')) return false;
    if (n.includes('texture') || n.includes('material')) return false;
    return n.includes('prefab') || n.startsWith('initial_') || n.startsWith('playsound_') || n.startsWith('sound');
  });
  const found = {};
  let n = 0;
  for (const name of files) {
    if (!want.size) break;
    n++;
    if (n % 200 === 0) console.log('resolve', n, files.length, 'left', want.size);
    const st = fs.statSync(path.join(HS_WIN, name));
    if (st.size > 12 * 1024 * 1024) continue;
    let unpacked;
    try { unpacked = unpackUnityFS(path.join(HS_WIN, name)); } catch { continue; }
    if (!unpacked.files.length) continue;
    const cab = unpacked.files[0].data;
    const hit = [...want].filter((g) => cab.includes(Buffer.from(g)));
    if (!hit.length) continue;
    let parsed;
    try { parsed = parseSerializedFile(cab); } catch { continue; }
    const abObj = parsed.objects.find((o) => o.classId === 142);
    if (!abObj) continue;
    const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
    for (const rec of ab.container || []) {
      if (!want.has(rec.key)) continue;
      found[rec.key] = { file: name, voiceKeys: vosFromPreload(cab, parsed, ab, rec) };
      want.delete(rec.key);
    }
  }
  return found;
}

const vac301 = dumpCard('carddef_base_global-23b69986-prefab-0.unity3d', 'VAC_301');
const vac954 = dumpCard('carddef_base_global-23b69986-prefab-1.unity3d', 'VAC_954');
const cap106 = dumpCard('carddef_base_global-51b13101-prefab-1.unity3d', 'CAP_106');
const cap107 = dumpCard('carddef_base_global-51b13101-prefab-1.unity3d', 'CAP_107');
const edr = dumpCard('carddef_base_global-0fde4609-prefab-1.unity3d', 'EDR_526');

const guids = [
  vac301?.play, vac301?.attack, vac301?.death,
  cap106?.play, cap106?.attack, cap106?.death,
  edr?.play, edr?.attack, edr?.death,
].filter(Boolean);

console.log('VAC_301', vac301);
console.log('VAC_954', { play: vac954?.play, attack: vac954?.attack, death: vac954?.death });
console.log('same VAC play', vac301?.play === vac954?.play);
console.log('CAP_106', cap106);
console.log('same CAP play', cap106?.play === cap107?.play);
console.log('EDR_526 slots', edr);

const resolved = resolveGuids(guids);
const out = { vac301, vac954, cap106, cap107, edr, resolved };
fs.writeFileSync('tmp/phase07-resolve.json', JSON.stringify(out, null, 2));
console.log('resolved', JSON.stringify(resolved, null, 2));
