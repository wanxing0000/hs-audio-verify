import fs from 'fs';
import path from 'path';
import { decompressLz4, decompressLzmaWithSize } from '@arkntools/unity-js-tools';

const NONE = 0, LZMA = 1, LZ4 = 2, LZ4_HC = 3;

class Reader {
  constructor(buf) {
    this.buf = Buffer.from(buf);
    this.pos = 0;
  }
  get position() { return this.pos; }
  seek(n) { this.pos = n; }
  move(n) { this.pos += n; }
  align(n) {
    const a = (n - (this.pos % n)) % n;
    if (a) this.pos += a;
  }
  ensure(n) {
    if (this.pos + n > this.buf.length) throw new Error(`oob ${this.pos}+${n}/${this.buf.length}`);
  }
  readU8() { this.ensure(1); return this.buf[this.pos++]; }
  readU16BE() { this.ensure(2); const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
  readU32BE() { this.ensure(4); const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  readI32BE() { this.ensure(4); const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  readU64BE() {
    this.ensure(8);
    const v = Number(this.buf.readBigUInt64BE(this.pos));
    this.pos += 8;
    return v;
  }
  readStringUntilZero() {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0) this.pos++;
    const s = this.buf.subarray(start, this.pos).toString('utf8');
    this.pos++;
    return s;
  }
  readBuffer(n) {
    this.ensure(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

function decompress(data, type, uncompressedSize) {
  if (type === NONE) return data;
  if (type === LZMA) return Buffer.from(decompressLzmaWithSize(new Uint8Array(data), uncompressedSize));
  if (type === LZ4 || type === LZ4_HC) return Buffer.from(decompressLz4(new Uint8Array(data), uncompressedSize));
  throw new Error('unsupported compression ' + type);
}

export function unpackUnityFS(filePath) {
  const r = new Reader(fs.readFileSync(filePath));
  const signature = r.readStringUntilZero();
  if (signature !== 'UnityFS') throw new Error('not UnityFS: ' + signature);
  const version = r.readU32BE();
  const unityVersion = r.readStringUntilZero();
  const unityRevision = r.readStringUntilZero();
  const size = r.readU64BE();
  const compressedBlocksInfoSize = r.readU32BE();
  const uncompressedBlocksInfoSize = r.readU32BE();
  const flags = r.readU32BE();
  if (version >= 7) r.align(16);
  const blockInfoBuf = r.readBuffer(compressedBlocksInfoSize);
  const infoUnc = decompress(blockInfoBuf, flags & 63, uncompressedBlocksInfoSize);
  const ir = new Reader(infoUnc);
  ir.move(16);
  const blockCount = ir.readI32BE();
  const blocks = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      uncompressedSize: ir.readU32BE(),
      compressedSize: ir.readU32BE(),
      flags: ir.readU16BE(),
    });
  }
  const nodeCount = ir.readI32BE();
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      offset: ir.readU64BE(),
      size: ir.readU64BE(),
      flags: ir.readU32BE(),
      path: ir.readStringUntilZero(),
    });
  }
  if (flags & 512) r.align(16);
  const parts = [];
  for (const b of blocks) {
    const compressed = r.readBuffer(b.compressedSize);
    parts.push(decompress(compressed, b.flags & 63, b.uncompressedSize));
  }
  const data = Buffer.concat(parts);
  const files = nodes.map((n) => ({
    ...n,
    data: data.subarray(n.offset, n.offset + n.size),
  }));
  return { signature, version, unityVersion, unityRevision, flags, nodes, files };
}

function extractPrintable(buf) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 4) out.push(Buffer.from(cur).toString('utf8'));
    cur = [];
  };
  for (const b of buf) {
    if (b >= 32 && b <= 126) cur.push(b);
    else flush();
  }
  flush();
  return out;
}

function searchBundle(filePath, needles) {
  const unpacked = unpackUnityFS(filePath);
  const hits = [];
  for (const f of unpacked.files) {
    const strings = extractPrintable(f.data);
    const matched = strings.filter((s) => needles.some((n) => s.toLowerCase().includes(n.toLowerCase())));
    // also raw index for exact needle
    const rawHits = [];
    for (const n of needles) {
      const pat = Buffer.from(n);
      let idx = f.data.indexOf(pat);
      while (idx !== -1) {
        const start = Math.max(0, idx - 80);
        const end = Math.min(f.data.length, idx + n.length + 120);
        const ctx = extractPrintable(f.data.subarray(start, end)).join(' | ');
        rawHits.push({ needle: n, offset: idx, ctx });
        idx = f.data.indexOf(pat, idx + 1);
      }
    }
    if (matched.length || rawHits.length) {
      hits.push({
        path: f.path,
        size: f.size,
        matched: [...new Set(matched)].slice(0, 80),
        rawHits: rawHits.slice(0, 40),
      });
    }
  }
  return {
    file: path.basename(filePath),
    unityVersion: unpacked.unityVersion,
    unityRevision: unpacked.unityRevision,
    nodes: unpacked.files.map((f) => ({ path: f.path, size: f.size })),
    hits,
  };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('unpack-search.mjs');
if (isMain) {
  const files = process.argv.slice(2);
  const needles = ['EX1_116', 'LeeroyJenkins', 'Leeroy', 'VO_Leeroy', 'VO_EX1_116', 'PlaySound'];
  const outDir = path.resolve('tmp', 'ex1_116');
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    console.log('search', f);
    const result = searchBundle(f, needles);
    const out = path.join(outDir, path.basename(f) + '.strings.json');
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      file: result.file,
      revision: result.unityRevision,
      nodes: result.nodes,
      hitFiles: result.hits.map((h) => ({ path: h.path, matched: h.matched.length, raw: h.rawHits.length })),
      sample: result.hits.flatMap((h) => h.rawHits.slice(0, 8)),
      matchedSample: result.hits.flatMap((h) => h.matched.slice(0, 20)),
    }, null, 2));
  }
}
