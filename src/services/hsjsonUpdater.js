const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const CARDS_URL = 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.json';
const COLLECTIBLE_URL = 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json';

const MIN_CARDS = 1000;
const MIN_COLLECTIBLE = 100;
const MIN_FIELD_RATIO = 0.8;
const MIN_ID_RATIO = 0.9;
const MIN_OVERLAP_RATIO = 0.9;
const MIN_COLLECTIBLE_TRUE_RATIO = 0.5;

function hsjsonError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.userMessage = message;
  return err;
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const v = headers.get(name);
    return v == null || v === '' ? null : String(v);
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === lower) {
      const v = headers[key];
      if (v == null || v === '') return null;
      return Array.isArray(v) ? String(v[0]) : String(v);
    }
  }
  return null;
}

function parseRemoteMeta(headers, url) {
  const etag = headerGet(headers, 'etag');
  const lastModified = headerGet(headers, 'last-modified');
  const lengthRaw = headerGet(headers, 'content-length');
  const range = headerGet(headers, 'content-range');
  const rangeTotal = range && /\/(\d+)\s*$/.exec(range);
  let contentLength = null;
  if (rangeTotal) {
    contentLength = Number(rangeTotal[1]);
  } else if (lengthRaw != null && /^\d+$/.test(String(lengthRaw).trim())) {
    contentLength = Number(String(lengthRaw).trim());
  }
  return {
    url: url,
    etag: etag,
    lastModified: lastModified,
    contentLength: contentLength,
  };
}

function remoteMetaComplete(meta) {
  return !!(meta && (meta.etag || meta.lastModified || meta.contentLength != null));
}

function normalizeEtag(etag) {
  if (etag == null || etag === '') return null;
  let s = String(etag).trim();
  if (/^W\//i.test(s)) s = s.slice(2).trim();
  return s;
}

function compareOne(remote, local) {
  const remoteEtag = normalizeEtag(remote && remote.etag);
  const localEtag = normalizeEtag(local && local.etag);
  if (remoteEtag && localEtag) {
    return { status: remoteEtag === localEtag ? 'unchanged' : 'changed', via: 'etag' };
  }
  if (remote.lastModified && local && local.lastModified) {
    return {
      status: remote.lastModified === local.lastModified ? 'unchanged' : 'changed',
      via: 'lastModified',
    };
  }
  const localLen = local && (local.contentLength != null ? local.contentLength : local.byteSize);
  if (remote.contentLength != null && localLen != null) {
    return {
      status: remote.contentLength === localLen ? 'unchanged' : 'changed',
      via: 'contentLength',
    };
  }
  return { status: 'unknown', via: null };
}

function combineStatus(a, b) {
  if (a.status === 'changed' || b.status === 'changed') return 'UPDATED_AVAILABLE';
  if (a.status === 'unknown' || b.status === 'unknown') return 'UNKNOWN';
  return 'UP_TO_DATE';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, byteSize: null, sha256: null, entryCount: null, mtime: null };
  }
  const st = fs.statSync(filePath);
  return {
    exists: true,
    byteSize: st.size,
    sha256: sha256File(filePath),
    entryCount: null,
    mtime: st.mtime.toISOString(),
  };
}

function readJsonArray(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw hsjsonError('VALIDATION_FAILED', '无法读取 JSON 文件');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw hsjsonError('VALIDATION_FAILED', 'JSON 无法解析');
  }
  if (!Array.isArray(parsed)) {
    throw hsjsonError('VALIDATION_FAILED', 'JSON 顶层必须是数组');
  }
  return parsed;
}

function ratioWith(arr, pred) {
  if (!arr.length) return 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (pred(arr[i])) n++;
  }
  return n / arr.length;
}

function assertUniqueIds(arr, label) {
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const id = arr[i] && arr[i].id;
    if (id == null || String(id).trim() === '') continue;
    const key = String(id);
    if (seen.has(key)) throw hsjsonError('VALIDATION_FAILED', label + ' ID 不唯一');
    seen.add(key);
  }
}

function validateCardsArray(cards, rules) {
  rules = rules || {};
  const minCards = rules.minCards != null ? rules.minCards : MIN_CARDS;
  if (!Array.isArray(cards)) throw hsjsonError('VALIDATION_FAILED', 'cards.json 顶层必须是数组');
  if (cards.length === 0) throw hsjsonError('VALIDATION_FAILED', 'cards.json 为空');
  if (cards.length <= minCards) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.json 数量过少');
  }
  assertUniqueIds(cards, 'cards.json');
  const objectRatio = ratioWith(cards, (c) => c && typeof c === 'object' && !Array.isArray(c));
  if (objectRatio < MIN_FIELD_RATIO) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.json 条目必须是对象');
  }
  const idRatio = ratioWith(cards, (c) => c && (c.id != null && String(c.id).trim() !== '' || c.dbfId != null));
  if (idRatio < MIN_ID_RATIO) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.json 缺少核心标识');
  }
  const setRatio = ratioWith(cards, (c) => c && c.set != null && String(c.set).trim() !== '');
  const typeRatio = ratioWith(cards, (c) => c && c.type != null && String(c.type).trim() !== '');
  if (setRatio < MIN_FIELD_RATIO || typeRatio < MIN_FIELD_RATIO) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.json 缺少 set/type');
  }
}

function validateCollectibleArray(collectible, rules) {
  rules = rules || {};
  const minCollectible = rules.minCollectible != null ? rules.minCollectible : MIN_COLLECTIBLE;
  if (!Array.isArray(collectible)) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.collectible.json 顶层必须是数组');
  }
  if (collectible.length === 0) throw hsjsonError('VALIDATION_FAILED', 'cards.collectible.json 为空');
  if (collectible.length <= minCollectible) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.collectible.json 数量过少');
  }
  const objectRatio = ratioWith(collectible, (c) => c && typeof c === 'object' && !Array.isArray(c));
  if (objectRatio < MIN_FIELD_RATIO) {
    throw hsjsonError('VALIDATION_FAILED', 'cards.collectible.json 条目必须是对象');
  }
  const trueRatio = ratioWith(collectible, (c) => c && c.collectible === true);
  if (trueRatio === 0 || trueRatio < MIN_COLLECTIBLE_TRUE_RATIO) {
    throw hsjsonError('VALIDATION_FAILED', 'collectible 数据不能明显为空');
  }
  assertUniqueIds(collectible, 'cards.collectible.json');
}

function crossValidate(cards, collectible, rules) {
  rules = rules || {};
  const minCollectible = rules.minCollectible != null ? rules.minCollectible : MIN_COLLECTIBLE;
  const minOverlap = rules.minOverlapRatio != null ? rules.minOverlapRatio : MIN_OVERLAP_RATIO;
  if (cards.length < collectible.length) {
    throw hsjsonError('VALIDATION_FAILED', 'cards 数量不能小于 collectible');
  }
  const ids = new Set();
  for (let i = 0; i < cards.length; i++) {
    const id = cards[i] && cards[i].id;
    if (id != null && String(id).trim() !== '') ids.add(String(id));
  }
  let overlapCount = 0;
  for (let i = 0; i < collectible.length; i++) {
    const id = collectible[i] && collectible[i].id;
    if (id != null && ids.has(String(id))) overlapCount++;
  }
  const overlapRatio = collectible.length ? overlapCount / collectible.length : 0;
  if (collectible.length > minCollectible && overlapRatio < minOverlap) {
    throw hsjsonError('VALIDATION_FAILED', 'cards 与 collectible 几乎没有 ID overlap');
  }
  return {
    cardsCount: cards.length,
    collectibleCount: collectible.length,
    overlapCount: overlapCount,
    overlapRatio: overlapRatio,
  };
}

function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e && (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'EEXIST')) {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      return;
    }
    throw e;
  }
}

function rmIfExists(p) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {}
}

function rmDirIfExists(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
}

async function streamToFile(res, dest, fetchBody) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  if (typeof res.bodyText === 'string') {
    await fs.promises.writeFile(dest, res.bodyText);
    return;
  }
  if (Buffer.isBuffer(res.body)) {
    await fs.promises.writeFile(dest, res.body);
    return;
  }
  const ws = fs.createWriteStream(dest);
  const body = fetchBody == null ? res.body : fetchBody;
  if (!body) {
    ws.destroy();
    throw hsjsonError('DOWNLOAD_FAILED', '响应没有正文');
  }
  try {
    if (typeof body.getReader === 'function') {
      await pipeline(Readable.fromWeb(body), ws);
    } else {
      await pipeline(body, ws);
    }
  } catch (e) {
    try { ws.destroy(); } catch (err) {}
    rmIfExists(dest);
    throw hsjsonError('DOWNLOAD_FAILED', '下载中断');
  }
}

function createHsjsonUpdater(options) {
  options = options || {};
  const rootDir = options.rootDir || process.cwd();
  const fetchImpl = options.fetch || global.fetch;
  const nowIso = options.nowIso || function () { return new Date().toISOString(); };
  const newId = options.newId || function () {
    return (crypto.randomUUID && crypto.randomUUID()) || ('t' + Date.now());
  };
  const prodDir = options.prodDir || path.join(rootDir, 'data', 'hearthstonejson', 'zhCN');
  const stagingRoot = options.stagingRoot || path.join(rootDir, 'tmp', 'hsjson-update');
  const cardsUrl = options.cardsUrl || CARDS_URL;
  const collectibleUrl = options.collectibleUrl || COLLECTIBLE_URL;
  const replaceFile = options.replaceFile || moveFile;
  const writeFileSyncImpl = options.writeFileSync || fs.writeFileSync.bind(fs);
  const rules = {
    minCards: options.minCards,
    minCollectible: options.minCollectible,
    minOverlapRatio: options.minOverlapRatio,
  };

  const paths = {
    cards: path.join(prodDir, 'cards.json'),
    collectible: path.join(prodDir, 'cards.collectible.json'),
    meta: path.join(prodDir, 'snapshot-meta.json'),
  };

  function readMetaFile() {
    if (!fs.existsSync(paths.meta)) return null;
    try {
      return JSON.parse(fs.readFileSync(paths.meta, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  function inspectLocalSnapshot(inspectOpts) {
    inspectOpts = inspectOpts || {};
    const parseEntries = inspectOpts.parseEntries !== false;
    const meta = readMetaFile();
    const cards = fileInfo(paths.cards);
    const collectible = fileInfo(paths.collectible);
    if (parseEntries && cards.exists) {
      try { cards.entryCount = readJsonArray(paths.cards).length; } catch (e) { cards.entryCount = null; }
    }
    if (parseEntries && collectible.exists) {
      try { collectible.entryCount = readJsonArray(paths.collectible).length; } catch (e) { collectible.entryCount = null; }
    }
    return {
      cards: Object.assign({}, cards, meta && meta.cards ? {
        etag: meta.cards.etag || null,
        lastModified: meta.cards.lastModified || null,
        contentLength: meta.cards.contentLength != null ? meta.cards.contentLength : cards.byteSize,
        url: meta.cards.url || cardsUrl,
      } : {
        etag: null,
        lastModified: null,
        contentLength: cards.byteSize,
        url: cardsUrl,
      }),
      collectible: Object.assign({}, collectible, meta && meta.collectible ? {
        etag: meta.collectible.etag || null,
        lastModified: meta.collectible.lastModified || null,
        contentLength: meta.collectible.contentLength != null ? meta.collectible.contentLength : collectible.byteSize,
        url: meta.collectible.url || collectibleUrl,
      } : {
        etag: null,
        lastModified: null,
        contentLength: collectible.byteSize,
        url: collectibleUrl,
      }),
      meta: meta,
    };
  }

    async function fetchMeta(url, method) {
      const res = await fetchImpl(url, { method: method, redirect: 'follow' });
      return res;
    }

    async function abortBody(res) {
      if (!res || !res.body) return;
      try {
        if (typeof res.body.cancel === 'function') await res.body.cancel();
        else if (typeof res.body.destroy === 'function') res.body.destroy();
      } catch (e) {}
    }

    async function headOrGetMeta(url) {
    if (typeof fetchImpl !== 'function') {
      throw hsjsonError('REMOTE_UNAVAILABLE', '没有可用的 HTTP 客户端');
    }
    let res = null;
    try {
      res = await fetchMeta(url, 'HEAD');
    } catch (e) {
      res = null;
    }
    let meta = null;
    if (res && res.ok) {
      meta = parseRemoteMeta(res.headers, url);
      await abortBody(res);
    } else {
      const headFailed = !res || res.status === 405 || res.status === 501 || res.status === 403;
      if (res && !res.ok && !headFailed) {
        throw hsjsonError('REMOTE_UNAVAILABLE', '远程 HSJSON 不可用');
      }
    }
    if (meta && meta.contentLength != null) {
      return meta;
    }
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      if (meta) return meta;
      throw hsjsonError('REMOTE_UNAVAILABLE', '远程 HSJSON 不可用');
    }
    if (!res || !res.ok) {
      if (meta) return meta;
      throw hsjsonError('REMOTE_UNAVAILABLE', '远程 HSJSON 不可用');
    }
    const got = parseRemoteMeta(res.headers, url);
    await abortBody(res);
    return {
      url: url,
      etag: (got.etag || (meta && meta.etag)) || null,
      lastModified: (got.lastModified || (meta && meta.lastModified)) || null,
      contentLength: got.contentLength != null ? got.contentLength : (meta && meta.contentLength),
    };
  }

  async function checkRemoteSnapshot() {
    const local = inspectLocalSnapshot({ parseEntries: false });
    let remoteCards;
    let remoteCollectible;
    try {
      remoteCards = await headOrGetMeta(cardsUrl);
      remoteCollectible = await headOrGetMeta(collectibleUrl);
    } catch (e) {
      if (e && e.code === 'REMOTE_UNAVAILABLE') {
        return {
          status: 'UNKNOWN',
          changed: false,
          unknown: true,
          error: e.code,
          remote: { cards: null, collectible: null },
          local: local,
        };
      }
      throw e;
    }
    const cardsCmp = remoteMetaComplete(remoteCards)
      ? compareOne(remoteCards, local.cards)
      : { status: 'unknown', via: null };
    const collCmp = remoteMetaComplete(remoteCollectible)
      ? compareOne(remoteCollectible, local.collectible)
      : { status: 'unknown', via: null };
    const status = combineStatus(cardsCmp, collCmp);
    return {
      status: status,
      changed: status === 'UPDATED_AVAILABLE',
      unknown: status === 'UNKNOWN',
      remote: { cards: remoteCards, collectible: remoteCollectible },
      local: local,
      compare: { cards: cardsCmp, collectible: collCmp },
    };
  }

  async function downloadOne(url, dest) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', redirect: 'follow' });
    } catch (e) {
      throw hsjsonError('DOWNLOAD_FAILED', '下载失败');
    }
    if (!res || !res.ok) {
      throw hsjsonError('DOWNLOAD_FAILED', '下载失败');
    }
    const contentType = headerGet(res.headers, 'content-type');
    if (contentType && /text\/html/i.test(contentType)) {
      throw hsjsonError('DOWNLOAD_FAILED', '下载失败');
    }
    const meta = parseRemoteMeta(res.headers, url);
    await streamToFile(res, dest, res.body);
    const st = fs.statSync(dest);
    if (meta.contentLength != null && st.size !== meta.contentLength) {
      rmIfExists(dest);
      throw hsjsonError('DOWNLOAD_FAILED', '下载长度不匹配');
    }
    meta.sha256 = sha256File(dest);
    meta.byteSize = st.size;
    return meta;
  }

  async function downloadSnapshotToStaging(opts) {
    opts = opts || {};
    const id = opts.id || newId();
    const dir = path.join(stagingRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const cardsMeta = await downloadOne(cardsUrl, path.join(dir, 'cards.json'));
      const collectibleMeta = await downloadOne(collectibleUrl, path.join(dir, 'cards.collectible.json'));
      const { snapshotFingerprint } = require('./dataVersionService.js');
      const fingerprint = snapshotFingerprint({
        source: 'hearthstonejson',
        locale: 'zhCN',
        cardsSha256: cardsMeta.sha256,
        collectibleSha256: collectibleMeta.sha256,
      });
      const stagingMeta = {
        schemaVersion: 1,
        locale: 'zhCN',
        source: 'hearthstonejson',
        build: null,
        cardsBytes: cardsMeta.byteSize,
        collectibleBytes: collectibleMeta.byteSize,
        cardsSha256: cardsMeta.sha256,
        collectibleSha256: collectibleMeta.sha256,
        downloadedAt: nowIso(),
        fingerprint: fingerprint,
        cards: cardsMeta,
        collectible: collectibleMeta,
        stagingId: id,
      };
      fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(stagingMeta, null, 2));
      return { id: id, dir: dir, remote: stagingMeta, fingerprint: fingerprint };
    } catch (e) {
      rmDirIfExists(dir);
      throw e;
    }
  }

  function validateSnapshot(stagingDir) {
    const cards = readJsonArray(path.join(stagingDir, 'cards.json'));
    const collectible = readJsonArray(path.join(stagingDir, 'cards.collectible.json'));
    validateCardsArray(cards, rules);
    validateCollectibleArray(collectible, rules);
    const cross = crossValidate(cards, collectible, rules);
    return { ok: true, cards: cards, collectible: collectible, cross: cross };
  }

  function buildSnapshotMeta(stagingRemote, cardsPath, collectiblePath) {
    const downloadedAt = nowIso();
    const cardsArr = readJsonArray(cardsPath);
    const collArr = readJsonArray(collectiblePath);
    return {
      schemaVersion: 1,
      locale: 'zhCN',
      source: 'hearthstonejson',
      cards: {
        url: (stagingRemote.cards && stagingRemote.cards.url) || cardsUrl,
        etag: stagingRemote.cards && stagingRemote.cards.etag != null ? stagingRemote.cards.etag : null,
        lastModified: stagingRemote.cards && stagingRemote.cards.lastModified != null ? stagingRemote.cards.lastModified : null,
        contentLength: stagingRemote.cards && stagingRemote.cards.contentLength != null
          ? stagingRemote.cards.contentLength
          : fs.statSync(cardsPath).size,
        sha256: sha256File(cardsPath),
        entryCount: cardsArr.length,
        downloadedAt: downloadedAt,
      },
      collectible: {
        url: (stagingRemote.collectible && stagingRemote.collectible.url) || collectibleUrl,
        etag: stagingRemote.collectible && stagingRemote.collectible.etag != null ? stagingRemote.collectible.etag : null,
        lastModified: stagingRemote.collectible && stagingRemote.collectible.lastModified != null ? stagingRemote.collectible.lastModified : null,
        contentLength: stagingRemote.collectible && stagingRemote.collectible.contentLength != null
          ? stagingRemote.collectible.contentLength
          : fs.statSync(collectiblePath).size,
        sha256: sha256File(collectiblePath),
        entryCount: collArr.length,
        downloadedAt: downloadedAt,
      },
    };
  }

  function commitSnapshot(staging, validation, commitOpts) {
    commitOpts = commitOpts || {};
    const txId = staging.id;
    const bak = {
      cards: paths.cards + '.bak.' + txId,
      collectible: paths.collectible + '.bak.' + txId,
      meta: paths.meta + '.bak.' + txId,
    };
    const state = {
      backedUp: { cards: false, collectible: false, meta: false },
      replaced: { cards: false, collectible: false, meta: false },
    };

    function restore() {
      if (state.replaced.meta || state.backedUp.meta) {
        if (state.backedUp.meta && fs.existsSync(bak.meta)) {
          rmIfExists(paths.meta);
          moveFile(bak.meta, paths.meta);
        } else if (state.replaced.meta) {
          rmIfExists(paths.meta);
        }
      }
      if (state.replaced.collectible || state.backedUp.collectible) {
        if (state.backedUp.collectible && fs.existsSync(bak.collectible)) {
          rmIfExists(paths.collectible);
          moveFile(bak.collectible, paths.collectible);
        } else if (state.replaced.collectible && !state.backedUp.collectible) {
          rmIfExists(paths.collectible);
        }
      }
      if (state.replaced.cards || state.backedUp.cards) {
        if (state.backedUp.cards && fs.existsSync(bak.cards)) {
          rmIfExists(paths.cards);
          moveFile(bak.cards, paths.cards);
        } else if (state.replaced.cards && !state.backedUp.cards) {
          rmIfExists(paths.cards);
        }
      }
    }

    try {
      fs.mkdirSync(prodDir, { recursive: true });
      if (fs.existsSync(paths.cards)) {
        moveFile(paths.cards, bak.cards);
        state.backedUp.cards = true;
      }
      if (fs.existsSync(paths.collectible)) {
        moveFile(paths.collectible, bak.collectible);
        state.backedUp.collectible = true;
      }
      if (fs.existsSync(paths.meta)) {
        moveFile(paths.meta, bak.meta);
        state.backedUp.meta = true;
      }

      replaceFile(path.join(staging.dir, 'cards.json'), paths.cards);
      state.replaced.cards = true;
      replaceFile(path.join(staging.dir, 'cards.collectible.json'), paths.collectible);
      state.replaced.collectible = true;

      const snapshotMeta = buildSnapshotMeta(staging.remote || {}, paths.cards, paths.collectible);
      writeFileSyncImpl(paths.meta, JSON.stringify(snapshotMeta, null, 2));
      state.replaced.meta = true;

      readJsonArray(paths.cards);
      readJsonArray(paths.collectible);
      JSON.parse(fs.readFileSync(paths.meta, 'utf8'));

      rmIfExists(bak.cards);
      rmIfExists(bak.collectible);
      rmIfExists(bak.meta);
      if (!commitOpts.keepStaging) rmDirIfExists(staging.dir);
      return { ok: true, meta: snapshotMeta, cross: validation && validation.cross };
    } catch (e) {
      try { restore(); } catch (err) {}
      const wrapped = e && e.code && e.userMessage ? e : hsjsonError('COMMIT_FAILED', '提交快照失败');
      if (!wrapped.code || wrapped.code === 'VALIDATION_FAILED') {
        wrapped.code = 'COMMIT_FAILED';
      }
      throw wrapped;
    }
  }

  async function updateSnapshot() {
    let staging = null;
    try {
      staging = await downloadSnapshotToStaging();
      const validation = validateSnapshot(staging.dir);
      const committed = commitSnapshot(staging, validation);
      return {
        status: 'UPDATED',
        ok: true,
        cross: validation.cross,
        meta: committed.meta,
      };
    } catch (e) {
      if (staging && staging.dir) rmDirIfExists(staging.dir);
      const code = (e && e.code) || 'COMMIT_FAILED';
      return {
        status: 'FAILED',
        ok: false,
        code: code,
        error: (e && (e.userMessage || e.message)) || '更新失败',
        preserved: true,
      };
    }
  }

  function formatCheckLog(result) {
    const lines = [];
    lines.push('[hsjson] source=hearthstonejson locale=zhCN');
    const rc = result.remote && result.remote.cards;
    const lc = result.local && result.local.cards;
    const rcol = result.remote && result.remote.collectible;
    const lcol = result.local && result.local.collectible;
    lines.push('[hsjson] cards remote etag=' + (rc && rc.etag ? rc.etag : 'null'));
    lines.push('[hsjson] cards local sha256=' + (lc && lc.sha256 ? lc.sha256 : 'null'));
    lines.push('[hsjson] collectible remote etag=' + (rcol && rcol.etag ? rcol.etag : 'null'));
    lines.push('[hsjson] collectible local sha256=' + (lcol && lcol.sha256 ? lcol.sha256 : 'null'));
    lines.push('[hsjson] status=' + (result.status || 'UNKNOWN'));
    return lines.join('\n');
  }

  function formatUpdateLog(result, validation) {
    const lines = [];
    if (result.status === 'UPDATED') {
      const cross = result.cross || (validation && validation.cross) || {};
      lines.push('[hsjson] snapshot committed');
      lines.push('[hsjson] cards=' + (cross.cardsCount != null ? cross.cardsCount : ''));
      lines.push('[hsjson] collectible=' + (cross.collectibleCount != null ? cross.collectibleCount : ''));
      lines.push('[hsjson] overlap=' + (cross.overlapCount != null ? cross.overlapCount : ''));
      lines.push('[hsjson] status=UPDATED');
    } else {
      lines.push('[hsjson] status=FAILED');
      if (result.code) lines.push('[hsjson] error=' + result.code);
      lines.push('[hsjson] current snapshot preserved');
    }
    return lines.join('\n');
  }

  return {
    CARDS_URL: cardsUrl,
    COLLECTIBLE_URL: collectibleUrl,
    paths: paths,
    prodDir: prodDir,
    inspectLocalSnapshot: inspectLocalSnapshot,
    checkRemoteSnapshot: checkRemoteSnapshot,
    downloadSnapshotToStaging: downloadSnapshotToStaging,
    validateSnapshot: validateSnapshot,
    commitSnapshot: commitSnapshot,
    updateSnapshot: updateSnapshot,
    formatCheckLog: formatCheckLog,
    formatUpdateLog: formatUpdateLog,
    parseRemoteMeta: parseRemoteMeta,
    compareOne: compareOne,
    validateCardsArray: validateCardsArray,
    validateCollectibleArray: validateCollectibleArray,
    crossValidate: crossValidate,
  };
}

module.exports = {
  CARDS_URL,
  COLLECTIBLE_URL,
  createHsjsonUpdater,
  parseRemoteMeta,
  compareOne,
  validateCardsArray,
  validateCollectibleArray,
  crossValidate,
  hsjsonError,
  sha256File,
};
