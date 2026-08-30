'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createHsjsonUpdater,
  validateCardsArray,
} = require('../src/services/hsjsonUpdater.js');
const {
  createMemoryDataVersionStore,
  createDataVersionService,
} = require('../src/services/dataVersionService.js');
const {
  createMemoryUpdateJobStore,
  createUpdateJobService,
} = require('../src/services/updateJobService.js');
const { createHsjsonSnapshotOrchestrator } = require('../src/services/hsjsonSnapshotJob.js');
const { backupProduction, restoreProduction } = require('../src/services/hsjsonUpdatePipeline.js');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'tmp', 'hsjson-pipeline-test');
const cardsUrl = 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.json';
const collUrl = 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json';

function makeCards(n, prefix) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: prefix + i,
      set: 'CORE',
      type: 'MINION',
      dbfId: i + 1,
      name: 'Card ' + i,
      collectible: i < Math.floor(n / 4),
    });
  }
  return out;
}

function makeCollectible(cards, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    out.push({
      id: c.id,
      set: c.set,
      type: c.type,
      dbfId: c.dbfId,
      collectible: true,
      name: c.name,
    });
  }
  return out;
}

function headers(map) {
  return new Headers(map);
}

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value));
}

function mockFetch(spec) {
  return async function (url, init) {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const rec = spec[method + ' ' + url] || spec[url];
    if (!rec) return { ok: false, status: 404, headers: new Headers() };
    return rec;
  };
}

function seedTree(dir, cards, collectible) {
  const prod = path.join(dir, 'data', 'hearthstonejson', 'zhCN');
  const idx = path.join(dir, 'data', 'index');
  fs.mkdirSync(prod, { recursive: true });
  fs.mkdirSync(path.join(idx, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(prod, 'cards.json'), JSON.stringify(cards));
  fs.writeFileSync(path.join(prod, 'cards.collectible.json'), JSON.stringify(collectible));
  fs.writeFileSync(path.join(idx, 'card-voice-index.json'), JSON.stringify({ cards: { OLD_0: { id: 'OLD_0' } } }));
  fs.writeFileSync(path.join(idx, 'audio-index.json'), JSON.stringify({ clips: {} }));
  fs.writeFileSync(path.join(idx, 'card-audio-index.json'), JSON.stringify({
    schemaVersion: '1.0',
    clientVersion: 'test',
    cards: { OLD_0: { id: 'OLD_0' } },
  }));
  fs.writeFileSync(path.join(idx, 'music-index.json'), JSON.stringify({ cards: {} }));
  fs.writeFileSync(path.join(idx, 'music-assets.json'), JSON.stringify({ assets: {} }));
  fs.writeFileSync(path.join(idx, 'manifest.json'), JSON.stringify({ v: 'old' }));
  fs.writeFileSync(path.join(idx, 'latest-set.json'), JSON.stringify({ set: 'ESCAPEFROM_VIOLET_HOLD' }));
  fs.writeFileSync(path.join(prod, 'snapshot-meta.json'), JSON.stringify({
    schemaVersion: 1,
    locale: 'zhCN',
    source: 'hearthstonejson',
    cards: { url: cardsUrl, etag: '"old"', contentLength: 1 },
    collectible: { url: collUrl, etag: '"oldc"', contentLength: 1 },
  }));
}

function readCards(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), 'utf8'));
}

function readIndexMarker(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'index', 'manifest.json'), 'utf8'));
}

function readLatest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'index', 'latest-set.json'), 'utf8'));
}

function writeNewIndexes(dir) {
  const idx = path.join(dir, 'data', 'index');
  fs.writeFileSync(path.join(idx, 'card-voice-index.json'), JSON.stringify({ cards: { NEW_0: { id: 'NEW_0' } } }));
  fs.writeFileSync(path.join(idx, 'audio-index.json'), JSON.stringify({ clips: {} }));
  fs.writeFileSync(path.join(idx, 'manifest.json'), JSON.stringify({ v: 'new' }));
  fs.writeFileSync(path.join(idx, 'card-audio-index.json'), JSON.stringify({
    schemaVersion: '1.0',
    clientVersion: 'test',
    cards: { NEW_0: { id: 'NEW_0' } },
  }));
  fs.writeFileSync(path.join(idx, 'music-index.json'), JSON.stringify({ cards: {} }));
  fs.writeFileSync(path.join(idx, 'music-assets.json'), JSON.stringify({ assets: {} }));
}

if (fs.existsSync(WORK)) fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

{
  const dup = makeCards(1100, 'D_');
  dup[2].id = dup[0].id;
  let failed = false;
  try { validateCardsArray(dup); } catch (e) {
    failed = true;
    assert.strictEqual(e.code, 'VALIDATION_FAILED');
  }
  assert.ok(failed);
  console.log('ok unique id validation');
}

(async function () {
  const oldCards = makeCards(1200, 'OLD_');
  const oldColl = makeCollectible(oldCards, 200);
  const newCards = makeCards(1300, 'NEW_');
  const newColl = makeCollectible(newCards, 220);

  function harness(dir, fetchSpec, hooks) {
    hooks = hooks || {};
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch(fetchSpec),
    });
    const versions = createDataVersionService(createMemoryDataVersionStore());
    const jobs = createUpdateJobService(createMemoryUpdateJobStore());
    const logs = [];
    const orch = createHsjsonSnapshotOrchestrator({
      updater: updater,
      versions: versions,
      jobs: jobs,
      writeLog: async function (entry) { logs.push(entry); },
      rootDir: dir,
      runPhase08: hooks.runPhase08 || async function () {
        writeNewIndexes(dir);
        return { status: 0 };
      },
      runPhase11: hooks.runPhase11 || async function () { return { status: 0 }; },
      validateIndex: hooks.validateIndex || async function () { return { ok: true, cardCount: 1 }; },
      validateAudio: hooks.validateAudio || async function () {
        return {
          ok: true,
          unified: JSON.parse(fs.readFileSync(path.join(dir, 'data', 'index', 'card-audio-index.json'), 'utf8')),
        };
      },
      validateCatalog: hooks.validateCatalog || async function () { return { ok: true }; },
      miniRegression: hooks.miniRegression || async function () { return { ok: true }; },
      getLatestSetCode: function () { return 'ESCAPEFROM_VIOLET_HOLD'; },
    });
    return { updater: updater, versions: versions, jobs: jobs, logs: logs, orch: orch };
  }

  const availableFetch = {
    ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"new"', 'content-length': '99' }) },
    ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"newc"', 'content-length': '88' }) },
    ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"new"', 'content-type': 'application/json' }), body: jsonBody(newCards) },
    ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"newc"', 'content-type': 'application/json' }), body: jsonBody(newColl) },
  };

  {
    const dir = path.join(WORK, 'a');
    seedTree(dir, oldCards, oldColl);
    fs.writeFileSync(path.join(dir, 'data', 'hearthstonejson', 'zhCN', 'snapshot-meta.json'), JSON.stringify({
      schemaVersion: 1,
      locale: 'zhCN',
      source: 'hearthstonejson',
      cards: { url: cardsUrl, etag: '"old"', contentLength: 1 },
      collectible: { url: collUrl, etag: '"oldc"', contentLength: 1 },
    }));
    const h = harness(dir, {
      ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"new"', 'content-length': '99' }) },
      ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"newc"', 'content-length': '88' }) },
      ['GET ' + cardsUrl]: { ok: false, status: 500, headers: headers({}) },
      ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({}), body: jsonBody(newColl) },
    });
    await assert.rejects(function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); });
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual(readIndexMarker(dir).v, 'old');
    const failed = (await h.jobs.listJobs()).filter(function (j) { return j.status === 'FAILED'; });
    assert.ok(failed.length >= 1);
    assert.ok(h.logs.some(function (e) { return e.action === 'data.update.failed'; }));
    assert.strictEqual(readLatest(dir).set, 'ESCAPEFROM_VIOLET_HOLD');
    console.log('ok TEST A download failure preserves snapshot');
  }

  {
    const dir = path.join(WORK, 'b');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, {
      ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"new"', 'content-length': '99' }) },
      ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"newc"', 'content-length': '88' }) },
      ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({ 'content-type': 'application/json' }), body: Buffer.from('{not json') },
      ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({ 'content-type': 'application/json' }), body: jsonBody(newColl) },
    });
    await assert.rejects(function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); });
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    console.log('ok TEST B validation failure preserves snapshot');
  }

  {
    const dir = path.join(WORK, 'c');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch, {
      runPhase08: async function () {
        writeNewIndexes(dir);
        return { status: 1, stderr: 'phase08 boom' };
      },
    });
    await assert.rejects(function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); });
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual(readIndexMarker(dir).v, 'old');
    assert.strictEqual((await h.versions.findActive()), null);
    const job = (await h.jobs.listJobs())[0];
    assert.strictEqual(job.status, 'FAILED');
    assert.strictEqual(job.error_code, 'PHASE08_FAILED');
    assert.strictEqual(readLatest(dir).set, 'ESCAPEFROM_VIOLET_HOLD');
    console.log('ok TEST C Phase08 failure rolls back');
  }

  {
    const dir = path.join(WORK, 'd');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch, {
      runPhase11: async function () {
        writeNewIndexes(dir);
        return { status: 1 };
      },
    });
    await assert.rejects(function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); });
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual(readIndexMarker(dir).v, 'old');
    assert.strictEqual((await h.versions.findActive()), null);
    const job = (await h.jobs.listJobs())[0];
    assert.strictEqual(job.error_code, 'PHASE11_FAILED');
    console.log('ok TEST D Phase11 failure rolls back');
  }

  {
    const dir = path.join(WORK, 'e');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch, {
      validateCatalog: async function () { return { ok: false }; },
    });
    await assert.rejects(function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); });
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual(readIndexMarker(dir).v, 'old');
    console.log('ok TEST E Catalog validation failure rolls back');
  }

  {
    const dir = path.join(WORK, 'f');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch, {
      miniRegression: async function () {
        const err = new Error('Mini 回归失败');
        err.code = 'MINI_REGRESSION_FAILED';
        err.userMessage = 'Mini 回归失败';
        throw err;
      },
    });
    await assert.rejects(function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); });
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual(readIndexMarker(dir).v, 'old');
    const job = (await h.jobs.listJobs())[0];
    assert.strictEqual(job.error_code, 'MINI_REGRESSION_FAILED');
    console.log('ok TEST F Mini regression failure rolls back');
  }

  {
    const dir = path.join(WORK, 'g');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch);
    const result = await h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } });
    assert.strictEqual(result.status, 'UPDATED');
    assert.ok(result.dataVersionId);
    const version = await h.versions.getDataVersion(result.dataVersionId);
    assert.strictEqual(version.status, 'ACTIVE');
    const job = await h.jobs.getJob(result.jobId);
    assert.strictEqual(job.status, 'SUCCEEDED');
    assert.strictEqual(readCards(dir)[0].id, 'NEW_0');
    assert.strictEqual(readIndexMarker(dir).v, 'new');
    assert.strictEqual(readLatest(dir).set, 'ESCAPEFROM_VIOLET_HOLD');
    assert.ok(h.logs.some(function (e) { return e.action === 'data.update.success'; }));
    assert.ok(!JSON.stringify(h.logs).includes('sb_secret_'));
    console.log('ok TEST G complete success ACTIVE + SUCCEEDED');
  }

  {
    const dir = path.join(WORK, 'up');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, {
      ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"old"', 'content-length': '1' }) },
      ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"oldc"', 'content-length': '1' }) },
    });
    fs.writeFileSync(path.join(dir, 'data', 'hearthstonejson', 'zhCN', 'snapshot-meta.json'), JSON.stringify({
      schemaVersion: 1,
      locale: 'zhCN',
      source: 'hearthstonejson',
      cards: { url: cardsUrl, etag: '"old"', contentLength: 1 },
      collectible: { url: collUrl, etag: '"oldc"', contentLength: 1 },
    }));
    const result = await h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } });
    assert.strictEqual(result.status, 'UP_TO_DATE');
    assert.strictEqual(result.dataVersionId, null);
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual((await h.versions.listDataVersions()).length, 0);
    console.log('ok UP_TO_DATE does not download');
  }

  {
    const dir = path.join(WORK, 'conc');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch);
    h.jobs.lockSim = true;
    await h.jobs.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    await h.jobs.updateJobStatus((await h.jobs.listJobs())[0].id, 'CHECKING');
    await assert.rejects(
      function () { return h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); },
      function (err) { return err && err.code === 'DATA_UPDATE_ALREADY_RUNNING'; },
    );
    console.log('ok concurrent update 409/ALREADY_RUNNING');
  }

  {
    const dir = path.join(WORK, 'bak');
    seedTree(dir, oldCards, oldColl);
    const backupDir = path.join(dir, 'tmp', 'hsjson-update', 'job-bak', 'backup');
    backupProduction(dir, backupDir);
    fs.writeFileSync(path.join(dir, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), JSON.stringify(newCards));
    fs.writeFileSync(path.join(dir, 'data', 'index', 'manifest.json'), JSON.stringify({ v: 'mutated' }));
    restoreProduction(dir, backupDir);
    assert.strictEqual(readCards(dir)[0].id, 'OLD_0');
    assert.strictEqual(readIndexMarker(dir).v, 'old');
    console.log('ok backup/restore');
  }

  {
    const dir = path.join(WORK, 'secret');
    seedTree(dir, oldCards, oldColl);
    const h = harness(dir, availableFetch, {
      runPhase08: async function () {
        const err = new Error('fail password=hunter2 SUPABASE_SERVICE_ROLE_KEY=sb_secret_nope');
        err.code = 'PHASE08_FAILED';
        err.userMessage = err.message;
        throw err;
      },
    });
    let caught = null;
    try { await h.orch.runHsjsonSnapshotJob({ admin: { userId: 'u1' } }); } catch (e) { caught = e; }
    assert.ok(caught);
    const blob = JSON.stringify(h.logs) + JSON.stringify(await h.jobs.listJobs()) + String(caught.userMessage || '');
    assert.ok(!/sb_secret_nope/.test(blob));
    assert.ok(!/password=hunter2/.test(blob));
    console.log('ok secret leakage redacted');
  }

  console.log('ok hsjsonUpdatePipeline');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
