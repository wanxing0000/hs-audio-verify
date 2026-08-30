const { createHsjsonUpdater } = require('./hsjsonUpdater.js');
const { snapshotFingerprint } = require('./dataVersionService.js');
const { sanitizeJobMessage } = require('./updateJobService.js');
const { createHsjsonUpdatePipeline, mapErrorCode, PIPELINE_STEPS } = require('./hsjsonUpdatePipeline.js');

function orchError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.userMessage = message;
  if (extra) Object.assign(err, extra);
  return err;
}

function publicCheckPayload(result) {
  result = result || {};
  const remote = result.remote || {};
  const local = result.local || {};
  function slimRemote(side) {
    if (!side) return null;
    return {
      url: side.url || null,
      etag: side.etag || null,
      lastModified: side.lastModified || null,
      contentLength: side.contentLength != null ? side.contentLength : null,
    };
  }
  function slimLocal(side) {
    if (!side) return null;
    return {
      url: side.url || null,
      etag: side.etag || null,
      lastModified: side.lastModified || null,
      contentLength: side.contentLength != null ? side.contentLength : null,
      sha256: side.sha256 || null,
      byteSize: side.byteSize != null ? side.byteSize : null,
      entryCount: side.entryCount != null ? side.entryCount : null,
    };
  }
  return {
    status: result.status || 'UNKNOWN',
    remote: {
      cards: slimRemote(remote.cards),
      collectible: slimRemote(remote.collectible),
    },
    local: {
      cards: slimLocal(local.cards),
      collectible: slimLocal(local.collectible),
    },
  };
}

function publicSnapshotFromInspect(local) {
  local = local || {};
  const meta = local.meta || {};
  const cards = local.cards || {};
  const collectible = local.collectible || {};
  const metaCards = meta.cards || {};
  const metaColl = meta.collectible || {};
  return {
    source: meta.source || 'hearthstonejson',
    locale: meta.locale || 'zhCN',
    build: meta.build == null || String(meta.build).trim() === '' ? null : String(meta.build).trim(),
    cards_count: metaCards.entryCount != null ? metaCards.entryCount : (cards.entryCount != null ? cards.entryCount : null),
    collectible_count: metaColl.entryCount != null ? metaColl.entryCount : (collectible.entryCount != null ? collectible.entryCount : null),
    cards_sha256: cards.sha256 || metaCards.sha256 || null,
    collectible_sha256: collectible.sha256 || metaColl.sha256 || null,
    downloadedAt: metaCards.downloadedAt || metaColl.downloadedAt || null,
  };
}

function createProcessMutex() {
  return { inProgress: false };
}

function createHsjsonSnapshotOrchestrator(deps) {
  deps = deps || {};
  const updater = deps.updater || createHsjsonUpdater({ rootDir: deps.rootDir });
  const versions = deps.versions;
  const jobs = deps.jobs;
  const lock = deps.lock || createProcessMutex();
  const source = deps.source || 'hearthstonejson';
  const locale = deps.locale || 'zhCN';

  async function writeLog(auth, action, details) {
    if (typeof deps.writeLog !== 'function') return;
    try {
      await deps.writeLog({
        admin_user_id: auth && auth.admin ? auth.admin.userId : null,
        action: action,
        target_type: 'hsjson_snapshot',
        target_id: details && (details.jobId || details.dataVersionId) ? String(details.jobId || details.dataVersionId) : null,
        details: details || {},
      });
    } catch (e) {}
  }

  async function inspectSnapshot() {
    return publicSnapshotFromInspect(updater.inspectLocalSnapshot({ parseEntries: false }));
  }

  const pipeline = deps.pipeline || createHsjsonUpdatePipeline({
    updater: updater,
    versions: versions,
    jobs: jobs,
    lock: lock,
    rootDir: deps.rootDir,
    source: source,
    locale: locale,
    runPhase08: deps.runPhase08,
    runPhase11: deps.runPhase11,
    validateIndex: deps.validateIndex,
    validateAudio: deps.validateAudio,
    validateCatalog: deps.validateCatalog,
    miniRegression: deps.miniRegression,
    backupProduction: deps.backupProduction,
    restoreProduction: deps.restoreProduction,
    reloadCatalog: deps.reloadCatalog,
    miniPort: deps.miniPort,
    onProgress: deps.onProgress,
  });

  function localFingerprint() {
    const local = updater.inspectLocalSnapshot({ parseEntries: false });
    const cardsSha = local.cards && local.cards.sha256;
    const collSha = local.collectible && local.collectible.sha256;
    if (!cardsSha || !collSha) return { fp: null, local: local };
    return {
      fp: snapshotFingerprint({
        source: source,
        locale: locale,
        cardsSha256: cardsSha,
        collectibleSha256: collSha,
      }),
      local: local,
    };
  }

  async function checkRemote(auth) {
    if (lock.inProgress) {
      throw orchError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行');
    }
    lock.inProgress = true;
    let job = null;
    try {
      const blocking = await jobs.findBlockingJob('HSJSON_SNAPSHOT');
      if (blocking) {
        throw orchError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行', {
          existing: blocking,
        });
      }

      const ident = localFingerprint();
      const fp = ident.fp;
      const result = await updater.checkRemoteSnapshot();
      const payload = publicCheckPayload(result);

      if (result.status === 'UP_TO_DATE' && fp) {
        const reuse = await jobs.findSucceededByFingerprint(fp);
        if (reuse) {
          await writeLog(auth, 'data.update.check', {
            jobId: reuse.id,
            dataVersionId: null,
            status: payload.status,
            source: source,
            locale: locale,
            snapshotFingerprint: fp,
          });
          return Object.assign({ jobId: reuse.id, dataVersionId: null, reused: true }, payload);
        }
      }

      job = await jobs.createJob({
        job_type: 'HSJSON_SNAPSHOT',
        source: source,
        locale: locale,
        snapshotFingerprint: fp,
        created_by: auth && auth.admin ? auth.admin.userId : null,
      });
      await writeLog(auth, 'data.update.start', {
        jobId: job.id,
        status: 'PENDING',
        source: source,
        locale: locale,
      });
      await jobs.updateJobStatus(job.id, 'CHECKING');

      if (result.status === 'UNKNOWN') {
        job = await jobs.failJob(job.id, 'REMOTE_UNKNOWN', '无法确认远程 HSJSON 是否有更新');
        await writeLog(auth, 'data.update.failed', {
          jobId: job.id,
          dataVersionId: null,
          status: 'UNKNOWN',
          source: source,
          locale: locale,
        });
        return Object.assign({ jobId: job.id, dataVersionId: null }, payload);
      }

      job = await jobs.completeJob(job.id, { snapshotFingerprint: fp });
      await writeLog(auth, 'data.update.check', {
        jobId: job.id,
        dataVersionId: null,
        status: payload.status,
        source: source,
        locale: locale,
        snapshotFingerprint: fp,
      });
      await writeLog(auth, 'data.update.success', {
        jobId: job.id,
        dataVersionId: null,
        status: payload.status,
        source: source,
        locale: locale,
      });
      return Object.assign({ jobId: job.id, dataVersionId: null }, payload);
    } catch (e) {
      if (e && e.code === 'DATA_UPDATE_ALREADY_RUNNING') throw e;
      if (job && job.id && job.status !== 'FAILED' && job.status !== 'SUCCEEDED') {
        try {
          await jobs.failJob(job.id, e.code || 'UPDATE_FAILED', e.userMessage || e.message);
        } catch (err) {}
        e.jobId = e.jobId || job.id;
      }
      throw e;
    } finally {
      lock.inProgress = false;
    }
  }

  async function runHsjsonSnapshotJob(auth) {
    if (lock.inProgress) {
      throw orchError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行');
    }
    lock.inProgress = true;
    lock.progress = { jobId: null, step: 'Started', steps: PIPELINE_STEPS };
    let job = null;
    try {
      const blocking = await jobs.findBlockingJob('HSJSON_SNAPSHOT');
      if (blocking) {
        throw orchError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行', {
          existing: blocking,
        });
      }
      job = await jobs.createJob({
        job_type: 'HSJSON_SNAPSHOT',
        source: source,
        locale: locale,
        created_by: auth && auth.admin ? auth.admin.userId : null,
      });
      lock.progress.jobId = job.id;
      lock.progress.step = 'Checking';
      await writeLog(auth, 'data.update.start', {
        jobId: job.id,
        status: 'PENDING',
        source: source,
        locale: locale,
      });

      await jobs.updateJobStatus(job.id, 'CHECKING');
      const ident = localFingerprint();
      const check = await updater.checkRemoteSnapshot();

      if (check.status === 'UP_TO_DATE') {
        job = await jobs.completeJob(job.id, { snapshotFingerprint: ident.fp });
        await writeLog(auth, 'data.update.success', {
          jobId: job.id,
          dataVersionId: null,
          status: 'UP_TO_DATE',
          source: source,
          locale: locale,
          snapshotFingerprint: ident.fp,
        });
        lock.progress.step = 'Completed';
        return {
          status: 'UP_TO_DATE',
          jobId: job.id,
          dataVersionId: null,
          check: publicCheckPayload(check),
        };
      }

      if (check.status !== 'UPDATED_AVAILABLE') {
        job = await jobs.failJob(job.id, 'REMOTE_UNKNOWN', '无法确认远程 HSJSON 是否有更新');
        await writeLog(auth, 'data.update.failed', {
          jobId: job.id,
          dataVersionId: null,
          status: 'UNKNOWN',
          source: source,
          locale: locale,
        });
        return {
          status: 'UNKNOWN',
          jobId: job.id,
          dataVersionId: null,
          check: publicCheckPayload(check),
        };
      }

      await jobs.updateJobStatus(job.id, 'DOWNLOADING');
      lock.progress.step = 'Downloading';
      const applied = await pipeline.runUpdatedAvailable({
        auth: auth,
        job: job,
        check: check,
        localFingerprint: ident,
        beforeLatestSet: typeof deps.getLatestSetCode === 'function' ? deps.getLatestSetCode() : null,
      });

      if (applied && applied.status === 'UP_TO_DATE') {
        const current = await jobs.getJob(job.id);
        if (current && current.status === 'DOWNLOADING') {
          await jobs.updateJobStatus(job.id, 'VALIDATING');
        }
        const after = await jobs.getJob(job.id);
        if (after && after.status === 'VALIDATING') {
          await jobs.updateJobStatus(job.id, 'READY');
        }
        job = await jobs.completeJob(job.id, { snapshotFingerprint: applied.fingerprint || ident.fp });
        await writeLog(auth, 'data.update.success', {
          jobId: job.id,
          dataVersionId: null,
          status: 'UP_TO_DATE',
          source: source,
          locale: locale,
          snapshotFingerprint: applied.fingerprint || ident.fp,
        });
        lock.progress.step = 'Completed';
        return {
          status: 'UP_TO_DATE',
          jobId: job.id,
          dataVersionId: null,
          check: publicCheckPayload(check),
        };
      }

      job = await jobs.completeJob(job.id, {
        dataVersionId: applied.dataVersionId,
        snapshotFingerprint: applied.fingerprint,
      });
      await writeLog(auth, 'data.update.success', {
        jobId: job.id,
        dataVersionId: applied.dataVersionId,
        status: 'UPDATED',
        source: source,
        locale: locale,
        snapshotFingerprint: applied.fingerprint,
      });
      lock.progress.step = 'Completed';
      return {
        status: 'UPDATED',
        jobId: job.id,
        dataVersionId: applied.dataVersionId,
        dataVersion: applied.dataVersion,
        check: publicCheckPayload(check),
      };
    } catch (e) {
      if (e && e.code === 'DATA_UPDATE_ALREADY_RUNNING') throw e;
      const code = mapErrorCode((e && e.code) || 'UPDATE_FAILED');
      e.code = code;
      e.userMessage = sanitizeJobMessage(e.userMessage || e.message || '操作失败');
      if (job && job.id && job.status !== 'FAILED' && job.status !== 'SUCCEEDED') {
        try {
          await jobs.failJob(job.id, code, e.userMessage);
          await writeLog(auth, 'data.update.failed', {
            jobId: job.id,
            dataVersionId: e.dataVersionId || null,
            status: 'FAILED',
            source: source,
            locale: locale,
            error: code,
            rollbackFailed: e.rollbackFailed === true,
          });
        } catch (err) {}
        e.jobId = e.jobId || job.id;
      }
      throw e;
    } finally {
      lock.inProgress = false;
    }
  }

  return {
    lock: lock,
    inspectSnapshot: inspectSnapshot,
    checkRemote: checkRemote,
    runHsjsonSnapshotJob: runHsjsonSnapshotJob,
    publicCheckPayload: publicCheckPayload,
    getProgress: function () { return lock.progress || null; },
  };
}

module.exports = {
  createHsjsonSnapshotOrchestrator,
  createProcessMutex,
  publicCheckPayload,
  publicSnapshotFromInspect,
};
