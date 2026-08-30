(function () {
  const form = document.getElementById('login-form');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');
  const submit = document.getElementById('submit');
  const errorEl = document.getElementById('error');

  function showError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  const params = new URLSearchParams(location.search);
  if (params.get('denied') === '1') {
    showError('你没有管理员权限');
  }

  let client = null;
  try {
    client = createAdminSupabase();
  } catch (e) {
    showError('登录服务未配置');
    submit.disabled = true;
    return;
  }

  client.auth.getSession().then(async function (result) {
    const session = result && result.data && result.data.session;
    if (!session || !session.access_token) return;
    const health = await adminApi('/api/admin/health', session.access_token);
    if (health.status === 200 && health.body && health.body.ok) {
      location.replace('/admin/');
    }
  });

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    showError('');
    submit.disabled = true;
    submit.textContent = '登录中…';
    try {
      const signed = await client.auth.signInWithPassword({
        email: String(emailEl.value || '').trim(),
        password: String(passwordEl.value || ''),
      });
      if (signed.error || !signed.data || !signed.data.session) {
        showError('邮箱或密码不正确');
        return;
      }
      const token = signed.data.session.access_token;
      const health = await adminApi('/api/admin/health', token);
      if (health.status === 200 && health.body && health.body.ok) {
        location.replace('/admin/');
        return;
      }
      await client.auth.signOut();
      if (health.status === 403) showError('你没有管理员权限');
      else if (health.status === 401) showError('登录已失效');
      else showError('无法进入后台');
    } catch (e) {
      showError('登录失败');
    } finally {
      submit.disabled = false;
      submit.textContent = '登录';
    }
  });
})();
