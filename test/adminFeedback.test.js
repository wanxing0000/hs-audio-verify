const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { createAdminAuthenticator } = require('../src/services/adminAuth.js');
const {
  createMemoryFeedbackStore,
  createFeedbackService,
  createSupabaseFeedbackStore,
} = require('../src/services/feedbackService.js');
const { createFeedbackHandlers } = require('../src/services/feedbackAdmin.js');
const {
  loadProjectEnv,
  inspectSupabaseEnv,
  createSupabaseAdmin,
} = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

{
  const mig = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '004_feedback_management.sql'), 'utf8');
  assert.ok(mig.includes("status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')"));
  assert.ok(mig.includes("type IN ('BUG', 'FEATURE_REQUEST', 'CARD_DATA', 'AUDIO', 'OTHER')"));
  assert.ok(!/DROP TABLE/i.test(mig));
  const html = fs.readFileSync(path.join(ROOT, 'admin', 'feedback.html'), 'utf8');
  assert.ok(html.includes('href="/admin/feedback"'));
  assert.ok(html.includes('用户反馈'));
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', 'feedback.js')));
  const more = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'more', 'more.wxml'), 'utf8');
  assert.ok(more.includes('意见反馈'));
  console.log('ok admin feedback files');
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_ID = '33333333-3333-4333-8333-333333333333';
const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TEST_PREFIX = '[TEST_PHASE_1_5_19]';

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(blob));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
  assert.ok(!/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./.test(blob));
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

function jsonReq(port, options) {
  options = options || {};
  const payload = options.body != null ? JSON.stringify(options.body) : null;
  return new Promise(function (resolve, reject) {
    const headers = Object.assign({}, options.headers || {});
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: options.path,
      method: options.method || 'GET',
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
          handleFeedback: harness.handlers.handle,
          body: body,
        });
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(result.body == null ? '' : JSON.stringify(result.body));
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

function seedRows() {
  const rows = [];
  for (let i = 0; i < 25; i += 1) {
    const n = String(i).padStart(2, '0');
    rows.push({
      id: '11111111-1111-4111-8111-1111111110' + n,
      content: 'seeded feedback item number ' + n + ' with enough text',
      type: i % 2 === 0 ? 'BUG' : 'AUDIO',
      status: i < 5 ? 'OPEN' : (i < 10 ? 'IN_PROGRESS' : 'RESOLVED'),
      created_at: '2026-08-29T12:00:' + n + '.000Z',
      updated_at: '2026-08-29T12:00:' + n + '.000Z',
    });
  }
  rows.push({
    id: ID_A,
    content: 'detail target feedback message for admin view',
    type: 'CARD_DATA',
    status: 'OPEN',
    created_at: '2026-08-29T13:00:00.000Z',
    updated_at: '2026-08-29T13:00:00.000Z',
  });
  rows.push({
    id: ID_B,
    content: 'second detail row',
    type: 'FEATURE_REQUEST',
    status: 'CLOSED',
    created_at: '2026-08-29T11:00:00.000Z',
    updated_at: '2026-08-29T11:00:00.000Z',
  });
  return rows;
}

(async function () {
  const logs = [];
  const store = createMemoryFeedbackStore(seedRows());
  const service = createFeedbackService(store, {
    nowIso: function () { return '2026-08-29T14:00:00.000Z'; },
    newId: function () { return crypto.randomUUID(); },
  });
  const harness = {
    handlers: createFeedbackHandlers({
      service: service,
      writeLog: async function (entry) { logs.push(entry); },
    }),
  };

  await withServer(harness, async function (port) {
    const noTok = await jsonReq(port, { path: '/api/admin/feedback' });
    assert.strictEqual(noTok.status, 401);
    console.log('ok TEST 8 no token 401');

    const fake = await jsonReq(port, {
      path: '/api/admin/feedback',
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.strictEqual(fake.status, 401);
    console.log('ok TEST 9 fake token 401');

    const user = await jsonReq(port, {
      path: '/api/admin/feedback',
      headers: { Authorization: 'Bearer user-token' },
    });
    assert.strictEqual(user.status, 403);
    const inactive = await jsonReq(port, {
      path: '/api/admin/feedback',
      headers: { Authorization: 'Bearer inactive-token' },
    });
    assert.strictEqual(inactive.status, 403);
    console.log('ok TEST 10 non-admin 403');

    const list = await jsonReq(port, {
      path: '/api/admin/feedback',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.body.items));
    assert.ok(list.body.pagination);
    assertNoSecret(list.raw);
    console.log('ok TEST 11 admin list 200');

    const page2 = await jsonReq(port, {
      path: '/api/admin/feedback?page=2&pageSize=10',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.strictEqual(page2.status, 200);
    assert.strictEqual(page2.body.pagination.page, 2);
    assert.strictEqual(page2.body.pagination.pageSize, 10);
    assert.strictEqual(page2.body.pagination.total, 27);
    assert.strictEqual(page2.body.pagination.totalPages, 3);
    assert.strictEqual(page2.body.items.length, 10);
    console.log('ok TEST 12 pagination');

    const open = await jsonReq(port, {
      path: '/api/admin/feedback?status=OPEN&pageSize=100',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.strictEqual(open.status, 200);
    assert.ok(open.body.items.length > 0);
    open.body.items.forEach(function (item) { assert.strictEqual(item.status, 'OPEN'); });
    console.log('ok TEST 13 status filter');

    const audio = await jsonReq(port, {
      path: '/api/admin/feedback?type=AUDIO&pageSize=100',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.strictEqual(audio.status, 200);
    assert.ok(audio.body.items.length > 0);
    audio.body.items.forEach(function (item) { assert.strictEqual(item.type, 'AUDIO'); });
    console.log('ok TEST 14 type filter');

    const detail = await jsonReq(port, {
      path: '/api/admin/feedback/' + ID_A,
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.item.id, ID_A);
    assert.ok(String(detail.body.item.message).includes('detail target'));
    console.log('ok TEST 15 get existing');

    const missing = await jsonReq(port, {
      path: '/api/admin/feedback/' + MISSING,
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.body.code, 'FEEDBACK_NOT_FOUND');
    console.log('ok TEST 16 missing 404');

    const patched = await jsonReq(port, {
      path: '/api/admin/feedback/' + ID_A,
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token' },
      body: { status: 'IN_PROGRESS' },
    });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.body.item.status, 'IN_PROGRESS');
    assert.strictEqual(patched.body.item.type, 'CARD_DATA');
    assert.strictEqual(patched.body.item.message, 'detail target feedback message for admin view');
    console.log('ok TEST 17 status OPEN → IN_PROGRESS');

    const badStatus = await jsonReq(port, {
      path: '/api/admin/feedback/' + ID_A,
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token' },
      body: { status: 'DONE' },
    });
    assert.strictEqual(badStatus.status, 400);
    assert.strictEqual(badStatus.body.code, 'FEEDBACK_STATUS_INVALID');
    console.log('ok TEST 18 invalid status');

    assert.strictEqual(patched.body.item.updatedAt, '2026-08-29T14:00:00.000Z');
    console.log('ok TEST 19 updated_at');

    const log = logs.filter(function (row) { return row.action === 'feedback.update_status'; })[0];
    assert.ok(log);
    assert.strictEqual(log.target_id, ID_A);
    assert.strictEqual(log.details.feedbackId, ID_A);
    assert.strictEqual(log.details.fromStatus, 'OPEN');
    assert.strictEqual(log.details.toStatus, 'IN_PROGRESS');
    assert.ok(!JSON.stringify(log).includes('admin-token'));
    assertNoSecret(JSON.stringify(log));
    console.log('ok TEST 20 admin_logs feedback.update_status');
  });

  const live = await runLiveDatabase();
  console.log('LIVE_FEEDBACK ' + live);
  scanForSecrets();
}()).catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(function () { process.exit(1); }, 200);
}).then(function () {
  setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
});

async function runLiveDatabase() {
  const flags = inspectSupabaseEnv(process.env);
  if (!flags.hasUrl || !flags.hasServiceRoleKey) {
    console.log('skip live feedback: supabase not configured');
    return 'skipped';
  }
  const client = createSupabaseAdmin();
  const probe = await client.from('feedback').select('id').limit(1);
  if (probe.error) {
    try {
      if (client.realtime && typeof client.realtime.disconnect === 'function') client.realtime.disconnect();
    } catch (_) {}
    console.log('skip live feedback readable: ' + String(probe.error.code || 'error'));
    return 'manual';
  }
  console.log('ok live feedback readable');

  async function withRetry(fn) {
    let last = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        const msg = String((e && e.message) || e);
        if (!/fetch failed|ConnectTimeout|UND_ERR_CONNECT_TIMEOUT/i.test(msg)) throw e;
        await new Promise(function (ok) { setTimeout(ok, 1500); });
      }
    }
    throw last;
  }

  const createdIds = [];
  const logIds = [];
  try {
    const store = createSupabaseFeedbackStore(client);
    const service = createFeedbackService(store, {
      newId: function () { return crypto.randomUUID(); },
    });
    let created;
    try {
      created = await withRetry(function () {
        return service.createFeedback({
          type: 'BUG',
          message: TEST_PREFIX + ' live insert check please ignore',
        });
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/check constraint|feedback_status_check|feedback_type_check|23514/i.test(msg) || String(e && e.code) === '23514') {
        console.log('live feedback insert blocked by legacy CHECK — apply migration 004');
        const legacy = await client.from('feedback').insert({
          content: TEST_PREFIX + ' live legacy write please ignore',
          type: 'bug',
          status: 'new',
        }).select('id,status,updated_at').single();
        if (legacy.error) throw legacy.error;
        createdIds.push(legacy.data.id);
        const before = legacy.data.updated_at;
        const upd = await client.from('feedback').update({ status: 'reviewing' }).eq('id', legacy.data.id).select('id,status,updated_at').single();
        if (upd.error) throw upd.error;
        assert.strictEqual(upd.data.status, 'reviewing');
        if (before) assert.ok(upd.data.updated_at);
        console.log('ok live legacy insert/update (004 not applied)');
        return 'manual';
      }
      throw e;
    }
    createdIds.push(created.id);
    assert.strictEqual(created.status, 'OPEN');
    console.log('ok live feedback insert');

    const before = created.updated_at;
    const updated = await withRetry(function () {
      return service.updateFeedbackStatus(created.id, 'IN_PROGRESS');
    });
    assert.strictEqual(updated.toStatus, 'IN_PROGRESS');
    assert.ok(updated.row.updatedAt);
    if (before) assert.notStrictEqual(updated.row.updatedAt, before);
    console.log('ok live feedback status update');

    const log = await withRetry(async function () {
      const r = await client.from('admin_logs').insert({
        admin_user_id: null,
        action: 'feedback.update_status',
        target_type: 'feedback',
        target_id: created.id,
        details: { feedbackId: created.id, fromStatus: 'OPEN', toStatus: 'IN_PROGRESS', note: TEST_PREFIX },
      }).select('id').single();
      if (r.error) throw r.error;
      return r;
    });
    logIds.push(log.data.id);
    console.log('ok live admin_logs insert');
  } finally {
    try {
      if (client.realtime && typeof client.realtime.disconnect === 'function') {
        client.realtime.disconnect();
      }
    } catch (_) {}
    if (logIds.length) {
      await client.from('admin_logs').delete().in('id', logIds);
    }
    await client.from('feedback').delete().like('content', TEST_PREFIX + '%');
    const leftover = await client.from('feedback').select('id').like('content', TEST_PREFIX + '%');
    if (leftover.error) throw leftover.error;
    assert.strictEqual((leftover.data || []).length, 0, 'TEST feedback rows remain');
    console.log('ok live feedback cleanup');
  }
  return 'verified';
}

function scanForSecrets() {
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const roots = ['admin', 'miniprogram', 'src', 'test', 'data/card-verification'];
  if (fs.existsSync(path.join(ROOT, 'public'))) roots.push('public');
  roots.forEach(function (rel) {
    walk(path.join(ROOT, rel)).forEach(function (file) {
      if (!/\.(js|cjs|html|css|json|md|wxml|wxss|sql)$/i.test(file)) return;
      const blob = fs.readFileSync(file, 'utf8');
      if (service) assert.ok(!blob.includes(service), 'service role leaked in ' + file);
      assert.ok(!/Authorization:\s*Bearer\s+eyJ[a-zA-Z0-9_-]{10,}/.test(blob), 'bearer token in ' + file);
    });
  });
  console.log('ok security scan: no service role / bearer token values');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  fs.readdirSync(dir).forEach(function (name) {
    if (name === 'node_modules' || name === '.git') return;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push.apply(out, walk(p));
    else out.push(p);
  });
  return out;
}
