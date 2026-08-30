const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 30;
const placeholder = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect fill="#1c2030" width="200" height="280"/><text x="100" y="150" fill="#6b7388" text-anchor="middle" font-size="16">暂无卡图</text></svg>'
);

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
let query = params.get('q') || '';
let page = Number(params.get('page') || 1);
let currentCard = params.get('card') || '';
let playingUrl = null;

const audio = new Audio();
audio.preload = 'metadata';
audio.volume = 1;

function activePlayer() {
  return document.querySelector('.player:not([hidden])');
}

audio.ontimeupdate = () => {
  const player = activePlayer();
  if (!player || !audio.duration) return;
  const seek = player.querySelector('.seek');
  const time = player.querySelector('.time');
  if (seek) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  if (time) time.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
};
audio.onended = () => {
  document.querySelectorAll('.entrance-btn, .track-btn').forEach((btn) => {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  });
  const player = activePlayer();
  if (player) player.querySelector('.pp').textContent = '▶';
};

async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(DEBUG ? path + sep + 'debug=1' : path);
  if (!res.ok) {
    let msg = '暂时无法播放';
    try {
      const body = await res.json();
      msg = body.error || msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function imgErr(el) {
  el.onerror = null;
  el.src = placeholder;
}

function setUrl() {
  const next = new URL(location.href);
  const sp = next.searchParams;
  if (DEBUG) sp.set('debug', '1'); else sp.delete('debug');
  if (query) sp.set('q', query); else sp.delete('q');
  if (query && page > 1) sp.set('page', String(page)); else sp.delete('page');
  if (currentCard) sp.set('card', currentCard); else sp.delete('card');
  history.replaceState(null, '', next.pathname + (sp.toString() ? '?' + sp.toString() : ''));
}

function cardButton(c) {
  const cls = [c.classLabel, c.typeLabel].filter(Boolean).join(' · ');
  const voice = c.hasPlayVoice ? '<span class="tag">有登场语音</span>' : '';
  return `<button class="card" data-id="${c.cardId}">
    <img src="${c.imageUrl}" alt="" onerror="this.onerror=null;this.src='${placeholder}'" />
    <div class="meta">
      <div class="name">${c.name}</div>
      <div class="sub">${c.cardId}${cls ? ' · ' + cls : ''}</div>
      ${voice}
    </div>
  </button>`;
}

function bindGrid(root) {
  root.querySelectorAll('.card').forEach((btn) => {
    btn.addEventListener('click', () => openCard(btn.dataset.id));
  });
}

function fmt(t) {
  if (!Number.isFinite(t)) return '0:00';
  const s = Math.max(0, Math.floor(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function playerHtml(kind) {
  return `<div class="player" data-kind="${kind}" hidden>
    <button class="pp" type="button" aria-label="播放">▶</button>
    <input class="seek" type="range" min="0" max="1000" value="0" />
    <span class="time">0:00 / 0:00</span>
    <input class="vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="音量" />
  </div>
  <p class="err" hidden></p>`;
}

function stopAudio() {
  audio.pause();
  audio.removeAttribute('src');
  playingUrl = null;
  document.querySelectorAll('.entrance-btn, .track-btn').forEach((btn) => {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
  });
  document.querySelectorAll('.player').forEach((p) => { p.hidden = true; });
}

function withDebug(url) {
  if (!DEBUG) return url;
  return url + (url.includes('?') ? '&' : '?') + 'debug=1';
}

async function playUrl(url, button, player) {
  const label = button.dataset.label;
  document.querySelectorAll('.entrance-btn, .track-btn').forEach((btn) => {
    if (btn !== button && btn.dataset.label) btn.textContent = btn.dataset.label;
  });
  button.disabled = true;
  button.textContent = '准备音频...';
  const err = player.parentElement.querySelector('.err');
  err.hidden = true;
  try {
    const t0 = performance.now();
    const res = await fetch(withDebug(url));
    if (!res.ok) {
      let msg = '暂时无法播放';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    if (playingUrl) URL.revokeObjectURL(playingUrl);
    playingUrl = obj;
    audio.src = obj;
    document.querySelectorAll('.player').forEach((p) => { p.hidden = p !== player; });
    player.hidden = false;
    button.textContent = '⏸ 正在播放';
    await audio.play();
    button.textContent = '⏸ 正在播放';
    button.disabled = false;
    player.dataset.ms = String(Math.round(performance.now() - t0));
  } catch (e) {
    button.textContent = label;
    button.disabled = false;
    err.textContent = e.message || '暂时无法播放';
    err.hidden = false;
  }
}

function bindPlayer(root, button, player, url) {
  const pp = player.querySelector('.pp');
  const seek = player.querySelector('.seek');
  const time = player.querySelector('.time');
  const vol = player.querySelector('.vol');
  button.dataset.label = button.textContent;
  button.addEventListener('click', async () => {
    if (!player.hidden && !audio.paused && audio.src) {
      audio.pause();
      button.textContent = button.dataset.label;
      pp.textContent = '▶';
      return;
    }
    if (!player.hidden && audio.paused && audio.src) {
      await audio.play();
      button.textContent = '⏸ 正在播放';
      pp.textContent = '⏸';
      return;
    }
    await playUrl(url, button, player);
    pp.textContent = '⏸';
  });
  pp.addEventListener('click', async () => {
    if (!audio.src) {
      await playUrl(url, button, player);
      pp.textContent = '⏸';
      return;
    }
    if (audio.paused) {
      await audio.play();
      pp.textContent = '⏸';
      button.textContent = '⏸ 正在播放';
    } else {
      audio.pause();
      pp.textContent = '▶';
      button.textContent = button.dataset.label;
    }
  });
  seek.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  });
  vol.addEventListener('input', () => { audio.volume = Number(vol.value); });
}

function trackBlock(title, available, status, url, kind) {
  if (!available) {
    return `<article class="track"><div class="row"><h3>${title}</h3><span class="na">${status || '暂无语音'}</span></div></article>`;
  }
  return `<article class="track">
    <div class="row">
      <h3>${title}</h3>
      <button class="track-btn" data-kind="${kind}">播放</button>
    </div>
    ${playerHtml(kind)}
  </article>`;
}

function renderDetail(card) {
  const chips = [
    card.classLabel,
    card.typeLabel,
    card.rarityLabel,
    card.cost != null ? card.cost + ' 费' : '',
    card.collectible ? '收藏卡' : '非收藏',
  ].filter(Boolean).map((x) => `<span class="chip">${x}</span>`).join('');
  const t = card.tracks;
  const debug = DEBUG ? `<pre class="debug">${JSON.stringify({
    cardId: card.cardId,
    play: t.play,
    attack: t.attack,
    death: t.death,
    music: t.music,
  }, null, 2)}</pre>` : '';
  const source = t.play.sourceNote ? `<p class="note">${t.play.sourceNote}</p>` : '';
  $('detail').innerHTML = `
    <img class="portrait" src="${card.imageUrl}" alt="" onerror="this.onerror=null;this.src='${placeholder}'" />
    <div class="detail-title">
      <h2>${card.name}</h2>
      <p class="id">${card.cardId}${card.nameEn ? ' · ' + card.nameEn : ''}</p>
    </div>
    <div class="chips">${chips}</div>
    ${t.entrance.available
      ? `<button class="entrance-btn" id="entrance-btn">完整登场试听</button>${playerHtml('entrance')}`
      : `<p class="empty">暂无完整登场音频</p>`}
    ${source}
    <div class="tracks">
      ${trackBlock('登场语音', t.play.available, t.play.userStatus, '/api/voice/' + card.cardId + '/play', 'play')}
      ${trackBlock('登场音乐', t.music.available, t.music.userStatus, '/api/music/' + card.cardId, 'music')}
      ${trackBlock('攻击语音', t.attack.available, t.attack.userStatus, '/api/voice/' + card.cardId + '/attack', 'attack')}
      ${trackBlock('死亡语音', t.death.available, t.death.userStatus, '/api/voice/' + card.cardId + '/death', 'death')}
    </div>
    ${debug}
  `;
  if (t.entrance.available) {
    bindPlayer($('detail'), $('entrance-btn'), $('detail').querySelector('[data-kind="entrance"]'), '/api/entrance/' + encodeURIComponent(card.cardId));
  }
  $('detail').querySelectorAll('.track-btn').forEach((btn) => {
    const kind = btn.dataset.kind;
    const player = btn.closest('.track').querySelector('.player');
    const url = kind === 'music'
      ? '/api/music/' + encodeURIComponent(card.cardId)
      : '/api/voice/' + encodeURIComponent(card.cardId) + '/' + kind;
    bindPlayer(btn.closest('.track'), btn, player, url);
  });
}

async function openCard(cardId) {
  currentCard = cardId;
  setUrl();
  stopAudio();
  $('overlay').hidden = false;
  $('detail').innerHTML = '<p class="muted">加载中...</p>';
  try {
    const card = await api('/api/cards/' + encodeURIComponent(cardId));
    renderDetail(card);
  } catch {
    $('detail').innerHTML = '<p class="empty">没有找到相关卡牌</p>';
  }
}

function closeCard() {
  currentCard = '';
  stopAudio();
  $('overlay').hidden = true;
  setUrl();
}

function renderPager(total, current) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const nav = $('pager');
  if (pages <= 1) { nav.hidden = true; nav.innerHTML = ''; return; }
  nav.hidden = false;
  const buttons = [];
  buttons.push(`<button data-p="${current - 1}" ${current <= 1 ? 'disabled' : ''}>上一页</button>`);
  const windowStart = Math.max(1, current - 2);
  const windowEnd = Math.min(pages, current + 2);
  for (let i = windowStart; i <= windowEnd; i++) {
    buttons.push(`<button data-p="${i}" ${i === current ? 'aria-current="page"' : ''}>${i}</button>`);
  }
  buttons.push(`<button data-p="${current + 1}" ${current >= pages ? 'disabled' : ''}>下一页</button>`);
  nav.innerHTML = buttons.join('');
  nav.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const p = Number(b.dataset.p);
      if (p >= 1 && p <= pages) runSearch(query, p);
    });
  });
}

async function runSearch(q, nextPage) {
  query = q;
  page = nextPage || 1;
  setUrl();
  $('q').value = query;
  $('q-header').value = query;
  if (!query.trim()) {
    $('results-block').hidden = true;
    $('home-block').hidden = false;
    $('empty').hidden = true;
    return;
  }
  $('home-block').hidden = true;
  $('results-block').hidden = false;
  const data = await api('/api/cards?q=' + encodeURIComponent(query) + '&page=' + page + '&pageSize=' + PAGE_SIZE);
  $('results-title').textContent = '搜索结果';
  $('results-meta').textContent = data.total ? `共 ${data.total} 张` : '';
  if (!data.results.length) {
    $('results').innerHTML = '';
    $('empty').hidden = false;
    $('pager').hidden = true;
    return;
  }
  $('empty').hidden = true;
  $('results').innerHTML = data.results.map(cardButton).join('');
  bindGrid($('results'));
  renderPager(data.total, data.page);
}

let timer = null;
function onType(value) {
  clearTimeout(timer);
  timer = setTimeout(() => runSearch(value, 1), 120);
}

$('q').addEventListener('input', (e) => onType(e.target.value));
$('q-header').addEventListener('input', (e) => {
  $('q').value = e.target.value;
  onType(e.target.value);
});
$('main-search').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('q').value, 1); });
$('header-search').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('q-header').value, 1); });
$('close').addEventListener('click', closeCard);
$('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeCard(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });

api('/api/featured').then((data) => {
  $('featured').innerHTML = data.results.map(cardButton).join('');
  bindGrid($('featured'));
}).catch(() => {});

if (query) runSearch(query, page);
if (currentCard) openCard(currentCard);
