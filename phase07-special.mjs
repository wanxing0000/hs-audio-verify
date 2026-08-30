import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseGameObject, extractPrintable } from './unity-serialized.mjs';

const HS_WIN = 'C:\\Hearthstone\\Data\\Win';
const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;

function unpack(file) {
  return unpackUnityFS(path.join(HS_WIN, file));
}

function dumpGo(file, cardId) {
  const u = unpack(file);
  const cab = u.files[0].data;
  const p = parseSerializedFile(cab);
  const byPath = new Map(p.objects.map((o) => [o.pathId, o]));
  const hits = [];
  for (const o of p.objects) {
    if (o.classId !== 1) continue;
    const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
    if (go.name !== cardId) continue;
    const comps = go.comps.map((c) => {
      const obj = byPath.get(c.pathId);
      if (!obj) return { missing: c.pathId };
      const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
      const text = extractPrintable(body);
      const prefabs = [];
      PREFAB_RE.lastIndex = 0;
      let m;
      while ((m = PREFAB_RE.exec(text))) prefabs.push({ name: m[1], guid: m[2] });
      const wavs = [...text.matchAll(/[A-Za-z0-9_]+\.wav/g)].map((x) => x[0]);
      return {
        classId: obj.classId,
        size: obj.byteSize,
        prefabs,
        wavs,
        ascii: text.replace(/[^\x20-\x7e]+/g, '.').slice(0, 1800),
      };
    });
    hits.push({ go, comps });
  }
  return hits;
}

const guids = [
  'ea0a75f3b2de73c4688e099186460c84', // VAC_954 play
  '628f6c805fa8d4a47ada7e3c2b9371ba', // CAP_107 play
  'c8bdcb02f5b00ad429f12d38d252c729', // CFM_335 play
];

function findGuidOwners(targetGuids) {
  const files = fs.readdirSync(HS_WIN).filter((n) => n.startsWith('carddef_') && n.endsWith('.unity3d'));
  const owners = {};
  for (const g of targetGuids) owners[g] = [];
  let n = 0;
  for (const name of files) {
    n++;
    if (n % 80 === 0) console.log('guid scan', n, files.length);
    let unpacked;
    try { unpacked = unpackUnityFS(path.join(HS_WIN, name)); } catch { continue; }
    const cab = unpacked.files[0].data;
    const present = targetGuids.filter((g) => cab.includes(Buffer.from(g)));
    if (!present.length) continue;
    let parsed;
    try { parsed = parseSerializedFile(cab); } catch { continue; }
    const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
    for (const o of parsed.objects) {
      if (o.classId !== 1) continue;
      const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
      for (const c of go.comps) {
        const obj = byPath.get(c.pathId);
        if (!obj || obj.classId !== 114) continue;
        const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
        for (const g of present) {
          if (body.includes(Buffer.from(g))) {
            owners[g].push({ cardId: go.name, file: name });
          }
        }
      }
    }
  }
  return owners;
}

const out = {
  EDR_526: dumpGo('carddef_base_global-0fde4609-prefab-1.unity3d', 'EDR_526'),
  VAC_301: dumpGo('carddef_base_global-23b69986-prefab-1.unity3d', 'VAC_301'),
  VAC_954: dumpGo('carddef_base_global-23b69986-prefab-1.unity3d', 'VAC_954'),
  CAP_106: dumpGo('carddef_base_global-51b13101-prefab-1.unity3d', 'CAP_106'),
  CAP_107: dumpGo('carddef_base_global-51b13101-prefab-1.unity3d', 'CAP_107'),
};
console.log('EDR comps', JSON.stringify(out.EDR_526, null, 2).slice(0, 4000));
console.log('VAC_301 prefabs', out.VAC_301[0]?.comps?.map((c) => c.prefabs));
console.log('VAC_954 prefabs', out.VAC_954[0]?.comps?.map((c) => c.prefabs));
console.log('CAP_106 prefabs', out.CAP_106[0]?.comps?.map((c) => c.prefabs));
console.log('CAP_107 prefabs', out.CAP_107[0]?.comps?.map((c) => c.prefabs));

// VAC_301 may be in a different carddef file
if (!out.VAC_301.length) {
  console.log('VAC_301 not in 23b69986, scanning...');
}
if (!out.CAP_106.length) {
  console.log('CAP_106 not in 51b13101');
}

const owners = findGuidOwners(guids);
out.guidOwners = owners;
fs.writeFileSync('tmp/phase07-special-dump.json', JSON.stringify(out, null, 2));
console.log('guidOwners', JSON.stringify(owners, null, 2));
