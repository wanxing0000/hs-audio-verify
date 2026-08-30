const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  inspectSupabaseEnv,
  createSupabaseAdmin,
  loadProjectEnv,
} = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
const TEST_SET_CODE = '__phase_1510_trigger_test__';

loadProjectEnv(ROOT);
const flags = inspectSupabaseEnv(process.env);

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

if (!flags.hasUrl || !flags.hasServiceRoleKey) {
  console.log('skip supabaseDatabase: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  process.exitCode = 0;
} else {
  const client = createSupabaseAdmin();
  assert.ok(client);
  assert.strictEqual(typeof client.from, 'function');
  console.log('ok TEST 1 supabase client initialized');

  const src = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');
  assert.ok(src.includes("loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set.json'))"));
  assert.ok(!/from\('latest_sets'\)/.test(src));
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gitignore.split(/\r?\n/).some((line) => line.trim() === '.env'));
  const migration = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '001_initial_admin_data.sql'),
    'utf8',
  );
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.admin_users'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.latest_sets'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.app_settings'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.feedback'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.admin_logs'));
  assert.ok(!migration.includes('data_versions'));
  assert.ok(!migration.includes('update_jobs'));
  assert.ok(migration.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('latest_sets_one_current'));
  assert.ok(migration.includes('ESCAPEFROM_VIOLET_HOLD'));
  assert.ok(!/password/i.test(migration));
  const migration2 = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '002_latest_set_publish.sql'),
    'utf8',
  );
  assert.ok(migration2.includes('publish_latest_set'));
  assert.ok(/GRANT EXECUTE[\s\S]*service_role/.test(migration2));
  assert.ok(!/DROP TABLE/i.test(migration2));
  assert.ok(!/DROP INDEX/i.test(migration2));
  const migration3 = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '003_data_update_jobs.sql'),
    'utf8',
  );
  assert.ok(migration3.includes('CREATE TABLE IF NOT EXISTS public.data_versions'));
  assert.ok(migration3.includes('CREATE TABLE IF NOT EXISTS public.update_jobs'));
  assert.ok(migration3.includes('snapshot_fingerprint'));
  assert.ok(migration3.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.data_versions TO service_role/.test(migration3));
  assert.ok(/REVOKE ALL ON TABLE public.data_versions FROM anon, authenticated/.test(migration3));
  assert.ok(!/DROP TABLE/i.test(migration3));

  runSchemaTests(client)
    .then(() => {
      try {
        if (client.realtime && typeof client.realtime.disconnect === 'function') {
          client.realtime.disconnect();
        }
      } catch (_) {}
      setTimeout(() => process.exit(process.exitCode || 0), 200);
    })
    .catch((e) => {
      console.error(redact(e && e.stack || e));
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 200);
    });
}

async function runSchemaTests(client) {
  const probe = await client.from('latest_sets').select('set_code').limit(1);
  if (probe.error && probe.error.code === 'PGRST205') {
    console.log('skip supabaseDatabase schema tests: tables not applied (DDL requires db url or management token, not service role)');
    return;
  }
  if (probe.error) fail('TEST 2 latest_sets read failed', probe.error);

  console.log('ok TEST 2 latest_sets readable');

  const current = await client
    .from('latest_sets')
    .select('id,set_code,name_en,name_zh,release_date,verified,is_current,source,source_url')
    .eq('is_current', true);
  if (current.error) fail('TEST 3 current latest_sets read failed', current.error);
  assert.strictEqual(current.data.length, 1, 'expected exactly one is_current latest set');
  console.log('ok TEST 3 current latest uniqueness');

  const row = current.data[0];
  assert.strictEqual(row.set_code, 'ESCAPEFROM_VIOLET_HOLD');
  assert.strictEqual(row.name_en, 'Escape from Violet Hold');
  assert.strictEqual(row.name_zh, '逃离紫罗兰监狱');
  assert.strictEqual(row.verified, true);
  assert.strictEqual(row.is_current, true);
  const release = row.release_date ? new Date(row.release_date) : null;
  assert.ok(release && !Number.isNaN(release.getTime()));
  assert.strictEqual(release.toISOString().slice(0, 10), '2026-07-07');
  console.log('ok TEST 4 current set ESCAPEFROM_VIOLET_HOLD');

  const rpc = await client.rpc('publish_latest_set', { p_id: row.id });
  if (rpc.error && (rpc.error.code === 'PGRST202' || /Could not find the function/i.test(String(rpc.error.message || '')))) {
    console.log('skip publish_latest_set RPC: migration 002 not applied');
  } else if (rpc.error) {
    fail('publish_latest_set RPC failed', rpc.error);
  } else {
    const afterRpc = await client.from('latest_sets').select('set_code').eq('is_current', true);
    if (afterRpc.error) fail('current latest_sets after RPC failed', afterRpc.error);
    assert.strictEqual(afterRpc.data.length, 1);
    assert.strictEqual(afterRpc.data[0].set_code, 'ESCAPEFROM_VIOLET_HOLD');
    console.log('ok publish_latest_set RPC');
  }

  await client.from('latest_sets').delete().like('set_code', 'TEST_PHASE_1_5_13_%');
  await client.from('latest_sets').delete().like('set_code', 'TEST_PHASE_1513_%');

  const settings = await client.from('app_settings').select('key').limit(5);
  if (settings.error) fail('TEST 5 app_settings read failed', settings.error);
  assert.ok(Array.isArray(settings.data));
  console.log('ok TEST 5 app_settings readable');

  const feedback = await client.from('feedback').select('id,status').limit(5);
  if (feedback.error) fail('TEST 6 feedback read failed', feedback.error);
  assert.ok(Array.isArray(feedback.data));
  console.log('ok TEST 6 feedback readable');

  const logs = await client.from('admin_logs').select('id,action').limit(5);
  if (logs.error) fail('TEST 7 admin_logs read failed', logs.error);
  assert.ok(Array.isArray(logs.data));
  console.log('ok TEST 7 admin_logs readable');

  const missing = await client
    .from('latest_sets')
    .select('id')
    .eq('id', '00000000-0000-0000-0000-000000000000');
  if (missing.error) fail('TEST 8 missing row query failed', missing.error);
  assert.deepStrictEqual(missing.data, []);
  console.log('ok TEST 8 missing record does not crash');

  const tables = ['admin_users', 'latest_sets', 'app_settings', 'feedback', 'admin_logs'];
  for (let i = 0; i < tables.length; i++) {
    const r = await client.from(tables[i]).select('*', { count: 'exact', head: true });
    if (r.error) fail('table missing ' + tables[i], r.error);
  }

  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (anonKey) {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const denied = await anon.from('latest_sets').select('set_code').limit(1);
    const closed = !!denied.error || !denied.data || denied.data.length === 0;
    assert.ok(closed, 'anon must not read latest_sets');
    console.log('ok RLS anon deny (latest_sets)');
  } else {
    console.log('skip RLS anon check: SUPABASE_ANON_KEY missing');
  }

  const badAdmin = await client.from('admin_users').insert({
    user_id: '00000000-0000-0000-0000-000000000000',
    role: 'admin',
  });
  assert.ok(badAdmin.error, 'admin_users FK to auth.users should reject unknown user_id');
  console.log('ok FK admin_users -> auth.users');

  await client.from('latest_sets').delete().eq('set_code', TEST_SET_CODE);
  const inserted = await client
    .from('latest_sets')
    .insert({
      set_code: TEST_SET_CODE,
      name_en: 'Phase 1.5.10 trigger test',
      name_zh: '触发器测试',
      verified: false,
      is_current: false,
    })
    .select('id,updated_at')
    .single();
  if (inserted.error) fail('trigger insert failed', inserted.error);
  const firstUpdated = inserted.data.updated_at;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const updated = await client
    .from('latest_sets')
    .update({ name_en: 'Phase 1.5.10 trigger test 2' })
    .eq('id', inserted.data.id)
    .select('updated_at')
    .single();
  const cleanup = await client.from('latest_sets').delete().eq('id', inserted.data.id);
  if (cleanup.error) fail('trigger cleanup failed', cleanup.error);
  if (updated.error) fail('trigger update failed', updated.error);
  assert.ok(updated.data.updated_at > firstUpdated, 'updated_at trigger should advance');
  console.log('ok updated_at trigger');

  const dvProbe = await client.from('data_versions').select('id').limit(1);
  const jobsProbe = await client.from('update_jobs').select('id').limit(1);
  const missing003 =
    (dvProbe.error && (dvProbe.error.code === 'PGRST205' || /Could not find the table/i.test(String(dvProbe.error.message || '')))) ||
    (jobsProbe.error && (jobsProbe.error.code === 'PGRST205' || /Could not find the table/i.test(String(jobsProbe.error.message || ''))));
  if (missing003) {
    console.log('DATABASE INTEGRATION BLOCKED: skip data_versions/update_jobs (migration 003 not applied)');
  } else {
    if (dvProbe.error) fail('data_versions read failed', dvProbe.error);
    if (jobsProbe.error) fail('update_jobs read failed', jobsProbe.error);
    const dvCount = await client.from('data_versions').select('id', { count: 'exact', head: true });
    const ujCount = await client.from('update_jobs').select('id', { count: 'exact', head: true });
    if (dvCount.error) fail('data_versions count failed', dvCount.error);
    if (ujCount.error) fail('update_jobs count failed', ujCount.error);
    assert.ok(dvCount.count === 0 || dvCount.count > 0 || dvCount.count === 0);
    console.log('ok data_versions readable count=' + dvCount.count);
    console.log('ok update_jobs readable count=' + ujCount.count);

    const {
      fetchPostgrestOpenApi,
      definition,
      columnNames,
      isPrimaryKey,
      foreignKey,
      createAnonClient,
      isAnonDenied,
    } = require('./supabaseSchemaInspect.js');
    const spec = await fetchPostgrestOpenApi();
    const dvDef = definition(spec, 'data_versions');
    const ujDef = definition(spec, 'update_jobs');
    const logsDef = definition(spec, 'admin_logs');
    assert.ok(dvDef && ujDef, 'OpenAPI must include data_versions and update_jobs');
    const dvCols = columnNames(dvDef);
    [
      'id', 'version', 'status', 'source', 'locale', 'build',
      'cards_sha256', 'collectible_sha256', 'cards_count', 'collectible_count',
      'snapshot_fingerprint', 'snapshot_meta', 'created_at', 'updated_at',
    ].forEach(function (col) {
      assert.ok(dvCols.indexOf(col) !== -1, 'missing data_versions.' + col);
    });
    const ujCols = columnNames(ujDef);
    [
      'id', 'job_type', 'status', 'data_version_id', 'source', 'locale',
      'snapshot_fingerprint', 'error_code', 'error_message',
      'started_at', 'finished_at', 'failed_at', 'created_by', 'created_at', 'updated_at',
    ].forEach(function (col) {
      assert.ok(ujCols.indexOf(col) !== -1, 'missing update_jobs.' + col);
    });
    assert.ok(isPrimaryKey(dvDef.properties.id));
    assert.ok(isPrimaryKey(ujDef.properties.id));
    assert.deepStrictEqual(foreignKey(ujDef.properties.data_version_id), { table: 'data_versions', column: 'id' });
    assert.deepStrictEqual(foreignKey(ujDef.properties.created_by), { table: 'admin_users', column: 'user_id' });
    const logProps = logsDef && logsDef.properties || {};
    Object.keys(logProps).forEach(function (col) {
      const fk = foreignKey(logProps[col]);
      assert.ok(!fk || (fk.table !== 'data_versions' && fk.table !== 'update_jobs'), 'admin_logs must not FK to 003 tables');
    });
    console.log('ok OpenAPI columns/PK/FK for 003 tables');

    if (anonKey) {
      const anon = createAnonClient();
      const deniedDv = await anon.from('data_versions').select('id').limit(1);
      const deniedJobs = await anon.from('update_jobs').select('id').limit(1);
      assert.ok(isAnonDenied(deniedDv), 'anon must not read data_versions');
      assert.ok(isAnonDenied(deniedJobs), 'anon must not read update_jobs');
      try {
        if (anon.realtime && typeof anon.realtime.disconnect === 'function') anon.realtime.disconnect();
      } catch (e) {}
      console.log('ok RLS anon deny (data_versions/update_jobs)');
    } else {
      fail('SUPABASE_ANON_KEY missing; cannot verify anon deny');
    }
  }

  console.log('ok supabaseDatabase', {
    currentSet: row.set_code,
    currentCount: current.data.length,
    settingsCount: settings.data.length,
    feedbackCount: feedback.data.length,
    logsCount: logs.data.length,
  });
}
