import fs from 'fs';
import path from 'path';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';

const file = process.argv[2];
const needle = (process.argv[3] || 'EX1_116').toLowerCase();
const bundle = await loadAssetBundle(fs.readFileSync(file));
const out = [];
for (const obj of bundle.objects) {
  let tree = null;
  try { tree = obj.getTypeTree?.(); } catch {}
  const name = obj.name || '';
  const blob = JSON.stringify(tree, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) || '';
  if (name.toLowerCase().includes(needle) || blob.toLowerCase().includes(needle)) {
    out.push({
      type: obj.type,
      className: obj.constructor?.name,
      name,
      pathId: obj.pathId?.toString?.(),
      container: obj.container || '',
      tree,
    });
  }
}
const dest = path.resolve('tmp', 'ex1_116', path.basename(file) + '.typetree.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log('objects', bundle.objects.length, 'hits', out.length, 'wrote', dest);
for (const h of out) {
  console.log('---', h.className, h.name, 'pathId', h.pathId);
  const t = h.tree || {};
  const keys = Object.keys(t);
  console.log('keys', keys.slice(0, 40).join(','));
  const interesting = {};
  for (const [k, v] of Object.entries(t)) {
    if (/sound|play|attack|death|spell|path|effect|summon|vo_/i.test(k)) interesting[k] = v;
  }
  console.log(JSON.stringify(interesting, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2).slice(0, 4000));
}
