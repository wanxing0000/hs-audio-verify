import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';

function ctx(buf, idx, before = 400, after = 900) {
  const start = Math.max(0, idx - before);
  const end = Math.min(buf.length, idx + after);
  const slice = buf.subarray(start, end);
  let s = '';
  for (const b of slice) {
    if (b >= 32 && b <= 126) s += String.fromCharCode(b);
    else s += (b === 0 ? '|' : '.');
  }
  return s.replace(/\|{2,}/g, ' || ');
}

function allIndex(buf, needle) {
  const pat = Buffer.from(needle);
  const out = [];
  let i = buf.indexOf(pat);
  while (i !== -1) {
    out.push(i);
    i = buf.indexOf(pat, i + 1);
  }
  return out;
}

const file = process.argv[2];
const needles = process.argv.slice(3);
if (!file || needles.length === 0) {
  console.error('usage: node dump-ctx.mjs <bundle> <needle...>');
  process.exit(1);
}
const unpacked = unpackUnityFS(file);
const report = { file: path.basename(file), hits: {} };
for (const n of needles) {
  report.hits[n] = [];
  let count = 0;
  for (const f of unpacked.files) {
    const idxs = allIndex(f.data, n);
    count += idxs.length;
    for (const idx of idxs.slice(0, 12)) {
      report.hits[n].push({ path: f.path, offset: idx, ctx: ctx(f.data, idx) });
    }
  }
  report.hits[n + '__count'] = count;
}
const outDir = path.resolve('tmp', 'ex1_116');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, path.basename(file) + '.ctx.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('wrote', out);
for (const [k, v] of Object.entries(report.hits)) {
  if (k.endsWith('__count')) {
    console.log(k, v);
    continue;
  }
  console.log('\n====', k, '====');
  for (const h of v.slice(0, 5)) {
    console.log('off', h.offset);
    console.log(h.ctx);
    console.log('---');
  }
}
