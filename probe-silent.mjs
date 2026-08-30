import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseAssetBundleContainer, extractPrintable } from './unity-serialized.mjs';

const file = 'C:\\Hearthstone\\Data\\Win\\initial_base_global-384202c8-prefab-5.unity3d';
const guid = '4e21f71016c970642905677e8a010738';
const u = unpackUnityFS(file);
const cab = u.files[0].data;
const p = parseSerializedFile(cab);
const abObj = p.objects.find((o) => o.classId === 142);
const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
const rec = ab.container.find((c) => c.key === guid);
console.log('container', rec);
const byPath = new Map(p.objects.map((o) => [o.pathId, o]));
const end = rec.preloadIndex + rec.preloadSize;
for (let i = rec.preloadIndex; i < end; i++) {
  const pid = ab.preload[i].pathId;
  const obj = byPath.get(pid);
  const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
  const text = extractPrintable(body).replace(/\.+/g, '.');
  const clips = [...text.matchAll(/[A-Za-z0-9_]+(?:\.wav(?::[0-9a-f]{32})?)?/g)].map((m) => m[0]).filter((s) => /wav|Play|Attack|Death|VO_|SFX_|Play_|Impact/i.test(s)).slice(0, 12);
  console.log(i, 'class', obj.classId, 'size', obj.byteSize, 'clips', clips, 'ascii', text.slice(0, 180));
}
