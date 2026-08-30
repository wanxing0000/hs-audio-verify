import fs from 'fs';
import { unpackUnityFS } from './unpack-search.mjs';

class R {
  constructor(buf, le = false) {
    this.buf = buf;
    this.pos = 0;
    this.le = le;
  }
  get remain() { return this.buf.length - this.pos; }
  seek(n) { this.pos = n; }
  align(n = 4) {
    const a = (n - (this.pos % n)) % n;
    if (a) this.pos += a;
  }
  u8() { return this.buf[this.pos++]; }
  bytes(n) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  u16() {
    const v = this.le ? this.buf.readUInt16LE(this.pos) : this.buf.readUInt16BE(this.pos);
    this.pos += 2; return v;
  }
  u32() {
    const v = this.le ? this.buf.readUInt32LE(this.pos) : this.buf.readUInt32BE(this.pos);
    this.pos += 4; return v;
  }
  i32() {
    const v = this.le ? this.buf.readInt32LE(this.pos) : this.buf.readInt32BE(this.pos);
    this.pos += 4; return v;
  }
  i16() {
    const v = this.le ? this.buf.readInt16LE(this.pos) : this.buf.readInt16BE(this.pos);
    this.pos += 2; return v;
  }
  i64() {
    const v = this.le ? this.buf.readBigInt64LE(this.pos) : this.buf.readBigInt64BE(this.pos);
    this.pos += 8; return v;
  }
  u64() {
    const v = this.le ? this.buf.readBigUInt64LE(this.pos) : this.buf.readBigUInt64BE(this.pos);
    this.pos += 8; return Number(v);
  }
  cstr() {
    const s = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0) this.pos++;
    const out = this.buf.subarray(s, this.pos).toString('utf8');
    this.pos++;
    return out;
  }
}

function parseHeader(buf) {
  const r = new R(buf, false); // header is always big-endian
  const metadataSize0 = r.u32();
  const fileSize0 = r.u32();
  const version = r.u32();
  const dataOffset0 = r.u32();
  let endian = 0;
  if (version >= 9) {
    endian = r.u8();
    r.bytes(3);
  }
  let metadataSize = metadataSize0;
  let fileSize = fileSize0;
  let dataOffset = dataOffset0;
  if (version >= 22) {
    metadataSize = r.u32();
    fileSize = Number(r.i64());
    dataOffset = Number(r.i64());
    r.i64();
  }
  return {
    version,
    endian,
    le: endian === 0,
    metadataSize,
    fileSize,
    dataOffset,
    headerEnd: r.pos,
  };
}

function skipTypeTree(r, version) {
  // blob format: nodeCount, stringBufSize, nodes, strings
  const nodeCount = r.i32();
  const stringBufSize = r.i32();
  const nodeSize = version >= 19 ? 32 : 24;
  if (nodeCount < 0 || nodeCount > 20000 || stringBufSize < 0 || stringBufSize > 5_000_000) {
    throw new Error(`bad typetree nodes=${nodeCount} str=${stringBufSize} at ${r.pos}`);
  }
  r.bytes(nodeCount * nodeSize);
  r.bytes(stringBufSize);
  if (version >= 21) {
    // Ref type hash extra? some versions have extra int per node already in 32 bytes
  }
}

function parseSerialized(buf) {
  const header = parseHeader(buf);
  const r = new R(buf, header.le);
  r.seek(header.headerEnd);
  const unityVersion = r.cstr();
  const targetPlatform = r.i32();
  let enableTypeTree = true;
  if (header.version >= 13) enableTypeTree = r.u8() !== 0;

  const typeCount = r.i32();
  const types = [];
  for (let i = 0; i < typeCount; i++) {
    const classId = r.i32();
    let stripped = 0;
    let scriptTypeIndex = -1;
    if (header.version >= 16) {
      stripped = r.u8();
      scriptTypeIndex = r.i16();
    }
    let scriptId = null;
    if (header.version >= 17) {
      // if script
      if (classId === 114 || scriptTypeIndex >= 0) {
        scriptId = r.bytes(16);
      }
      r.bytes(16); // old type hash
    } else if (header.version >= 13) {
      if (classId < 0) r.bytes(16);
      r.bytes(16);
    }
    if (enableTypeTree) {
      skipTypeTree(r, header.version);
      if (header.version >= 21) {
        // dependencies?
        const depCount = r.i32();
        if (depCount >= 0 && depCount < 10000) {
          for (let d = 0; d < depCount; d++) r.i32();
        } else {
          r.pos -= 4;
        }
      }
    }
    types.push({ classId, stripped, scriptTypeIndex });
  }

  const objectCount = r.i32();
  const objects = [];
  for (let i = 0; i < objectCount; i++) {
    r.align(4);
    const pathId = r.i64().toString();
    const byteStart = header.version >= 22 ? Number(r.i64()) : r.u32();
    const byteSize = r.u32();
    const typeId = r.i32();
    objects.push({
      pathId,
      byteStart,
      absStart: header.dataOffset + byteStart,
      byteSize,
      typeId,
    });
  }
  return { header, unityVersion, targetPlatform, enableTypeTree, typeCount, types, objectCount, objects, metaPos: r.pos };
}

function extractPrintable(buf) {
  let s = '';
  for (const b of buf) s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
  return s;
}

const file = process.argv[2] || 'C:\\Hearthstone\\Data\\Win\\initial_base_global-775a814d-prefab-1.unity3d';
const unpacked = unpackUnityFS(file);
const cab = unpacked.files[0].data;
try {
  const parsed = parseSerialized(cab);
  console.log(JSON.stringify({
    header: parsed.header,
    unityVersion: parsed.unityVersion,
    targetPlatform: parsed.targetPlatform,
    enableTypeTree: parsed.enableTypeTree,
    typeCount: parsed.typeCount,
    classIds: parsed.types.map((t) => t.classId).slice(0, 30),
    objectCount: parsed.objectCount,
    metaPos: parsed.metaPos,
    firstObjects: parsed.objects.slice(0, 8),
    pathIdsSample: parsed.objects.slice(0, 15).map((o) => o.pathId),
  }, null, 2));

  const dumpObj = (label, obj) => {
    if (!obj) { console.log('missing', label); return; }
    const start = obj.absStart;
    const end = Math.min(cab.length, start + obj.byteSize);
    if (start < 0 || start >= cab.length) {
      console.log(label, 'bad range', start, obj.byteSize);
      return;
    }
    const slice = cab.subarray(start, end);
    const text = extractPrintable(slice);
    const vos = [...text.matchAll(/VO_[A-Za-z0-9_.]+/g)].map((m) => m[0]);
    console.log(label, 'pathId', obj.pathId, 'typeId', obj.typeId, 'off', start, 'size', obj.byteSize, 'vos', vos.slice(0, 8));
    if (vos.length) console.log('  ascii', text.replace(/\.+/g, '.').slice(0, 300));
  };

  dumpObj('index760', parsed.objects[760]);
  dumpObj('index892', parsed.objects[892]);
  dumpObj('index81', parsed.objects[81]);

  // GUID table: 56-byte records of [i32, i32=9, i32=0, 8 hash, i32=32, guid ascii]
  const guidNeedle = Buffer.from('abd4cfd794032624785f78a5de7da354');
  const gi = cab.indexOf(guidNeedle);
  const recStart = gi - 24;
  const rec = {
    a: cab.readInt32LE(recStart),
    b: cab.readInt32LE(recStart + 4),
    c: cab.readInt32LE(recStart + 8),
    guid: cab.subarray(gi, gi + 32).toString('ascii'),
  };
  console.log('guid record', rec);
  dumpObj('indexA', parsed.objects[rec.a]);
  dumpObj('indexAm1', parsed.objects[rec.a - 1]);
  dumpObj('indexAp1', parsed.objects[rec.a + 1]);

  const voHits = [];
  for (const obj of parsed.objects) {
    const start = obj.absStart;
    if (start < 0 || start >= cab.length) continue;
    const slice = cab.subarray(start, Math.min(cab.length, start + obj.byteSize));
    if (slice.includes(Buffer.from('VO_EX1_116'))) {
      const text = extractPrintable(slice);
      const vos = [...text.matchAll(/VO_[A-Za-z0-9_.]+/g)].map((m) => m[0]);
      voHits.push({ pathId: obj.pathId, typeId: obj.typeId, size: obj.byteSize, vos, idx: parsed.objects.indexOf(obj) });
    }
  }
  console.log('VO_EX1_116 objects', JSON.stringify(voHits, null, 2));
  const classOf = (typeId) => parsed.types[typeId]?.classId;
  const dumpRange = (from, to) => {
    for (let i = from; i <= to; i++) {
      const obj = parsed.objects[i];
      if (!obj) continue;
      const slice = cab.subarray(obj.absStart, Math.min(cab.length, obj.absStart + obj.byteSize));
      const text = extractPrintable(slice);
      const vos = [...text.matchAll(/VO_[A-Za-z0-9_.]+/g)].map((m) => m[0]);
      const names = [...text.matchAll(/[A-Za-z][A-Za-z0-9_]{2,40}/g)].map((m) => m[0]).filter((s) => !s.startsWith('m_')).slice(0, 6);
      console.log(i, 'class', classOf(obj.typeId), 'size', obj.byteSize, 'vos', vos, 'names', names);
    }
  };
  console.log('--- around Play VO idx 130 ---');
  dumpRange(120, 140);
  console.log('--- around GUID index 892 ---');
  dumpRange(885, 900);
  console.log('--- around Death VO idx 91 ---');
  dumpRange(85, 100);
  console.log('--- AssetBundle objects ---');
  parsed.objects.forEach((obj, i) => {
    if (classOf(obj.typeId) !== 142) return;
    const slice = cab.subarray(obj.absStart, Math.min(cab.length, obj.absStart + Math.min(obj.byteSize, 8000)));
    const text = extractPrintable(slice);
    const guids = [...text.matchAll(/[0-9a-f]{32}/g)].map((m) => m[0]).slice(0, 5);
    const names = [...text.matchAll(/[A-Za-z0-9_./-]{4,80}/g)].map((m) => m[0]).slice(0, 30);
    console.log('AssetBundle idx', i, 'size', obj.byteSize, 'pathId', obj.pathId);
    console.log(' names', names);
    console.log(' guids', guids);
    console.log(' has play guid', slice.includes(guidNeedle));
  });

  // parse GameObject name + component pathIds for idx 125
  const parseGO = (obj) => {
    const slice = Buffer.from(cab.subarray(obj.absStart, obj.absStart + obj.byteSize));
    const r = new R(slice, true);
    const count = r.i32();
    const comps = [];
    for (let i = 0; i < Math.min(count, 16); i++) {
      const fileId = r.i32();
      const pathId = r.i64().toString();
      comps.push({ fileId, pathId });
    }
    r.align(4);
    const layer = r.i32();
    const nameLen = r.i32();
    const name = r.bytes(Math.max(0, Math.min(64, nameLen))).toString('utf8');
    return { count, comps, layer, name };
  };
  console.log('GO125', parseGO(parsed.objects[125]));
  console.log('GO140', parseGO(parsed.objects[140]));
  console.log('GO891', parseGO(parsed.objects[891]));
  const ab = parsed.objects[522];
  console.log('AB abs', ab.absStart, 'end', ab.absStart + ab.byteSize, 'guidOff', gi, 'inside', gi >= ab.absStart && gi < ab.absStart + ab.byteSize);
  const abSlice = cab.subarray(ab.absStart, ab.absStart + ab.byteSize);
  const playCount = [...abSlice.toString('latin1').matchAll(/Play/g)].length;
  console.log('AB play string count', playCount, 'guid count', [...abSlice.toString('latin1').matchAll(/[0-9a-f]{32}/g)].length);
  const giLocal = gi - ab.absStart;
  console.log('guid local off in AB', giLocal);
  console.log('AB around guid', extractPrintable(abSlice.subarray(Math.max(0, giLocal - 40), giLocal + 80)));

  const byPath = new Map(parsed.objects.map((o, i) => [o.pathId, { ...o, idx: i }]));
  const follow = (pid, depth = 0) => {
    const o = byPath.get(pid);
    if (!o) return { pid, missing: true };
    const slice = cab.subarray(o.absStart, o.absStart + o.byteSize);
    const text = extractPrintable(slice);
    const vos = [...text.matchAll(/VO_[A-Za-z0-9_]+/g)].map((m) => m[0]);
    const nameMatch = text.match(/[A-Za-z][A-Za-z0-9_]{2,40}/);
    return { pid, idx: o.idx, class: classOf(o.typeId), size: o.byteSize, vos, name: nameMatch?.[0] };
  };
  console.log('Play125 comps', parseGO(parsed.objects[125]).comps.map((c) => follow(c.pathId)));
} catch (e) {
  console.error('PARSE FAIL', e.message, e.stack.split('\n').slice(0, 4).join('\n'));
}
