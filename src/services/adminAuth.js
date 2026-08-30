const { tryCreateSupabaseAdmin } = require('./supabaseClient.js');

function fail(status, code, userMessage) {
  return { ok: false, status: status, code: code, userMessage: userMessage };
}

function parseAuthorizationHeader(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization != null ? headers.authorization : headers.Authorization;
  if (raw == null) return fail(401, 'ADMIN_AUTH_REQUIRED', '需要管理员登录');
  const text = String(raw).trim();
  if (!text) return fail(401, 'ADMIN_AUTH_REQUIRED', '需要管理员登录');
  const matched = /^Bearer\s+(.+)$/i.exec(text);
  if (!matched) return fail(401, 'ADMIN_TOKEN_INVALID', '登录已失效');
  const token = String(matched[1] || '').trim();
  if (!token) return fail(401, 'ADMIN_TOKEN_INVALID', '登录已失效');
  return { ok: true, token: token };
}

function applyAdminCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function publicAdminError(auth) {
  return {
    ok: false,
    error: auth.userMessage || '没有管理员权限',
    code: auth.code,
  };
}

function publicAdminHealth(auth) {
  return {
    ok: true,
    service: 'admin-api',
    authenticated: true,
    admin: {
      userId: auth.admin.userId,
      role: auth.admin.role,
      displayName: auth.admin.displayName,
    },
  };
}

function publicAdminStatus(auth, snap) {
  snap = snap || {};
  return {
    ok: true,
    mini: { ok: snap.miniOk !== false },
    catalog: { count: Number(snap.catalogCount) || 0 },
    latest: {
      set: snap.latestSet || null,
      count: Number(snap.latestCount) || 0,
    },
    supabase: { connected: !!snap.supabaseConnected },
    admin: {
      userId: auth.admin.userId,
      role: auth.admin.role,
      displayName: auth.admin.displayName,
    },
  };
}

async function defaultGetUser(token) {
  const boot = tryCreateSupabaseAdmin();
  if (!boot.client) return { data: { user: null }, error: { message: 'not configured' } };
  return boot.client.auth.getUser(token);
}

async function defaultLookupAdmin(userId) {
  const boot = tryCreateSupabaseAdmin();
  if (!boot.client) return { data: null, error: { message: 'not configured' } };
  return boot.client
    .from('admin_users')
    .select('user_id, role, is_active, display_name')
    .eq('user_id', userId)
    .maybeSingle();
}

function createAdminAuthenticator(options) {
  options = options || {};
  const getUser = options.getUser || defaultGetUser;
  const lookupAdmin = options.lookupAdmin || defaultLookupAdmin;

  async function authenticateAdminRequest(req) {
    const parsed = parseAuthorizationHeader(req);
    if (!parsed.ok) return parsed;

    let userResult;
    try {
      userResult = await getUser(parsed.token);
    } catch (e) {
      return fail(401, 'ADMIN_TOKEN_INVALID', '登录已失效');
    }
    const user = userResult && userResult.data && userResult.data.user;
    if ((userResult && userResult.error) || !user || !user.id) {
      return fail(401, 'ADMIN_TOKEN_INVALID', '登录已失效');
    }

    let adminResult;
    try {
      adminResult = await lookupAdmin(user.id);
    } catch (e) {
      return fail(403, 'ADMIN_USER_NOT_FOUND', '没有管理员权限');
    }
    if (adminResult && adminResult.error) {
      return fail(403, 'ADMIN_USER_NOT_FOUND', '没有管理员权限');
    }
    const row = adminResult && adminResult.data;
    if (!row) return fail(403, 'ADMIN_USER_NOT_FOUND', '没有管理员权限');
    if (row.is_active !== true) return fail(403, 'ADMIN_INACTIVE', '管理员账号已停用');
    if (row.role !== 'admin') return fail(403, 'ADMIN_FORBIDDEN', '没有管理员权限');

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email || null,
      },
      admin: {
        userId: row.user_id,
        role: row.role,
        displayName: row.display_name == null ? null : row.display_name,
      },
    };
  }

  async function dispatchAdminRequest(req, url, extras) {
    extras = extras || {};
    if (req.method === 'OPTIONS') {
      return { handled: true, status: 204, body: null };
    }
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) {
      return { handled: true, status: auth.status, body: publicAdminError(auth) };
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/health') {
      return { handled: true, status: 200, body: publicAdminHealth(auth) };
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/status') {
      const snap = typeof extras.getStatus === 'function' ? extras.getStatus() : {};
      return { handled: true, status: 200, body: publicAdminStatus(auth, snap) };
    }
    if (typeof extras.handleLatestSets === 'function' && url.pathname.indexOf('/api/admin/latest-sets') === 0) {
      const latest = await extras.handleLatestSets(req, url, auth, extras);
      if (latest && latest.handled) return latest;
    }
    if (typeof extras.handleDataUpdate === 'function') {
      const p = url.pathname;
      if (
        p.indexOf('/api/admin/data-versions') === 0 ||
        p.indexOf('/api/admin/update-jobs') === 0 ||
        p.indexOf('/api/admin/data/') === 0
      ) {
        const data = await extras.handleDataUpdate(req, url, auth, extras);
        if (data && data.handled) return data;
      }
    }
    if (typeof extras.handleFeedback === 'function' && url.pathname.indexOf('/api/admin/feedback') === 0) {
      const feedback = await extras.handleFeedback(req, url, auth, extras);
      if (feedback && feedback.handled) return feedback;
    }
    if (req.method !== 'GET') {
      return {
        handled: true,
        status: 405,
        body: { ok: false, error: '方法不允许', code: 'ADMIN_METHOD_NOT_ALLOWED' },
      };
    }
    return {
      handled: true,
      status: 404,
      body: { ok: false, error: 'not found', code: 'ADMIN_NOT_FOUND' },
    };
  }

  return {
    authenticateAdminRequest: authenticateAdminRequest,
    dispatchAdminRequest: dispatchAdminRequest,
    parseAuthorizationHeader: parseAuthorizationHeader,
  };
}

const defaultAuthenticator = createAdminAuthenticator();

module.exports = {
  parseAuthorizationHeader: parseAuthorizationHeader,
  applyAdminCors: applyAdminCors,
  publicAdminHealth: publicAdminHealth,
  publicAdminStatus: publicAdminStatus,
  publicAdminError: publicAdminError,
  createAdminAuthenticator: createAdminAuthenticator,
  authenticateAdminRequest: defaultAuthenticator.authenticateAdminRequest,
  dispatchAdminRequest: defaultAuthenticator.dispatchAdminRequest,
};
