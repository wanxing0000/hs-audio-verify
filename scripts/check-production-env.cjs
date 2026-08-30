const { inspectSupabaseEnv } = require('../src/services/supabaseClient.js');

function present(value) {
  return value != null && String(value).trim() !== '';
}

function flag(ok) {
  return ok ? 'SET' : 'MISSING';
}

const env = process.env;
const nodeEnv = String(env.NODE_ENV || '').trim();
const audioSource = String(env.HS_AUDIO_SOURCE || '').trim();
const flags = inspectSupabaseEnv(env);

const checks = {
  NODE_ENV: nodeEnv === 'production',
  HS_AUDIO_SOURCE: audioSource === 'production',
  SUPABASE_URL: flags.hasUrl,
  SUPABASE_ANON_KEY: flags.hasAnonKey,
  SUPABASE_SERVICE_ROLE_KEY: flags.hasServiceRoleKey,
};

console.log('NODE_ENV: ' + flag(present(env.NODE_ENV)));
console.log('HS_AUDIO_SOURCE: ' + flag(present(env.HS_AUDIO_SOURCE)));
console.log('SUPABASE_URL: ' + flag(flags.hasUrl));
console.log('SUPABASE_ANON_KEY: ' + flag(flags.hasAnonKey));
console.log('SUPABASE_SERVICE_ROLE_KEY: ' + flag(flags.hasServiceRoleKey));

if (present(env.NODE_ENV) && nodeEnv !== 'production') {
  console.log('NODE_ENV_VALUE_OK: NO');
}
if (present(env.HS_AUDIO_SOURCE) && audioSource !== 'production') {
  console.log('HS_AUDIO_SOURCE_VALUE_OK: NO');
}

const valid = Object.keys(checks).every((key) => checks[key]);
console.log('status=' + (valid ? 'ENV_VALID' : 'ENV_INVALID'));
process.exit(valid ? 0 : 1);
