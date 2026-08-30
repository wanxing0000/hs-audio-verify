const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  createAdminAuthenticator,
  publicAdminStatus,
} = require('../src/services/adminAuth.js');
const {
  buildAdminConfigJs,
  resolveAdminAsset,
  tryHandleAdminStatic,
} = require('../src/miniprogram/adminStatic.js');
const { loadProjectEnv } = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

const USER_ID = '11111111-1111-4111-8111-111111111111';

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(blob));
  assert.ok(!/service_role/.test(blob));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
}

function walkAdmin() {
  const dir = path.join(ROOT, 'admin');
  const out = [];
  fs.readdirSync(dir).forEach((name) => {
    out.push(path.join(dir, name));
  });
  return out;
}

{
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', 'index.html')));
  console.log('ok TEST 1 Admin 页面文件存在');
}

{
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', 'login.html')));
  console.log('ok TEST 2 Login 页面存在');
}

{
  walkAdmin().forEach((p) => {
    if (fs.statSync(p).isFile()) assertNoSecret(fs.readFileSync(p, 'utf8'));
  });
  console.log('ok TEST 3 Admin 页面没有 service_role');
}

{
  walkAdmin().forEach((p) => {
    if (fs.statSync(p).isFile()) {
      assert.ok(!fs.readFileSync(p, 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY'));
    }
  });
  console.log('ok TEST 4 Admin 页面没有 SUPABASE_SERVICE_ROLE_KEY');
}

const fakeEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_should_never_appear_in_config',
};
const configJs = buildAdminConfigJs(fakeEnv);
assert.ok(configJs.includes('sb_publishable_test_anon'));
assert.ok(!configJs.includes('sb_secret_should_never_appear_in_config'));
assert.ok(!/SERVICE_ROLE/i.test(configJs));
assert.strictEqual(resolveAdminAsset('/admin/login', ROOT).kind, 'file');
assert.strictEqual(resolveAdminAsset('/admin/config.js', ROOT).kind, 'config');
assert.strictEqual(resolveAdminAsset('/admin/feedback', ROOT).kind, 'file');
assert.ok(String(resolveAdminAsset('/admin/feedback', ROOT).file).replace(/\\/g, '/').endsWith('/admin/feedback.html'));

const auth = createAdminAuthenticator({
  getUser: async (token) => {
    if (token === 'user-token') {
      return { data: { user: { id: USER_ID, email: 'a@example.test' } }, error: null };
    }
    return { data: { user: null }, error: { message: 'invalid' } };
  },
  lookupAdmin: async () => ({
    data: { user_id: USER_ID, role: 'admin', is_active: true, display_name: 'Op' },
    error: null,
  }),
});

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
        try { body = raw ? JSON.parse(raw) : raw; } catch (e) { body = raw; }
        resolve({ status: res.statusCode, raw: raw, body: body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/admin/')) {
        const result = await auth.dispatchAdminRequest(req, url, {
          getStatus: () => ({
            miniOk: true,
            catalogCount: 7263,
            latestSet: 'ESCAPEFROM_VIOLET_HOLD',
            latestCount: 164,
            supabaseConnected: true,
          }),
        });
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(result.body == null ? '' : JSON.stringify(result.body));
        return;
      }
      if (url.pathname === '/api/mini/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, service: 'mini-api' }));
        return;
      }
      if (url.pathname === '/api/mini/latest') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ set: 'ESCAPEFROM_VIOLET_HOLD', total: 164 }));
        return;
      }
      if (url.pathname === '/api/mini/catalog') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ total: 7263 }));
        return;
      }
      if (tryHandleAdminStatic(req, url, res, ROOT, fakeEnv)) return;
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', async () => {
      try {
        await fn(server.address().port);
        server.close(() => resolve());
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

(async () => {
  await withServer(async (port) => {
    const noTok = await jsonReq(port, '/api/admin/health');
    assert.strictEqual(noTok.status, 401);
    console.log('ok TEST 5 未认证 API 返回 401');

    const fake = await jsonReq(port, '/api/admin/health', { Authorization: 'Bearer not-a-real-token' });
    assert.strictEqual(fake.status, 401);
    console.log('ok TEST 6 伪造 token 返回 401');

    const stNo = await jsonReq(port, '/api/admin/status');
    assert.strictEqual(stNo.status, 401);
    console.log('ok TEST 7 Admin status 需要认证');

    const mini = await jsonReq(port, '/api/mini/health');
    assert.strictEqual(mini.status, 200);
    assert.strictEqual(mini.body.ok, true);
    console.log('ok TEST 8 Mini health 仍然公开');

    const latest = await jsonReq(port, '/api/mini/latest');
    assert.strictEqual(latest.status, 200);
    assert.strictEqual(latest.body.total, 164);
    console.log('ok TEST 9 Mini latest 仍然公开');

    const catalog = await jsonReq(port, '/api/mini/catalog');
    assert.strictEqual(catalog.status, 200);
    assert.strictEqual(catalog.body.total, 7263);
    console.log('ok TEST 10 Catalog API 仍然正常');

    const okStatus = await jsonReq(port, '/api/admin/status', { Authorization: 'Bearer user-token' });
    assert.strictEqual(okStatus.status, 200);
    assert.strictEqual(okStatus.body.catalog.count, 7263);
    assert.strictEqual(okStatus.body.latest.set, 'ESCAPEFROM_VIOLET_HOLD');
    assert.strictEqual(okStatus.body.latest.count, 164);
    assertNoSecret(okStatus.raw);
    assert.ok(!okStatus.raw.includes('access_token'));

    const loginPage = await jsonReq(port, '/admin/login');
    assert.strictEqual(loginPage.status, 200);
    assert.ok(String(loginPage.raw).includes('管理员登录'));
    assertNoSecret(loginPage.raw);

    const dash = await jsonReq(port, '/admin/');
    assert.strictEqual(dash.status, 200);
    assert.ok(String(dash.raw).includes('Dashboard'));

    const feedbackPage = await jsonReq(port, '/admin/feedback');
    assert.strictEqual(feedbackPage.status, 200);
    assert.ok(String(feedbackPage.raw).includes('用户反馈'));
    assertNoSecret(feedbackPage.raw);

    const cfg = await jsonReq(port, '/admin/config.js');
    assert.strictEqual(cfg.status, 200);
    assert.ok(!String(cfg.raw).includes('sb_secret_should_never_appear_in_config'));
  });

  const miniSrc = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');
  assert.ok(miniSrc.includes('/api/mini/health'));
  assert.ok(miniSrc.includes('/api/mini/latest'));
  assert.ok(miniSrc.includes('tryHandleAdminStatic'));
  assert.ok(miniSrc.includes("loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set.json'))"));
  assert.ok(!miniSrc.includes("from('latest_sets')"));
  console.log('ok TEST 11 Admin Auth 不影响 Mini API');

  const status = publicAdminStatus(
    { admin: { userId: USER_ID, role: 'admin', displayName: 'Op' } },
    { miniOk: true, catalogCount: 7263, latestSet: 'ESCAPEFROM_VIOLET_HOLD', latestCount: 164, supabaseConnected: true },
  );
  assert.strictEqual(status.ok, true);
  assertNoSecret(JSON.stringify(status));

  console.log('ok adminUi MANUAL REQUIRED: real Admin password login in browser');
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
}).then(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 200);
});
