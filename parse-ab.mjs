import { unpackUnityFS } from './unpack-search.mjs';
import {
  parseSerializedFile,
  parseAssetBundleContainer,
  parseGameObject,
  extractVoKeys,
  extractPrintable,
} from './unity-serialized.mjs';

const file = 'C:\\Hearthstone\\Data\\Win\\initial_base_global-775a814d-prefab-1.unity3d';
const unpacked = unpackUnityFS(file);
const cab = unpacked.files[0].data;
const parsed = parseSerializedFile(cab);
const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
const ab = parsed.objects.find((o) => o.classId === 142);
const slice = cab.subarray(ab.absStart, ab.absStart + ab.byteSize);
const parsedAb = parseAssetBundleContainer(slice);
console.log({
  name: parsedAb.name,
  preloadCount: parsedAb.preloadCount,
  containerCount: parsedAb.containerCount,
  error: parsedAb.error,
  sample: parsedAb.container.slice(0, 3),
});
const play = parsedAb.container.find((c) => c.key === 'abd4cfd794032624785f78a5de7da354');
const attack = parsedAb.container.find((c) => c.key === '99e7209c52d3cee49ac49ba864faf78b');
const death = parsedAb.container.find((c) => c.key === '3601ea7b697d3dc4891a30c665676139');
console.log({ play, attack, death });

function collectVos(pathId, seen = new Set(), depth = 0) {
  if (!pathId || seen.has(pathId) || depth > 6) return [];
  seen.add(pathId);
  const obj = byPath.get(pathId);
  if (!obj) return [];
  const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
  const vos = extractVoKeys(body).map((k) => ({ key: k, pathId, classId: obj.classId }));
  if (obj.classId === 1) {
    const go = parseGameObject(body);
    for (const c of go.comps) vos.push(...collectVos(c.pathId, seen, depth + 1));
  }
  return vos;
}

for (const [label, rec] of [['play', play], ['attack', attack], ['death', death]]) {
  if (!rec) continue;
  const obj = byPath.get(rec.pathId);
  console.log(label, 'root class', obj?.classId, 'nameascii', obj ? extractPrintable(cab.subarray(obj.absStart, obj.absStart + Math.min(80, obj.byteSize))) : null);
  const vos = [];
  const slicePre = parsedAb.preload.slice(rec.preloadIndex, rec.preloadIndex + rec.preloadSize);
  for (const p of slicePre) {
    const o = byPath.get(p.pathId);
    if (!o) continue;
    const body = cab.subarray(o.absStart, o.absStart + o.byteSize);
    for (const k of extractVoKeys(body)) vos.push({ key: k, classId: o.classId, pathId: p.pathId });
  }
  console.log(label, 'preload vos', vos);
}
