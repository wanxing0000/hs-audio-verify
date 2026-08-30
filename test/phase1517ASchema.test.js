const assert = require('assert');
const fs = require('fs');
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
  foreignKey,
  createAnonClient,
  isAnonDenied,
} = require('./supabaseSchemaInspect.js');

const ROOT = path.resolve(__dirname, '..');
loadProjectEnv(ROOT);

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

const flags = inspectSupabaseEnv(process.env);
if (!flags.hasUrl || !flags.hasServiceRoleKey || !flags.hasAnonKey) {
  console.log('BLOCKED phase1517ASchema: Supabase env incomplete');
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
  const migration = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '003_data_update_jobs.sql'),
    'utf8',
  );
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.data_versions'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.update_jobs'));
  assert.ok(migration.includes('CONSTRAINT data_versions_fingerprint_key UNIQUE (snapshot_fingerprint)'));
  assert.ok(migration.includes('CONSTRAINT data_versions_version_key UNIQUE (version)'));
  assert.ok(migration.includes("status IN ('STAGED', 'VALIDATED', 'READY', 'ACTIVE', 'FAILED', 'RETIRED')"));
  assert.ok(migration.includes("job_type IN ('HSJSON_SNAPSHOT')"));
  assert.ok(migration.includes("WHERE status IN ('CHECKING', 'DOWNLOADING', 'VALIDATING', 'RUNNING')"));
  assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS update_jobs_one_active_hsjson'));
  assert.ok(migration.includes('data_version_id uuid REFERENCES public.data_versions'));
  assert.ok(migration.includes('created_by uuid REFERENCES public.admin_users'));
  assert.ok(migration.includes('trg_data_versions_updated_at'));
  assert.ok(migration.includes('trg_update_jobs_updated_at'));
  assert.ok(migration.includes('EXECUTE PROCEDURE public.set_updated_at()'));
  assert.ok(migration.includes('ALTER TABLE public.data_versions ENABLE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('ALTER TABLE public.update_jobs ENABLE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('REVOKE ALL ON TABLE public.data_versions FROM anon, authenticated'));
  assert.ok(!/REFERENCES public\.admin_logs/i.test(migration));
  console.log('ok migration 003 text: constraints/index/RLS/trigger/FK');

  const client = createSupabaseAdmin();
  try {
    const dv = await client.from('data_versions').select('id', { count: 'exact' }).limit(1);
    const uj = await client.from('update_jobs').select('id', { count: 'exact' }).limit(1);
    if (dv.error) fail('data_versions missing or unreadable', dv.error);
    if (uj.error) fail('update_jobs missing or unreadable', uj.error);
    assert.ok(typeof dv.count === 'number' && dv.count >= 0, 'data_versions count');
    assert.ok(typeof uj.count === 'number' && uj.count >= 0, 'update_jobs count');
    console.log('ok tables exist counts', { data_versions: dv.count, update_jobs: uj.count });

    const spec = await fetchPostgrestOpenApi();
    const dvDef = definition(spec, 'data_versions');
    const ujDef = definition(spec, 'update_jobs');
    const logsDef = definition(spec, 'admin_logs');
    assert.ok(dvDef, 'OpenAPI data_versions');
    assert.ok(ujDef, 'OpenAPI update_jobs');

    const expectedDv = [
      'id', 'version', 'status', 'source', 'locale', 'build',
      'cards_sha256', 'collectible_sha256', 'cards_count', 'collectible_count',
      'snapshot_fingerprint', 'snapshot_meta', 'created_at', 'updated_at',
    ];
    assert.deepStrictEqual(columnNames(dvDef).slice().sort(), expectedDv.slice().sort());
    assert.ok(isPrimaryKey(dvDef.properties.id));
    assert.ok(dvDef.required.indexOf('version') !== -1);
    assert.ok(dvDef.required.indexOf('snapshot_fingerprint') !== -1);
    assert.strictEqual(dvDef.properties.status.format, 'text');
    assert.strictEqual(dvDef.properties.build.format, 'text');
    console.log('ok data_versions OpenAPI columns/PK');

    const expectedUj = [
      'id', 'job_type', 'status', 'data_version_id', 'source', 'locale',
      'snapshot_fingerprint', 'error_code', 'error_message',
      'started_at', 'finished_at', 'failed_at', 'created_by', 'created_at', 'updated_at',
    ];
    assert.deepStrictEqual(columnNames(ujDef).slice().sort(), expectedUj.slice().sort());
    assert.ok(isPrimaryKey(ujDef.properties.id));
    assert.deepStrictEqual(foreignKey(ujDef.properties.data_version_id), {
      table: 'data_versions',
      column: 'id',
    });
    assert.deepStrictEqual(foreignKey(ujDef.properties.created_by), {
      table: 'admin_users',
      column: 'user_id',
    });
    console.log('ok update_jobs OpenAPI columns/PK/FK');

    const logFks = Object.keys((logsDef && logsDef.properties) || {}).map(function (col) {
      return foreignKey(logsDef.properties[col]);
    }).filter(Boolean);
    logFks.forEach(function (fk) {
      assert.notStrictEqual(fk.table, 'data_versions');
      assert.notStrictEqual(fk.table, 'update_jobs');
    });
    assert.ok(logFks.some(function (fk) { return fk.table === 'admin_users' && fk.column === 'user_id'; }));
    console.log('ok admin_logs has no FK to data_versions/update_jobs');

    const { createClient } = require('@supabase/supabase-js');
    const url = String(process.env.SUPABASE_URL || '').trim();
    const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const infoClient = createClient(url, service, {
      db: { schema: 'information_schema' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pgClient = createClient(url, service, {
      db: { schema: 'pg_catalog' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const info = await infoClient.from('tables').select('table_name').limit(1);
    const pg = await pgClient.from('pg_indexes').select('indexname').limit(1);
    assert.ok(info.error && String(info.error.code) === 'PGRST106');
    assert.ok(pg.error && String(pg.error.code) === 'PGRST106');
    try {
      if (infoClient.realtime) infoClient.realtime.disconnect();
      if (pgClient.realtime) pgClient.realtime.disconnect();
    } catch (e) {}
    console.log('ok pg_catalog/information_schema not exposed (no dirty UNIQUE probes)');

    const anon = createAnonClient();
    try {
      const deniedDv = await anon.from('data_versions').select('id').limit(1);
      const deniedJobs = await anon.from('update_jobs').select('id').limit(1);
      assert.ok(isAnonDenied(deniedDv), 'anon read data_versions');
      assert.ok(isAnonDenied(deniedJobs), 'anon read update_jobs');
      assert.ok(String(deniedDv.error && deniedDv.error.code) === '42501' || /permission denied/i.test(String(deniedDv.error && deniedDv.error.message)));
      console.log('ok anon DENY read (42501)');
    } finally {
      try {
        if (anon.realtime && typeof anon.realtime.disconnect === 'function') anon.realtime.disconnect();
      } catch (e) {}
    }

    const current = await client.from('latest_sets').select('set_code').eq('is_current', true);
    if (current.error) fail('latest_sets read failed', current.error);
    assert.strictEqual(current.data.length, 1);
    assert.strictEqual(current.data[0].set_code, 'ESCAPEFROM_VIOLET_HOLD');
    console.log('ok latest_sets current unchanged');

    const afterDv = await client.from('data_versions').select('id', { count: 'exact', head: true });
    const afterUj = await client.from('update_jobs').select('id', { count: 'exact', head: true });
    assert.strictEqual(afterDv.count, dv.count, 'schema inspect must not insert data_versions');
    assert.strictEqual(afterUj.count, uj.count, 'schema inspect must not insert update_jobs');
    console.log('ok no verification pollution');

    console.log('ok phase1517ASchema', {
      data_versions: 'EXISTS',
      update_jobs: 'EXISTS',
      counts: { data_versions: afterDv.count, update_jobs: afterUj.count },
      catalog: 'PGRST106',
      indexPredicate: "status IN ('CHECKING', 'DOWNLOADING', 'VALIDATING', 'RUNNING')",
    });
  } finally {
    try {
      if (client.realtime && typeof client.realtime.disconnect === 'function') client.realtime.disconnect();
    } catch (e) {}
  }
}
