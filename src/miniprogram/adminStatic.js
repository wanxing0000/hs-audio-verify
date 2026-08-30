const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

const PAGE_MAP = {
  '/admin': 'index.html',
  '/admin/': 'index.html',
  '/admin/index.html': 'index.html',
  '/admin/login': 'login.html',
  '/admin/login.html': 'login.html',
  '/admin/admin.css': 'admin.css',
  '/admin/admin.js': 'admin.js',
  '/admin/login.js': 'login.js',
  '/admin/auth.js': 'auth.js',
  '/admin/latest': 'latest.html',
  '/admin/latest/': 'latest.html',
  '/admin/latest.html': 'latest.html',
  '/admin/latest.js': 'latest.js',
  '/admin/data': 'data.html',
  '/admin/data/': 'data.html',
  '/admin/data.html': 'data.html',
  '/admin/data.js': 'data.js',
  '/admin/feedback': 'feedback.html',
  '/admin/feedback/': 'feedback.html',
  '/admin/feedback.html': 'feedback.html',
  '/admin/feedback.js': 'feedback.js',
};

function buildAdminConfigJs(env) {
  env = env || process.env;
  const supabaseUrl = String((env && env.SUPABASE_URL) || '').trim();
  const anonKey = String((env && env.SUPABASE_ANON_KEY) || '').trim();
  return 'window.__ADMIN_CONFIG__=' + JSON.stringify({
    supabaseUrl: supabaseUrl,
    anonKey: anonKey,
  }) + ';\n';
}

function resolveAdminAsset(pathname, rootDir) {
  if (pathname === '/admin/config.js') return { kind: 'config' };
  if (pathname === '/admin/vendor/supabase.js') {
    return {
      kind: 'file',
      file: path.join(rootDir, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
    };
  }
  const name = PAGE_MAP[pathname];
  if (!name) return null;
  return { kind: 'file', file: path.join(rootDir, 'admin', name) };
}

function isAdminPagePath(pathname) {
  return pathname === '/admin' || pathname.indexOf('/admin/') === 0;
}

function tryHandleAdminStatic(req, url, res, rootDir, env) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!isAdminPagePath(url.pathname)) return false;
  const resolved = resolveAdminAsset(url.pathname, rootDir);
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return true;
  }
  if (resolved.kind === 'config') {
    const body = buildAdminConfigJs(env);
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? '' : body);
    return true;
  }
  if (!fs.existsSync(resolved.file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return true;
  }
  const ext = path.extname(resolved.file);
  const data = fs.readFileSync(resolved.file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? '' : data);
  return true;
}

module.exports = {
  buildAdminConfigJs,
  resolveAdminAsset,
  tryHandleAdminStatic,
  isAdminPagePath,
};
