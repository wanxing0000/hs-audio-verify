import fs from 'fs';

export class R {
  constructor(buf, le = false) {
    this.buf = buf;
    this.pos = 0;
    this.le = le;
  }
  seek(n) { this.pos = n; }
  align(n = 4) {
    const a = (n - (this.pos % n)) % n;
    if (a) this.pos += a;
  }
  u8() { return this.buf[this.pos++]; }
  i8() {
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }
  bool() { return this.u8() !== 0; }
  f32() {
    const v = this.le ? this.buf.readFloatLE(this.pos) : this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.le ? this.buf.readDoubleLE(this.pos) : this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }
  alignedCstr() {
    const n = this.i32();
    if (n < 0 || n > 1_000_000 || this.pos + n > this.buf.length) {
      throw new Error('bad aligned string ' + n + ' at ' + this.pos);
    }
    const s = this.bytes(n).toString('utf8');
    this.align(4);
    return s;
  }
  bytes(n) {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  u16() {
    const v = this.le ? this.buf.readUInt16LE(this.pos) : this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.le ? this.buf.readUInt32LE(this.pos) : this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.le ? this.buf.readInt32LE(this.pos) : this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i16() {
    const v = this.le ? this.buf.readInt16LE(this.pos) : this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i64() {
    const v = this.le ? this.buf.readBigInt64LE(this.pos) : this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
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
  const r = new R(buf, false);
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
  const nodeCount = r.i32();
  const stringBufSize = r.i32();
  const nodeSize = version >= 19 ? 32 : 24;
  if (nodeCount < 0 || nodeCount > 20000 || stringBufSize < 0 || stringBufSize > 5_000_000) {
    throw new Error(`bad typetree nodes=${nodeCount} str=${stringBufSize} at ${r.pos}`);
  }
  r.bytes(nodeCount * nodeSize);
  r.bytes(stringBufSize);
}

const COMMON_STRING = {
  0: 'AABB', 5: 'AnimationClip', 19: 'AnimationCurve', 34: 'AnimationState', 49: 'Array',
  55: 'Base', 60: 'BitField', 69: 'bitset', 76: 'bool', 81: 'char', 86: 'ColorRGBA',
  96: 'Component', 106: 'data', 111: 'deque', 117: 'double', 124: 'dynamic_array',
  138: 'FastPropertyName', 155: 'first', 161: 'float', 167: 'Font', 172: 'GameObject',
  183: 'Generic Mono', 196: 'GradientNEW', 208: 'GUID', 213: 'GUIStyle', 222: 'int',
  226: 'list', 231: 'long long', 241: 'map', 245: 'Matrix4x4f', 256: 'MdFour',
  263: 'MonoBehaviour', 277: 'MonoScript', 288: 'm_ByteSize', 299: 'm_Curve',
  307: 'm_EditorClassIdentifier', 331: 'm_EditorHideFlags', 349: 'm_Enabled',
  359: 'm_ExtensionPtr', 374: 'm_GameObject', 387: 'm_Index', 395: 'm_IsArray',
  405: 'm_IsStatic', 416: 'm_MetaFlag', 427: 'm_Name', 434: 'm_ObjectHideFlags',
  452: 'm_PrefabInternal', 469: 'm_PrefabParentObject', 490: 'm_Script',
  499: 'm_StaticEditorFlags', 519: 'm_Type', 526: 'm_Version', 536: 'Object',
  543: 'pair', 548: 'PPtr<Component>', 564: 'PPtr<GameObject>', 581: 'PPtr<Material>',
  596: 'PPtr<MonoBehaviour>', 616: 'PPtr<MonoScript>', 633: 'PPtr<Object>',
  646: 'PPtr<Prefab>', 659: 'PPtr<Sprite>', 672: 'PPtr<TextAsset>', 688: 'PPtr<Texture>',
  702: 'PPtr<Texture2D>', 718: 'PPtr<Transform>', 734: 'Prefab', 741: 'Quaternionf',
  753: 'Rectf', 759: 'RectInt', 767: 'RectOffset', 778: 'second', 785: 'set',
  789: 'short', 795: 'size', 800: 'SInt16', 807: 'SInt32', 814: 'SInt64', 821: 'SInt8',
  827: 'staticvector', 840: 'string', 847: 'TextAsset', 857: 'TextMesh', 866: 'Texture',
  874: 'Texture2D', 884: 'Transform', 894: 'TypelessData', 907: 'UInt16', 914: 'UInt32',
  921: 'UInt64', 928: 'UInt8', 934: 'unsigned int', 947: 'unsigned long long',
  966: 'unsigned short', 981: 'vector', 988: 'Vector2f', 997: 'Vector3f', 1006: 'Vector4f',
  1015: 'm_ScriptingClassIdentifier', 1042: 'Gradient', 1051: 'Type*', 1057: 'int2_storage',
  1070: 'int3_storage', 1083: 'BoundsInt', 1093: 'm_CorrespondingSourceObject',
  1121: 'm_PrefabInstance', 1138: 'm_PrefabAsset', 1152: 'FileSize', 1161: 'Hash128',
};

function ttString(stringBuf, offset) {
  if ((offset & 0x80000000) === 0) {
    let end = offset;
    while (end < stringBuf.length && stringBuf[end] !== 0) end++;
    return stringBuf.toString('utf8', offset, end);
  }
  const key = offset & 0x7fffffff;
  return COMMON_STRING[key] || String(key);
}

function readTypeTreeBlob(r, version) {
  const nodeCount = r.i32();
  const stringBufSize = r.i32();
  if (nodeCount < 0 || nodeCount > 20000 || stringBufSize < 0 || stringBufSize > 5_000_000) {
    throw new Error(`bad typetree nodes=${nodeCount} str=${stringBufSize} at ${r.pos}`);
  }
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const node = {
      version: r.u16(),
      level: r.u8(),
      typeFlag: r.u8(),
      typeStrOffset: r.u32(),
      nameStrOffset: r.u32(),
      size: r.i32(),
      index: r.i32(),
      metaFlag: r.i32(),
    };
    if (version >= 19) r.i64();
    nodes.push(node);
  }
  const stringBuf = Buffer.from(r.bytes(stringBufSize));
  for (const node of nodes) {
    node.type = ttString(stringBuf, node.typeStrOffset);
    node.name = ttString(stringBuf, node.nameStrOffset);
  }
  return nodes;
}

function typeTreeChildren(nodes, index) {
  const out = [nodes[index]];
  const level = nodes[index].level;
  for (let i = index + 1; i < nodes.length; i++) {
    if (nodes[i].level <= level) break;
    out.push(nodes[i]);
  }
  return out;
}

function readTypeTreeValue(nodes, r, ctx) {
  const node = nodes[ctx.index];
  let align = (node.metaFlag & 0x4000) !== 0;
  let value;
  switch (node.type) {
    case 'SInt8': value = r.i8(); break;
    case 'UInt8':
    case 'char': value = r.u8(); break;
    case 'short':
    case 'SInt16': value = r.i16(); break;
    case 'UInt16':
    case 'unsigned short': value = r.u16(); break;
    case 'int':
    case 'SInt32': value = r.i32(); break;
    case 'UInt32':
    case 'unsigned int':
    case 'Type*': value = r.u32(); break;
    case 'long long':
    case 'SInt64': value = r.i64().toString(); break;
    case 'UInt64':
    case 'unsigned long long':
    case 'FileSize': value = r.i64().toString(); break;
    case 'float': value = r.f32(); break;
    case 'double': value = r.f64(); break;
    case 'bool': value = r.bool(); break;
    case 'string': {
      value = r.alignedCstr();
      const toSkip = typeTreeChildren(nodes, ctx.index);
      ctx.index += toSkip.length - 1;
      break;
    }
    case 'TypelessData': {
      const size = r.i32();
      if (size < 0 || size > r.buf.length) throw new Error('bad TypelessData');
      r.bytes(size);
      ctx.index += 2;
      value = { byteSize: size };
      break;
    }
    default:
      if (ctx.index < nodes.length - 1 && nodes[ctx.index + 1].type === 'Array') {
        if ((nodes[ctx.index + 1].metaFlag & 0x4000) !== 0) align = true;
        const size = r.i32();
        const vector = typeTreeChildren(nodes, ctx.index);
        ctx.index += vector.length - 1;
        if (size < 0 || size > 20000) {
          value = { error: 'array too large', size };
          break;
        }
        const arrayValue = [];
        for (let i = 0; i < size; i++) {
          arrayValue.push(readTypeTreeValue(vector, r, { index: 3 }));
        }
        value = arrayValue;
      } else {
        const clz = typeTreeChildren(nodes, ctx.index);
        ctx.index += clz.length - 1;
        const classValue = {};
        for (let ctx2 = { index: 1 }; ctx2.index < clz.length; ctx2.index++) {
          const classNode = clz[ctx2.index];
          classValue[classNode.name] = readTypeTreeValue(clz, r, ctx2);
        }
        value = classValue;
      }
      break;
  }
  if (align) r.align(4);
  return value;
}

export function readObjectTypeTree(body, nodes) {
  if (!nodes || !nodes.length) return { error: 'no type tree nodes' };
  const r = new R(body, true);
  try {
    const result = {};
    for (let ctx = { index: 0 }; ctx.index < nodes.length; ctx.index++) {
      const node = nodes[ctx.index];
      result[node.name] = readTypeTreeValue(nodes, r, ctx);
    }
    return result.Base != null ? result.Base : result;
  } catch (e) {
    return { error: e.message, bytesRead: r.pos, byteSize: body.length };
  }
}

export function parseSerializedFile(buf, opts = {}) {
  const typeTrees = opts.typeTrees === true;
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
    if (header.version >= 17) {
      if (classId === 114 || scriptTypeIndex >= 0) r.bytes(16);
      r.bytes(16);
    } else if (header.version >= 13) {
      if (classId < 0) r.bytes(16);
      r.bytes(16);
    }
    let nodes = null;
    if (enableTypeTree) {
      if (typeTrees) nodes = readTypeTreeBlob(r, header.version);
      else skipTypeTree(r, header.version);
      if (header.version >= 21) {
        const depCount = r.i32();
        if (depCount >= 0 && depCount < 10000) {
          for (let d = 0; d < depCount; d++) r.i32();
        } else {
          r.pos -= 4;
        }
      }
    }
    types.push({ classId, stripped, scriptTypeIndex, nodes });
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
      classId: types[typeId]?.classId ?? null,
    });
  }
  return { header, unityVersion, targetPlatform, enableTypeTree, typeCount, types, objectCount, objects };
}

export function extractPrintable(buf) {
  let s = '';
  for (const b of buf) s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
  return s;
}

export function extractVoKeys(buf) {
  const text = extractPrintable(buf);
  const keys = [];
  const re = /(?:VO_[A-Za-z0-9_]+|[A-Za-z0-9_]+(?=\.wav))/g;
  let m;
  while ((m = re.exec(text))) keys.push(m[0]);
  return [...new Set(keys)];
}

export function alignedString(buf, pos) {
  const n = buf.readInt32LE(pos);
  pos += 4;
  if (n < 0 || n > 4096 || pos + n > buf.length) return { str: null, pos };
  const str = buf.subarray(pos, pos + n).toString('utf8');
  pos += n;
  pos += (4 - (pos % 4)) % 4;
  return { str, pos };
}

export function parseGameObject(buf) {
  const r = new R(buf, true);
  const count = r.i32();
  if (count < 0 || count > 32) return { name: null, comps: [] };
  const comps = [];
  for (let i = 0; i < count; i++) {
    comps.push({ fileId: r.i32(), pathId: r.i64().toString() });
  }
  r.align(4);
  r.i32(); // layer
  const nameLen = r.i32();
  if (nameLen < 0 || nameLen > 256 || r.pos + nameLen > buf.length) return { name: null, comps };
  const name = r.bytes(nameLen).toString('utf8');
  return { name, comps };
}

export function parseAssetBundleContainer(buf) {
  let pos = 0;
  const name = alignedString(buf, pos);
  if (!name.str) return { name: null, container: [], preload: [] };
  pos = name.pos;
  const preloadCount = buf.readInt32LE(pos);
  pos += 4;
  if (preloadCount < 0 || preloadCount > 200000) return { name: name.str, container: [], preload: [], error: 'bad preload' };
  const preload = [];
  for (let i = 0; i < preloadCount; i++) {
    const fileId = buf.readInt32LE(pos); pos += 4;
    const pathId = buf.readBigInt64LE(pos).toString(); pos += 8;
    preload.push({ fileId, pathId });
  }
  if (pos + 4 > buf.length) return { name: name.str, container: [], preload, error: 'truncated preload' };
  const containerCount = buf.readInt32LE(pos);
  pos += 4;
  if (containerCount < 0 || containerCount > 50000) {
    return { name: name.str, preloadCount, preload, container: [], error: 'bad container count ' + containerCount };
  }
  const container = [];
  for (let i = 0; i < containerCount; i++) {
    const key = alignedString(buf, pos);
    if (key.str == null) break;
    pos = key.pos;
    if (pos + 20 > buf.length) break;
    const preloadIndex = buf.readInt32LE(pos); pos += 4;
    const preloadSize = buf.readInt32LE(pos); pos += 4;
    const fileId = buf.readInt32LE(pos); pos += 4;
    const pathId = buf.readBigInt64LE(pos).toString(); pos += 8;
    container.push({ key: key.str, preloadIndex, preloadSize, fileId, pathId });
  }
  return { name: name.str, preloadCount, containerCount, container, preload };
}
