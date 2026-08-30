(function () {
  const who = document.getElementById('who');
  const notice = document.getElementById('notice');
  const logout = document.getElementById('logout');
  const rowsEl = document.getElementById('rows');
  const toast = document.getElementById('toast');
  const empty = document.getElementById('list-empty');
  const pageMeta = document.getElementById('page-meta');
  const filterStatus = document.getElementById('filter-status');
  const filterType = document.getElementById('filter-type');
  const prevPage = document.getElementById('prev-page');
  const nextPage = document.getElementById('next-page');
  const modal = document.getElementById('detail-modal');
  const detailKv = document.getElementById('detail-kv');
  const detailMessage = document.getElementById('detail-message');
  const detailStatus = document.getElementById('detail-status');
  const detailClose = document.getElementById('detail-close');
  const detailSave = document.getElementById('detail-save');

  let client;
  let token;
  let page = 1;
  let totalPages = 0;
  let currentItem = null;

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

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeText(value) {
    if (!value) return '—';
    return String(value).replace('T', ' ').slice(0, 19);
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

  function listQuery() {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', '20');
    if (filterStatus.value) params.set('status', filterStatus.value);
    if (filterType.value) params.set('type', filterType.value);
    return '/api/admin/feedback?' + params.toString();
  }

  function renderRows(items) {
    if (!items || !items.length) {
      empty.hidden = false;
      rowsEl.innerHTML = '';
      return;
    }
    empty.hidden = true;
    rowsEl.innerHTML = items.map(function (item) {
      return '<tr>' +
        '<td>' + escapeHtml(item.typeLabel || item.type) + '</td>' +
        '<td>' + escapeHtml(item.excerpt || '') + '</td>' +
        '<td>' + escapeHtml(item.statusLabel || item.status) + '</td>' +
        '<td>' + escapeHtml(timeText(item.createdAt)) + '</td>' +
        '<td><button type="button" class="btn ghost" data-id="' + escapeHtml(item.id) + '">查看</button></td>' +
        '</tr>';
    }).join('');
  }

  async function loadList() {
    const res = await api(listQuery());
    if (!res) return;
    if (res.status !== 200 || !res.body || res.body.ok !== true) {
      showNotice((res.body && res.body.error) || '无法读取反馈列表');
      return;
    }
    showNotice('');
    const pagination = res.body.pagination || {};
    page = pagination.page || 1;
    totalPages = pagination.totalPages || 0;
    renderRows(res.body.items || []);
    pageMeta.textContent = '第 ' + page + ' / ' + (totalPages || 1) + ' 页 · 共 ' + (pagination.total || 0) + ' 条';
    prevPage.disabled = page <= 1;
    nextPage.disabled = totalPages === 0 || page >= totalPages;
  }

  function openDetail(item) {
    currentItem = item;
    detailKv.innerHTML =
      '<span>类型</span><strong>' + escapeHtml(item.typeLabel || item.type) + '</strong>' +
      '<span>状态</span><strong>' + escapeHtml(item.statusLabel || item.status) + '</strong>' +
      '<span>提交时间</span><strong>' + escapeHtml(timeText(item.createdAt)) + '</strong>' +
      '<span>更新时间</span><strong>' + escapeHtml(timeText(item.updatedAt)) + '</strong>';
    detailMessage.textContent = item.message || '';
    detailStatus.value = item.status;
    modal.hidden = false;
  }

  rowsEl.addEventListener('click', async function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-id]') : null;
    if (!btn) return;
    const res = await api('/api/admin/feedback/' + encodeURIComponent(btn.getAttribute('data-id')));
    if (!res) return;
    if (res.status !== 200 || !res.body || !res.body.item) {
      showNotice((res.body && res.body.error) || '无法读取反馈详情');
      return;
    }
    openDetail(res.body.item);
  });

  detailClose.addEventListener('click', function () {
    modal.hidden = true;
    currentItem = null;
  });

  detailSave.addEventListener('click', async function () {
    if (!currentItem) return;
    detailSave.disabled = true;
    const res = await api('/api/admin/feedback/' + encodeURIComponent(currentItem.id), {
      method: 'PATCH',
      body: { status: detailStatus.value },
    });
    detailSave.disabled = false;
    if (!res) return;
    if (res.status !== 200 || !res.body || res.body.ok !== true) {
      showNotice((res.body && res.body.error) || '更新状态失败');
      return;
    }
    showToast('状态已更新');
    modal.hidden = true;
    currentItem = null;
    await loadList();
  });

  filterStatus.addEventListener('change', function () {
    page = 1;
    loadList();
  });
  filterType.addEventListener('change', function () {
    page = 1;
    loadList();
  });
  prevPage.addEventListener('click', function () {
    if (page > 1) {
      page -= 1;
      loadList();
    }
  });
  nextPage.addEventListener('click', function () {
    if (totalPages === 0 || page < totalPages) {
      page += 1;
      loadList();
    }
  });

  requireAdmin(client).then(async function (gate) {
    if (!gate) return;
    token = gate.session.access_token;
    who.textContent = (gate.session.user && gate.session.user.email) || '管理员';
    await loadList();
  });
})();
