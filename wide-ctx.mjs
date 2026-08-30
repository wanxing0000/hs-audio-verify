import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';

function printable(buf) {
  let s = '';
  for (const b of buf) {
    if (b >= 32 && b <= 126) s += String.fromCharCode(b);
    else if (b === 0) s += '|';
    else s += '.';
  }
  return s.replace(/\|{2,}/g, '||');
}

const file = process.argv[2];
const needle = process.argv[3];
const before = Number(process.argv[4] || 2500);
const after = Number(process.argv[5] || 400);
const unpacked = unpackUnityFS(file);
const pat = Buffer.from(needle);
for (const f of unpacked.files) {
  let idx = f.data.indexOf(pat);
  let n = 0;
  while (idx !== -1 && n < 8) {
    const start = Math.max(0, idx - before);
    const end = Math.min(f.data.length, idx + needle.length + after);
    console.log('\n====', f.path, 'off', idx, '====');
    console.log(printable(f.data.subarray(start, end)));
    idx = f.data.indexOf(pat, idx + 1);
    n++;
  }
}
