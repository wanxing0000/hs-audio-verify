import fs from 'fs';
import { unpackUnityFS } from './unpack-search.mjs';

const file = 'C:\\Hearthstone\\Data\\Win\\initial_base_global-775a814d-prefab-1.unity3d';
const unpacked = unpackUnityFS(file);
const buf = Buffer.concat(unpacked.files.map((f) => f.data));
const guid = Buffer.from('abd4cfd794032624785f78a5de7da354');
const i = buf.indexOf(guid);
console.log('guid offset', i, 'file size', buf.length);
const start = Math.max(0, i - 80);
const slice = buf.subarray(start, i + 80);
console.log(slice.toString('hex').match(/.{1,32}/g).join('\n'));
console.log('--- ascii ---');
let s = '';
for (const b of slice) s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
console.log(s);

// find repeating 32-hex GUID table stride
const hex = /[0-9a-f]{32}/g;
const text = buf.subarray(i - 2000, i + 2000).toString('latin1');
const matches = [...text.matchAll(hex)];
const offsets = matches.map((m) => m.index);
const diffs = [];
for (let k = 1; k < Math.min(offsets.length, 20); k++) diffs.push(offsets[k] - offsets[k - 1]);
console.log('guid strides in window', diffs);

// dump 64 bytes AFTER this guid
const after = buf.subarray(i + 32, i + 32 + 48);
console.log('after guid hex', after.toString('hex'));
console.log('after guid i32le', {
  a: after.readInt32LE(0),
  b: after.readInt32LE(4),
  c: after.readInt32LE(8),
  d: after.readInt32LE(12),
  pathId64: after.readBigInt64LE(0).toString(),
  pathId64_4: after.readBigInt64LE(4).toString(),
});
