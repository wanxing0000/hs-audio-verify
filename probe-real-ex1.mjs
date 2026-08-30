import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseGameObject, extractPrintable } from './unity-serialized.mjs';

const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;
const u = unpackUnityFS('C:\\Hearthstone\\Data\\Win\\carddef_base_global-775a814d-prefab-0.unity3d');
const cab = u.files[0].data;
const p = parseSerializedFile(cab);
const byPath = new Map(p.objects.map((o) => [o.pathId, o]));
for (const o of p.objects) {
  if (o.classId !== 1) continue;
  const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
  if (go.name !== 'EX1_116') continue;
  console.log('GO', go);
  for (const c of go.comps) {
    const obj = byPath.get(c.pathId);
    if (!obj) continue;
    const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
    const text = extractPrintable(body);
    const prefabs = [];
    PREFAB_RE.lastIndex = 0;
    let m;
    while ((m = PREFAB_RE.exec(text))) prefabs.push({ name: m[1], guid: m[2] });
    console.log(' comp class', obj.classId, 'size', obj.byteSize, 'prefabs', prefabs.filter((x) => /play|attack|death|summon|stinger/i.test(x.name)));
  }
}
