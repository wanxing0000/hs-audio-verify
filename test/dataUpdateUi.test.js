const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { buildAdminConfigJs, resolveAdminAsset, tryHandleAdminStatic } = require('../src/miniprogram/adminStatic.js');
const { loadProjectEnv } = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(blob));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
}

function readAdmin(name) {
  return fs.readFileSync(path.join(ROOT, 'admin', name), 'utf8');
}

{
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', 'data.html')));
  assert.ok(fs.existsSync(path.join(ROOT, 'admin', 'data.js')));
  const resolved = resolveAdminAsset('/admin/data', ROOT);
  assert.ok(resolved && resolved.kind === 'file');
  assert.ok(String(resolved.file).replace(/\\/g, '/').endsWith('/admin/data.html'));
  console.log('ok TEST 1 /admin/data exists');
}

{
  const js = readAdmin('data.js');
  assert.ok(js.includes('requireAdmin'));
  assert.ok(js.includes("location.replace('/admin/login')"));
  console.log('ok TEST 2 login protection');
}

{
  const html = readAdmin('data.html');
  const js = readAdmin('data.js');
  assert.ok(html.includes('检查 HSJSON 更新'));
  assert.ok(html.includes('更新 HSJSON'));
  assert.ok(js.includes('检查 HSJSON 更新') || html.includes('id="check-btn"'));
  console.log('ok TEST 3 correct buttons');
}

{
  assertNoSecret(readAdmin('data.html'));
  assertNoSecret(readAdmin('data.js'));
  const cfg = buildAdminConfigJs({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_test_anon',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_should_never_appear_in_config',
  });
  assert.ok(!cfg.includes('sb_secret_should_never_appear_in_config'));
  console.log('ok TEST 4 no service role');
}

{
  const blob = readAdmin('data.html') + '\n' + readAdmin('data.js') + '\n' + readAdmin('index.html');
  assert.ok(!/一键更新全部数据/.test(blob));
  assert.ok(!/更新游戏数据/.test(blob));
  assert.ok(!/FULL DATA UPDATE/i.test(blob));
  assert.ok(!/一键更新/.test(blob));
  console.log('ok TEST 5 no FULL DATA UPDATE wording');
}

{
  const js = readAdmin('data.js');
  assert.ok(js.includes('loadLists()'));
  assert.ok(js.includes("remoteStatus !== 'UPDATED_AVAILABLE'"));
  assert.ok(js.includes('DATA_UPDATE_ALREADY_RUNNING'));
  const html = readAdmin('data.html');
  assert.ok(html.includes('id="update-btn"') && /update-btn"[^>]*disabled/.test(html.replace(/\n/g, ' ')));
  const pipeline = fs.readFileSync(path.join(ROOT, 'src', 'services', 'hsjsonUpdatePipeline.js'), 'utf8');
  assert.ok(pipeline.includes('run-phase08.cjs'));
  assert.ok(pipeline.includes('run-phase11.cjs'));
  assert.ok(!/run-phase08|index:voice/.test(js));
  console.log('ok TEST 6 UI refresh and pipeline orchestration');
}

{
  ['index.html', 'latest.html', 'data.html', 'feedback.html'].forEach(function (name) {
    assert.ok(readAdmin(name).includes('href="/admin/data"'));
  });
  console.log('ok TEST 7 sidebar link');
}

const fakeEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_should_never_appear_in_config',
};

function jsonReq(port, pathname) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: pathname,
      method: 'GET',
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async function () {
  await new Promise(function (resolve, reject) {
    const server = http.createServer(function (req, res) {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (tryHandleAdminStatic(req, url, res, ROOT, fakeEnv)) return;
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', async function () {
      try {
        const page = await jsonReq(server.address().port, '/admin/data');
        assert.strictEqual(page.status, 200);
        assert.ok(page.raw.includes('检查 HSJSON 更新'));
        assert.ok(page.raw.includes('更新 HSJSON'));
        assertNoSecret(page.raw);
        const cfg = await jsonReq(server.address().port, '/admin/config.js');
        assert.ok(!cfg.raw.includes('sb_secret_should_never_appear_in_config'));
        server.close(function () { resolve(); });
      } catch (e) {
        server.close(function () { reject(e); });
      }
    });
  });
  console.log('ok dataUpdateUi');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(function () { process.exit(1); }, 200);
}).then(function () {
  setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
});
