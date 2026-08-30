import fs from 'fs';
import path from 'path';
import { loadAssetBundle, AssetType } from '@arkntools/unity-js';
import { convertFsb, FsbConvertFormat } from '@arkntools/unity-js/audio';

const HS = 'C:\\Hearthstone\\Data\\Win';
const OUT = path.resolve('tmp', 'export');
const TARGET_NAME = 'VO_HERO_01bn_Male_Dragon_ERROR_PLAY_01';
const BUNDLE = path.join(HS, 'playsound_base_hero_01bn_zhcn-content-0.unity3d');

const COMPRESSION = {
  0: 'PCM',
  1: 'Vorbis',
  2: 'ADPCM',
  3: 'MP3',
};

function magic(buf) {
  const n = Math.min(16, buf.length);
  let ascii = '';
  const hex = [];
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
    hex.push(b.toString(16).padStart(2, '0'));
  }
  return { ascii, hex: hex.join(' ') };
}

function sniffFormat(buf) {
  if (buf.length >= 4) {
    const s = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    if (s === 'OggS') return 'ogg';
    if (s === 'RIFF') return 'wav';
    if (s === 'FSB5' || s === 'FSB4') return 'fsb';
  }
  return 'bin';
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const bundle = await loadAssetBundle(fs.readFileSync(BUNDLE));
  const clip = bundle.objects.find(
    (o) => o.type === AssetType.AudioClip && o.name === TARGET_NAME,
  );
  if (!clip) throw new Error('AudioClip not found');

  const tree = clip.getTypeTree();
  const res = tree.m_Resource || {};
  const sourceName = String(res.m_Source || '').split('/').pop();
  const offset = Number(res.m_Offset || 0);
  const size = Number(res.m_Size || 0);
  const nodeIndex = bundle.nodes.findIndex((n) => n.path === sourceName);
  if (nodeIndex < 0) throw new Error('resource node not found: ' + sourceName);
  const file = Buffer.from(bundle.files[nodeIndex]);
  const payload = file.subarray(offset, offset + size);
  const fmt = sniffFormat(payload);

  const meta = {
    name: clip.name,
    pathId: clip.pathId.toString(),
    container: clip.container,
    bundle: path.basename(BUNDLE),
    gameplayAudioKey: TARGET_NAME,
    gameplayAudioTextZh: '不能那么做。',
    localeBundle: 'zhcn',
    typeTree: {
      loadType: tree.m_LoadType,
      channels: tree.m_Channels,
      frequency: tree.m_Frequency,
      bitsPerSample: tree.m_BitsPerSample,
      lengthSec: tree.m_Length,
      compressionFormat: tree.m_CompressionFormat,
      compressionName: COMPRESSION[tree.m_CompressionFormat] || String(tree.m_CompressionFormat),
      resource: res,
    },
    payloadBytes: payload.length,
    sniffedFormat: fmt,
    magic: magic(payload),
  };
  const json = JSON.stringify(meta, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  console.log(json);

  const rawPath = path.join(OUT, `${TARGET_NAME}.${fmt}`);
  fs.writeFileSync(rawPath, payload);
  console.log('wrote', rawPath, payload.length);

  if (fmt === 'fsb') {
    const wav = await convertFsb(
      { data: new Uint8Array(payload), size: payload.length, channels: tree.m_Channels },
      FsbConvertFormat.WAV,
    );
    const wavPath = path.join(OUT, `${TARGET_NAME}.wav`);
    fs.writeFileSync(wavPath, Buffer.from(wav));
    console.log('wrote wav', wavPath, wav.length, magic(wav));
  }

  fs.writeFileSync(path.join(OUT, 'export-meta.json'), json);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
