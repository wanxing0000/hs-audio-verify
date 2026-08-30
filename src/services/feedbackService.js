'use strict';

const crypto = require('crypto');

const FEEDBACK_TYPES = ['BUG', 'FEATURE_REQUEST', 'CARD_DATA', 'AUDIO', 'OTHER'];
const FEEDBACK_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const TYPE_LABELS = {
  BUG: 'Bug 问题',
  FEATURE_REQUEST: '功能建议',
  CARD_DATA: '卡牌数据问题',
  AUDIO: '音频问题',
  OTHER: '其他',
};
const STATUS_LABELS = {
  OPEN: '待处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
};

const MIN_MESSAGE = 5;
const MAX_MESSAGE = 2000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function feedbackError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.userMessage = message;
  err.status = status || 400;
  return err;
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || ('fb-' + Date.now());
}

function isUuid(id) {
  return UUID_RE.test(String(id || ''));
}

function excerpt(text, max) {
  max = max || 140;
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function publicFeedback(row) {
  if (!row) return null;
  const message = row.content != null ? row.content : row.message;
  return {
    id: row.id,
    type: row.type,
    typeLabel: TYPE_LABELS[row.type] || row.type,
    message: message,
    excerpt: excerpt(message),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function validateCreate(input) {
  input = input || {};
  const type = String(input.type || '').trim();
  if (FEEDBACK_TYPES.indexOf(type) === -1) {
    throw feedbackError('FEEDBACK_TYPE_INVALID', '请选择有效的反馈类型', 400);
  }
  const message = String(input.message == null ? '' : input.message).trim();
  if (!message || message.length < MIN_MESSAGE) {
    throw feedbackError('FEEDBACK_MESSAGE_TOO_SHORT', '反馈内容太短', 400);
  }
  if (message.length > MAX_MESSAGE) {
    throw feedbackError('FEEDBACK_MESSAGE_TOO_LONG', '反馈内容不能超过 2000 字', 400);
  }
  return { type: type, message: message };
}

function parsePage(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parsePageSize(raw) {
  if (raw == null || raw === '') return DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

function createMemoryFeedbackStore(seed) {
  const rows = (seed || []).slice();
  return {
    kind: 'memory',
    rows: rows,
    async insert(row) {
      rows.push(row);
      return row;
    },
    async findById(id) {
      return rows.filter(function (r) { return r.id === id; })[0] || null;
    },
    async list(query) {
      query = query || {};
      let list = rows.slice();
      if (query.status) list = list.filter(function (r) { return r.status === query.status; });
      if (query.type) list = list.filter(function (r) { return r.type === query.type; });
      list.sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      const total = list.length;
      const page = query.page || 1;
      const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
      const start = (page - 1) * pageSize;
      return { items: list.slice(start, start + pageSize), total: total };
    },
    async update(id, patch) {
      const row = rows.filter(function (r) { return r.id === id; })[0];
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

const FEEDBACK_FIELDS = 'id,content,contact,type,status,admin_note,created_at,updated_at';

function createSupabaseFeedbackStore(client) {
  return {
    kind: 'supabase',
    async insert(row) {
      const r = await client.from('feedback').insert({
        id: row.id,
        content: row.content,
        type: row.type,
        status: row.status,
      }).select(FEEDBACK_FIELDS).single();
      if (r.error) throw r.error;
      return r.data;
    },
    async findById(id) {
      const r = await client.from('feedback').select(FEEDBACK_FIELDS).eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      return r.data || null;
    },
    async list(query) {
      query = query || {};
      const page = query.page || 1;
      const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let q = client.from('feedback').select(FEEDBACK_FIELDS, { count: 'exact' });
      if (query.status) q = q.eq('status', query.status);
      if (query.type) q = q.eq('type', query.type);
      const r = await q.order('created_at', { ascending: false }).range(from, to);
      if (r.error) throw r.error;
      return { items: r.data || [], total: r.count == null ? (r.data || []).length : r.count };
    },
    async update(id, patch) {
      const r = await client.from('feedback').update(patch).eq('id', id).select(FEEDBACK_FIELDS).single();
      if (r.error) throw r.error;
      return r.data;
    },
  };
}

function createIpRateLimiter(options) {
  options = options || {};
  const windowMs = options.windowMs != null ? options.windowMs : 10 * 60 * 1000;
  const max = options.max != null ? options.max : 5;
  const nowFn = options.now || function () { return Date.now(); };
  const hits = new Map();

  function allow(ip) {
    const key = String(ip || 'unknown');
    const now = nowFn();
    const prev = (hits.get(key) || []).filter(function (t) { return now - t < windowMs; });
    if (prev.length >= max) {
      hits.set(key, prev);
      return false;
    }
    prev.push(now);
    hits.set(key, prev);
    return true;
  }

  return {
    allow: allow,
    reset: function () { hits.clear(); },
    windowMs: windowMs,
    max: max,
  };
}

function createFeedbackService(store, options) {
  options = options || {};
  const nowIso = options.nowIso || function () { return new Date().toISOString(); };
  const makeId = options.newId || newId;
  const limiter = options.limiter || null;

  async function createFeedback(input, meta) {
    meta = meta || {};
    const body = validateCreate(input);
    if (limiter && !limiter.allow(meta.ip)) {
      throw feedbackError('FEEDBACK_RATE_LIMITED', '提交过于频繁，请稍后再试', 429);
    }
    const now = nowIso();
    const row = {
      id: makeId(),
      content: body.message,
      type: body.type,
      status: 'OPEN',
      contact: null,
      admin_note: null,
      created_at: now,
      updated_at: now,
    };
    return store.insert(row);
  }

  async function listFeedback(query) {
    query = query || {};
    const status = query.status ? String(query.status).trim() : '';
    const type = query.type ? String(query.type).trim() : '';
    if (status && status !== 'ALL' && FEEDBACK_STATUSES.indexOf(status) === -1) {
      throw feedbackError('FEEDBACK_STATUS_INVALID', '无效的反馈状态', 400);
    }
    if (type && type !== 'ALL' && FEEDBACK_TYPES.indexOf(type) === -1) {
      throw feedbackError('FEEDBACK_TYPE_INVALID', '无效的反馈类型', 400);
    }
    const page = parsePage(query.page);
    const pageSize = parsePageSize(query.pageSize);
    const result = await store.list({
      status: status && status !== 'ALL' ? status : null,
      type: type && type !== 'ALL' ? type : null,
      page: page,
      pageSize: pageSize,
    });
    const total = result.total || 0;
    return {
      items: (result.items || []).map(publicFeedback),
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async function getFeedbackById(id) {
    if (!isUuid(id)) throw feedbackError('FEEDBACK_NOT_FOUND', '反馈不存在', 404);
    const row = await store.findById(id);
    if (!row) throw feedbackError('FEEDBACK_NOT_FOUND', '反馈不存在', 404);
    return publicFeedback(row);
  }

  async function updateFeedbackStatus(id, nextStatus) {
    if (!isUuid(id)) throw feedbackError('FEEDBACK_NOT_FOUND', '反馈不存在', 404);
    const status = String(nextStatus || '').trim();
    if (FEEDBACK_STATUSES.indexOf(status) === -1) {
      throw feedbackError('FEEDBACK_STATUS_INVALID', '无效的反馈状态', 400);
    }
    const row = await store.findById(id);
    if (!row) throw feedbackError('FEEDBACK_NOT_FOUND', '反馈不存在', 404);
    const fromStatus = row.status;
    if (fromStatus === status) return { row: publicFeedback(row), fromStatus: fromStatus, toStatus: status };
    const patch = { status: status, updated_at: nowIso() };
    const updated = await store.update(id, patch);
    return { row: publicFeedback(updated), fromStatus: fromStatus, toStatus: status };
  }

  return {
    createFeedback: createFeedback,
    listFeedback: listFeedback,
    getFeedbackById: getFeedbackById,
    updateFeedbackStatus: updateFeedbackStatus,
  };
}

function clientIp(req) {
  const headers = (req && req.headers) || {};
  const xf = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (xf) return String(xf).split(',')[0].trim() || 'unknown';
  const sock = req && (req.socket || req.connection);
  return (sock && sock.remoteAddress) || 'unknown';
}

module.exports = {
  FEEDBACK_TYPES,
  FEEDBACK_STATUSES,
  TYPE_LABELS,
  STATUS_LABELS,
  MIN_MESSAGE,
  MAX_MESSAGE,
  feedbackError,
  isUuid,
  excerpt,
  publicFeedback,
  validateCreate,
  parsePage,
  parsePageSize,
  createMemoryFeedbackStore,
  createSupabaseFeedbackStore,
  createIpRateLimiter,
  createFeedbackService,
  clientIp,
};
