const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  loadProjectEnv,
  inspectSupabaseEnv,
  createSupabaseAdmin,
} = require('../src/services/supabaseClient.js');
const { snapshotFingerprint } = require('../src/services/dataVersionService.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

const PREFIX = 'hs-1517-';
const CARDS = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
const COLL = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.collectible.json');

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

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function jsonReq(pathname, opts) {
  opts = opts || {};
  const payload = opts.body != null ? JSON.stringify(opts.body) : null;
  return new Promise(function (resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8767,
      path: pathname,
      method: opts.method || 'GET',
      headers: Object.assign(
        payload ? { 'Content-Type': 'application/json' } : {},
        opts.headers || {},
      ),
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
    req.setTimeout(8000, function () {
      req.destroy();
      reject(new Error('timeout ' + pathname));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anon = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  if (anon) assert.ok(!blob.includes(anon), 'anon key leaked');
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
}

const flags = inspectSupabaseEnv(process.env);
if (!flags.hasUrl || !flags.hasServiceRoleKey) {
  console.log('BLOCKED phase1517DataJobs: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
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

async function cleanup(client) {
  await client.from('update_jobs').delete().like('source', PREFIX + '%');
  const versions = await client.from('data_versions').select('id').like('version', PREFIX + '%');
  if (!versions.error && versions.data) {
    for (let i = 0; i < versions.data.length; i++) {
      await client.from('update_jobs').delete().eq('data_version_id', versions.data[i].id);
    }
  }
  await client.from('data_versions').delete().like('version', PREFIX + '%');
  await client.from('admin_logs').delete().like('target_id', PREFIX + '%');
}

async function run() {
  const before = {
    cardsBytes: fs.statSync(CARDS).size,
    cardsSha: sha256File(CARDS),
    collBytes: fs.statSync(COLL).size,
    collSha: sha256File(COLL),
  };
  console.log('ok snapshot before', { cardsBytes: before.cardsBytes, collBytes: before.collBytes });

  const fp = snapshotFingerprint({
    source: 'hearthstonejson',
    locale: 'zhCN',
    cardsSha256: before.cardsSha,
    collectibleSha256: before.collSha,
  });
  const fp2 = snapshotFingerprint({
    source: 'hearthstonejson',
    locale: 'zhCN',
    cardsSha256: before.cardsSha,
    collectibleSha256: before.collSha,
  });
  assert.strictEqual(fp, fp2);
  assert.ok(!/T\d{2}:\d{2}/.test(fp));
  console.log('ok fingerprint stable (no timestamp)');

  const client = createSupabaseAdmin();
  try {
    const dv = await client.from('data_versions').select('id').limit(1);
    const uj = await client.from('update_jobs').select('id').limit(1);
    if (dv.error && (dv.error.code === 'PGRST205' || /Could not find the table/i.test(String(dv.error.message || '')))) {
      fail('MANUAL REQUIRED: migration 003 not applied (data_versions missing)', dv.error);
    }
    if (uj.error && (uj.error.code === 'PGRST205' || /Could not find the table/i.test(String(uj.error.message || '')))) {
      fail('MANUAL REQUIRED: migration 003 not applied (update_jobs missing)', uj.error);
    }
    if (dv.error) fail('data_versions read failed', dv.error);
    if (uj.error) fail('update_jobs read failed', uj.error);
    const dvCount = await client.from('data_versions').select('id', { count: 'exact', head: true });
    const ujCount = await client.from('update_jobs').select('id', { count: 'exact', head: true });
    console.log('ok tables exist', { data_versions: dvCount.count, update_jobs: ujCount.count });

    await cleanup(client);

    const shaA = crypto.randomBytes(32).toString('hex');
    const shaB = crypto.randomBytes(32).toString('hex');
    const fpRow = crypto.randomBytes(32).toString('hex');
    const inserted = await client.from('data_versions').insert({
      version: PREFIX + 'v1-' + fpRow.slice(0, 8),
      status: 'STAGED',
      source: 'hearthstonejson',
      locale: 'zhCN',
      build: null,
      cards_sha256: shaA,
      collectible_sha256: shaB,
      cards_count: 2000,
      collectible_count: 200,
      snapshot_fingerprint: fpRow,
      snapshot_meta: { source: 'hearthstonejson', locale: 'zhCN', build: null },
    }).select('id,updated_at,status,build').single();
    if (inserted.error) fail('data_versions insert failed', inserted.error);
    assert.strictEqual(inserted.data.status, 'STAGED');
    assert.strictEqual(inserted.data.build, null);
    console.log('ok data_versions insert STAGED build=null');

    const dupFp = await client.from('data_versions').insert({
      version: PREFIX + 'v2-' + fpRow.slice(0, 8),
      status: 'STAGED',
      source: 'hearthstonejson',
      locale: 'zhCN',
      cards_sha256: shaA,
      collectible_sha256: shaB,
      snapshot_fingerprint: fpRow,
    }).select('id').single();
    assert.ok(dupFp.error, 'fingerprint UNIQUE should reject');
    console.log('ok fingerprint UNIQUE');

    const dupVer = await client.from('data_versions').insert({
      version: PREFIX + 'v1-' + fpRow.slice(0, 8),
      status: 'STAGED',
      source: 'hearthstonejson',
      locale: 'zhCN',
      cards_sha256: crypto.randomBytes(32).toString('hex'),
      collectible_sha256: crypto.randomBytes(32).toString('hex'),
      snapshot_fingerprint: crypto.randomBytes(32).toString('hex'),
    }).select('id').single();
    assert.ok(dupVer.error, 'version UNIQUE should reject');
    console.log('ok version UNIQUE');

    const badStatus = await client.from('data_versions').insert({
      version: PREFIX + 'bad-status',
      status: 'UP_TO_DATE',
      source: 'hearthstonejson',
      locale: 'zhCN',
      cards_sha256: crypto.randomBytes(32).toString('hex'),
      collectible_sha256: crypto.randomBytes(32).toString('hex'),
      snapshot_fingerprint: crypto.randomBytes(32).toString('hex'),
    }).select('id').single();
    assert.ok(badStatus.error, 'invalid data_versions status should reject');
    console.log('ok data_versions status CHECK');

    for (let i = 0; i < ['VALIDATED', 'READY', 'ACTIVE', 'FAILED', 'RETIRED'].length; i++) {
      const st = ['VALIDATED', 'READY', 'ACTIVE', 'FAILED', 'RETIRED'][i];
      const row = await client.from('data_versions').insert({
        version: PREFIX + 'st-' + st.toLowerCase(),
        status: st,
        source: 'hearthstonejson',
        locale: 'zhCN',
        cards_sha256: crypto.randomBytes(32).toString('hex'),
        collectible_sha256: crypto.randomBytes(32).toString('hex'),
        snapshot_fingerprint: crypto.randomBytes(32).toString('hex'),
      }).select('id,status').single();
      if (row.error) fail('allowed status ' + st + ' rejected', row.error);
      await client.from('data_versions').delete().eq('id', row.data.id);
    }
    console.log('ok allowed data_versions statuses');

    await new Promise(function (resolve) { setTimeout(resolve, 1100); });
    const updated = await client.from('data_versions').update({ cards_count: 2001 }).eq('id', inserted.data.id).select('updated_at').single();
    if (updated.error) fail('data_versions update failed', updated.error);
    assert.ok(updated.data.updated_at > inserted.data.updated_at, 'updated_at trigger');
    console.log('ok data_versions updated_at trigger');

    const job = await client.from('update_jobs').insert({
      job_type: 'HSJSON_SNAPSHOT',
      status: 'PENDING',
      data_version_id: inserted.data.id,
      source: PREFIX + 'job',
      locale: 'zhCN',
    }).select('id,status,job_type,created_at,updated_at').single();
    if (job.error) fail('update_jobs insert failed', job.error);
    assert.strictEqual(job.data.job_type, 'HSJSON_SNAPSHOT');
    assert.strictEqual(job.data.status, 'PENDING');
    console.log('ok update_jobs insert FK');

    const badType = await client.from('update_jobs').insert({
      job_type: 'FULL_DATA_UPDATE',
      status: 'PENDING',
      source: PREFIX + 'job-bad',
    }).select('id').single();
    assert.ok(badType.error, 'job_type CHECK should reject FULL_DATA_UPDATE');
    console.log('ok update_jobs job_type CHECK');

    const badJobStatus = await client.from('update_jobs').insert({
      job_type: 'HSJSON_SNAPSHOT',
      status: 'UP_TO_DATE',
      source: PREFIX + 'job-bad-status',
    }).select('id').single();
    assert.ok(badJobStatus.error, 'invalid update_jobs status should reject');
    console.log('ok update_jobs status CHECK');

    const badFk = await client.from('update_jobs').insert({
      job_type: 'HSJSON_SNAPSHOT',
      status: 'PENDING',
      data_version_id: '00000000-0000-4000-8000-000000000000',
      source: PREFIX + 'job-fk',
    }).select('id').single();
    assert.ok(badFk.error, 'data_version_id FK should reject');
    console.log('ok update_jobs data_version_id FK');

    const checkingA = await client.from('update_jobs').insert({
      job_type: 'HSJSON_SNAPSHOT',
      status: 'CHECKING',
      source: PREFIX + 'checking-a',
    }).select('id').single();
    if (checkingA.error) fail('first CHECKING job insert failed', checkingA.error);
    const checkingB = await client.from('update_jobs').insert({
      job_type: 'HSJSON_SNAPSHOT',
      status: 'CHECKING',
      source: PREFIX + 'checking-b',
    }).select('id').single();
    assert.ok(checkingB.error, 'partial unique index should reject second in-progress job');
    await client.from('update_jobs').delete().eq('id', checkingA.data.id);
    console.log('ok update_jobs one-active partial unique index');

    const pending2 = await client.from('update_jobs').insert({
      job_type: 'HSJSON_SNAPSHOT',
      status: 'PENDING',
      source: PREFIX + 'pending-2',
    }).select('id').single();
    if (pending2.error) fail('second PENDING job should be allowed', pending2.error);
    await client.from('update_jobs').delete().eq('id', pending2.data.id);
    console.log('ok multiple PENDING jobs allowed');

    const log = await client.from('admin_logs').insert({
      action: 'data.update.check',
      target_type: 'hsjson_snapshot',
      target_id: PREFIX + 'audit',
      details: {
        jobId: job.data.id,
        dataVersionId: null,
        status: 'UP_TO_DATE',
        source: 'hearthstonejson',
        locale: 'zhCN',
        snapshotFingerprint: fp,
      },
    }).select('id,action,details').single();
    if (log.error) fail('admin_logs insert failed', log.error);
    assert.strictEqual(log.data.action, 'data.update.check');
    assertNoSecret(JSON.stringify(log.data));
    console.log('ok admin_logs data.update.check writable');

    const currentLatest = await client.from('latest_sets').select('set_code').eq('is_current', true);
    if (currentLatest.error) fail('latest_sets current read failed', currentLatest.error);
    assert.strictEqual(currentLatest.data.length, 1);
    assert.strictEqual(currentLatest.data[0].set_code, 'ESCAPEFROM_VIOLET_HOLD');
    console.log('ok latest set unmodified');

    const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
    if (anonKey) {
      const url = String(process.env.SUPABASE_URL || '').trim();
      const anon = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const deniedDv = await anon.from('data_versions').select('id').limit(1);
      const deniedJobs = await anon.from('update_jobs').select('id').limit(1);
      const deniedLogs = await anon.from('admin_logs').select('id').limit(1);
      const writeDv = await anon.from('data_versions').insert({
        version: PREFIX + 'anon',
        status: 'STAGED',
        source: 'hearthstonejson',
        locale: 'zhCN',
        cards_sha256: crypto.randomBytes(32).toString('hex'),
        collectible_sha256: crypto.randomBytes(32).toString('hex'),
        snapshot_fingerprint: crypto.randomBytes(32).toString('hex'),
      });
      assert.ok(!!deniedDv.error || !deniedDv.data || deniedDv.data.length === 0, 'anon must not read data_versions');
      assert.ok(!!deniedJobs.error || !deniedJobs.data || deniedJobs.data.length === 0, 'anon must not read update_jobs');
      assert.ok(!!deniedLogs.error || !deniedLogs.data || deniedLogs.data.length === 0, 'anon must not read admin_logs');
      assert.ok(writeDv.error, 'anon must not write data_versions');
      try {
        if (anon.realtime && typeof anon.realtime.disconnect === 'function') anon.realtime.disconnect();
      } catch (e) {}
      console.log('ok RLS anon deny read/write');
    } else {
      fail('SUPABASE_ANON_KEY missing; cannot verify RLS');
    }

    const admins = await client.from('admin_users').select('user_id,role,is_active');
    if (admins.error) fail('admin_users read failed', admins.error);
    const active = (admins.data || []).filter(function (row) {
      return row.role === 'admin' && row.is_active === true;
    });
    if (active.length === 0) {
      console.log('MANUAL REQUIRED: no active admin_users row; skip real Admin Check session');
    } else {
      console.log('ok active admin exists', { count: active.length });
    }

    const health = await jsonReq('/api/mini/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.ok, true);
    const catalog = await jsonReq('/api/mini/catalog?page=1&pageSize=1');
    assert.strictEqual(catalog.status, 200);
    assert.strictEqual(catalog.body.total, 7263);
    const latest = await jsonReq('/api/mini/latest?page=1&pageSize=1');
    assert.strictEqual(latest.status, 200);
    assert.strictEqual(latest.body.set, 'ESCAPEFROM_VIOLET_HOLD');
    assert.strictEqual(latest.body.total, 164);
    console.log('ok Mini regression');

    const unauth = await jsonReq('/api/admin/data/check', { method: 'POST', body: {} });
    assert.strictEqual(unauth.status, 401);
    assertNoSecret(unauth.raw);
    console.log('ok POST /api/admin/data/check unauthenticated -> 401');

    const fake = await jsonReq('/api/admin/data/check', {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-token' },
      body: {},
    });
    assert.strictEqual(fake.status, 401);
    assertNoSecret(fake.raw);
    console.log('ok POST /api/admin/data/check fake token -> 401');

    await cleanup(client);

    const after = {
      cardsBytes: fs.statSync(CARDS).size,
      cardsSha: sha256File(CARDS),
      collBytes: fs.statSync(COLL).size,
      collSha: sha256File(COLL),
    };
    assert.strictEqual(after.cardsSha, before.cardsSha);
    assert.strictEqual(after.collSha, before.collSha);
    assert.strictEqual(after.cardsBytes, before.cardsBytes);
    assert.strictEqual(after.collBytes, before.collBytes);
    console.log('ok Snapshot unchanged.');

    const dvAfter = await client.from('data_versions').select('id', { count: 'exact', head: true });
    const ujAfter = await client.from('update_jobs').select('id', { count: 'exact', head: true });
    console.log('ok phase1517DataJobs', {
      data_versions: dvAfter.count,
      update_jobs: ujAfter.count,
      fingerprint: fp,
      adminRequired: active.length === 0,
    });
  } finally {
    try { await cleanup(client); } catch (e) {}
    try {
      if (client.realtime && typeof client.realtime.disconnect === 'function') client.realtime.disconnect();
    } catch (e) {}
  }
}
