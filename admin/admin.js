(function () {
  const who = document.getElementById('who');
  const notice = document.getElementById('notice');
  const logout = document.getElementById('logout');

  function setText(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'value' + (cls ? ' ' + cls : '');
  }

  function showNotice(text) {
    notice.hidden = !text;
    notice.textContent = text || '';
  }

  let client;
  try {
    client = createAdminSupabase();
  } catch (e) {
    location.replace('/admin/login');
    return;
  }

  logout.addEventListener('click', function () {
    signOutToLogin(client);
  });

  requireAdmin(client).then(async function (gate) {
    if (!gate) return;
    const email = (gate.session.user && gate.session.user.email) || '管理员';
    who.textContent = email;
    setText('admin-email', email, 'ok');
    setText('auth-status', '正常', 'ok');

    let token = gate.session.access_token;
    let status;
    try {
      status = await adminApi('/api/admin/status', token);
    } catch (e) {
      showNotice('无法读取系统状态');
      return;
    }
    if (status.status === 401) {
      const again = await requireAdmin(client);
      if (!again) return;
      token = again.session.access_token;
      status = await adminApi('/api/admin/status', token);
    }
    if (status.status !== 200 || !status.body || status.body.ok !== true) {
      showNotice('无法读取系统状态');
      return;
    }
    const body = status.body;
    setText('sb-status', body.supabase && body.supabase.connected ? '已连接' : '未连接', body.supabase && body.supabase.connected ? 'ok' : 'bad');
    setText('catalog-count', body.catalog && body.catalog.count != null ? String(body.catalog.count) : '—');
    setText('latest-set', (body.latest && body.latest.set) || '—');
    const latestMeta = document.getElementById('latest-count');
    if (latestMeta) {
      latestMeta.textContent = body.latest && body.latest.count != null
        ? ('卡牌 ' + body.latest.count)
        : '';
    }

    try {
      const mini = await fetch('/api/mini/health');
      const miniBody = await mini.json();
      const ok = mini.status === 200 && miniBody && miniBody.ok === true;
      setText('mini-status', ok ? '正常' : '异常', ok ? 'ok' : 'bad');
    } catch (e) {
      setText('mini-status', '异常', 'bad');
    }

    try {
      const openFb = await adminApi('/api/admin/feedback?status=OPEN&page=1&pageSize=1', token);
      if (openFb.status === 200 && openFb.body && openFb.body.pagination) {
        setText('open-feedback', String(openFb.body.pagination.total || 0));
      } else {
        setText('open-feedback', '—');
      }
    } catch (e) {
      setText('open-feedback', '—');
    }
  });
})();
