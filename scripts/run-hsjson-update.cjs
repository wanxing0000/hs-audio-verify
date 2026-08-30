const { loadProjectEnv, tryCreateSupabaseAdmin } = require('../src/services/supabaseClient.js');
const { createHsjsonUpdater } = require('../src/services/hsjsonUpdater.js');
const { createSupabaseDataUpdateDeps } = require('../src/services/dataUpdateAdmin.js');

function fail(code, message) {
  console.log('[hsjson] status=FAILED');
  console.log('[hsjson] error=' + code);
  if (message) console.log('[hsjson] ' + message);
  console.log('[hsjson] current snapshot preserved');
}

function isSchemaMissing(err) {
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || '');
  return code === 'PGRST205' || code === 'DATA_SCHEMA_UNAVAILABLE' || /Could not find the table|schema cache/i.test(msg);
}

async function runLegacyUpdate(updater) {
  console.log('[hsjson] update started');
  console.log('[hsjson] downloading cards');
  console.log('[hsjson] downloading collectible');
  const staging = await updater.downloadSnapshotToStaging();
  console.log('[hsjson] validating snapshot');
  let validation;
  try {
    validation = updater.validateSnapshot(staging.dir);
  } catch (e) {
    fail((e && e.code) || 'VALIDATION_FAILED', e && (e.userMessage || e.message));
    process.exitCode = 1;
    return;
  }
  console.log('[hsjson] cards=' + validation.cross.cardsCount);
  console.log('[hsjson] collectible=' + validation.cross.collectibleCount);
  console.log('[hsjson] overlap=' + validation.cross.overlapCount);
  console.log('[hsjson] committing snapshot');
  try {
    updater.commitSnapshot(staging, validation);
  } catch (e) {
    fail((e && e.code) || 'COMMIT_FAILED', e && (e.userMessage || e.message));
    process.exitCode = 1;
    return;
  }
  console.log('[hsjson] snapshot committed');
  console.log('[hsjson] status=UPDATED');
}

(async function () {
  loadProjectEnv(process.cwd());
  const updater = createHsjsonUpdater({ rootDir: process.cwd() });
  const boot = tryCreateSupabaseAdmin();
  if (boot.client) {
    try {
      const deps = createSupabaseDataUpdateDeps({
        client: boot.client,
        rootDir: process.cwd(),
        updater: updater,
      });
      console.log('[hsjson] update started');
      const result = await deps.orchestrator.runHsjsonSnapshotJob(null);
      console.log('[hsjson] status=' + result.status);
      if (result.jobId) console.log('[hsjson] jobId=' + result.jobId);
      if (result.dataVersionId) console.log('[hsjson] dataVersionId=' + result.dataVersionId);
      if (result.status === 'UP_TO_DATE') {
        console.log('[hsjson] no snapshot change');
        return;
      }
      if (result.status === 'UPDATED') {
        console.log('[hsjson] snapshot committed');
        return;
      }
      if (result.status === 'UNKNOWN') {
        console.log('[hsjson] status=UNKNOWN');
        process.exitCode = 0;
        return;
      }
    } catch (e) {
      if (isSchemaMissing(e) || (e && e.code === 'DATA_SCHEMA_UNAVAILABLE')) {
        console.log('[hsjson] data_version skipped: migration 003 not applied');
      } else if (e && e.code === 'DATA_UPDATE_ALREADY_RUNNING') {
        fail('DATA_UPDATE_ALREADY_RUNNING', e.userMessage || e.message);
        process.exitCode = 1;
        return;
      } else {
        fail((e && e.code) || 'UPDATE_FAILED', e && (e.userMessage || e.message));
        process.exitCode = 1;
        return;
      }
    }
  }
  try {
    await runLegacyUpdate(updater);
  } catch (e) {
    const code = (e && e.code) || 'DOWNLOAD_FAILED';
    fail(code, e && (e.userMessage || e.message));
    process.exitCode = 1;
  }
})();
