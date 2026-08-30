const { tryCreateSupabaseAdmin } = require('./supabaseClient.js');

function createLatestSetRuntime(initial) {
  initial = initial || {};
  let config = initial.config || null;
  let loadError = initial.error || null;
  let source = initial.source || 'none';
  let reason = initial.reason || null;
  return {
    getLatestSetConfig: function () { return config; },
    getLatestSetError: function () { return loadError; },
    getSource: function () { return source; },
    getReason: function () { return reason; },
    setLatestSetConfig: function (next, src, why) {
      config = next;
      loadError = null;
      source = src || 'db';
      reason = why || null;
    },
    setLatestSetFailure: function (err, src, why) {
      config = null;
      loadError = err || null;
      source = src || 'none';
      reason = why || null;
    },
  };
}

function dbRowToFileShape(row) {
  row = row || {};
  return {
    set: row.set_code,
    nameEn: row.name_en,
    nameZh: row.name_zh,
    releaseDate: row.release_date ? String(row.release_date) : '',
    source: row.source || '',
    sourceUrl: row.source_url || '',
    verified: row.verified === true,
  };
}

function dbRowToLatestConfig(row, parseLatestSetConfig) {
  return parseLatestSetConfig(dbRowToFileShape(row));
}

async function loadLatestRuntime(opts) {
  const parseLatestSetConfig = opts.parseLatestSetConfig;
  const loadLatestSetConfig = opts.loadLatestSetConfig;
  const jsonPath = opts.jsonPath;
  const client = opts.client;
  const runtime = createLatestSetRuntime();

  function applyJsonFallback(why) {
    try {
      runtime.setLatestSetConfig(loadLatestSetConfig(jsonPath), 'json-fallback', why);
      return runtime;
    } catch (e) {
      runtime.setLatestSetFailure(e, 'none', why);
      return runtime;
    }
  }

  if (!client) return applyJsonFallback('NO_CLIENT');

  let result;
  try {
    result = await client.from('latest_sets').select('*').eq('is_current', true).maybeSingle();
  } catch (e) {
    return applyJsonFallback('DB_ERROR');
  }
  if (result.error) return applyJsonFallback('DB_ERROR');
  if (!result.data) {
    const err = new Error('尚未设置最新扩展包');
    err.code = 'LATEST_SET_NOT_CONFIGURED';
    runtime.setLatestSetFailure(err, 'db', 'DB_NO_CURRENT');
    return runtime;
  }
  try {
    runtime.setLatestSetConfig(dbRowToLatestConfig(result.data, parseLatestSetConfig), 'db');
    return runtime;
  } catch (e) {
    runtime.setLatestSetFailure(e, 'db', 'DB_INVALID');
    return runtime;
  }
}

async function loadLatestRuntimeFromEnv(opts) {
  const boot = tryCreateSupabaseAdmin();
  return loadLatestRuntime({
    parseLatestSetConfig: opts.parseLatestSetConfig,
    loadLatestSetConfig: opts.loadLatestSetConfig,
    jsonPath: opts.jsonPath,
    client: boot.client,
  });
}

module.exports = {
  createLatestSetRuntime,
  dbRowToFileShape,
  dbRowToLatestConfig,
  loadLatestRuntime,
  loadLatestRuntimeFromEnv,
};
