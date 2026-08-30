import fs from 'fs';
import path from 'path';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';

const OUT = path.resolve('tmp', 'ex1_116');
fs.mkdirSync(OUT, { recursive: true });

const typeName = (t) => {
  const e = Object.entries(AssetType).find(([, v]) => v === t);
  return e ? e[0] : String(t);
};

const looksRelated = (s) =>
  /EX1_116|LeeroyJenkins|Leeroy|PlaySound|VO_/i.test(s);

function collectStrings(val, acc, depth = 0) {
  if (depth > 8 || val == null) return;
  if (typeof val === 'string') {
    if (val.length >= 3 && val.length < 500) acc.push(val);
    return;
  }
  if (typeof val === 'bigint') return;
  if (Array.isArray(val)) {
    for (const x of val) collectStrings(x, acc, depth + 1);
    return;
  }
  if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (typeof k === 'string') acc.push(k);
      collectStrings(v, acc, depth + 1);
    }
  }
}

async function inspect(filePath, { dumpHits = true, maxObjects = Infinity } = {}) {
  console.log('\n====', path.basename(filePath), '====');
  const bundle = await loadAssetBundle(fs.readFileSync(filePath));
  const typeCounts = {};
  const hits = [];
  let i = 0;
  for (const obj of bundle.objects) {
    if (++i > maxObjects) break;
    const tn = typeName(obj.type);
    typeCounts[tn] = (typeCounts[tn] || 0) + 1;
    let tree = null;
    let dump = null;
    try { tree = obj.getTypeTree?.(); } catch {}
    try { dump = obj.dump?.(); } catch {}
    const blobParts = [obj.name || '', tn];
    const strs = [];
    collectStrings(tree, strs);
    collectStrings(dump, strs);
    blobParts.push(...strs);
    const blob = blobParts.join('\n');
    if (looksRelated(blob)) {
      const rec = {
        file: path.basename(filePath),
        type: tn,
        name: obj.name || '',
        pathId: obj.pathId?.toString?.() || '',
        container: '',
        relatedStrings: [...new Set(strs.filter(looksRelated))].slice(0, 80),
      };
      try { rec.container = obj.container || bundle.getContainer?.(obj.pathId) || ''; } catch {}
      if (dumpHits) {
        rec.treePreview = tree;
      }
      hits.push(rec);
    }
  }
  const summary = {
    file: path.basename(filePath),
    objectCount: bundle.objects.length,
    nodes: (bundle.nodes || []).map((n) => n.path),
    typeCounts,
    hitCount: hits.length,
    hits,
  };
  const out = path.join(OUT, path.basename(filePath) + '.ex1.json');
  fs.writeFileSync(out, JSON.stringify(summary, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  console.log(JSON.stringify({
    file: summary.file,
    objectCount: summary.objectCount,
    typeCounts,
    hitCount: hits.length,
    hitNames: hits.slice(0, 30).map((h) => `${h.type}:${h.name}`),
    relatedSample: hits.slice(0, 5).map((h) => h.relatedStrings.slice(0, 15)),
  }, null, 2));
  console.log('wrote', out);
  return summary;
}

const target = process.argv[2];
if (!target) {
  console.error('usage: node inspect-ex1.mjs <bundle>');
  process.exit(1);
}
inspect(target).catch((e) => {
  console.error(e);
  process.exit(1);
});
