'use strict';

const {
  clientIp,
  publicFeedback,
} = require('./feedbackService.js');

function fail(status, code, error) {
  return { handled: true, status: status, body: { ok: false, error: error, code: code } };
}

function applyFeedbackCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isSchemaUnavailable(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return (
    code === 'PGRST205' ||
    code === '23514' ||
    code === '23502' ||
    /Could not find the table|schema cache|check constraint|feedback_status_check|feedback_type_check/i.test(msg)
  );
}

function fromServiceError(e) {
  if (e && e.status && e.code) {
    return fail(e.status, e.code, e.userMessage || '操作失败');
  }
  if (isSchemaUnavailable(e)) {
    return fail(503, 'FEEDBACK_UNAVAILABLE', '反馈服务暂不可用');
  }
  return fail(500, 'FEEDBACK_INTERNAL', '操作失败，请稍后重试');
}

function parseFeedbackId(pathname) {
  const prefix = '/api/admin/feedback/';
  if (pathname.indexOf(prefix) !== 0) return null;
  const rest = pathname.slice(prefix.length);
  if (!rest || rest.indexOf('/') !== -1) return null;
  return rest;
}

function createPublicFeedbackHandler(service) {
  return async function handlePublic(req, url, extras) {
    extras = extras || {};
    if (!url || url.pathname !== '/api/feedback') return null;
    if (req.method === 'OPTIONS') return { handled: true, status: 204, body: null };
    if (req.method !== 'POST') {
      return fail(405, 'FEEDBACK_METHOD_NOT_ALLOWED', '方法不允许');
    }
    if (!service) {
      return fail(503, 'FEEDBACK_UNAVAILABLE', '反馈服务暂不可用');
    }
    try {
      const row = await service.createFeedback(extras.body || {}, { ip: clientIp(req) });
      const created = publicFeedback(row);
      return {
        handled: true,
        status: 200,
        body: {
          ok: true,
          feedback: {
            id: created.id,
            status: created.status,
            createdAt: created.createdAt,
          },
        },
      };
    } catch (e) {
      return fromServiceError(e);
    }
  };
}

function createFeedbackHandlers(deps) {
  deps = deps || {};
  const service = deps.service;

  async function writeLog(auth, action, targetId, details) {
    if (typeof deps.writeLog !== 'function') return;
    await deps.writeLog({
      admin_user_id: auth && auth.admin ? auth.admin.userId : null,
      action: action,
      target_type: 'feedback',
      target_id: targetId == null ? null : String(targetId),
      details: details || {},
    });
  }

  async function handle(req, url, auth, extras) {
    extras = extras || {};
    const pathname = url.pathname;
    if (pathname.indexOf('/api/admin/feedback') !== 0) return null;
    try {
      return await handleInner(req, url, auth, extras, pathname);
    } catch (e) {
      return fromServiceError(e);
    }
  }

  async function handleInner(req, url, auth, extras, pathname) {
    if (!service) return fail(503, 'FEEDBACK_UNAVAILABLE', '反馈服务暂不可用');

    if (req.method === 'GET' && pathname === '/api/admin/feedback') {
      const result = await service.listFeedback({
        status: url.searchParams.get('status'),
        type: url.searchParams.get('type'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      });
      return {
        handled: true,
        status: 200,
        body: {
          ok: true,
          items: result.items,
          pagination: result.pagination,
        },
      };
    }

    const id = parseFeedbackId(pathname);
    if (req.method === 'GET' && id) {
      const item = await service.getFeedbackById(id);
      return { handled: true, status: 200, body: { ok: true, item: item } };
    }

    if (req.method === 'PATCH' && id) {
      const body = extras.body || {};
      const result = await service.updateFeedbackStatus(id, body.status);
      if (result.fromStatus !== result.toStatus) {
        await writeLog(auth, 'feedback.update_status', id, {
          feedbackId: id,
          fromStatus: result.fromStatus,
          toStatus: result.toStatus,
        });
      }
      return { handled: true, status: 200, body: { ok: true, item: result.row } };
    }

    if (pathname === '/api/admin/feedback' || id) {
      return fail(405, 'ADMIN_METHOD_NOT_ALLOWED', '方法不允许');
    }
    return fail(404, 'ADMIN_NOT_FOUND', 'not found');
  }

  return { handle: handle };
}

module.exports = {
  applyFeedbackCors,
  createPublicFeedbackHandler,
  createFeedbackHandlers,
};
