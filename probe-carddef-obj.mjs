import { unpackUnityFS } from './unpack-search.mjs';
import { parseSerializedFile, parseGameObject, extractPrintable } from './unity-serialized.mjs';
import path from 'path';
import fs from 'fs';

const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;

function extractPrefabs(text) {
  const out = [];
  PREFAB_RE.lastIndex = 0;
  let m;
  while ((m = PREFAB_RE.exec(text))) out.push({ name: m[1], guid: m[2] });
  return out;
}

const file = process.argv[2] || 'C:\\Hearthstone\\Data\\Win\\carddef_base_global-bc10ad9a-prefab-1.unity3d';
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['EX1_116'];
const u = unpackUnityFS(file);
const cab = u.files[0].data;
const parsed = parseSerializedFile(cab);
console.log('objects', parsed.objectCount);
for (const o of parsed.objects) {
  const body = cab.subarray(o.absStart, o.absStart + o.byteSize);
  for (const id of ids) {
    if (!body.includes(Buffer.from(id))) continue;
    const text = extractPrintable(body);
    const prefabs = extractPrefabs(text);
    const slots = prefabs.filter((p) => /^(Play|Attack|Death)$/i.test(p.name));
    console.log('hit', id, 'class', o.classId, 'size', o.byteSize, 'pathId', o.pathId);
    if (o.classId === 1) {
      const go = parseGameObject(body);
      console.log('  parsedGO', go);
      console.log('  ascii', text.replace(/\.+/g, '.').slice(0, 200));
    }
    if (slots.length) console.log('  slots', slots);
    if (o.classId === 114 && slots.length) {
      console.log('  mb ascii', text.replace(/\.+/g, '.').slice(0, 500));
    }
  }
}
