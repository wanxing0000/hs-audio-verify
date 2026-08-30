const crypto = require('crypto');

const VERSION_STATUSES = ['STAGED', 'VALIDATED', 'READY', 'ACTIVE', 'FAILED', 'RETIRED'];
const TRANSITIONS = {
  STAGED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['READY', 'FAILED'],
  READY: ['ACTIVE', 'FAILED'],
  ACTIVE: ['RETIRED', 'FAILED'],
  FAILED: ['STAGED'],
  RETIRED: [],
};

function versionError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.userMessage = message;
  return err;
}

function snapshotFingerprint(input) {
  const source = String((input && input.source) || '');
  const locale = String((input && input.locale) || '');
  const cardsSha256 = String((input && input.cardsSha256) || '');
  const collectibleSha256 = String((input && input.collectibleSha256) || '');
  return crypto
    .createHash('sha256')
    .update(source + '\n' + locale + '\n' + cardsSha256 + '\n' + collectibleSha256)
    .digest('hex');
}

function makeVersionLabel(input) {
  const fp = String((input && input.fingerprint) || '');
  const short = fp.slice(0, 12) || 'unknown';
  const build = input && input.build != null && String(input.build).trim() !== ''
    ? String(input.build).trim()
    : null;
  if (build) return 'hs-' + build + '-' + short;
  return 'hs-' + short;
}

function fieldsFromSnapshotMeta(meta) {
  meta = meta || {};
  const cards = meta.cards || {};
  const collectible = meta.collectible || {};
  const source = meta.source || 'hearthstonejson';
  const locale = meta.locale || 'zhCN';
  const build = meta.build == null || String(meta.build).trim() === '' ? null : String(meta.build).trim();
  const cardsSha256 = cards.sha256 || null;
  const collectibleSha256 = collectible.sha256 || null;
  if (!cardsSha256 || !collectibleSha256) {
    throw versionError('DATA_VERSION_INVALID', 'snapshot metadata 缺少 SHA-256');
  }
  const fingerprint = snapshotFingerprint({
    source: source,
    locale: locale,
    cardsSha256: cardsSha256,
    collectibleSha256: collectibleSha256,
  });
  return {
    source: source,
    locale: locale,
    build: build,
    cards_sha256: cardsSha256,
    collectible_sha256: collectibleSha256,
    cards_count: cards.entryCount != null ? Number(cards.entryCount) : null,
    collectible_count: collectible.entryCount != null ? Number(collectible.entryCount) : null,
    snapshot_fingerprint: fingerprint,
    snapshot_meta: {
      source: source,
      locale: locale,
      build: build,
      downloadedAt: cards.downloadedAt || collectible.downloadedAt || null,
      cards: {
        url: cards.url || null,
        etag: cards.etag || null,
        lastModified: cards.lastModified || null,
        contentLength: cards.contentLength != null ? cards.contentLength : null,
        sha256: cardsSha256,
        entryCount: cards.entryCount != null ? cards.entryCount : null,
        downloadedAt: cards.downloadedAt || null,
      },
      collectible: {
        url: collectible.url || null,
        etag: collectible.etag || null,
        lastModified: collectible.lastModified || null,
        contentLength: collectible.contentLength != null ? collectible.contentLength : null,
        sha256: collectibleSha256,
        entryCount: collectible.entryCount != null ? collectible.entryCount : null,
        downloadedAt: collectible.downloadedAt || null,
      },
    },
    version: makeVersionLabel({ build: build, fingerprint: fingerprint }),
  };
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || ('dv-' + Date.now());
}

function createMemoryDataVersionStore(seed) {
  const rows = (seed || []).slice();
  return {
    kind: 'memory',
    rows: rows,
    async insert(row) {
      const dup = rows.filter(function (r) {
        return r.snapshot_fingerprint === row.snapshot_fingerprint || r.version === row.version;
      })[0];
      if (dup) {
        const err = versionError('DATA_VERSION_DUPLICATE', '相同快照版本已存在');
        err.existing = dup;
        throw err;
      }
      rows.push(row);
      return row;
    },
    async findById(id) {
      return rows.filter(function (r) { return r.id === id; })[0] || null;
    },
    async findByFingerprint(fp) {
      return rows.filter(function (r) { return r.snapshot_fingerprint === fp; })[0] || null;
    },
    async list(limit) {
      const n = limit || 50;
      return rows.slice().sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }).slice(0, n);
    },
    async findByStatus(status) {
      return rows.filter(function (r) { return r.status === status; });
    },
    async update(id, patch) {
      const row = rows.filter(function (r) { return r.id === id; })[0];
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

function isUniqueViolation(err) {
  if (!err) return false;
  if (String(err.code) === '23505') return true;
  return /duplicate key|unique constraint/i.test(String(err.message || ''));
}

const VERSION_FIELDS =
  'id,version,status,source,locale,build,cards_sha256,collectible_sha256,cards_count,collectible_count,snapshot_fingerprint,snapshot_meta,created_at,updated_at';

function createSupabaseDataVersionStore(client) {
  return {
    kind: 'supabase',
    async insert(row) {
      const r = await client.from('data_versions').insert(row).select(VERSION_FIELDS).single();
      if (r.error) {
        if (isUniqueViolation(r.error)) {
          const err = versionError('DATA_VERSION_DUPLICATE', '相同快照版本已存在');
          err.cause = r.error;
          throw err;
        }
        throw r.error;
      }
      return r.data;
    },
    async findById(id) {
      const r = await client.from('data_versions').select(VERSION_FIELDS).eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      return r.data || null;
    },
    async findByFingerprint(fp) {
      const r = await client
        .from('data_versions')
        .select(VERSION_FIELDS)
        .eq('snapshot_fingerprint', fp)
        .maybeSingle();
      if (r.error) throw r.error;
      return r.data || null;
    },
    async list(limit) {
      const r = await client
        .from('data_versions')
        .select(VERSION_FIELDS)
        .order('created_at', { ascending: false })
        .limit(limit || 50);
      if (r.error) throw r.error;
      return r.data || [];
    },
    async findByStatus(status) {
      const r = await client.from('data_versions').select(VERSION_FIELDS).eq('status', status);
      if (r.error) throw r.error;
      return r.data || [];
    },
    async update(id, patch) {
      const r = await client.from('data_versions').update(patch).eq('id', id).select(VERSION_FIELDS).single();
      if (r.error) throw r.error;
      return r.data;
    },
  };
}

function canTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.indexOf(to) !== -1;
}

function createDataVersionService(store, options) {
  options = options || {};
  const nowIso = options.nowIso || function () { return new Date().toISOString(); };
  const makeId = options.newId || newId;

  async function findByFingerprint(fp) {
    if (!fp) return null;
    return store.findByFingerprint(fp);
  }

  async function getDataVersion(id) {
    if (!id) return null;
    return store.findById(id);
  }

  async function listDataVersions(limit) {
    return store.list(limit);
  }

  async function findByStatus(status) {
    if (typeof store.findByStatus === 'function') return store.findByStatus(status);
    const list = await store.list(200);
    return list.filter(function (row) { return row.status === status; });
  }

  async function findActive() {
    const rows = await findByStatus('ACTIVE');
    return (rows && rows[0]) || null;
  }

  async function createDataVersion(input) {
    input = input || {};
    const fromMeta = input.snapshotMeta
      ? fieldsFromSnapshotMeta(input.snapshotMeta)
      : null;
    const source = (input && input.source) || (fromMeta && fromMeta.source);
    const locale = (input && input.locale) || (fromMeta && fromMeta.locale);
    const cardsSha256 = (input && input.cardsSha256) || (fromMeta && fromMeta.cards_sha256);
    const collectibleSha256 = (input && input.collectibleSha256) || (fromMeta && fromMeta.collectible_sha256);
    if (!source || !locale || !cardsSha256 || !collectibleSha256) {
      throw versionError('DATA_VERSION_INVALID', '缺少 source/locale/SHA-256');
    }
    const fingerprint = (fromMeta && fromMeta.snapshot_fingerprint) || snapshotFingerprint({
      source: source,
      locale: locale,
      cardsSha256: cardsSha256,
      collectibleSha256: collectibleSha256,
    });
    const existing = await findByFingerprint(fingerprint);
    if (existing) return existing;

    const build = input && Object.prototype.hasOwnProperty.call(input, 'build')
      ? input.build
      : (fromMeta ? fromMeta.build : null);
    const version = (input && input.version) || makeVersionLabel({ build: build, fingerprint: fingerprint });
    const status = (input && input.status) || 'STAGED';
    if (status !== 'STAGED' && status !== 'FAILED') {
      throw versionError('DATA_VERSION_STATUS_INVALID', '新建版本只能是 STAGED');
    }
    const row = {
      id: (input && input.id) || makeId(),
      version: version,
      status: status,
      source: source,
      locale: locale,
      build: build == null || build === '' ? null : String(build),
      cards_sha256: cardsSha256,
      collectible_sha256: collectibleSha256,
      cards_count: input && input.cardsCount != null ? input.cardsCount : (fromMeta && fromMeta.cards_count),
      collectible_count: input && input.collectibleCount != null
        ? input.collectibleCount
        : (fromMeta && fromMeta.collectible_count),
      snapshot_fingerprint: fingerprint,
      snapshot_meta: (fromMeta && fromMeta.snapshot_meta) || input.snapshotMeta || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    try {
      return await store.insert(row);
    } catch (e) {
      if (e && e.code === 'DATA_VERSION_DUPLICATE') {
        const again = await findByFingerprint(fingerprint);
        if (again) return again;
      }
      throw e;
    }
  }

  async function updateDataVersionStatus(id, nextStatus) {
    if (VERSION_STATUSES.indexOf(nextStatus) === -1) {
      throw versionError('DATA_VERSION_STATUS_INVALID', '无效的数据版本状态');
    }
    const row = await getDataVersion(id);
    if (!row) throw versionError('DATA_VERSION_NOT_FOUND', '数据版本不存在');
    if (row.status === nextStatus) return row;
    if (!canTransition(row.status, nextStatus)) {
      throw versionError('DATA_VERSION_STATUS_INVALID', '不允许的状态迁移');
    }
    const updated = await store.update(id, { status: nextStatus, updated_at: nowIso() });
    return updated;
  }

  async function markValidated(id) {
    return updateDataVersionStatus(id, 'VALIDATED');
  }

  async function markReady(id) {
    return updateDataVersionStatus(id, 'READY');
  }

  async function markActive(id) {
    const others = await findByStatus('ACTIVE');
    for (let i = 0; i < (others || []).length; i++) {
      if (others[i].id !== id) {
        await updateDataVersionStatus(others[i].id, 'RETIRED');
      }
    }
    return updateDataVersionStatus(id, 'ACTIVE');
  }

  async function markFailed(id) {
    return updateDataVersionStatus(id, 'FAILED');
  }

  return {
    snapshotFingerprint: snapshotFingerprint,
    makeVersionLabel: makeVersionLabel,
    fieldsFromSnapshotMeta: fieldsFromSnapshotMeta,
    createDataVersion: createDataVersion,
    findByFingerprint: findByFingerprint,
    getDataVersion: getDataVersion,
    listDataVersions: listDataVersions,
    findByStatus: findByStatus,
    findActive: findActive,
    updateDataVersionStatus: updateDataVersionStatus,
    markValidated: markValidated,
    markReady: markReady,
    markActive: markActive,
    markFailed: markFailed,
  };
}

module.exports = {
  VERSION_STATUSES,
  TRANSITIONS,
  snapshotFingerprint,
  makeVersionLabel,
  fieldsFromSnapshotMeta,
  createMemoryDataVersionStore,
  createSupabaseDataVersionStore,
  createDataVersionService,
  versionError,
};
