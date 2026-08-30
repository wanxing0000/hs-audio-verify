import fs from 'fs';
import { unpackUnityFS } from './unpack-search.mjs';

const file = 'C:\\Hearthstone\\Data\\Win\\initial_base_global-775a814d-prefab-1.unity3d';
const unpacked = unpackUnityFS(file);
for (const f of unpacked.files) {
  const buf = f.data;
  console.log('node', f.path, 'size', buf.length);
  console.log('head ascii', buf.subarray(0, 80).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
  console.log('head hex', buf.subarray(0, 64).toString('hex'));
  console.log('unityVersion', unpacked.unityVersion, 'revision', unpacked.unityRevision);
  // try header fields both endian
  console.log('u32be', {
    m0: buf.readUInt32BE(0),
    m1: buf.readUInt32BE(4),
    m2: buf.readUInt32BE(8),
    m3: buf.readUInt32BE(12),
    m4: buf.readUInt32BE(16),
  });
  console.log('u32le', {
    m0: buf.readUInt32LE(0),
    m1: buf.readUInt32LE(4),
    m2: buf.readUInt32LE(8),
    m3: buf.readUInt32LE(12),
    m4: buf.readUInt32LE(16),
  });
}
