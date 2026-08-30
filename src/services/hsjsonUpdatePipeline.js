'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { snapshotFingerprint } = require('./dataVersionService.js');
const { sanitizeJobMessage } = require('./updateJobService.js');
const { hsjsonError } = require('./hsjsonUpdater.js');
const { validateFromDisk } = require('../validation/validateCardVoiceIndex.js');
const { validateCardAudioIndex } = require('../validation/validateCardAudioIndex.js');
const { buildCatalog, shouldPublish, VERIFY_IDS } = require('../miniprogram/catalogAdapter.js');

const PIPELINE_STEPS = [
  'Started',
  'Checking',
  'Downloading',
  'Validating',
  'Committing',
  'Phase08',
  'Phase11',
  'Catalog validation',
  'Completed',
];

const SNAPSHOT_RELS = [
  'data/hearthstonejson/zhCN/cards.json',
  'data/hearthstonejson/zhCN/cards.collectible.json',
  'data/hearthstonejson/zhCN/snapshot-meta.json',
];

const INDEX_RELS = [
  'data/index/card-voice-index.json',
  'data/index/audio-index.json',
  'data/index/card-audio-index.json',
  'data/index/music-index.json',
  'data/index/music-assets.json',
  'data/index/manifest.json',
  'data/index/latest-set.json',
  'data/index/card-audio-index-diff.json',
  'data/index/card-audio-index-report.md',
  'data/index/cache/carddef-sounds.json',
  'data/index/cache/guid-voice-index.json',
  'data/index/cache/phase-0.8-stats.json',
  'data/voice-verification/audio-index.json',
  'data/voice-verification/phase-0.8-report.md',
  'data/voice-verification/phase-0.8-unresolved.json',
  'data/voice-verification/phase-0.8-sample.json',
  'data/audio-verification/audio-bundle-resolution-cache.json',
];

const ALL_BACKUP_RELS = SNAPSHOT_RELS.concat(INDEX_RELS);

function pipelineError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.userMessage = message;
  if (extra) Object.assign(err, extra);
  return err;
}

function mapErrorCode(code) {
  const raw = String(code || '');
  if (raw === 'DOWNLOAD_FAILED') return 'HSJSON_DOWNLOAD_FAILED';
  if (raw === 'VALIDATION_FAILED') return 'HSJSON_VALIDATION_FAILED';
  if (raw === 'COMMIT_FAILED' || raw === 'UPDATE_FAILED') return 'HSJSON_COMMIT_FAILED';
  return raw || 'UPDATE_FAILED';
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function rmIfExists(p) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {}
}

function readJsonSafe(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function backupProduction(rootDir, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const files = [];
  ALL_BACKUP_RELS.forEach(function (rel) {
    const src = path.join(rootDir, rel);
    const dest = path.join(backupDir, rel);
    const existed = copyIfExists(src, dest);
    files.push({ rel: rel, existed: existed });
  });
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    files: files,
    createdAt: new Date().toISOString(),
  }, null, 2));
  return { dir: backupDir, files: files };
}

function restoreProduction(rootDir, backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw pipelineError('DATA_UPDATE_ROLLBACK_FAILED', '备份清单缺失，无法回滚');
  }
  const manifest = readJsonSafe(manifestPath);
  const files = manifest.files || [];
  files.forEach(function (entry) {
    const dest = path.join(rootDir, entry.rel);
    const src = path.join(backupDir, entry.rel);
    if (entry.existed) {
      if (!fs.existsSync(src)) {
        throw pipelineError('DATA_UPDATE_ROLLBACK_FAILED', '备份文件缺失，无法回滚');
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    } else {
      rmIfExists(dest);
    }
  });
}

function spawnProjectScript(rootDir, scriptRel, timeoutMs) {
  const result = spawnSync(process.execPath, [path.join(rootDir, scriptRel)], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs || 30 * 60 * 1000,
  });
  const stdout = sanitizeJobMessage(result.stdout || '').slice(0, 400);
  const stderr = sanitizeJobMessage(result.stderr || '').slice(0, 400);
  return {
    status: result.status,
    stdout: stdout,
    stderr: stderr,
    error: result.error ? sanitizeJobMessage(result.error.message) : null,
  };
}

function expectedIndexFilesAfterPhase08(rootDir) {
  return [
    path.join(rootDir, 'data', 'index', 'card-voice-index.json'),
    path.join(rootDir, 'data', 'index', 'audio-index.json'),
    path.join(rootDir, 'data', 'index', 'manifest.json'),
  ];
}

function expectedIndexFilesAfterPhase11(rootDir) {
  return [
    path.join(rootDir, 'data', 'index', 'card-audio-index.json'),
    path.join(rootDir, 'data', 'index', 'music-index.json'),
    path.join(rootDir, 'data', 'index', 'music-assets.json'),
  ];
}

function assertFilesExist(files, code) {
  for (let i = 0; i < files.length; i++) {
    if (!fs.existsSync(files[i])) {
      throw pipelineError(code, '索引输出文件缺失');
    }
    const st = fs.statSync(files[i]);
    if (!st.size) throw pipelineError(code, '索引输出文件为空');
  }
}

function validateIndexOnDisk(rootDir) {
  const result = validateFromDisk(rootDir);
  if (!result || result.ok !== true) {
    throw pipelineError('INDEX_VALIDATION_FAILED', '语音索引校验失败');
  }
  if (!(result.cardCount > 0)) {
    throw pipelineError('INDEX_VALIDATION_FAILED', '语音索引为空');
  }
  return result;
}

function validateAudioOnDisk(rootDir) {
  let unified;
  let musicIndex;
  let musicAssets;
  let cards;
  try {
    unified = readJsonSafe(path.join(rootDir, 'data', 'index', 'card-audio-index.json'));
    musicIndex = readJsonSafe(path.join(rootDir, 'data', 'index', 'music-index.json'));
    musicAssets = readJsonSafe(path.join(rootDir, 'data', 'index', 'music-assets.json'));
    cards = readJsonSafe(path.join(rootDir, 'data', 'hearthstonejson', 'zhCN', 'cards.json'));
  } catch (e) {
    throw pipelineError('INDEX_VALIDATION_FAILED', '音频索引无法解析');
  }
  if (!unified.schemaVersion || !unified.clientVersion || !unified.cards) {
    throw pipelineError('INDEX_VALIDATION_FAILED', '音频索引缺少 schema/clientVersion');
  }
  const cardCount = Object.keys(unified.cards).length;
  if (!cardCount) throw pipelineError('INDEX_VALIDATION_FAILED', '音频索引为空');
  const result = validateCardAudioIndex({
    unified: unified,
    musicIndex: musicIndex,
    musicAssets: musicAssets,
    cards: cards,
    clientVersion: unified.clientVersion,
  });
  if (!result || result.ok !== true) {
    throw pipelineError('INDEX_VALIDATION_FAILED', '音频索引校验失败');
  }
  return { ok: true, cardCount: cardCount, unified: unified };
}

function validateCatalogBuild(unified) {
  if (!unified || !unified.cards) {
    throw pipelineError('CATALOG_VALIDATION_FAILED', 'Catalog 源索引无效');
  }
  const catalog = buildCatalog(unified);
  if (!catalog || !Array.isArray(catalog.cards) || !catalog.cards.length) {
    throw pipelineError('CATALOG_VALIDATION_FAILED', 'Catalog 为空');
  }
  if (!catalog.byId || typeof catalog.byId !== 'object') {
    throw pipelineError('CATALOG_VALIDATION_FAILED', 'Catalog byId 无效');
  }
  const fold = catalog.foldStats || {};
  if (fold.before > 0 && fold.after === 0) {
    throw pipelineError('CATALOG_VALIDATION_FAILED', 'Catalog fold 结果异常');
  }
  if (Object.keys(catalog.byId).length === 0) {
    throw pipelineError('CATALOG_VALIDATION_FAILED', 'Catalog byId 为空');
  }
  for (let i = 0; i < VERIFY_IDS.length; i++) {
    const id = VERIFY_IDS[i];
    const raw = unified.cards[id];
    if (!raw || !shouldPublish(raw)) continue;
    if (!catalog.byId[id]) {
      const folded = catalog.cards.some(function (c) { return c && c.id === id; });
      if (!folded) {
        throw pipelineError('CATALOG_VALIDATION_FAILED', '关键卡牌无法进入 Catalog');
      }
    }
  }
  return { ok: true, catalog: catalog };
}

function httpJson(urlPath, port) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port || 8767,
      path: urlPath,
      method: 'GET',
      timeout: 8000,
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
        resolve({ status: res.statusCode, body: body, raw: raw });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

async function defaultMiniRegression(opts) {
  opts = opts || {};
  if (typeof opts.reloadCatalog === 'function') {
    opts.reloadCatalog();
  }
  const port = opts.port || 8767;
  let health;
  try {
    health = await httpJson('/api/mini/health', port);
  } catch (e) {
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND')) {
      return { ok: true, skipped: true, reason: 'mini_not_running' };
    }
    throw pipelineError('MINI_REGRESSION_FAILED', 'Mini health 检查失败');
  }
  if (health.status !== 200 || !health.body || health.body.ok !== true) {
    throw pipelineError('MINI_REGRESSION_FAILED', 'Mini health 非 200');
  }
  let latest;
  try {
    latest = await httpJson('/api/mini/latest?page=1&pageSize=1', port);
  } catch (e) {
    throw pipelineError('MINI_REGRESSION_FAILED', 'Mini latest 检查失败');
  }
  if (latest.status !== 200 || !latest.body || !latest.body.set) {
    throw pipelineError('MINI_REGRESSION_FAILED', 'Mini latest 非 200');
  }
  if (opts.beforeLatestSet && latest.body.set !== opts.beforeLatestSet) {
    throw pipelineError('MINI_REGRESSION_FAILED', 'Latest Set 被意外修改');
  }
  const cardCount = (latest.body && (latest.body.total != null || (latest.body.cards && latest.body.cards.length)))
    ? (latest.body.total != null ? latest.body.total : latest.body.cards.length)
    : null;
  if (cardCount != null && !(cardCount > 0)) {
    throw pipelineError('MINI_REGRESSION_FAILED', 'Latest 页为空');
  }
  return {
    ok: true,
    skipped: false,
    latestSet: latest.body.set,
    latestCount: latest.body.total,
  };
}

function stagingToSnapshotMeta(staging, validation) {
  const remote = (staging && staging.remote) || {};
  const cards = remote.cards || {};
  const coll = remote.collectible || {};
  const cross = (validation && validation.cross) || {};
  const build = remote.build == null || String(remote.build).trim() === '' ? null : String(remote.build).trim();
  return {
    schemaVersion: 1,
    locale: remote.locale || 'zhCN',
    source: remote.source || 'hearthstonejson',
    build: build,
    cards: {
      url: cards.url || null,
      etag: cards.etag != null ? cards.etag : null,
      lastModified: cards.lastModified != null ? cards.lastModified : null,
      contentLength: cards.contentLength != null ? cards.contentLength : (cards.byteSize != null ? cards.byteSize : null),
      sha256: cards.sha256 || remote.cardsSha256 || null,
      entryCount: cross.cardsCount != null ? cross.cardsCount : (cards.entryCount != null ? cards.entryCount : null),
      downloadedAt: remote.downloadedAt || cards.downloadedAt || null,
    },
    collectible: {
      url: coll.url || null,
      etag: coll.etag != null ? coll.etag : null,
      lastModified: coll.lastModified != null ? coll.lastModified : null,
      contentLength: coll.contentLength != null ? coll.contentLength : (coll.byteSize != null ? coll.byteSize : null),
      sha256: coll.sha256 || remote.collectibleSha256 || null,
      entryCount: cross.collectibleCount != null ? cross.collectibleCount : (coll.entryCount != null ? coll.entryCount : null),
      downloadedAt: remote.downloadedAt || coll.downloadedAt || null,
    },
  };
}

function createHsjsonUpdatePipeline(deps) {
  deps = deps || {};
  const rootDir = deps.rootDir || process.cwd();
  const updater = deps.updater;
  const versions = deps.versions;
  const lock = deps.lock;
  const source = deps.source || 'hearthstonejson';
  const locale = deps.locale || 'zhCN';

  function setProgress(jobId, step) {
    if (lock) {
      lock.progress = { jobId: jobId, step: step, steps: PIPELINE_STEPS };
    }
    if (typeof deps.onProgress === 'function') deps.onProgress(jobId, step);
  }

  async function runPhase08() {
    if (typeof deps.runPhase08 === 'function') return deps.runPhase08();
    return spawnProjectScript(rootDir, 'scripts/run-phase08.cjs');
  }

  async function runPhase11() {
    if (typeof deps.runPhase11 === 'function') return deps.runPhase11();
    return spawnProjectScript(rootDir, 'scripts/run-phase11.cjs');
  }

  async function runUpdatedAvailable(ctx) {
    ctx = ctx || {};
    const job = ctx.job;
    const jobDir = path.join(rootDir, 'tmp', 'hsjson-update', job.id);
    const backupDir = path.join(jobDir, 'backup');
    let committed = false;
    let version = null;
    let staging = null;

    async function rollbackAndFail(err) {
      const mapped = mapErrorCode(err && err.code);
      const message = sanitizeJobMessage((err && (err.userMessage || err.message)) || '更新失败');
      if (committed) {
        try {
          if (typeof deps.restoreProduction === 'function') {
            await deps.restoreProduction(backupDir);
          } else {
            restoreProduction(rootDir, backupDir);
          }
        } catch (rb) {
          const fail = pipelineError(
            'DATA_UPDATE_ROLLBACK_FAILED',
            '回滚失败，请停止自动操作并人工检查',
            { rollbackFailed: true, originalCode: mapped },
          );
          fail.jobId = job.id;
          if (version && version.id && versions && typeof versions.markFailed === 'function') {
            try { await versions.markFailed(version.id); } catch (e) {}
          }
          throw fail;
        }
      }
      if (version && version.id && versions && typeof versions.markFailed === 'function') {
        try {
          const row = await versions.getDataVersion(version.id);
          if (row && row.status !== 'ACTIVE' && row.status !== 'RETIRED') {
            await versions.markFailed(version.id);
          }
        } catch (e) {}
      }
      const wrapped = pipelineError(mapped, message, { rollbackFailed: false });
      wrapped.jobId = job.id;
      wrapped.dataVersionId = version && version.id ? version.id : null;
      throw wrapped;
    }

    try {
      setProgress(job.id, 'Downloading');
      staging = typeof updater.downloadSnapshotToStaging === 'function'
        ? await updater.downloadSnapshotToStaging({ id: job.id })
        : null;
      if (!staging) throw pipelineError('HSJSON_DOWNLOAD_FAILED', '下载失败');

      const ident = ctx.localFingerprint || null;
      const newFp = staging.fingerprint || (staging.remote && staging.remote.fingerprint) || null;
      if (ident && ident.fp && newFp && ident.fp === newFp) {
        return {
          status: 'UP_TO_DATE',
          skippedDownloadApply: true,
          fingerprint: newFp,
          dataVersionId: null,
        };
      }

      if (deps.jobs) {
        await deps.jobs.updateJobStatus(job.id, 'VALIDATING', { snapshot_fingerprint: newFp });
      }

      setProgress(job.id, 'Validating');
      let validation;
      try {
        validation = updater.validateSnapshot(staging.dir);
      } catch (e) {
        throw pipelineError(mapErrorCode(e && e.code) || 'HSJSON_VALIDATION_FAILED', e.userMessage || e.message || '校验失败');
      }

      const snapshotMeta = stagingToSnapshotMeta(staging, validation);
      if (!snapshotMeta.cards || !snapshotMeta.cards.sha256 || !snapshotMeta.collectible || !snapshotMeta.collectible.sha256) {
        throw pipelineError('HSJSON_VALIDATION_FAILED', '缺少 snapshot metadata');
      }

      version = await versions.createDataVersion({ snapshotMeta: snapshotMeta, status: 'STAGED' });
      if (version.status === 'ACTIVE' || version.status === 'READY') {
        return {
          status: 'UP_TO_DATE',
          fingerprint: version.snapshot_fingerprint,
          dataVersionId: version.id,
          reusedVersion: true,
        };
      }
      if (version.status === 'FAILED') {
        version = await versions.updateDataVersionStatus(version.id, 'STAGED');
      }
      if (version.status === 'STAGED') version = await versions.markValidated(version.id);

      setProgress(job.id, 'Committing');
      if (typeof deps.backupProduction === 'function') {
        await deps.backupProduction(backupDir);
      } else {
        backupProduction(rootDir, backupDir);
      }

      let committedResult;
      try {
        committedResult = updater.commitSnapshot(staging, validation, { keepStaging: true });
      } catch (e) {
        throw pipelineError(mapErrorCode(e && e.code) || 'HSJSON_COMMIT_FAILED', e.userMessage || e.message || '提交失败');
      }
      if (!committedResult || committedResult.ok === false) {
        throw pipelineError('HSJSON_COMMIT_FAILED', '提交失败');
      }
      committed = true;
      const meta = committedResult.meta || snapshotMeta;

      setProgress(job.id, 'Phase08');
      const p08 = await runPhase08();
      if (!p08 || p08.status !== 0) {
        throw pipelineError('PHASE08_FAILED', 'Phase08 失败');
      }
      if (typeof deps.runPhase08 !== 'function') {
        assertFilesExist(expectedIndexFilesAfterPhase08(rootDir), 'PHASE08_FAILED');
      }
      if (typeof deps.validateIndex === 'function') {
        const v08 = await deps.validateIndex();
        if (v08 && v08.ok === false) throw pipelineError('INDEX_VALIDATION_FAILED', '语音索引校验失败');
      } else {
        validateIndexOnDisk(rootDir);
      }

      setProgress(job.id, 'Phase11');
      const p11 = await runPhase11();
      if (!p11 || p11.status !== 0) {
        throw pipelineError('PHASE11_FAILED', 'Phase11 失败');
      }
      if (typeof deps.runPhase11 !== 'function') {
        assertFilesExist(expectedIndexFilesAfterPhase11(rootDir), 'PHASE11_FAILED');
      }
      let audio;
      if (typeof deps.validateAudio === 'function') {
        audio = await deps.validateAudio();
        if (audio && audio.ok === false) throw pipelineError('INDEX_VALIDATION_FAILED', '音频索引校验失败');
      } else {
        audio = validateAudioOnDisk(rootDir);
      }

      setProgress(job.id, 'Catalog validation');
      const unified = (audio && audio.unified) || readJsonSafe(path.join(rootDir, 'data', 'index', 'card-audio-index.json'));
      if (typeof deps.validateCatalog === 'function') {
        const cat = await deps.validateCatalog(unified);
        if (cat && cat.ok === false) throw pipelineError('CATALOG_VALIDATION_FAILED', 'Catalog 校验失败');
      } else {
        validateCatalogBuild(unified);
      }

      version = await versions.markReady(version.id);
      if (deps.jobs) {
        await deps.jobs.updateJobStatus(job.id, 'READY', {
          data_version_id: version.id,
          snapshot_fingerprint: version.snapshot_fingerprint || newFp,
        });
      }

      if (typeof deps.miniRegression === 'function') {
        const mini = await deps.miniRegression({ beforeLatestSet: ctx.beforeLatestSet });
        if (mini && mini.ok === false) throw pipelineError('MINI_REGRESSION_FAILED', 'Mini 回归失败');
      } else {
        await defaultMiniRegression({
          reloadCatalog: deps.reloadCatalog,
          port: deps.miniPort,
          beforeLatestSet: ctx.beforeLatestSet,
        });
      }

      version = await versions.markActive(version.id);
      setProgress(job.id, 'Completed');
      return {
        status: 'UPDATED',
        fingerprint: snapshotFingerprint({
          source: source,
          locale: locale,
          cardsSha256: meta.cards && meta.cards.sha256,
          collectibleSha256: meta.collectible && meta.collectible.sha256,
        }),
        dataVersionId: version.id,
        dataVersion: version,
        meta: meta,
      };
    } catch (e) {
      if (e && e.code === 'DATA_UPDATE_ROLLBACK_FAILED') throw e;
      await rollbackAndFail(e);
    }
  }

  return {
    runUpdatedAvailable: runUpdatedAvailable,
    backupProduction: function (backupDir) { return backupProduction(rootDir, backupDir); },
    restoreProduction: function (backupDir) { return restoreProduction(rootDir, backupDir); },
    validateCatalogBuild: validateCatalogBuild,
    PIPELINE_STEPS: PIPELINE_STEPS,
  };
}

module.exports = {
  PIPELINE_STEPS,
  SNAPSHOT_RELS,
  INDEX_RELS,
  ALL_BACKUP_RELS,
  mapErrorCode,
  backupProduction,
  restoreProduction,
  validateCatalogBuild,
  validateIndexOnDisk,
  validateAudioOnDisk,
  defaultMiniRegression,
  createHsjsonUpdatePipeline,
  pipelineError,
};
