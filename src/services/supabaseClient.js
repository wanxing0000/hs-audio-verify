const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function readTrim(env, key) {
  const raw = env && env[key];
  if (raw == null) return '';
  return String(raw).trim();
}

function inspectSupabaseEnv(env) {
  env = env || process.env;
  return {
    hasUrl: !!readTrim(env, 'SUPABASE_URL'),
    hasServiceRoleKey: !!readTrim(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    hasAnonKey: !!readTrim(env, 'SUPABASE_ANON_KEY'),
  };
}

function supabaseConfigError(message) {
  const err = new Error(message);
  err.code = 'SUPABASE_CONFIG_INVALID';
  err.userMessage = message;
  return err;
}

function createSupabaseAdmin(env) {
  env = env || process.env;
  const url = readTrim(env, 'SUPABASE_URL');
  const serviceRoleKey = readTrim(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw supabaseConfigError('缺少 SUPABASE_URL');
  if (!serviceRoleKey) throw supabaseConfigError('缺少 SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function tryCreateSupabaseAdmin(env) {
  const flags = inspectSupabaseEnv(env);
  if (!flags.hasUrl || !flags.hasServiceRoleKey) {
    return { ok: false, configured: false, client: null, flags: flags };
  }
  const client = createSupabaseAdmin(env);
  return { ok: true, configured: true, client: client, flags: flags };
}

function loadProjectEnv(rootDir) {
  const dotenv = require('dotenv');
  const dir = rootDir || process.cwd();
  dotenv.config({ path: path.join(dir, '.env') });
}

module.exports = {
  inspectSupabaseEnv,
  createSupabaseAdmin,
  tryCreateSupabaseAdmin,
  loadProjectEnv,
};
