import fs from 'fs';
import path from 'path';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';

const typeName = (t) => {
  const entry = Object.entries(AssetType).find(([, v]) => v === t);
  return entry ? entry[0] : String(t);
};

const summarize = async (filePath, { nameLimit = 80 } = {}) => {
  const buf = fs.readFileSync(filePath);
  const bundle = await loadAssetBundle(buf);
  const typeCounts = new Map();
  const named = [];
  const audio = [];
  const containers = [];
  const voHits = [];

  for (const obj of bundle.objects) {
    const tn = typeName(obj.type);
    typeCounts.set(tn, (typeCounts.get(tn) || 0) + 1);
    const rec = {
      type: tn,
      name: obj.name || '',
      pathId: obj.pathId?.toString?.() ?? '',
      container: '',
    };
    try {
      rec.container = obj.container || bundle.getContainer?.(obj.pathId) || '';
    } catch {
      rec.container = '';
    }
    if (rec.container) containers.push(rec.container);
    const blob = `${rec.name} ${rec.container}`;
    if (/VO_|AudioClip|\.wav|\.ogg/i.test(blob)) voHits.push(rec);
    if (obj.type === AssetType.AudioClip) {
      let meta = {};
      try {
        const a = typeof obj.getAudio === 'function' ? obj.getAudio() : null;
        meta = {
          format: a?.format || obj.format,
          size: a?.size ?? obj.audioSize?.toString?.(),
          channels: a?.channels,
          compression: obj.meta?.compressionFormat,
          soundType: obj.meta?.soundType,
          frequency: obj.meta?.frequency,
          length: obj.meta?.length,
          source: obj.source,
        };
      } catch (e) {
        meta = { error: String(e) };
      }
      audio.push({ ...rec, ...meta });
    }
    if (named.length < nameLimit) named.push(rec);
  }

  return {
    file: path.basename(filePath),
    bytes: buf.length,
    nodes: (bundle.nodes || []).map((n) => n.path),
    objectCount: bundle.objects.length,
    typeCounts: Object.fromEntries([...typeCounts.entries()].sort((a, b) => b[1] - a[1])),
    audioCount: audio.length,
    containerSample: [...new Set(containers)].slice(0, 30),
    voHits,
    audio: audio.slice(0, 40),
    namedSample: named,
  };
};

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node list-bundle.mjs <bundle...>');
    process.exit(1);
  }

  const outDir = path.resolve('tmp');
  fs.mkdirSync(outDir, { recursive: true });

  for (const f of files) {
    const abs = path.resolve(f);
    console.log(`\n==== LIST ${abs} ====`);
    try {
      const info = await summarize(abs);
      const out = path.join(outDir, path.basename(f) + '.list.json');
      fs.writeFileSync(out, JSON.stringify(info, null, 2));
      console.log(JSON.stringify({
        file: info.file,
        bytes: info.bytes,
        objectCount: info.objectCount,
        typeCounts: info.typeCounts,
        audioCount: info.audioCount,
        nodes: info.nodes,
        voHits: info.voHits.slice(0, 20),
        audioNames: info.audio.map((a) => ({
          name: a.name, format: a.format, container: a.container, compression: a.compression,
        })),
        namedSample: info.namedSample.slice(0, 25).map((x) => `${x.type}:${x.name}`),
      }, null, 2));
      console.log('wrote', out);
    } catch (e) {
      console.error('FAIL', abs, e?.stack || e);
    }
  }
}

main();
