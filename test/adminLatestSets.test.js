const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createAdminAuthenticator } = require('../src/services/adminAuth.js');
const { createLatestSetsHandlers } = require('../src/services/latestSetsAdmin.js');
const {
  createLatestSetRuntime,
  dbRowToLatestConfig,
  loadLatestRuntime,
} = require('../src/services/latestSetRuntime.js');
const { parseLatestSetConfig, filterLatestCards, loadLatestSetConfig } = require('../src/miniprogram/catalogAdapter.js');
const { loadProjectEnv, inspectSupabaseEnv, createSupabaseAdmin } = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_ID = '33333333-3333-4333-8333-333333333333';
const CURRENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NODATA_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const TEST_PREFIX = 'TEST_PHASE_1_5_13_';

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(blob));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
}

function seedRows() {
  return [
    {
      id: CURRENT_ID,
      set_code: 'ESCAPEFROM_VIOLET_HOLD',
      name_en: 'Escape from Violet Hold',
      name_zh: '逃离紫罗兰监狱',
      release_date: '2026-07-07',
      source: 'Blizzard',
      source_url: 'https://example.test/violet',
      verified: true,
      is_current: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: OTHER_ID,
      set_code: 'CORE',
      name_en: 'Core',
      name_zh: '核心',
      release_date: '2026-01-01',
      source: 'Blizzard',
      source_url: null,
      verified: false,
      is_current: false,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    },
    {
      id: NODATA_ID,
      set_code: TEST_PREFIX + 'NO_CARDS',
      name_en: 'No Cards',
      name_zh: '无卡牌',
      release_date: '2026-08-01',
      source: 'test',
      source_url: null,
      verified: false,
      is_current: false,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    },
  ];
}

const catalogCards = [
  { set: 'ESCAPEFROM_VIOLET_HOLD', id: 'v1' },
  { set: 'ESCAPEFROM_VIOLET_HOLD', id: 'v2' },
  { set: 'CORE', id: 'c1' },
  { set: 'CORE', id: 'c2' },
  { set: 'CORE', id: 'c3' },
];

function createHarness() {
  const rows = seedRows();
  const logs = [];
  const runtime = createLatestSetRuntime();
  runtime.setLatestSetConfig(dbRowToLatestConfig(rows[0], parseLatestSetConfig), 'db');
  let created = 0;
  const deps = {
    runtime: runtime,
    countInCatalog: function (code) {
      return filterLatestCards(catalogCards, code).length;
    },
    listSets: async function () { return rows.slice(); },
    getCurrent: async function () {
      return rows.filter(function (r) { return r.is_current === true; })[0] || null;
    },
    getSetById: async function (id) {
      return rows.filter(function (r) { return r.id === id; })[0] || null;
    },
    insertSet: async function (row) {
      created += 1;
      const item = Object.assign({
        id: 'dddddddd-dddd-4ddd-8ddd-' + String(created).padStart(12, '0'),
        created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:00Z',
      }, row);
      rows.push(item);
      return item;
    },
    updateSet: async function (id, patch) {
      const row = rows.filter(function (r) { return r.id === id; })[0];
      Object.assign(row, patch, { updated_at: '2026-08-29T01:00:00Z' });
      return row;
    },
    publishSet: async function (id) {
      const target = rows.filter(function (r) { return r.id === id; })[0];
      if (!target) return null;
      const prev = rows.filter(function (r) { return r.is_current === true; })[0];
      for (let i = 0; i < rows.length; i++) rows[i].is_current = rows[i].id === id;
      return { previous_set_code: prev && prev.id !== id ? prev.set_code : null };
    },
    writeLog: async function (entry) { logs.push(entry); },
    toRuntimeConfig: function (row) {
      return dbRowToLatestConfig(row, parseLatestSetConfig);
    },
  };
  return { rows: rows, logs: logs, runtime: runtime, handlers: createLatestSetsHandlers(deps) };
}

function createAuth() {
  return createAdminAuthenticator({
    getUser: async function (token) {
      if (token === 'admin-token') {
        return { data: { user: { id: ADMIN_ID, email: 'admin@example.test' } }, error: null };
      }
      if (token === 'user-token') {
        return { data: { user: { id: USER_ID, email: 'user@example.test' } }, error: null };
      }
      if (token === 'inactive-token') {
        return { data: { user: { id: INACTIVE_ID, email: 'off@example.test' } }, error: null };
      }
      return { data: { user: null }, error: { message: 'invalid' } };
    },
    lookupAdmin: async function (userId) {
      if (userId === ADMIN_ID) {
        return { data: { user_id: ADMIN_ID, role: 'admin', is_active: true, display_name: 'Op' }, error: null };
      }
      if (userId === INACTIVE_ID) {
        return { data: { user_id: INACTIVE_ID, role: 'admin', is_active: false, display_name: 'Off' }, error: null };
      }
      return { data: null, error: null };
    },
  });
}

function request(port, opts) {
  return new Promise(function (resolve, reject) {
    const payload = opts.body != null ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: opts.path,
      method: opts.method || 'GET',
      headers: headers,
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
        resolve({ status: res.statusCode, raw: raw, body: body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function withServer(harness, fn) {
  const auth = createAuth();
  return new Promise(function (resolve, reject) {
    const server = http.createServer(async function (req, res) {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/admin/')) {
        let body = {};
        if (req.method === 'POST' || req.method === 'PATCH') {
          body = await new Promise(function (ok, fail) {
            const chunks = [];
            req.on('data', function (c) { chunks.push(c); });
            req.on('end', function () {
              if (!chunks.length) return ok({});
              try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { fail(e); }
            });
            req.on('error', fail);
          });
        }
        const result = await auth.dispatchAdminRequest(req, url, {
          handleLatestSets: harness.handlers.handle,
          body: body,
        });
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(result.body == null ? '' : JSON.stringify(result.body));
        return;
      }
      if (url.pathname === '/api/mini/latest') {
        const cfg = harness.runtime.getLatestSetConfig();
        if (!cfg) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '最新扩展包配置无效', code: 'LATEST_SET_CONFIG_INVALID' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          set: cfg.set,
          total: filterLatestCards(catalogCards, cfg.set).length,
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', async function () {
      try {
        await fn(server.address().port);
        server.close(function () { resolve(); });
      } catch (e) {
        server.close(function () { reject(e); });
      }
    });
  });
}

function adminHeaders() {
  return { Authorization: 'Bearer admin-token' };
}

(async function () {
  const tmpJson = path.join(ROOT, 'tmp', 'latest-set-fallback-test.json');
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(tmpJson, JSON.stringify({
    set: 'ESCAPEFROM_VIOLET_HOLD',
    nameEn: 'Escape from Violet Hold',
    nameZh: '逃离紫罗兰监狱',
    releaseDate: '2026-07-07',
    source: 'local',
    sourceUrl: '',
    verified: true,
  }));

  const dbErrorClient = {
    from: function () {
      return {
        select: function () {
          return {
            eq: function () {
              return {
                maybeSingle: async function () {
                  return { data: null, error: { message: 'connection failed' } };
                },
              };
            },
          };
        },
      };
    },
  };
  const fallback = await loadLatestRuntime({
    parseLatestSetConfig: parseLatestSetConfig,
    loadLatestSetConfig: loadLatestSetConfig,
    jsonPath: tmpJson,
    client: dbErrorClient,
  });
  assert.strictEqual(fallback.getSource(), 'json-fallback');
  assert.strictEqual(fallback.getReason(), 'DB_ERROR');
  assert.strictEqual(fallback.getLatestSetConfig().set, 'ESCAPEFROM_VIOLET_HOLD');

  const noCurrentClient = {
    from: function () {
      return {
        select: function () {
          return {
            eq: function () {
              return {
                maybeSingle: async function () {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const none = await loadLatestRuntime({
    parseLatestSetConfig: parseLatestSetConfig,
    loadLatestSetConfig: loadLatestSetConfig,
    jsonPath: tmpJson,
    client: noCurrentClient,
  });
  assert.strictEqual(none.getReason(), 'DB_NO_CURRENT');
  assert.strictEqual(none.getLatestSetConfig(), null);
  assert.ok(none.getLatestSetError());

  const harness = createHarness();
  await withServer(harness, async function (port) {
    const t1 = await request(port, { path: '/api/admin/latest-sets' });
    assert.strictEqual(t1.status, 401);
    assertNoSecret(t1.raw);
    console.log('ok TEST 1 GET /api/admin/latest-sets 无 token → 401');

    const t2 = await request(port, {
      path: '/api/admin/latest-sets',
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.strictEqual(t2.status, 401);
    assertNoSecret(t2.raw);
    console.log('ok TEST 2 GET /api/admin/latest-sets 假 token → 401');

    const t3 = await request(port, { path: '/api/admin/latest-sets', headers: adminHeaders() });
    assert.strictEqual(t3.status, 200);
    assert.strictEqual(t3.body.ok, true);
    assert.ok(Array.isArray(t3.body.items));
    assert.ok(t3.body.items.length >= 2);
    assertNoSecret(t3.raw);
    console.log('ok TEST 3 GET /api/admin/latest-sets Admin → 200');

    const t4 = await request(port, { path: '/api/admin/latest-sets/current', headers: adminHeaders() });
    assert.strictEqual(t4.status, 200);
    assert.strictEqual(t4.body.item.set_code, 'ESCAPEFROM_VIOLET_HOLD');
    assert.strictEqual(t4.body.item.is_current, true);
    console.log('ok TEST 4 current latest 返回正确');

    const t5 = await request(port, {
      path: '/api/admin/latest-sets',
      method: 'POST',
      headers: adminHeaders(),
      body: {
        set_code: TEST_PREFIX + 'NEW',
        name_en: 'New Set',
        name_zh: '新扩展包',
        release_date: '2026-08-02',
        source: 'test',
        verified: true,
      },
    });
    assert.strictEqual(t5.status, 200);
    assert.strictEqual(t5.body.item.set_code, TEST_PREFIX + 'NEW');
    console.log('ok TEST 5 创建 latest set');

    assert.strictEqual(t5.body.item.is_current, false);
    const afterCreate = harness.rows.filter(function (r) { return r.is_current === true; });
    assert.strictEqual(afterCreate.length, 1);
    assert.strictEqual(afterCreate[0].set_code, 'ESCAPEFROM_VIOLET_HOLD');
    console.log('ok TEST 6 创建默认不是 current');

    const createdId = t5.body.item.id;
    const t7 = await request(port, {
      path: '/api/admin/latest-sets/' + createdId,
      method: 'PATCH',
      headers: adminHeaders(),
      body: { name_zh: '新扩展包（已改）', is_current: true },
    });
    assert.strictEqual(t7.status, 200);
    assert.strictEqual(t7.body.item.name_zh, '新扩展包（已改）');
    assert.strictEqual(t7.body.item.is_current, false);
    console.log('ok TEST 7 更新 latest set');

    const t8 = await request(port, {
      path: '/api/admin/latest-sets/' + createdId,
      method: 'PATCH',
      headers: adminHeaders(),
      body: { set_code: 'HACKED_SET' },
    });
    assert.strictEqual(t8.status, 409);
    assert.strictEqual(t8.body.code, 'SET_CODE_IMMUTABLE');
    const unchanged = harness.rows.filter(function (r) { return r.id === createdId; })[0];
    assert.strictEqual(unchanged.set_code, TEST_PREFIX + 'NEW');
    console.log('ok TEST 8 set_code 不允许危险修改');

    const t9 = await request(port, {
      path: '/api/admin/latest-sets/' + MISSING_ID + '/publish',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t9.status, 404);
    console.log('ok TEST 9 发布不存在 Set → 404');

    const t10 = await request(port, {
      path: '/api/admin/latest-sets/' + NODATA_ID + '/publish',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t10.status, 409);
    assert.strictEqual(t10.body.code, 'LATEST_SET_DATA_NOT_FOUND');
    console.log('ok TEST 10 发布 Catalog 中不存在的 Set → 409 LATEST_SET_DATA_NOT_FOUND');

    const t11 = await request(port, {
      path: '/api/admin/latest-sets/' + OTHER_ID + '/publish',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t11.status, 200);
    assert.strictEqual(t11.body.ok, true);
    assert.strictEqual(t11.body.item.set_code, 'CORE');
    console.log('ok TEST 11 发布合法 Set → success');

    const currents = harness.rows.filter(function (r) { return r.is_current === true; });
    assert.strictEqual(currents.length, 1);
    console.log('ok TEST 12 发布后只有一个 current');

    const old = harness.rows.filter(function (r) { return r.id === CURRENT_ID; })[0];
    assert.strictEqual(old.is_current, false);
    console.log('ok TEST 13 旧 current 变 false');

    const neu = harness.rows.filter(function (r) { return r.id === OTHER_ID; })[0];
    assert.strictEqual(neu.is_current, true);
    console.log('ok TEST 14 新 current 变 true');

    assert.strictEqual(harness.runtime.getLatestSetConfig().set, 'CORE');
    console.log('ok TEST 15 发布后 Mini runtime latest 更新');

    const t16 = await request(port, { path: '/api/mini/latest?page=1&pageSize=1' });
    assert.strictEqual(t16.status, 200);
    assert.strictEqual(t16.body.set, 'CORE');
    console.log('ok TEST 16 GET /api/mini/latest 使用新的 latest set');

    const publishLogs = harness.logs.filter(function (e) { return e.action === 'latest_set.publish'; });
    assert.strictEqual(publishLogs.length, 1);
    assert.strictEqual(publishLogs[0].target_type, 'latest_set');
    assert.strictEqual(publishLogs[0].target_id, OTHER_ID);
    assert.strictEqual(publishLogs[0].details.set_code, 'CORE');
    assert.strictEqual(publishLogs[0].details.previous_set_code, 'ESCAPEFROM_VIOLET_HOLD');
    assert.ok(!JSON.stringify(publishLogs[0]).includes('admin-token'));
    console.log('ok TEST 17 发布操作写入 admin_logs');

    const t18 = await request(port, {
      path: '/api/admin/latest-sets',
      headers: { Authorization: 'Bearer user-token' },
    });
    assert.strictEqual(t18.status, 403);
    console.log('ok TEST 18 普通 Auth 用户不能调用 Admin API');

    const t19 = await request(port, {
      path: '/api/admin/latest-sets',
      headers: { Authorization: 'Bearer inactive-token' },
    });
    assert.strictEqual(t19.status, 403);
    console.log('ok TEST 19 inactive admin 不能调用 Admin API');

    const t20 = await request(port, { path: '/api/mini/latest?page=1&pageSize=1' });
    assert.strictEqual(t20.status, 200);
    assert.strictEqual(t20.body.set, 'CORE');
    console.log('ok TEST 20 Mini API 不受 Admin Auth 影响');
  });

  const flags = inspectSupabaseEnv(process.env);
  if (flags.hasUrl && flags.hasServiceRoleKey) {
    const client = createSupabaseAdmin();
    try {
      await client.from('latest_sets').delete().like('set_code', TEST_PREFIX + '%');
      await client.from('latest_sets').delete().like('set_code', 'TEST_PHASE_1513_%');
      const current = await client.from('latest_sets').select('set_code').eq('is_current', true);
      if (!current.error && current.data) {
        assert.ok(current.data.every(function (row) { return row.set_code !== TEST_PREFIX + 'NO_CARDS'; }));
      }
      console.log('ok live leftover TEST_PHASE_1_5_13_ rows cleaned');
    } finally {
      try {
        if (client.realtime && typeof client.realtime.disconnect === 'function') {
          client.realtime.disconnect();
        }
      } catch (e) {}
    }
  }

  function walk(dir, acc) {
    fs.readdirSync(dir).forEach(function (name) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, acc);
      else if (/\.(js|html|css|json)$/.test(name)) acc.push(p);
    });
  }
  ['admin', path.join('src', 'miniprogram'), path.join('src', 'services'), 'test'].forEach(function (rel) {
    const files = [];
    walk(path.join(ROOT, rel), files);
    files.forEach(function (file) {
      if (path.basename(file) === '.env') return;
      const text = fs.readFileSync(file, 'utf8');
      const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      if (service) assert.ok(!text.includes(service), file);
      if (file.indexOf(path.join(ROOT, 'admin')) === 0) {
        assert.ok(!text.includes('SUPABASE_SERVICE_ROLE_KEY'), file);
      }
    });
  });
  console.log('ok security scan: no service_role in admin frontend');

  try { fs.unlinkSync(tmpJson); } catch (e) {}
  console.log('ok adminLatestSets');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(function () { process.exit(1); }, 200);
}).then(function () {
  setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
});
