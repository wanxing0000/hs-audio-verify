const { createHsjsonUpdater } = require('./hsjsonUpdater.js');
const {
  createDataVersionService,
  createSupabaseDataVersionStore,
} = require('./dataVersionService.js');
const {
  createUpdateJobService,
  createSupabaseUpdateJobStore,
} = require('./updateJobService.js');
const { createHsjsonSnapshotOrchestrator, publicSnapshotFromInspect } = require('./hsjsonSnapshotJob.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, code, error, extra) {
  const body = { ok: false, error: error, code: code };
  if (extra) Object.assign(body, extra);
  return { handled: true, status: status, body: body };
}

function isSchemaMissing(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === 'PGRST205' || /Could not find the table|schema cache/i.test(msg);
}

function publicVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    source: row.source,
    locale: row.locale,
    build: row.build || null,
    cards_sha256: row.cards_sha256,
    collectible_sha256: row.collectible_sha256,
    cards_count: row.cards_count != null ? row.cards_count : null,
    collectible_count: row.collectible_count != null ? row.collectible_count : null,
    snapshot_fingerprint: row.snapshot_fingerprint,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function publicJob(row, progress) {
  if (!row) return null;
  const out = {
    id: row.id,
    job_type: row.job_type,
    status: row.status,
    data_version_id: row.data_version_id || null,
    source: row.source || null,
    locale: row.locale || null,
    snapshot_fingerprint: row.snapshot_fingerprint || null,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    started_at: row.started_at || null,
    finished_at: row.finished_at || null,
    failed_at: row.failed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    currentStep: null,
    rollbackFailed: row.error_code === 'DATA_UPDATE_ROLLBACK_FAILED',
  };
  if (progress && progress.jobId === row.id) out.currentStep = progress.step || null;
  return out;
}

function parseUuidPath(pathname, prefix) {
  if (pathname.indexOf(prefix) !== 0) return null;
  const rest = pathname.slice(prefix.length);
  if (!UUID_RE.test(rest)) return null;
  return rest;
}

function createDataUpdateHandlers(deps) {
  deps = deps || {};
  const orch = deps.orchestrator;
  const versions = deps.versions;
  const jobs = deps.jobs;
  const updater = deps.updater;

  async function handle(req, url, auth, extras) {
    extras = extras || {};
    const pathname = url.pathname;
    const matched =
      pathname.indexOf('/api/admin/data-versions') === 0 ||
      pathname.indexOf('/api/admin/update-jobs') === 0 ||
      pathname.indexOf('/api/admin/data/') === 0;
    if (!matched) return null;
    try {
      return await handleInner(req, pathname, auth);
    } catch (e) {
      if (e && e.code === 'DATA_UPDATE_ALREADY_RUNNING') {
        return fail(409, 'DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行', {
          jobId: e.existing && e.existing.id ? e.existing.id : e.jobId || null,
        });
      }
      if (isSchemaMissing(e)) {
        return fail(503, 'DATA_SCHEMA_UNAVAILABLE', '数据版本表尚未就绪，请先执行 migration 003。');
      }
      return fail(500, e && e.code ? e.code : 'ADMIN_INTERNAL', e && (e.userMessage || '操作失败，请检查服务器状态。'), {
        jobId: e && e.jobId ? e.jobId : null,
        status: 'FAILED',
        rollbackFailed: e && e.rollbackFailed === true,
      });
    }
  }

  async function handleInner(req, pathname, auth) {
    const progress = orch && typeof orch.getProgress === 'function' ? orch.getProgress() : null;
    if (req.method === 'GET' && pathname === '/api/admin/data-versions') {
      const items = (await versions.listDataVersions(50)).map(publicVersion);
      const snapshot = updater
        ? publicSnapshotFromInspect(updater.inspectLocalSnapshot({ parseEntries: false }))
        : await orch.inspectSnapshot();
      return { handled: true, status: 200, body: { ok: true, snapshot: snapshot, items: items } };
    }

    const versionId = parseUuidPath(pathname, '/api/admin/data-versions/');
    if (req.method === 'GET' && versionId) {
      const row = await versions.getDataVersion(versionId);
      if (!row) return fail(404, 'DATA_VERSION_NOT_FOUND', '数据版本不存在');
      return { handled: true, status: 200, body: { ok: true, item: publicVersion(row) } };
    }

    if (req.method === 'GET' && pathname === '/api/admin/update-jobs') {
      const items = (await jobs.listJobs(50)).map(function (row) { return publicJob(row, progress); });
      return { handled: true, status: 200, body: { ok: true, items: items } };
    }

    const jobId = parseUuidPath(pathname, '/api/admin/update-jobs/');
    if (req.method === 'GET' && jobId) {
      const row = await jobs.getJob(jobId);
      if (!row) return fail(404, 'UPDATE_JOB_NOT_FOUND', '更新任务不存在');
      return { handled: true, status: 200, body: { ok: true, item: publicJob(row, progress) } };
    }

    if (req.method === 'POST' && pathname === '/api/admin/data/check') {
      const payload = await orch.checkRemote(auth);
      return { handled: true, status: 200, body: Object.assign({ ok: true }, payload) };
    }

    if (req.method === 'POST' && pathname === '/api/admin/data/update') {
      const result = await orch.runHsjsonSnapshotJob(auth);
      const body = {
        ok: result.status === 'UPDATED' || result.status === 'UP_TO_DATE',
        status: result.status,
        jobId: result.jobId,
        dataVersionId: result.dataVersionId || null,
      };
      if (result.status === 'UNKNOWN') {
        body.ok = false;
        body.code = 'REMOTE_UNKNOWN';
        body.error = '无法确认远程 HSJSON 是否有更新';
        return { handled: true, status: 200, body: body };
      }
      return { handled: true, status: 200, body: body };
    }

    return fail(404, 'ADMIN_NOT_FOUND', 'not found');
  }

  return { handle: handle };
}

function createSupabaseDataUpdateDeps(options) {
  options = options || {};
  const client = options.client;
  const rootDir = options.rootDir;
  const updater = options.updater || createHsjsonUpdater({ rootDir: rootDir });
  const versions = createDataVersionService(createSupabaseDataVersionStore(client));
  const jobs = createUpdateJobService(createSupabaseUpdateJobStore(client));
  const lock = options.lock;

  async function writeLog(entry) {
    const r = await client.from('admin_logs').insert(entry);
    if (r.error) throw r.error;
  }

  const orchestrator = createHsjsonSnapshotOrchestrator({
    updater: updater,
    versions: versions,
    jobs: jobs,
    writeLog: writeLog,
    lock: lock,
    rootDir: rootDir,
    runPhase08: options.runPhase08,
    runPhase11: options.runPhase11,
    validateIndex: options.validateIndex,
    validateAudio: options.validateAudio,
    validateCatalog: options.validateCatalog,
    miniRegression: options.miniRegression,
    backupProduction: options.backupProduction,
    restoreProduction: options.restoreProduction,
    reloadCatalog: options.reloadCatalog,
    getLatestSetCode: options.getLatestSetCode,
    miniPort: options.miniPort,
    onProgress: options.onProgress,
  });

  return {
    updater: updater,
    versions: versions,
    jobs: jobs,
    orchestrator: orchestrator,
    writeLog: writeLog,
  };
}

module.exports = {
  createDataUpdateHandlers,
  createSupabaseDataUpdateDeps,
  publicVersion,
  publicJob,
};
