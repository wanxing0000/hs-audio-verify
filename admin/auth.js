function adminConfig() {
  return window.__ADMIN_CONFIG__ || {};
}

function createAdminSupabase() {
  const cfg = adminConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new Error('missing-config');
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('missing-sdk');
  }
  return window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

async function adminApi(path, accessToken, options) {
  options = options || {};
  const headers = {};
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  if (options.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = {};
  }
  return { status: res.status, body: body };
}

async function signOutToLogin(client) {
  try {
    if (client) await client.auth.signOut();
  } catch (e) {}
  location.replace('/admin/login');
}

async function requireAdmin(client) {
  const first = await client.auth.getSession();
  let session = first && first.data && first.data.session;
  if (!session || !session.access_token) {
    location.replace('/admin/login');
    return null;
  }
  let health = await adminApi('/api/admin/health', session.access_token);
  if (health.status === 401) {
    const refreshed = await client.auth.refreshSession();
    session = refreshed && refreshed.data && refreshed.data.session;
    if (!session || !session.access_token) {
      await signOutToLogin(client);
      return null;
    }
    health = await adminApi('/api/admin/health', session.access_token);
  }
  if (health.status === 403) {
    try { await client.auth.signOut(); } catch (e) {}
    location.replace('/admin/login?denied=1');
    return null;
  }
  if (health.status !== 200 || !health.body || health.body.ok !== true) {
    await signOutToLogin(client);
    return null;
  }
  return { session: session, health: health.body };
}
