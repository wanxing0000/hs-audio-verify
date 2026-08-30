import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseGameObject } from './unity-serialized.mjs';

const dir = 'C:\\Hearthstone\\Data\\Win';
const want = process.argv[2] || 'EX1_116';
const files = fs.readdirSync(dir).filter((n) => n.startsWith('carddef_') && n.endsWith('.unity3d'));
let found = 0;
for (const n of files) {
  const f = path.join(dir, n);
  let unpacked;
  try { unpacked = unpackUnityFS(f); } catch { continue; }
  if (!unpacked.files[0]) continue;
  const cab = unpacked.files[0].data;
  if (!cab.includes(Buffer.from(want))) continue;
  let parsed;
  try { parsed = parseSerializedFile(cab); } catch { continue; }
  for (const o of parsed.objects) {
    if (o.classId !== 1) continue;
    const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
    if (go.name === want) {
      console.log('GO name match', n, 'size', o.byteSize);
      found++;
    }
  }
}
console.log('done found', found);
