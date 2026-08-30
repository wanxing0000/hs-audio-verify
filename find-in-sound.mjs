import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from './unpack-search.mjs';

const win = 'C:\\Hearthstone\\Data\\Win';
const needles = process.argv.slice(2).map((s) => Buffer.from(s));
const prefixes = ['playsound', 'soundotherminion', 'soundspell', 'soundmission', 'initial'];
const files = fs.readdirSync(win)
  .filter((n) => n.endsWith('.unity3d') && prefixes.some((p) => n.startsWith(p)))
  .map((n) => path.join(win, n));

console.log('scan files', files.length, 'needles', process.argv.slice(2));
const hits = [];
for (const f of files) {
  try {
    const unpacked = unpackUnityFS(f);
    for (const node of unpacked.files) {
      for (const pat of needles) {
        if (node.data.includes(pat)) {
          const idx = node.data.indexOf(pat);
          const start = Math.max(0, idx - 60);
          const end = Math.min(node.data.length, idx + pat.length + 80);
          let ctx = '';
          for (const b of node.data.subarray(start, end)) {
            ctx += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
          }
          console.log('HIT', path.basename(f), node.path, pat.toString(), ctx);
          hits.push({ file: path.basename(f), node: node.path, needle: pat.toString(), ctx });
        }
      }
    }
  } catch (e) {
    console.error('fail', path.basename(f), e.message);
  }
}
fs.mkdirSync(path.resolve('tmp', 'ex1_116'), { recursive: true });
fs.writeFileSync(path.resolve('tmp', 'ex1_116', 'sound-guid-hits.json'), JSON.stringify(hits, null, 2));
console.log('done hits', hits.length);
