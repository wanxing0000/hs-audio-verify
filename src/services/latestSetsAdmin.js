const { dbRowToLatestConfig } = require('./latestSetRuntime.js');

const SET_FIELDS = 'id,set_code,name_en,name_zh,release_date,source,source_url,verified,is_current,created_at,updated_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, code, error) {
  return { handled: true, status: status, body: { ok: false, error: error, code: code } };
}

function trimStr(v) {
  if (v == null) return '';
  return String(v).trim();
}

function publicItem(row, cardCount) {
  return {
    id: row.id,
    set_code: row.set_code,
    name_en: row.name_en,
    name_zh: row.name_zh,
    release_date: row.release_date || null,
    source: row.source || null,
    source_url: row.source_url || null,
    verified: row.verified === true,
    is_current: row.is_current === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    card_count: cardCount,
  };
}

function sortSets(items) {
  return items.slice().sort((a, b) => {
    const da = a.release_date ? Date.parse(a.release_date) : NaN;
    const db = b.release_date ? Date.parse(b.release_date) : NaN;
    const aOk = !Number.isNaN(da);
    const bOk = !Number.isNaN(db);
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    if (aOk && bOk && db !== da) return db - da;
    return String(a.set_code || '').localeCompare(String(b.set_code || ''));
  });
}

function parseId(pathname, suffix) {
  const prefix = '/api/admin/latest-sets/';
  if (pathname.indexOf(prefix) !== 0) return null;
  let rest = pathname.slice(prefix.length);
  if (suffix) {
    if (rest.length <= suffix.length) return null;
    if (rest.slice(-suffix.length) !== suffix) return null;
    rest = rest.slice(0, rest.length - suffix.length);
  }
  if (!UUID_RE.test(rest)) return null;
  return rest;
}

function isUniqueViolation(err) {
  if (!err) return false;
  if (String(err.code) === '23505') return true;
  return /duplicate key|unique constraint/i.test(String(err.message || ''));
}

function createLatestSetsHandlers(deps) {
  deps = deps || {};

  async function writeLog(auth, action, targetId, details) {
    if (typeof deps.writeLog !== 'function') return;
    try {
      await deps.writeLog({
        admin_user_id: auth.admin.userId,
        action: action,
        target_type: 'latest_set',
        target_id: targetId == null ? null : String(targetId),
        details: details || {},
      });
    } catch (e) {}
  }

  function cardCount(setCode) {
    try {
      const n = deps.countInCatalog(setCode);
      if (typeof n !== 'number' || Number.isNaN(n)) return null;
      return n;
    } catch (e) {
      return null;
    }
  }

  async function handle(req, url, auth, extras) {
    extras = extras || {};
    const pathname = url.pathname;
    if (pathname.indexOf('/api/admin/latest-sets') !== 0) return null;
    try {
      return await handleInner(req, url, auth, extras, pathname);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return fail(409, 'LATEST_SET_CONFLICT', '扩展包代码已存在');
      }
      return fail(500, 'ADMIN_INTERNAL', '操作失败，请检查服务器状态。');
    }
  }

  async function handleInner(req, url, auth, extras, pathname) {
    const body = extras.body || {};

    if (req.method === 'GET' && pathname === '/api/admin/latest-sets') {
      const rows = await deps.listSets();
      const items = sortSets(rows).map((row) => publicItem(row, cardCount(row.set_code)));
      return { handled: true, status: 200, body: { ok: true, items: items } };
    }

    if (req.method === 'GET' && pathname === '/api/admin/latest-sets/current') {
      const row = await deps.getCurrent();
      if (!row) return fail(404, 'LATEST_SET_NOT_CONFIGURED', '尚未设置最新扩展包');
      return {
        handled: true,
        status: 200,
        body: { ok: true, item: publicItem(row, cardCount(row.set_code)) },
      };
    }

    if (req.method === 'POST' && pathname === '/api/admin/latest-sets') {
      const set_code = trimStr(body.set_code);
      const name_en = trimStr(body.name_en);
      const name_zh = trimStr(body.name_zh);
      if (!set_code || !name_en || !name_zh) {
        return fail(400, 'LATEST_SET_INVALID', '扩展包代码和中英文名称不能为空');
      }
      const row = await deps.insertSet({
        set_code: set_code,
        name_en: name_en,
        name_zh: name_zh,
        release_date: trimStr(body.release_date) || null,
        source: trimStr(body.source) || null,
        source_url: trimStr(body.source_url) || null,
        verified: body.verified === true,
        is_current: false,
      });
      await writeLog(auth, 'latest_set.create', row.id, { set_code: row.set_code });
      return { handled: true, status: 200, body: { ok: true, item: publicItem(row, cardCount(row.set_code)) } };
    }

    const publishId = parseId(pathname, '/publish');
    if (req.method === 'POST' && publishId) {
      const target = await deps.getSetById(publishId);
      if (!target) return fail(404, 'LATEST_SET_NOT_FOUND', '扩展包不存在');
      const set_code = trimStr(target.set_code);
      const name_en = trimStr(target.name_en);
      const name_zh = trimStr(target.name_zh);
      if (!set_code || !name_en || !name_zh) {
        return fail(400, 'LATEST_SET_INVALID', '扩展包信息不完整');
      }
      if (!trimStr(target.release_date)) {
        return fail(400, 'LATEST_SET_INVALID', '扩展包信息不完整');
      }
      const catalogCount = cardCount(set_code);
      if (!catalogCount) {
        return fail(409, 'LATEST_SET_DATA_NOT_FOUND', '该扩展包尚未存在于当前卡牌数据中，无法发布。');
      }
      const current = await deps.getCurrent();
      const previous = current && current.set_code;
      const published = await deps.publishSet(publishId);
      if (published === null) {
        return fail(500, 'LATEST_SET_PUBLISH_FAILED', '发布失败，请检查服务器状态。');
      }
      const fresh = await deps.getSetById(publishId);
      if (!fresh || fresh.is_current !== true) {
        return fail(500, 'LATEST_SET_PUBLISH_FAILED', '发布失败，请检查服务器状态。');
      }
      try {
        const cfg = deps.toRuntimeConfig(fresh);
        deps.runtime.setLatestSetConfig(cfg, 'db');
        const got = deps.runtime.getLatestSetConfig();
        if (!got || got.set !== cfg.set) throw new Error('mismatch');
      } catch (e) {
        return fail(500, 'LATEST_SET_RUNTIME_REFRESH_FAILED', '发布失败，请检查服务器状态。');
      }
      await writeLog(auth, 'latest_set.publish', publishId, {
        set_code: set_code,
        previous_set_code: previous || null,
        card_count: catalogCount,
      });
      return {
        handled: true,
        status: 200,
        body: {
          ok: true,
          item: publicItem(fresh, catalogCount),
          previous_set_code: (published && published.previous_set_code) || previous || null,
        },
      };
    }

    const patchId = parseId(pathname, '');
    if (req.method === 'PATCH' && patchId && pathname === '/api/admin/latest-sets/' + patchId) {
      const existing = await deps.getSetById(patchId);
      if (!existing) return fail(404, 'LATEST_SET_NOT_FOUND', '扩展包不存在');
      if (body.set_code != null && trimStr(body.set_code) !== existing.set_code) {
        return fail(409, 'SET_CODE_IMMUTABLE', '扩展包代码创建后不可修改');
      }
      const patch = {};
      if (body.name_en != null) patch.name_en = trimStr(body.name_en);
      if (body.name_zh != null) patch.name_zh = trimStr(body.name_zh);
      if (body.release_date !== undefined) patch.release_date = trimStr(body.release_date) || null;
      if (body.source !== undefined) patch.source = trimStr(body.source) || null;
      if (body.source_url !== undefined) patch.source_url = trimStr(body.source_url) || null;
      if (body.verified !== undefined) patch.verified = body.verified === true;
      if (patch.name_en === '' || patch.name_zh === '') {
        return fail(400, 'LATEST_SET_INVALID', '扩展包代码和中英文名称不能为空');
      }
      const row = await deps.updateSet(patchId, patch);
      await writeLog(auth, 'latest_set.update', patchId, { set_code: row.set_code });
      if (row.is_current === true) {
        try {
          deps.runtime.setLatestSetConfig(deps.toRuntimeConfig(row), 'db');
        } catch (e) {}
      }
      return { handled: true, status: 200, body: { ok: true, item: publicItem(row, cardCount(row.set_code)) } };
    }

    return fail(404, 'ADMIN_NOT_FOUND', 'not found');
  }

  return { handle: handle };
}

function createSupabaseLatestSetsDeps(opts) {
  const client = opts.client;
  const runtime = opts.runtime;
  const parseLatestSetConfig = opts.parseLatestSetConfig;
  const filterLatestCards = opts.filterLatestCards;
  function getCatalogCards() {
    if (typeof opts.getCatalogCards === 'function') return opts.getCatalogCards();
    return opts.catalogCards || [];
  }

  function countInCatalog(setCode) {
    return filterLatestCards(getCatalogCards(), setCode).length;
  }

  async function listSets() {
    const r = await client.from('latest_sets').select(SET_FIELDS);
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function getCurrent() {
    const r = await client.from('latest_sets').select(SET_FIELDS).eq('is_current', true).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function getSetById(id) {
    const r = await client.from('latest_sets').select(SET_FIELDS).eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function insertSet(row) {
    const r = await client.from('latest_sets').insert(row).select(SET_FIELDS).single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function updateSet(id, patch) {
    const r = await client.from('latest_sets').update(patch).eq('id', id).select(SET_FIELDS).single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function publishSet(id) {
    const r = await client.rpc('publish_latest_set', { p_id: id });
    if (r.error) {
      const msg = String(r.error.message || '');
      if (msg.indexOf('LATEST_SET_NOT_FOUND') !== -1) return null;
      throw r.error;
    }
    return r.data;
  }

  async function writeLog(entry) {
    const r = await client.from('admin_logs').insert(entry);
    if (r.error) throw r.error;
  }

  return {
    runtime: runtime,
    countInCatalog: countInCatalog,
    listSets: listSets,
    getCurrent: getCurrent,
    getSetById: getSetById,
    insertSet: insertSet,
    updateSet: updateSet,
    publishSet: publishSet,
    writeLog: writeLog,
    toRuntimeConfig: function (row) {
      return dbRowToLatestConfig(row, parseLatestSetConfig);
    },
  };
}

module.exports = {
  createLatestSetsHandlers,
  createSupabaseLatestSetsDeps,
  publicItem,
  sortSets,
};
