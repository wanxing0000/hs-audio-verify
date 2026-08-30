import fs from 'fs';
import path from 'path';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';

const BUNDLE = 'C:\\Hearthstone\\Data\\Win\\playsound_base_hero_01bn_zhcn-content-0.unity3d';

async function main() {
  const bundle = await loadAssetBundle(fs.readFileSync(BUNDLE));
  console.log('nodes', bundle.nodes);
  console.log('files lengths', bundle.files.map((f) => f.byteLength));
  for (const obj of bundle.objects) {
    console.log('---', obj.type, obj.name);
    console.log('pathId', obj.pathId?.toString?.());
    console.log('class', obj.__class || obj.constructor?.name);
    try {
      console.log('info version', obj.__info?.version, 'assetVersion', obj.__info?.assetVersion, 'classId', obj.__info?.classId);
    } catch (e) {
      console.log('info err', e.message);
    }
    if (typeof obj.dump === 'function') {
      try { console.log('dump', JSON.stringify(obj.dump(), (_, v) => typeof v === 'bigint' ? v.toString() : v, 2).slice(0, 4000)); }
      catch (e) { console.log('dump err', e.message); }
    }
    if (typeof obj.getTypeTree === 'function') {
      try { console.log('typetree', JSON.stringify(obj.getTypeTree(), (_, v) => typeof v === 'bigint' ? v.toString() : v, 2).slice(0, 4000)); }
      catch (e) { console.log('typetree err', e.message); }
    }
    if (obj.type === AssetType.AudioClip) {
      console.log('meta', obj.meta);
      console.log('source', obj.source);
      console.log('offset', obj.offset?.toString?.());
      console.log('audioSize', obj.audioSize?.toString?.());
      console.log('dataLen', obj.data?.length);
      console.log('format', obj.format);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
