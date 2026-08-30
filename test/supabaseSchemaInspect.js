const { createClient } = require('@supabase/supabase-js');

function envTrim(key) {
  return String(process.env[key] || '').trim();
}

async function fetchPostgrestOpenApi() {
  const url = envTrim('SUPABASE_URL').replace(/\/$/, '');
  const key = envTrim('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(url + '/rest/v1/', {
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/openapi+json',
    },
  });
  if (!res.ok) {
    const err = new Error('openapi HTTP ' + res.status);
    err.code = 'OPENAPI_UNAVAILABLE';
    throw err;
  }
  return res.json();
}

function definition(spec, name) {
  const defs = spec.definitions || (spec.components && spec.components.schemas) || {};
  return defs[name] || null;
}

function columnNames(def) {
  return Object.keys((def && def.properties) || {});
}

function isPrimaryKey(prop) {
  return /<pk\/>/.test(String((prop && prop.description) || ''));
}

function foreignKey(prop) {
  const m = /<fk table='([^']+)' column='([^']+)'\/>/.exec(String((prop && prop.description) || ''));
  if (!m) return null;
  return { table: m[1], column: m[2] };
}

function createAnonClient() {
  return createClient(envTrim('SUPABASE_URL'), envTrim('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isAnonDenied(result) {
  if (result && result.error) {
    const code = String(result.error.code || '');
    const msg = String(result.error.message || '');
    return code === '42501' || /permission denied/i.test(msg);
  }
  return !result.data || result.data.length === 0;
}

module.exports = {
  fetchPostgrestOpenApi,
  definition,
  columnNames,
  isPrimaryKey,
  foreignKey,
  createAnonClient,
  isAnonDenied,
};
