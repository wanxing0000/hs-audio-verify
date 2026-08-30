const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  inspectSupabaseEnv,
  createSupabaseAdmin,
  tryCreateSupabaseAdmin,
  loadProjectEnv,
} = require('../src/services/supabaseClient.js');

const ROOT = path.resolve(__dirname, '..');
const SECRET_SAMPLE = 'test-service-role-not-for-production';

function expectConfigError(env) {
  let err = null;
  try {
    createSupabaseAdmin(env);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected SUPABASE_CONFIG_INVALID');
  assert.strictEqual(err.code, 'SUPABASE_CONFIG_INVALID');
  const text = String(err.message || '') + String(err.userMessage || '');
  assert.ok(!text.includes(SECRET_SAMPLE));
  return err;
}

{
  const flags = inspectSupabaseEnv({
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_ANON_KEY: '',
  });
  assert.strictEqual(flags.hasUrl, false);
  assert.strictEqual(flags.hasServiceRoleKey, false);
  assert.strictEqual(flags.hasAnonKey, false);
  assert.deepStrictEqual(Object.keys(flags).sort(), ['hasAnonKey', 'hasServiceRoleKey', 'hasUrl']);
}

{
  const err = expectConfigError({
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: SECRET_SAMPLE,
  });
  assert.ok(err.message.includes('SUPABASE_URL'));
}

{
  const err = expectConfigError({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.ok(err.message.includes('SUPABASE_SERVICE_ROLE_KEY'));
}

{
  const client = createSupabaseAdmin({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: SECRET_SAMPLE,
  });
  assert.ok(client);
  assert.strictEqual(typeof client.from, 'function');
  assert.strictEqual(typeof client.auth, 'object');
}

{
  const skipped = tryCreateSupabaseAdmin({
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.configured, false);
  assert.strictEqual(skipped.client, null);
}

{
  const ready = tryCreateSupabaseAdmin({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: SECRET_SAMPLE,
  });
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.configured, true);
  assert.ok(ready.client);
}

{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'supabaseClient.js'), 'utf8');
  assert.ok(src.includes('SUPABASE_URL'));
  assert.ok(src.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(src.includes('createClient'));
  assert.ok(!/sb_secret_|eyJhbGci/.test(src));
}

{
  const miniSrc = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');
  assert.ok(miniSrc.includes('tryCreateSupabaseAdmin'));
  assert.ok(miniSrc.includes('loadProjectEnv'));
}

{
  const runMini = fs.readFileSync(path.join(ROOT, 'scripts', 'run-mini.cjs'), 'utf8');
  assert.ok(runMini.includes("require('dotenv')"));
}

{
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gitignore.split(/\r?\n/).some((line) => line.trim() === '.env'));
}

function walkJs(dir, acc) {
  const names = fs.readdirSync(dir);
  for (let i = 0; i < names.length; i++) {
    const p = path.join(dir, names[i]);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkJs(p, acc);
    else if (/\.(js|wxml|wxss|json)$/.test(names[i])) acc.push(p);
  }
}

{
  const files = [];
  walkJs(path.join(ROOT, 'miniprogram'), files);
  walkJs(path.join(ROOT, 'public'), files);
  for (let i = 0; i < files.length; i++) {
    const text = fs.readFileSync(files[i], 'utf8');
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|@supabase\/supabase-js|createSupabaseAdmin/.test(text), files[i]);
  }
}

loadProjectEnv(ROOT);
const liveFlags = inspectSupabaseEnv(process.env);
assert.ok(typeof liveFlags.hasUrl === 'boolean');
assert.ok(typeof liveFlags.hasServiceRoleKey === 'boolean');
assert.ok(typeof liveFlags.hasAnonKey === 'boolean');

console.log('ok supabaseClient', {
  processHasUrl: liveFlags.hasUrl,
  processHasServiceRoleKey: liveFlags.hasServiceRoleKey,
  processHasAnonKey: liveFlags.hasAnonKey,
});
