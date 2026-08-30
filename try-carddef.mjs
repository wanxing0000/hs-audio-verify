import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, extractPrintable, extractVoKeys } from './unity-serialized.mjs';
import fs from 'fs';
import path from 'path';

const dir = 'C:\\Hearthstone\\Data\\Win';
const files = fs.readdirSync(dir).filter(n => n.startsWith('carddef_')).slice(0, 8);
for (const n of files) {
  const f = path.join(dir, n);
  try {
    const u = unpackUnityFS(f);
    const cab = u.files[0].data;
    const p = parseSerializedFile(cab);
    const classes = {};
    for (const o of p.objects) classes[o.classId] = (classes[o.classId]||0)+1;
    const gos = p.objects.filter(o => o.classId===1).slice(0,3).map(o => extractPrintable(cab.subarray(o.absStart, o.absStart+o.byteSize)).replace(/\.+/g,'.').slice(0,80));
    console.log(n, 'ok objects', p.objectCount, 'classes', JSON.stringify(classes), 'go', gos);
  } catch (e) {
    console.log(n, 'FAIL', e.message);
  }
}
