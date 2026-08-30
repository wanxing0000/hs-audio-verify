'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  loadProjectEnv,
  inspectSupabaseEnv,
  createSupabaseAdmin,
} = require('../src/services/supabaseClient.js');
const {
  fetchPostgrestOpenApi,
  definition,
  columnNames,
  isPrimaryKey,
  createAnonClient,
  isAnonDenied,
} = require('./supabaseSchemaInspect.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

const PREFIX = '[TEST_PHASE_1_5_19A]';
const MESSAGE = PREFIX + ' feedback integration verification';
const CARDS = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
const COLL = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.collectible.json');
const MINI = 'http://127.0.0.1:8767';

function redact(text) {
  return String(text || '')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}/g, '[redacted]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, '[redacted]');
}

function fail(message, extra) {
  const err = extra && extra.message ? redact(extra.message) : '';
  const code = extra && extra.code ? String(extra.code) : '';
  throw new Error(message + (code ? ' code=' + code : '') + (err ? ' ' + err : ''));
}

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anon = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  if (anon) assert.ok(!blob.includes(anon), 'anon key leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/.test(blob));
  assert.ok(!/Authorization:\s*Bearer\s+eyJ[a-zA-Z0-9_-]{10,}/.test(blob));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function jsonReq(pathname, options) {
  options = options || {};
  const payload = options.body != null ? JSON.stringify(options.body) : null;
  return new Promise(function (resolve, reject) {
    const url = new URL(pathname, MINI);
    const headers = Object.assign({}, options.headers || {});
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
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

function disconnect(client) {
  try {
    if (client && client.realtime && typeof client.realtime.disconnect === 'function') {
      client.realtime.disconnect();
    }
  } catch (e) {}
}

async function cleanup(client, ids, logIds) {
  if (logIds && logIds.length) {
    await client.from('admin_logs').delete().in('id', logIds);
  }
  if (ids && ids.length) {
    await client.from('feedback').delete().in('id', ids);
  }
  await client.from('feedback').delete().like('content', PREFIX + '%');
}

async function signInActiveAdmin(adminClient) {
  const admins = await adminClient.from('admin_users').select('user_id,role,is_active');
  if (admins.error) fail('admin_users read failed', admins.error);
  const active = (admins.data || []).filter(function (row) {
    return row.role === 'admin' && row.is_active === true;
  });
  if (!active.length) return { ok: false, reason: 'no active admin_users row' };
  const userId = active[0].user_id;
  const user = await adminClient.auth.admin.getUserById(userId);
  if (user.error || !user.data || !user.data.user || !user.data.user.email) {
    return { ok: false, reason: 'admin auth user email unavailable' };
  }
  const link = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: user.data.user.email,
  });
  if (link.error || !link.data || !link.data.properties || !link.data.properties.hashed_token) {
    return { ok: false, reason: 'generateLink failed' };
  }
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const { createClient } = require('@supabase/supabase-js');
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const verified = await authClient.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'email',
    });
    const session = verified && verified.data && verified.data.session;
    if (verified.error || !session || !session.access_token) {
      return { ok: false, reason: 'verifyOtp failed' };
    }
    return {
      ok: true,
      token: session.access_token,
      userId: userId,
    };
  } finally {
    disconnect(authClient);
  }
}

const flags = inspectSupabaseEnv(process.env);
if (!flags.hasUrl || !flags.hasServiceRoleKey || !flags.hasAnonKey) {
  console.log('BLOCKED feedbackDatabaseIntegration: Supabase env incomplete', {
    hasUrl: flags.hasUrl,
    hasServiceRoleKey: flags.hasServiceRoleKey,
    hasAnonKey: flags.hasAnonKey,
  });
  process.exitCode = 1;
} else {
  run().catch(function (e) {
    console.error(redact(e && e.stack || e));
    process.exitCode = 1;
    setTimeout(function () { process.exit(1); }, 200);
  }).then(function () {
    setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
  });
}

async function run() {
  console.log('ok env', {
    SUPABASE_URL: flags.hasUrl ? 'configured' : 'not configured',
    SUPABASE_SERVICE_ROLE_KEY: flags.hasServiceRoleKey ? 'configured' : 'not configured',
    SUPABASE_ANON_KEY: flags.hasAnonKey ? 'configured' : 'not configured',
  });

  const client = createSupabaseAdmin();
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
  let adminSession = null;
  try {
    const spec = await fetchPostgrestOpenApi();
    const fbDef = definition(spec, 'feedback');
    assert.ok(fbDef, 'OpenAPI feedback missing');
    const cols = columnNames(fbDef).slice().sort();
    const expected = ['admin_note', 'contact', 'content', 'created_at', 'id', 'status', 'type', 'updated_at'];
    expected.forEach(function (col) {
      assert.ok(cols.indexOf(col) !== -1, 'missing column ' + col);
    });
    assert.ok(isPrimaryKey(fbDef.properties.id));
    console.log('ok feedback OpenAPI columns', cols);

    const before = await client.from('feedback').select('id,content,type,status,created_at,updated_at', { count: 'exact' });
    if (before.error) fail('feedback readable failed', before.error);
    const beforeCount = before.count == null ? (before.data || []).length : before.count;
    const beforeIds = (before.data || []).map(function (row) { return row.id; }).sort();
    console.log('ok feedback readable count=' + beforeCount);

    const legacyStatus = await client.from('feedback').insert({
      content: PREFIX + ' legacy status probe',
      type: 'BUG',
      status: 'new',
    }).select('id').single();
    assert.ok(legacyStatus.error, 'legacy status new should fail after 004');
    if (legacyStatus.data && legacyStatus.data.id) createdIds.push(legacyStatus.data.id);
    console.log('ok status CHECK rejects new');

    const legacyType = await client.from('feedback').insert({
      content: PREFIX + ' legacy type probe',
      type: 'bug',
      status: 'OPEN',
    }).select('id').single();
    assert.ok(legacyType.error, 'legacy type bug should fail after 004');
    if (legacyType.data && legacyType.data.id) createdIds.push(legacyType.data.id);
    console.log('ok type CHECK rejects bug');

    const anon = createAnonClient();
    try {
      const denied = await anon.from('feedback').select('id,content,status').limit(5);
      assert.ok(isAnonDenied(denied), 'anon must not select feedback');
      assert.ok(
        String(denied.error && denied.error.code) === '42501' ||
        /permission denied/i.test(String(denied.error && denied.error.message)),
        'anon select should be 42501',
      );
      const anonInsert = await anon.from('feedback').insert({
        content: PREFIX + ' anon direct insert',
        type: 'BUG',
        status: 'OPEN',
      });
      assert.ok(anonInsert.error, 'anon must not insert feedback directly');
      console.log('ok RLS anon select/insert denied', { code: denied.error && denied.error.code });
    } finally {
      disconnect(anon);
    }

    const posted = await withRetry(function () {
      return jsonReq('/api/feedback', {
        method: 'POST',
        body: { type: 'BUG', message: MESSAGE },
      });
    });
    assertNoSecret(posted.raw);
    assert.strictEqual(posted.status, 200, redact(posted.raw));
    assert.strictEqual(posted.body.ok, true);
    assert.ok(posted.body.feedback && posted.body.feedback.id);
    assert.strictEqual(posted.body.feedback.status, 'OPEN');
    createdIds.push(posted.body.feedback.id);
    const testId = posted.body.feedback.id;
    console.log('ok POST /api/feedback id=' + testId);

    const row = await client.from('feedback').select('id,content,type,status,created_at,updated_at').eq('id', testId).maybeSingle();
    if (row.error) fail('read created feedback', row.error);
    assert.ok(row.data);
    assert.strictEqual(row.data.type, 'BUG');
    assert.strictEqual(row.data.content, MESSAGE);
    assert.strictEqual(row.data.status, 'OPEN');
    assert.ok(row.data.created_at);
    assert.ok(row.data.updated_at);
    console.log('ok real row type/status/timestamps');

    const noTok = await jsonReq('/api/admin/feedback');
    assert.strictEqual(noTok.status, 401);
    assertNoSecret(noTok.raw);
    console.log('ok GET /api/admin/feedback no token 401');

    const fake = await jsonReq('/api/admin/feedback', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.strictEqual(fake.status, 401);
    assertNoSecret(fake.raw);
    console.log('ok GET /api/admin/feedback fake token 401');

    adminSession = await signInActiveAdmin(client);
    if (!adminSession.ok) {
      fail('real admin session unavailable: ' + adminSession.reason);
    }
    const authHeader = { Authorization: 'Bearer ' + adminSession.token };
    const list = await jsonReq('/api/admin/feedback?page=1&pageSize=20', { headers: authHeader });
    assert.strictEqual(list.status, 200, redact(list.raw));
    assert.ok(Array.isArray(list.body.items));
    const found = (list.body.items || []).filter(function (item) { return item.id === testId; })[0];
    assert.ok(found, 'admin list missing test feedback');
    assert.ok(String(found.message).indexOf(PREFIX) !== -1);
    assertNoSecret(list.raw);
    console.log('ok GET /api/admin/feedback admin 200 saw test row');

    const openFilter = await jsonReq('/api/admin/feedback?status=OPEN&page=1&pageSize=100', { headers: authHeader });
    assert.strictEqual(openFilter.status, 200);
    assert.ok((openFilter.body.items || []).some(function (item) { return item.id === testId; }));
    (openFilter.body.items || []).forEach(function (item) { assert.strictEqual(item.status, 'OPEN'); });

    const typeFilter = await jsonReq('/api/admin/feedback?type=BUG&page=1&pageSize=100', { headers: authHeader });
    assert.strictEqual(typeFilter.status, 200);
    assert.ok((typeFilter.body.items || []).some(function (item) { return item.id === testId; }));
    (typeFilter.body.items || []).forEach(function (item) { assert.strictEqual(item.type, 'BUG'); });

    const closedFilter = await jsonReq('/api/admin/feedback?status=CLOSED&page=1&pageSize=100', { headers: authHeader });
    assert.strictEqual(closedFilter.status, 200);
    assert.ok(!(closedFilter.body.items || []).some(function (item) { return item.id === testId; }));

    const page = await jsonReq('/api/admin/feedback?page=1&pageSize=1', { headers: authHeader });
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.body.pagination.page, 1);
    assert.strictEqual(page.body.pagination.pageSize, 1);
    assert.ok(page.body.pagination.total >= 1);
    assert.ok(page.body.items.length <= 1);
    console.log('ok admin filters + pagination');

    const unauthPatch = await jsonReq('/api/admin/feedback/' + testId, {
      method: 'PATCH',
      body: { status: 'IN_PROGRESS' },
    });
    assert.strictEqual(unauthPatch.status, 401);
    console.log('ok PATCH no token 401');

    const badStatus = await jsonReq('/api/admin/feedback/' + testId, {
      method: 'PATCH',
      headers: authHeader,
      body: { status: 'new' },
    });
    assert.strictEqual(badStatus.status, 400);
    assert.strictEqual(badStatus.body.code, 'FEEDBACK_STATUS_INVALID');
    assertNoSecret(badStatus.raw);
    console.log('ok PATCH illegal status 400');

    const beforePatch = row.data.updated_at;
    const patched = await jsonReq('/api/admin/feedback/' + testId, {
      method: 'PATCH',
      headers: authHeader,
      body: { status: 'IN_PROGRESS' },
    });
    assert.strictEqual(patched.status, 200, redact(patched.raw));
    assert.strictEqual(patched.body.item.status, 'IN_PROGRESS');
    assert.strictEqual(patched.body.item.type, 'BUG');
    assert.strictEqual(patched.body.item.message, MESSAGE);
    assertNoSecret(patched.raw);
    console.log('ok PATCH status OPEN → IN_PROGRESS');

    const after = await client.from('feedback').select('status,updated_at,type,content').eq('id', testId).maybeSingle();
    if (after.error) fail('read patched feedback', after.error);
    assert.strictEqual(after.data.status, 'IN_PROGRESS');
    assert.strictEqual(after.data.type, 'BUG');
    assert.strictEqual(after.data.content, MESSAGE);
    assert.ok(after.data.updated_at);
    assert.notStrictEqual(after.data.updated_at, beforePatch);
    console.log('ok updated_at changed');

    const logs = await client.from('admin_logs')
      .select('id,admin_user_id,action,target_type,target_id,details')
      .eq('action', 'feedback.update_status')
      .eq('target_id', testId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (logs.error) fail('admin_logs read failed', logs.error);
    assert.ok(logs.data && logs.data.length, 'missing feedback.update_status audit');
    const audit = logs.data[0];
    logIds.push(audit.id);
    assert.strictEqual(audit.target_id, testId);
    assert.strictEqual(audit.admin_user_id, adminSession.userId);
    assert.strictEqual(audit.details.feedbackId, testId);
    assert.strictEqual(audit.details.fromStatus, 'OPEN');
    assert.strictEqual(audit.details.toStatus, 'IN_PROGRESS');
    assertNoSecret(JSON.stringify(audit));
    console.log('ok audit feedback.update_status');

    const health = await jsonReq('/api/mini/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.ok, true);
    const catalog = await jsonReq('/api/mini/catalog?page=1&pageSize=1');
    assert.strictEqual(catalog.body.total, 7263);
    const latest = await jsonReq('/api/mini/latest?page=1&pageSize=1');
    assert.strictEqual(latest.body.set, 'ESCAPEFROM_VIOLET_HOLD');
    assert.strictEqual(latest.body.total, 164);
    console.log('ok Mini regression');

    await cleanup(client, createdIds, logIds);
    const leftover = await client.from('feedback').select('id').like('content', PREFIX + '%');
    if (leftover.error) fail('leftover read failed', leftover.error);
    assert.strictEqual((leftover.data || []).length, 0);
    const afterRows = await client.from('feedback').select('id', { count: 'exact' });
    if (afterRows.error) fail('feedback recount failed', afterRows.error);
    const afterCount = afterRows.count == null ? (afterRows.data || []).length : afterRows.count;
    assert.strictEqual(afterCount, beforeCount, 'real feedback row count changed');
    const leftoverLogs = await client.from('admin_logs').select('id').eq('action', 'feedback.update_status').eq('target_id', testId);
    assert.strictEqual((leftoverLogs.data || []).length, 0);
    console.log('ok cleanup; real user rows untouched count=' + afterCount);

    const cardsSha = sha256File(CARDS);
    const collSha = sha256File(COLL);
    console.log('ok snapshot', {
      cardsBytes: fs.statSync(CARDS).size,
      cardsSha: cardsSha,
      collBytes: fs.statSync(COLL).size,
      collSha: collSha,
    });
    console.log('ok LIVE_FEEDBACK_INTEGRATION verified');
  } finally {
    try {
      await cleanup(client, createdIds, logIds);
    } catch (e) {
      console.error(redact(e && e.stack || e));
    }
    disconnect(client);
  }
}
