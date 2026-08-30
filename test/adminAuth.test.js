const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  parseAuthorizationHeader,
  applyAdminCors,
  publicAdminHealth,
  createAdminAuthenticator,
} = require('../src/services/adminAuth.js');
const { loadProjectEnv, inspectSupabaseEnv } = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

const USER_ID = '11111111-1111-4111-8111-111111111111';

function redact(text) {
  return String(text || '')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}/g, '[redacted]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, '[redacted]');
}

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anon = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  if (anon) assert.ok(!blob.includes(anon), 'anon key leaked');
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
  assert.ok(!/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./.test(blob));
}

function mockAuth(lookupRow, user) {
  return createAdminAuthenticator({
    getUser: async () => ({
      data: { user: user || { id: USER_ID, email: 'admin@example.test' } },
      error: null,
    }),
    lookupAdmin: async () => ({ data: lookupRow, error: null }),
  });
}

function jsonReq(port, pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: pathname,
      method: 'GET',
      headers: headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
        resolve({ status: res.statusCode, raw: raw, body: body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function withAdminServer(auth, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      applyAdminCors(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (!url.pathname.startsWith('/api/admin/')) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const result = await auth.dispatchAdminRequest(req, url);
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(result.body == null ? '' : JSON.stringify(result.body));
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        await fn(port);
        server.close(() => resolve());
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

{
  const auth = createAdminAuthenticator({
    getUser: async () => ({ data: { user: null }, error: { message: 'x' } }),
    lookupAdmin: async () => ({ data: null, error: null }),
  });
  assert.strictEqual(typeof auth.authenticateAdminRequest, 'function');
  assert.strictEqual(typeof auth.dispatchAdminRequest, 'function');
  assert.strictEqual(typeof parseAuthorizationHeader, 'function');
  console.log('ok TEST 1 adminAuth module initialized');
}

{
  const r = parseAuthorizationHeader({ headers: {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.code, 'ADMIN_AUTH_REQUIRED');
  console.log('ok TEST 2 missing Authorization → 401');
}

{
  const r = parseAuthorizationHeader({ headers: { authorization: 'Basic abc' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.code, 'ADMIN_TOKEN_INVALID');
  const emptyBearer = parseAuthorizationHeader({ headers: { authorization: 'Bearer' } });
  assert.strictEqual(emptyBearer.status, 401);
  assert.strictEqual(emptyBearer.code, 'ADMIN_TOKEN_INVALID');
  console.log('ok TEST 3 Authorization format error → 401');
}

(async () => {
  const authInvalid = createAdminAuthenticator({
    getUser: async () => ({ data: { user: null }, error: { name: 'AuthApiError' } }),
    lookupAdmin: async () => { throw new Error('lookup should not run'); },
  });
  const invalid = await authInvalid.authenticateAdminRequest({
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.status, 401);
  assert.strictEqual(invalid.code, 'ADMIN_TOKEN_INVALID');
  console.log('ok TEST 4 invalid token → 401');

  const authMissing = mockAuth(null);
  const missing = await authMissing.authenticateAdminRequest({
    headers: { authorization: 'Bearer user-token' },
  });
  assert.strictEqual(missing.status, 403);
  assert.strictEqual(missing.code, 'ADMIN_USER_NOT_FOUND');
  console.log('ok TEST 5 auth user without admin_users → 403');

  const authInactive = mockAuth({
    user_id: USER_ID,
    role: 'admin',
    is_active: false,
    display_name: 'Off',
  });
  const inactive = await authInactive.authenticateAdminRequest({
    headers: { authorization: 'Bearer user-token' },
  });
  assert.strictEqual(inactive.status, 403);
  assert.strictEqual(inactive.code, 'ADMIN_INACTIVE');
  console.log('ok TEST 6 inactive admin → 403');

  const authRole = mockAuth({
    user_id: USER_ID,
    role: 'viewer',
    is_active: true,
    display_name: 'Nope',
  });
  const forbidden = await authRole.authenticateAdminRequest({
    headers: { authorization: 'Bearer user-token' },
  });
  assert.strictEqual(forbidden.status, 403);
  assert.strictEqual(forbidden.code, 'ADMIN_FORBIDDEN');
  console.log('ok TEST 7 role != admin → 403');

  const authOk = mockAuth({
    user_id: USER_ID,
    role: 'admin',
    is_active: true,
    display_name: 'Operator',
  });
  const ok = await authOk.authenticateAdminRequest({
    headers: { authorization: 'Bearer user-token' },
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.admin.userId, USER_ID);
  assert.strictEqual(ok.admin.role, 'admin');
  assert.strictEqual(ok.admin.displayName, 'Operator');
  const health = publicAdminHealth(ok);
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.service, 'admin-api');
  assert.strictEqual(health.authenticated, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(health, 'email'));
  assertNoSecret(JSON.stringify(health));
  console.log('ok TEST 8 active admin PASS');

  assertNoSecret(JSON.stringify(health));
  console.log('ok TEST 9 service_role not in API response');

  function walk(dir, acc) {
    const names = fs.readdirSync(dir);
    for (let i = 0; i < names.length; i++) {
      const p = path.join(dir, names[i]);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, acc);
      else if (/\.(js|json|wxml|wxss|html|map)$/.test(names[i])) acc.push(p);
    }
  }
  const frontend = [];
  walk(path.join(ROOT, 'miniprogram'), frontend);
  walk(path.join(ROOT, 'public'), frontend);
  for (let i = 0; i < frontend.length; i++) {
    const text = fs.readFileSync(frontend[i], 'utf8');
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|createSupabaseAdmin|createAdminAuthenticator/.test(text), frontend[i]);
    assertNoSecret(text);
  }
  console.log('ok TEST 10 service_role not in miniprogram/public');

  await withAdminServer(authOk, async (port) => {
    const noTok = await jsonReq(port, '/api/admin/health');
    assert.strictEqual(noTok.status, 401);
    assert.strictEqual(noTok.body.code, 'ADMIN_AUTH_REQUIRED');
    assertNoSecret(noTok.raw);
    console.log('ok TEST 11 GET /api/admin/health no token → 401');
  });

  const nonAdminAuth = mockAuth(null);
  await withAdminServer(nonAdminAuth, async (port) => {
    const res = await jsonReq(port, '/api/admin/health', { Authorization: 'Bearer user-token' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'ADMIN_USER_NOT_FOUND');
    assertNoSecret(res.raw);
    console.log('ok TEST 12 GET /api/admin/health non-admin → 403');
  });

  await withAdminServer(authOk, async (port) => {
    const res = await jsonReq(port, '/api/admin/health', { Authorization: 'Bearer user-token' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.service, 'admin-api');
    assert.strictEqual(res.body.admin.role, 'admin');
    assert.strictEqual(res.body.admin.userId, USER_ID);
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, 'access_token'));
    assertNoSecret(res.raw);
    console.log('ok TEST 13 GET /api/admin/health admin → 200');
  });

  await withAdminServer(authOk, async (port) => {
    const mini = await jsonReq(port, '/api/mini/health');
    assert.strictEqual(mini.status, 404);
  });

  const flags = inspectSupabaseEnv();
  if (flags.hasUrl && flags.hasServiceRoleKey) {
    const live = createAdminAuthenticator();
    const liveInvalid = await live.authenticateAdminRequest({
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    assert.strictEqual(liveInvalid.status, 401);
    assert.strictEqual(liveInvalid.code, 'ADMIN_TOKEN_INVALID');
    console.log('ok live invalid token against Supabase Auth → 401');
  }

  const src = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');
  assert.ok(src.includes('/api/admin/health') || src.includes('dispatchAdminRequest'));
  assert.ok(src.includes('/api/mini/latest'));
  assert.ok(src.includes("loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set.json'))"));
  assert.ok(!src.includes("from('latest_sets')"));

  console.log('ok adminAuth MANUAL REQUIRED: real Dashboard Auth user + admin_users row + browser login UI');
})().catch((e) => {
  console.error(redact(e && e.stack || e));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
}).then(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 200);
});
