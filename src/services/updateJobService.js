const crypto = require('crypto');

const JOB_TYPES = ['HSJSON_SNAPSHOT'];
const JOB_STATUSES = [
  'PENDING',
  'CHECKING',
  'DOWNLOADING',
  'VALIDATING',
  'READY',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
];
const BLOCKING_STATUSES = ['CHECKING', 'DOWNLOADING', 'VALIDATING', 'RUNNING'];
const TRANSITIONS = {
  PENDING: ['CHECKING', 'FAILED', 'CANCELLED'],
  CHECKING: ['DOWNLOADING', 'VALIDATING', 'READY', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['VALIDATING', 'FAILED', 'CANCELLED'],
  VALIDATING: ['READY', 'FAILED', 'CANCELLED'],
  READY: ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

function jobError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.userMessage = message;
  return err;
}

function sanitizeJobMessage(text) {
  let s = String(text == null ? '' : text).split('\n')[0].trim();
  s = s.replace(/eyJ[a-zA-Z0-9_-]{10,}/g, '[redacted]');
  s = s.replace(/sb_secret_[A-Za-z0-9_-]+/g, '[redacted]');
  s = s.replace(/sb_publishable_[A-Za-z0-9_-]+/g, '[redacted]');
  if (/SUPABASE_SERVICE_ROLE_KEY|\.env\b|password|access_token|service_role/i.test(s)) {
    return '操作失败';
  }
  if (s.length > 300) s = s.slice(0, 300);
  return s || '操作失败';
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || ('job-' + Date.now());
}

function isBlockingStatus(status) {
  return BLOCKING_STATUSES.indexOf(status) !== -1;
}

function createMemoryUpdateJobStore(seed) {
  const rows = (seed || []).slice();
  return {
    kind: 'memory',
    rows: rows,
    async insert(row) {
      const blocking = rows.filter(function (r) {
        return r.job_type === row.job_type && isBlockingStatus(r.status);
      })[0];
      if (blocking) {
        const err = jobError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行');
        err.existing = blocking;
        throw err;
      }
      rows.push(row);
      return row;
    },
    async findById(id) {
      return rows.filter(function (r) { return r.id === id; })[0] || null;
    },
    async findBlocking(jobType) {
      return rows.filter(function (r) {
        return r.job_type === jobType && isBlockingStatus(r.status);
      })[0] || null;
    },
    async findSucceededByFingerprint(fp) {
      if (!fp) return null;
      return rows.filter(function (r) {
        return r.job_type === 'HSJSON_SNAPSHOT' && r.status === 'SUCCEEDED' && r.snapshot_fingerprint === fp;
      }).sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      })[0] || null;
    },
    async list(limit) {
      const n = limit || 50;
      return rows.slice().sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }).slice(0, n);
    },
    async update(id, patch) {
      const row = rows.filter(function (r) { return r.id === id; })[0];
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

function isUniqueViolation(err) {
  if (!err) return false;
  if (String(err.code) === '23505') return true;
  return /duplicate key|unique constraint/i.test(String(err.message || ''));
}

const JOB_FIELDS =
  'id,job_type,status,data_version_id,source,locale,snapshot_fingerprint,error_code,error_message,started_at,finished_at,failed_at,created_by,created_at,updated_at';

function createSupabaseUpdateJobStore(client) {
  return {
    kind: 'supabase',
    async insert(row) {
      const r = await client.from('update_jobs').insert(row).select(JOB_FIELDS).single();
      if (r.error) {
        if (isUniqueViolation(r.error)) {
          const err = jobError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行');
          err.cause = r.error;
          throw err;
        }
        throw r.error;
      }
      return r.data;
    },
    async findById(id) {
      const r = await client.from('update_jobs').select(JOB_FIELDS).eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      return r.data || null;
    },
    async findBlocking(jobType) {
      const r = await client
        .from('update_jobs')
        .select(JOB_FIELDS)
        .eq('job_type', jobType)
        .in('status', BLOCKING_STATUSES)
        .limit(1);
      if (r.error) throw r.error;
      return (r.data && r.data[0]) || null;
    },
    async findSucceededByFingerprint(fp) {
      if (!fp) return null;
      const r = await client
        .from('update_jobs')
        .select(JOB_FIELDS)
        .eq('job_type', 'HSJSON_SNAPSHOT')
        .eq('status', 'SUCCEEDED')
        .eq('snapshot_fingerprint', fp)
        .order('created_at', { ascending: false })
        .limit(1);
      if (r.error) throw r.error;
      return (r.data && r.data[0]) || null;
    },
    async list(limit) {
      const r = await client
        .from('update_jobs')
        .select(JOB_FIELDS)
        .order('created_at', { ascending: false })
        .limit(limit || 50);
      if (r.error) throw r.error;
      return r.data || [];
    },
    async update(id, patch) {
      const r = await client.from('update_jobs').update(patch).eq('id', id).select(JOB_FIELDS).single();
      if (r.error) throw r.error;
      return r.data;
    },
  };
}

function canTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.indexOf(to) !== -1;
}

function createUpdateJobService(store, options) {
  options = options || {};
  const nowIso = options.nowIso || function () { return new Date().toISOString(); };
  const makeId = options.newId || newId;

  async function getJob(id) {
    if (!id) return null;
    return store.findById(id);
  }

  async function listJobs(limit) {
    return store.list(limit);
  }

  async function findBlockingJob(jobType) {
    return store.findBlocking(jobType || 'HSJSON_SNAPSHOT');
  }

  async function findSucceededByFingerprint(fp) {
    if (typeof store.findSucceededByFingerprint !== 'function') return null;
    return store.findSucceededByFingerprint(fp);
  }

  async function createJob(input) {
    input = input || {};
    const jobType = input.job_type || input.jobType || 'HSJSON_SNAPSHOT';
    if (JOB_TYPES.indexOf(jobType) === -1) {
      throw jobError('UPDATE_JOB_TYPE_INVALID', '不支持的任务类型');
    }
    const blocking = await findBlockingJob(jobType);
    if (blocking) {
      const err = jobError('DATA_UPDATE_ALREADY_RUNNING', '已有 HSJSON 更新任务正在进行');
      err.existing = blocking;
      throw err;
    }
    const status = input.status || 'PENDING';
    if (status !== 'PENDING') {
      throw jobError('UPDATE_JOB_STATUS_INVALID', '新建任务只能是 PENDING');
    }
    const now = nowIso();
    const row = {
      id: input.id || makeId(),
      job_type: jobType,
      status: status,
      data_version_id: input.data_version_id || input.dataVersionId || null,
      source: input.source || 'hearthstonejson',
      locale: input.locale || 'zhCN',
      snapshot_fingerprint: input.snapshot_fingerprint || input.snapshotFingerprint || null,
      error_code: null,
      error_message: null,
      started_at: now,
      finished_at: null,
      failed_at: null,
      created_by: input.created_by || input.createdBy || null,
      created_at: now,
      updated_at: now,
    };
    return store.insert(row);
  }

  async function updateJobStatus(id, nextStatus, extra) {
    extra = extra || {};
    if (JOB_STATUSES.indexOf(nextStatus) === -1) {
      throw jobError('UPDATE_JOB_STATUS_INVALID', '无效的任务状态');
    }
    const row = await getJob(id);
    if (!row) throw jobError('UPDATE_JOB_NOT_FOUND', '更新任务不存在');
    if (row.status === nextStatus) {
      return Object.assign({}, row, extra);
    }
    if (!canTransition(row.status, nextStatus)) {
      throw jobError('UPDATE_JOB_STATUS_INVALID', '不允许的任务状态迁移');
    }
    const patch = Object.assign({ status: nextStatus, updated_at: nowIso() }, extra);
    return store.update(id, patch);
  }

  async function failJob(id, errorCode, errorMessage) {
    const now = nowIso();
    return updateJobStatus(id, 'FAILED', {
      error_code: errorCode || 'UPDATE_FAILED',
      error_message: sanitizeJobMessage(errorMessage),
      failed_at: now,
      finished_at: now,
    });
  }

  async function completeJob(id, extra) {
    extra = extra || {};
    const patch = {
      finished_at: nowIso(),
      error_code: null,
      error_message: null,
    };
    if (extra.data_version_id || extra.dataVersionId) {
      patch.data_version_id = extra.data_version_id || extra.dataVersionId;
    }
    if (extra.snapshot_fingerprint || extra.snapshotFingerprint) {
      patch.snapshot_fingerprint = extra.snapshot_fingerprint || extra.snapshotFingerprint;
    }
    return updateJobStatus(id, 'SUCCEEDED', patch);
  }

  return {
    createJob: createJob,
    getJob: getJob,
    listJobs: listJobs,
    findBlockingJob: findBlockingJob,
    findSucceededByFingerprint: findSucceededByFingerprint,
    updateJobStatus: updateJobStatus,
    failJob: failJob,
    completeJob: completeJob,
    sanitizeJobMessage: sanitizeJobMessage,
  };
}

module.exports = {
  JOB_TYPES,
  JOB_STATUSES,
  BLOCKING_STATUSES,
  TRANSITIONS,
  sanitizeJobMessage,
  createMemoryUpdateJobStore,
  createSupabaseUpdateJobStore,
  createUpdateJobService,
  jobError,
};
