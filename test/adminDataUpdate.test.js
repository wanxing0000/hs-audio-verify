const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createAdminAuthenticator } = require('../src/services/adminAuth.js');
const {
  createMemoryDataVersionStore,
  createDataVersionService,
} = require('../src/services/dataVersionService.js');
const {
  createMemoryUpdateJobStore,
  createUpdateJobService,
} = require('../src/services/updateJobService.js');
const { snapshotFingerprint } = require('../src/services/dataVersionService.js');
const { createHsjsonSnapshotOrchestrator } = require('../src/services/hsjsonSnapshotJob.js');
const { createDataUpdateHandlers } = require('../src/services/dataUpdateAdmin.js');
const { loadProjectEnv } = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_ID = '33333333-3333-4333-8333-333333333333';
const CARDS_SHA = 'aa'.repeat(32);
const COLL_SHA = 'bb'.repeat(32);
const NEW_CARDS_SHA = 'cc'.repeat(32);
const NEW_COLL_SHA = 'dd'.repeat(32);

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(blob));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
  assert.ok(!/eyJ[a-zA-Z0-9_-]{20,}/.test(blob));
}

function fakeMeta(cardsSha, collSha) {
  cardsSha = cardsSha || CARDS_SHA;
  collSha = collSha || COLL_SHA;
  return {
    schemaVersion: 1,
    locale: 'zhCN',
    source: 'hearthstonejson',
    cards: {
      url: 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.json',
      sha256: cardsSha,
      entryCount: 2000,
      downloadedAt: '2026-08-29T12:00:00.000Z',
      etag: '"abc"',
      contentLength: 100,
    },
    collectible: {
      url: 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json',
      sha256: collSha,
      entryCount: 200,
      downloadedAt: '2026-08-29T12:00:00.000Z',
      etag: '"def"',
      contentLength: 50,
    },
  };
}

function createHarness() {
  const versionStore = createMemoryDataVersionStore();
  const jobStore = createMemoryUpdateJobStore();
  const versions = createDataVersionService(versionStore);
  const jobs = createUpdateJobService(jobStore);
  const logs = [];
  const state = {
    checkStatus: 'UP_TO_DATE',
    updateFail: false,
    updateCalls: 0,
    downloadCalls: 0,
    commitCalls: 0,
    phase08Calls: 0,
    phase11Calls: 0,
  };
  const meta = fakeMeta();
  const newMeta = fakeMeta(NEW_CARDS_SHA, NEW_COLL_SHA);
  const newFp = snapshotFingerprint({
    source: 'hearthstonejson',
    locale: 'zhCN',
    cardsSha256: NEW_CARDS_SHA,
    collectibleSha256: NEW_COLL_SHA,
  });
  const updater = {
    inspectLocalSnapshot: function () {
      return {
        cards: { sha256: CARDS_SHA, byteSize: 100, etag: '"abc"', contentLength: 100 },
        collectible: { sha256: COLL_SHA, byteSize: 50, etag: '"def"', contentLength: 50 },
        meta: meta,
      };
    },
    checkRemoteSnapshot: async function () {
      return {
        status: state.checkStatus,
        remote: {
          cards: { url: meta.cards.url, etag: meta.cards.etag, contentLength: 100 },
          collectible: { url: meta.collectible.url, etag: meta.collectible.etag, contentLength: 50 },
        },
        local: {
          cards: { sha256: CARDS_SHA, byteSize: 100 },
          collectible: { sha256: COLL_SHA, byteSize: 50 },
        },
      };
    },
    downloadSnapshotToStaging: async function (opts) {
      state.downloadCalls += 1;
      return {
        id: (opts && opts.id) || 'stage',
        dir: path.join(ROOT, 'tmp', 'hsjson-admin-test-stage'),
        remote: Object.assign({}, newMeta, {
          fingerprint: newFp,
          cardsSha256: NEW_CARDS_SHA,
          collectibleSha256: NEW_COLL_SHA,
          downloadedAt: '2026-08-29T12:00:00.000Z',
          build: null,
        }),
        fingerprint: newFp,
      };
    },
    validateSnapshot: function () {
      if (state.updateFail) {
        const err = new Error('fixture failed');
        err.code = 'VALIDATION_FAILED';
        err.userMessage = 'fixture failed';
        throw err;
      }
      return { ok: true, cross: { cardsCount: 2100, collectibleCount: 210, overlapCount: 210 } };
    },
    commitSnapshot: function () {
      state.commitCalls += 1;
      return { ok: true, meta: newMeta };
    },
    updateSnapshot: async function () {
      state.updateCalls += 1;
      throw new Error('updateSnapshot must not be used by pipeline');
    },
  };
  const orchestrator = createHsjsonSnapshotOrchestrator({
    updater: updater,
    versions: versions,
    jobs: jobs,
    writeLog: async function (entry) { logs.push(entry); },
    rootDir: path.join(ROOT, 'tmp', 'hsjson-admin-test'),
    runPhase08: async function () {
      state.phase08Calls += 1;
      return { status: 0 };
    },
    runPhase11: async function () {
      state.phase11Calls += 1;
      return { status: 0 };
    },
    validateIndex: async function () { return { ok: true, cardCount: 10 }; },
    validateAudio: async function () {
      return { ok: true, unified: { schemaVersion: '1.0', clientVersion: '1', cards: { EX1_116: { id: 'EX1_116', collectible: true } } } };
    },
    validateCatalog: async function () { return { ok: true }; },
    miniRegression: async function () { return { ok: true }; },
    backupProduction: async function () {},
    restoreProduction: async function () {},
  });
  return {
    versionStore: versionStore,
    jobStore: jobStore,
    versions: versions,
    jobs: jobs,
    logs: logs,
    state: state,
    updater: updater,
    handlers: createDataUpdateHandlers({
      orchestrator: orchestrator,
      versions: versions,
      jobs: jobs,
      updater: updater,
    }),
  };
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
          handleDataUpdate: harness.handlers.handle,
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

function adminHeaders() {
  return { Authorization: 'Bearer admin-token' };
}

(async function () {
  const harness = createHarness();
  await withServer(harness, async function (port) {
    const t1 = await request(port, { path: '/api/admin/data-versions' });
    assert.strictEqual(t1.status, 401);
    console.log('ok TEST 1 unauthenticated -> 401');

    const t2 = await request(port, {
      path: '/api/admin/data/check',
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: {},
    });
    assert.strictEqual(t2.status, 403);
    console.log('ok TEST 2 non-admin -> 403');

    const t3 = await request(port, {
      path: '/api/admin/data/check',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t3.status, 200);
    assert.strictEqual(t3.body.status, 'UP_TO_DATE');
    assert.ok(t3.body.jobId);
    assert.strictEqual(t3.body.dataVersionId, null);
    assert.strictEqual(harness.state.downloadCalls, 0);
    const checkJob = await harness.jobs.getJob(t3.body.jobId);
    assert.strictEqual(checkJob.status, 'SUCCEEDED');
    assert.strictEqual((await harness.versions.listDataVersions()).length, 0);
    const t3b = await request(port, {
      path: '/api/admin/data/check',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t3b.status, 200);
    assert.strictEqual(t3b.body.status, 'UP_TO_DATE');
    assert.strictEqual(t3b.body.jobId, t3.body.jobId);
    assert.strictEqual(t3b.body.reused, true);
    assert.strictEqual(harness.jobStore.rows.filter(function (r) { return r.job_type === 'HSJSON_SNAPSHOT'; }).length, 1);
    assert.strictEqual((await harness.versions.listDataVersions()).length, 0);
    assert.ok(harness.logs.some(function (e) { return e.action === 'data.update.check'; }));
    assert.ok(harness.logs.some(function (e) { return e.action === 'data.update.start'; }));
    assert.ok(harness.logs.some(function (e) { return e.action === 'data.update.success'; }));
    assertNoSecret(t3.raw);
    assertNoSecret(t3b.raw);
    console.log('ok TEST 3 admin check');

    harness.state.checkStatus = 'UPDATED_AVAILABLE';
    const t4 = await request(port, {
      path: '/api/admin/data/update',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t4.status, 200);
    assert.strictEqual(t4.body.status, 'UPDATED');
    assert.ok(t4.body.jobId);
    assert.ok(t4.body.dataVersionId);
    assert.strictEqual(harness.state.downloadCalls, 1);
    assert.strictEqual(harness.state.commitCalls, 1);
    assert.strictEqual(harness.state.phase08Calls, 1);
    assert.strictEqual(harness.state.phase11Calls, 1);
    assert.strictEqual(harness.state.updateCalls, 0);
    const version = await harness.versions.getDataVersion(t4.body.dataVersionId);
    assert.strictEqual(version.status, 'ACTIVE');
    const job = await harness.jobs.getJob(t4.body.jobId);
    assert.strictEqual(job.status, 'SUCCEEDED');
    assert.ok(harness.logs.some(function (e) { return e.action === 'data.update.start'; }));
    assert.ok(harness.logs.some(function (e) { return e.action === 'data.update.success'; }));
    assertNoSecret(JSON.stringify(harness.logs));
    console.log('ok TEST 4 admin update');

    harness.jobStore.rows.push({
      id: '99999999-9999-4999-8999-999999999999',
      job_type: 'HSJSON_SNAPSHOT',
      status: 'DOWNLOADING',
      data_version_id: null,
      source: 'hearthstonejson',
      locale: 'zhCN',
      created_at: '2026-08-29T13:00:00.000Z',
    });
    const t5check = await request(port, {
      path: '/api/admin/data/check',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t5check.status, 409);
    assert.strictEqual(t5check.body.code, 'DATA_UPDATE_ALREADY_RUNNING');
    const t5 = await request(port, {
      path: '/api/admin/data/update',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t5.status, 409);
    assert.strictEqual(t5.body.code, 'DATA_UPDATE_ALREADY_RUNNING');
    harness.jobStore.rows.pop();
    console.log('ok TEST 5 update already running -> 409');

    harness.state.checkStatus = 'UP_TO_DATE';
    const t6 = await request(port, {
      path: '/api/admin/data/update',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t6.status, 200);
    assert.strictEqual(t6.body.status, 'UP_TO_DATE');
    assert.strictEqual(t6.body.dataVersionId, null);
    const versionsAfter = await harness.versions.listDataVersions();
    assert.strictEqual(versionsAfter.length, 1);
    console.log('ok TEST 6 up-to-date response');

    harness.state.checkStatus = 'UPDATED_AVAILABLE';
    const t7 = await request(port, {
      path: '/api/admin/data/check',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.strictEqual(t7.status, 200);
    assert.strictEqual(t7.body.status, 'UPDATED_AVAILABLE');
    assert.ok(t7.body.remote);
    assert.ok(t7.body.local);
    console.log('ok TEST 7 updated available response');

    harness.state.updateFail = true;
    const t8 = await request(port, {
      path: '/api/admin/data/update',
      method: 'POST',
      headers: adminHeaders(),
      body: {},
    });
    assert.ok(t8.status === 500 || (t8.body && t8.body.status === 'FAILED'));
    assert.ok(t8.body.code === 'HSJSON_VALIDATION_FAILED' || t8.body.code === 'VALIDATION_FAILED' || t8.body.status === 'FAILED');
    assert.strictEqual(harness.state.commitCalls, 1);
    assertNoSecret(t8.raw);
    console.log('ok TEST 8 failed update response');

    const list = await request(port, { path: '/api/admin/data-versions', headers: adminHeaders() });
    assert.strictEqual(list.status, 200);
    assertNoSecret(list.raw);
    const jobs = await request(port, { path: '/api/admin/update-jobs', headers: adminHeaders() });
    assert.strictEqual(jobs.status, 200);
    assertNoSecret(jobs.raw);
    assert.ok(!JSON.stringify(list.body).includes('SUPABASE_SERVICE_ROLE_KEY'));
    console.log('ok TEST 9 service role never exposed');
  });

  const srcFiles = [
    path.join(ROOT, 'src', 'services', 'hsjsonSnapshotJob.js'),
    path.join(ROOT, 'src', 'services', 'dataUpdateAdmin.js'),
    path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'),
    path.join(ROOT, 'admin', 'data.js'),
  ];
  srcFiles.forEach(function (file) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/C:\\\\Hearthstone/.test(text));
    assertNoSecret(text);
  });

  console.log('ok adminDataUpdate');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(function () { process.exit(1); }, 200);
}).then(function () {
  setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
});
