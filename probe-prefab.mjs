import fs from 'fs';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';

const file = process.argv[2] || 'C:\\Hearthstone\\Data\\Win\\initial_base_global-775a814d-prefab-1.unity3d';
const needle = (process.argv[3] || 'EX1_116').toLowerCase();

const typeName = (t) => {
  const entry = Object.entries(AssetType).find(([, v]) => v === t);
  return entry ? entry[0] : String(t);
};

async function main() {
const bundle = await loadAssetBundle(fs.readFileSync(file));
console.log('objects', bundle.objects.length);
const typeCounts = {};
const hits = [];
for (const obj of bundle.objects) {
  const tn = typeName(obj.type);
  typeCounts[tn] = (typeCounts[tn] || 0) + 1;
  let tree = null;
  let treeErr = null;
  try { tree = obj.getTypeTree?.() || obj.tree || null; } catch (e) { treeErr = e.message; }
  const json = tree ? JSON.stringify(tree, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : '';
  const blob = `${obj.name || ''} ${obj.container || ''} ${json}`.toLowerCase();
  if (blob.includes(needle) || blob.includes('vo_ex1') || /audio|soundspell|play/i.test(obj.name || '')) {
    const keys = tree && typeof tree === 'object' ? Object.keys(tree).slice(0, 50) : [];
    hits.push({
      type: tn,
      name: obj.name,
      pathId: obj.pathId?.toString?.(),
      container: obj.container,
      treeErr,
      keys,
      snippet: json.slice(0, 1500),
    });
  }
}
console.log('typeCounts', typeCounts);
console.log('hits', hits.length);
for (const h of hits.slice(0, 20)) {
  console.log('---', h.type, h.name, h.pathId, h.container);
  console.log('keys', h.keys.join(','));
  console.log(h.snippet.slice(0, 800));
}
fs.writeFileSync('tmp/probe-prefab.json', JSON.stringify({ typeCounts, hits: hits.slice(0, 40) }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
