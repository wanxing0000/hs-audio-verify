import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseGameObject, extractPrintable } from './unity-serialized.mjs';

const u = unpackUnityFS('C:\\Hearthstone\\Data\\Win\\carddef_base_global-bc10ad9a-prefab-1.unity3d');
const cab = u.files[0].data;
const p = parseSerializedFile(cab);
for (const o of p.objects) {
  if (o.classId !== 1) continue;
  const body = cab.subarray(o.absStart, o.absStart + o.byteSize);
  const text = extractPrintable(body);
  if (text.includes('EX1_116') || text.includes('CRED_559') && body.length < 80) {
    console.log(o.byteSize, parseGameObject(body).name, JSON.stringify(text));
  }
}
console.log('--- all GO names containing EX1 ---');
for (const o of p.objects) {
  if (o.classId !== 1) continue;
  const body = cab.subarray(o.absStart, o.absStart + o.byteSize);
  const go = parseGameObject(body);
  if (go.name && /EX1_116|Leeroy|CRED_/.test(go.name)) console.log(go.name, o.byteSize);
}
