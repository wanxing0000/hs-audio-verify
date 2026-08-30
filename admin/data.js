(function () {
  const who = document.getElementById('who');
  const notice = document.getElementById('notice');
  const logout = document.getElementById('logout');
  const toast = document.getElementById('toast');
  const checkBtn = document.getElementById('check-btn');
  const updateBtn = document.getElementById('update-btn');

  let client;
  let token;
  let remoteStatus = null;
  let pollTimer = null;

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

  function shortHash(value) {
    if (!value) return '—';
    const s = String(value);
    return s.length <= 12 ? s : s.slice(0, 12) + '…';
  }

  function timeText(value) {
    if (!value) return '—';
    return String(value).replace('T', ' ').replace(/\.\d+Z$/, 'Z');
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

  function renderSnapshot(snap) {
    const empty = document.getElementById('snapshot-empty');
    const kv = document.getElementById('snapshot-kv');
    if (!snap) {
      empty.hidden = false;
      kv.innerHTML = '';
      return;
    }
    empty.hidden = true;
    kv.innerHTML =
      '<span>source</span><strong>' + escapeHtml(snap.source || '—') + '</strong>' +
      '<span>locale</span><strong>' + escapeHtml(snap.locale || '—') + '</strong>' +
      '<span>cards</span><strong>' + escapeHtml(snap.cards_count == null ? '—' : String(snap.cards_count)) + '</strong>' +
      '<span>collectible</span><strong>' + escapeHtml(snap.collectible_count == null ? '—' : String(snap.collectible_count)) + '</strong>' +
      '<span>cards SHA-256</span><strong class="hash">' + escapeHtml(shortHash(snap.cards_sha256)) + '</strong>' +
      '<span>collectible SHA-256</span><strong class="hash">' + escapeHtml(shortHash(snap.collectible_sha256)) + '</strong>' +
      '<span>downloadedAt</span><strong>' + escapeHtml(snap.downloadedAt || '—') + '</strong>';
  }

  function renderRemote(status, extra) {
    const el = document.getElementById('remote-status');
    const meta = document.getElementById('remote-meta');
    remoteStatus = status || 'UNKNOWN';
    el.textContent = remoteStatus;
    el.className = 'value' + (status === 'UP_TO_DATE' ? ' ok' : status === 'UPDATED_AVAILABLE' ? '' : '');
    meta.textContent = extra || '';
    syncUpdateButton();
  }

  function syncUpdateButton(jobs) {
    const running = (jobs || []).some(function (item) {
      return item && (
        item.status === 'CHECKING' ||
        item.status === 'DOWNLOADING' ||
        item.status === 'VALIDATING' ||
        item.status === 'READY' && !item.finished_at
      );
    });
    updateBtn.disabled = remoteStatus !== 'UPDATED_AVAILABLE' || running;
    checkBtn.disabled = running;
  }

  function renderPipeline(jobs) {
    const el = document.getElementById('pipeline-step');
    if (!el) return;
    const active = (jobs || []).filter(function (item) {
      return item && item.currentStep;
    })[0] || (jobs || [])[0];
    if (!active) {
      el.textContent = '';
      return;
    }
    const step = active.currentStep || active.status || '';
    el.textContent = step ? ('进度：' + step) : '';
  }

  function renderVersions(items) {
    const rows = document.getElementById('version-rows');
    if (!items || !items.length) {
      rows.innerHTML = '<tr><td colspan="5" class="muted">暂无数据版本</td></tr>';
      return;
    }
    rows.innerHTML = items.map(function (item) {
      const counts = (item.cards_count == null ? '—' : String(item.cards_count)) +
        ' / ' +
        (item.collectible_count == null ? '—' : String(item.collectible_count));
      return '<tr>' +
        '<td>' + escapeHtml(item.version) + '</td>' +
        '<td>' + escapeHtml(item.status) + '</td>' +
        '<td>' + escapeHtml(item.build || '—') + '</td>' +
        '<td>' + escapeHtml(counts) + '</td>' +
        '<td>' + escapeHtml(timeText(item.created_at)) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderJobs(items) {
    const rows = document.getElementById('job-rows');
    if (!items || !items.length) {
      rows.innerHTML = '<tr><td colspan="5" class="muted">暂无更新任务</td></tr>';
      return;
    }
    rows.innerHTML = items.map(function (item) {
      const err = item.error_code
        ? escapeHtml(item.error_code) + (item.error_message ? ' · ' + escapeHtml(item.error_message) : '')
        : '—';
      return '<tr>' +
        '<td>' + escapeHtml(item.job_type) + '</td>' +
        '<td>' + escapeHtml(item.status) + '</td>' +
        '<td>' + escapeHtml(timeText(item.started_at)) + '</td>' +
        '<td>' + escapeHtml(timeText(item.finished_at)) + '</td>' +
        '<td>' + err + '</td>' +
        '</tr>';
    }).join('');
  }

  async function loadLists() {
    const versionsRes = await api('/api/admin/data-versions');
    if (!versionsRes) return;
    if (versionsRes.status === 503 && versionsRes.body && versionsRes.body.code === 'DATA_SCHEMA_UNAVAILABLE') {
      showNotice(versionsRes.body.error || '数据版本表尚未就绪');
      return;
    }
    if (versionsRes.status !== 200 || !versionsRes.body || versionsRes.body.ok !== true) {
      showNotice((versionsRes.body && versionsRes.body.error) || '无法读取数据版本');
      return;
    }
    renderSnapshot(versionsRes.body.snapshot);
    renderVersions(versionsRes.body.items || []);

    const jobsRes = await api('/api/admin/update-jobs');
    if (!jobsRes) return;
    if (jobsRes.status !== 200 || !jobsRes.body || jobsRes.body.ok !== true) {
      showNotice((jobsRes.body && jobsRes.body.error) || '无法读取更新任务');
      return;
    }
    renderJobs(jobsRes.body.items || []);
    renderPipeline(jobsRes.body.items || []);
    syncUpdateButton(jobsRes.body.items || []);
  }

  checkBtn.addEventListener('click', async function () {
    checkBtn.disabled = true;
    try {
      showNotice('');
      const res = await api('/api/admin/data/check', { method: 'POST', body: {} });
      if (!res) return;
      if (res.status === 409 && res.body && res.body.code === 'DATA_UPDATE_ALREADY_RUNNING') {
        showNotice('已有 HSJSON 更新任务正在进行');
        await loadLists();
        return;
      }
      if (res.status !== 200 || !res.body) {
        showNotice((res.body && res.body.error) || '检查失败');
        await loadLists();
        return;
      }
      renderRemote(res.body.status);
      showToast('检查完成');
      await loadLists();
    } finally {
      syncUpdateButton();
    }
  });

  updateBtn.addEventListener('click', async function () {
    if (updateBtn.disabled) return;
    if (!window.confirm('确认更新 HSJSON 快照？将重建语音/音频索引并验证 Catalog，不会修改 Latest Set。')) return;
    updateBtn.disabled = true;
    checkBtn.disabled = true;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () { loadLists(); }, 2000);
    try {
      showNotice('');
      const res = await api('/api/admin/data/update', { method: 'POST', body: {} });
      if (!res) return;
      if (res.status === 409 && res.body && res.body.code === 'DATA_UPDATE_ALREADY_RUNNING') {
        showNotice('已有 HSJSON 更新任务正在进行');
        await loadLists();
        return;
      }
      if (!res.body || (res.body.ok !== true && res.body.status !== 'UP_TO_DATE')) {
        showNotice((res.body && res.body.error) || 'HSJSON 更新失败');
        await loadLists();
        return;
      }
      renderRemote(res.body.status === 'UPDATED' ? 'UP_TO_DATE' : res.body.status);
      showToast(res.body.status === 'UP_TO_DATE' ? '已是最新' : 'HSJSON 已更新');
      await loadLists();
    } finally {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      await loadLists();
    }
  });

  requireAdmin(client).then(async function (gate) {
    if (!gate) return;
    token = gate.session.access_token;
    who.textContent = (gate.session.user && gate.session.user.email) || '管理员';
    await loadLists();
  });
})();
