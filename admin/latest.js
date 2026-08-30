(function () {
  const who = document.getElementById('who');
  const notice = document.getElementById('notice');
  const logout = document.getElementById('logout');
  const rowsEl = document.getElementById('rows');
  const toast = document.getElementById('toast');
  const editor = document.getElementById('editor');
  const editorTitle = document.getElementById('editor-title');
  const form = document.getElementById('editor-form');
  const setCodeInput = document.getElementById('f-set-code');
  const modal = document.getElementById('publish-modal');
  const publishCopy = document.getElementById('publish-copy');

  let client;
  let token;
  let items = [];
  let currentItem = null;
  let editingId = null;
  let pendingPublish = null;

  try {
    client = createAdminSupabase();
  } catch (e) {
    location.replace('/admin/login');
    return;
  }

  logout.addEventListener('click', function () {
    signOutToLogin(client);
  });

  function showNotice(text) {
    notice.hidden = !text;
    notice.textContent = text || '';
  }

  function showToast(text) {
    toast.hidden = !text;
    toast.textContent = text || '';
    if (text) setTimeout(function () { toast.hidden = true; }, 2400);
  }

  function dateText(value) {
    if (!value) return '—';
    return String(value).slice(0, 10);
  }

  function cardCountText(count) {
    if (count == null) return '数据不可用';
    return String(count);
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(path, options) {
    const res = await adminApi(path, token, options);
    if (res.status === 401) {
      await signOutToLogin(client);
      return null;
    }
    if (res.status === 403) {
      showNotice('你没有管理员权限。');
      return res;
    }
    return res;
  }

  function renderCurrent() {
    const empty = document.getElementById('current-empty');
    const kv = document.getElementById('current-kv');
    if (!currentItem) {
      empty.hidden = false;
      kv.hidden = true;
      kv.innerHTML = '';
      return;
    }
    empty.hidden = true;
    kv.hidden = false;
    kv.innerHTML =
      '<span>当前最新扩展包</span><strong>' + escapeHtml(currentItem.name_zh) + '</strong>' +
      '<span></span><strong>' + escapeHtml(currentItem.name_en) + '</strong>' +
      '<span>Set Code</span><strong>' + escapeHtml(currentItem.set_code) + '</strong>' +
      '<span>发布日期</span><strong>' + escapeHtml(dateText(currentItem.release_date)) + '</strong>' +
      '<span>卡牌数量</span><strong>' + escapeHtml(cardCountText(currentItem.card_count)) + '</strong>' +
      '<span>状态</span><strong>当前发布</strong>' +
      '<span>来源</span><strong>' + escapeHtml(currentItem.source || '—') + '</strong>';
  }

  function renderRows() {
    rowsEl.innerHTML = items.map(function (item) {
      const current = item.is_current === true;
      const count = cardCountText(item.card_count);
      const actions = [
        '<button type="button" class="btn ghost" data-edit="' + escapeHtml(item.id) + '">编辑</button>',
      ];
      if (!current) {
        actions.push('<button type="button" class="btn" data-publish="' + escapeHtml(item.id) + '">设为当前</button>');
      } else {
        actions.push('<span class="muted">-</span>');
      }
      return '<tr>' +
        '<td>' + escapeHtml(item.name_zh || item.name_en) + '<div class="muted">' + escapeHtml(item.name_en || '') + '</div></td>' +
        '<td>' + escapeHtml(item.set_code) + '</td>' +
        '<td>' + escapeHtml(dateText(item.release_date)) + '</td>' +
        '<td>' + escapeHtml(count) + '</td>' +
        '<td>' + (current ? '<span class="badge">当前</span>' : '<span class="muted">非当前</span>') + '</td>' +
        '<td class="actions">' + actions.join('') + '</td>' +
        '</tr>';
    }).join('');
  }

  function fillForm(item) {
    editingId = item ? item.id : null;
    editorTitle.textContent = item ? '编辑扩展包' : '添加扩展包';
    setCodeInput.value = item ? item.set_code : '';
    setCodeInput.disabled = !!item;
    document.getElementById('f-name-en').value = item ? item.name_en : '';
    document.getElementById('f-name-zh').value = item ? item.name_zh : '';
    document.getElementById('f-release').value = item && item.release_date ? String(item.release_date).slice(0, 10) : '';
    document.getElementById('f-source').value = item && item.source ? item.source : '';
    document.getElementById('f-source-url').value = item && item.source_url ? item.source_url : '';
    document.getElementById('f-verified').checked = !!(item && item.verified);
    editor.hidden = false;
  }

  function formPayload() {
    return {
      set_code: setCodeInput.value.trim(),
      name_en: document.getElementById('f-name-en').value.trim(),
      name_zh: document.getElementById('f-name-zh').value.trim(),
      release_date: document.getElementById('f-release').value.trim() || null,
      source: document.getElementById('f-source').value.trim() || null,
      source_url: document.getElementById('f-source-url').value.trim() || null,
      verified: document.getElementById('f-verified').checked === true,
    };
  }

  async function loadAll() {
    showNotice('');
    const listRes = await api('/api/admin/latest-sets');
    if (!listRes) return;
    if (listRes.status !== 200 || !listRes.body || listRes.body.ok !== true) {
      showNotice('无法读取扩展包列表');
      return;
    }
    items = listRes.body.items || [];

    const curRes = await api('/api/admin/latest-sets/current');
    if (!curRes) return;
    if (curRes.status === 404 && curRes.body && curRes.body.code === 'LATEST_SET_NOT_CONFIGURED') {
      currentItem = null;
    } else if (curRes.status === 200 && curRes.body && curRes.body.ok === true) {
      currentItem = curRes.body.item;
    } else {
      showNotice('无法读取当前最新扩展包');
      currentItem = null;
    }
    renderCurrent();
    renderRows();
  }

  async function verifyPublishState() {
    const expected = currentItem && currentItem.set_code;
    if (!expected) return;
    try {
      const mini = await fetch('/api/mini/latest?page=1&pageSize=1');
      const body = await mini.json();
      if (!body || body.set !== expected) {
        showNotice('发布状态异常');
      }
    } catch (e) {
      showNotice('发布状态异常');
    }
  }

  document.getElementById('add-btn').addEventListener('click', function () {
    fillForm(null);
  });
  document.getElementById('cancel-btn').addEventListener('click', function () {
    editor.hidden = true;
    editingId = null;
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const payload = formPayload();
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    try {
      const res = editingId
        ? await api('/api/admin/latest-sets/' + editingId, { method: 'PATCH', body: payload })
        : await api('/api/admin/latest-sets', { method: 'POST', body: payload });
      if (!res) return;
      if (res.status === 200 && res.body && res.body.ok === true) {
        editor.hidden = true;
        editingId = null;
        showToast('保存成功');
        await loadAll();
      } else {
        showNotice((res.body && res.body.error) || '保存失败，请检查服务器状态。');
      }
    } finally {
      saveBtn.disabled = false;
    }
  });

  rowsEl.addEventListener('click', function (e) {
    const editId = e.target && e.target.getAttribute && e.target.getAttribute('data-edit');
    const publishId = e.target && e.target.getAttribute && e.target.getAttribute('data-publish');
    if (editId) {
      const item = items.filter(function (row) { return row.id === editId; })[0];
      if (item) fillForm(item);
      return;
    }
    if (publishId) {
      pendingPublish = items.filter(function (row) { return row.id === publishId; })[0];
      if (!pendingPublish) return;
      const currentName = currentItem ? (currentItem.name_zh || currentItem.set_code) : '尚未设置';
      publishCopy.innerHTML =
        '确认将：<strong>' + escapeHtml(pendingPublish.name_zh || pendingPublish.set_code) + '</strong> 设置为当前最新扩展包？' +
        '<br>当前最新：<strong>' + escapeHtml(currentName) + '</strong>' +
        '<br>发布后小程序最新卡牌页面将切换到该扩展包。';
      modal.hidden = false;
    }
  });

  document.getElementById('publish-cancel').addEventListener('click', function () {
    modal.hidden = true;
    pendingPublish = null;
  });

  document.getElementById('publish-ok').addEventListener('click', async function () {
    if (!pendingPublish) return;
    const btn = document.getElementById('publish-ok');
    btn.disabled = true;
    try {
      const res = await api('/api/admin/latest-sets/' + pendingPublish.id + '/publish', { method: 'POST', body: {} });
      if (!res) return;
      modal.hidden = true;
      if (res.status === 200 && res.body && res.body.ok === true) {
        showToast('发布成功');
        await loadAll();
        await api('/api/admin/status');
        await verifyPublishState();
      } else if (res.body && res.body.code === 'LATEST_SET_DATA_NOT_FOUND') {
        showNotice('该扩展包尚未存在于当前卡牌数据中，无法发布。');
      } else if (res.status === 500) {
        showNotice('发布失败，请检查服务器状态。');
      } else {
        showNotice((res.body && res.body.error) || '发布失败，请检查服务器状态。');
      }
    } finally {
      btn.disabled = false;
      pendingPublish = null;
    }
  });

  requireAdmin(client).then(async function (gate) {
    if (!gate) return;
    token = gate.session.access_token;
    who.textContent = (gate.session.user && gate.session.user.email) || '管理员';
    await loadAll();
  });
})();
