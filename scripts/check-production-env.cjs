const path = require('path');
const fs = require('fs');
const { inspectSupabaseEnv } = require('../src/services/supabaseClient.js');

function present(value) {
  return value != null && String(value).trim() !== '';
}

function flagRequired(ok) {
  return ok ? 'SET' : 'MISSING';
}

function flagOptional(ok) {
  return ok ? 'SET' : 'OPTIONAL/MISSING';
}

function validPort(value) {
  if (!present(value)) return false;
  const n = Number(String(value).trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

const envFile = path.resolve(process.cwd(), '.env');
const envFileExists = fs.existsSync(envFile);
if (!envFileExists) {
  console.log('.env: MISSING');
} else {
  require('dotenv').config({ path: envFile, override: false, quiet: true });
  console.log('.env: PRESENT');
}

const env = process.env;
const nodeEnv = String(env.NODE_ENV || '').trim();
const audioSource = String(env.HS_AUDIO_SOURCE || '').trim();
const miniHost = String(env.MINI_HOST || '').trim();
const flags = inspectSupabaseEnv(env);

const required = {
  NODE_ENV: nodeEnv === 'production',
  HS_AUDIO_SOURCE: audioSource === 'production',
  MINI_HOST: present(miniHost),
  MINI_PORT: validPort(env.MINI_PORT),
};

console.log('NODE_ENV: ' + flagRequired(present(env.NODE_ENV)));
console.log('HS_AUDIO_SOURCE: ' + flagRequired(present(env.HS_AUDIO_SOURCE)));
console.log('MINI_HOST: ' + flagRequired(present(env.MINI_HOST)));
console.log('MINI_PORT: ' + flagRequired(present(env.MINI_PORT)));
console.log('SUPABASE_URL: ' + flagOptional(flags.hasUrl));
console.log('SUPABASE_ANON_KEY: ' + flagOptional(flags.hasAnonKey));
console.log('SUPABASE_SERVICE_ROLE_KEY: ' + flagOptional(flags.hasServiceRoleKey));

if (present(env.NODE_ENV) && nodeEnv !== 'production') {
  console.log('NODE_ENV_VALUE_OK: NO');
}
if (present(env.HS_AUDIO_SOURCE) && audioSource !== 'production') {
  console.log('HS_AUDIO_SOURCE_VALUE_OK: NO');
}
if (present(env.MINI_PORT) && !validPort(env.MINI_PORT)) {
  console.log('MINI_PORT_VALUE_OK: NO');
}

const valid = Object.keys(required).every((key) => required[key]);
console.log('status=' + (valid ? 'ENV_VALID' : 'ENV_INVALID'));
process.exit(valid ? 0 : 1);
