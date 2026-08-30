const $ = (id) => document.getElementById(id);
const SHORTCUTS = [
  ['EX1_116', '火车王'],
  ['VAN_NEW1_010', 'shared_resource'],
  ['VAC_954', 'shared_audio'],
  ['CAP_107', 'token_clip'],
  ['CFM_335', 'named_sfx'],
  ['EDR_526', 'direct'],
  ['CORE_DMF_067', 'CORE'],
  ['WON_302', 'WON'],
];

const placeholder = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="168"><rect fill="#2a2c33" width="120" height="168"/><text x="60" y="88" fill="#888" text-anchor="middle" font-size="12">no art</text></svg>'
);

function imgErr(el) { el.onerror = null; el.src = placeholder; }

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function renderList(rows) {
  const box = $('results');
  if (!rows.length) {
    box.innerHTML = '<p class="hint">无匹配。</p>';
    return;
  }
  box.innerHTML = rows.map((c) => `
    <button class="card-row" data-id="${c.cardId}">
      <img src="${c.imageUrl}" alt="" onerror="this.onerror=null;this.src='${placeholder}'" />
      <div>
        <div>${c.name}</div>
        <div class="meta-id">${c.cardId}</div>
        <div class="meta-id">${c.type}${c.collectible ? ' · collectible' : ''}</div>
      </div>
    </button>
  `).join('');
  box.querySelectorAll('.card-row').forEach((btn) => {
    btn.addEventListener('click', () => selectCard(btn.dataset.id));
  });
}

function slotView(slot) {
  const statusClass = slot.playable ? 'ok' : (slot.uiStatus.includes('unresolved') ? 'warn' : 'bad');
  const mark = slot.playable ? '✓' : '–';
  const play = slot.playable
    ? `<div class="play-row">
         <button class="play-btn" data-key="${encodeURIComponent(slot.voiceKey)}">▶ Play</button>
         <audio controls preload="none"></audio>
         <span class="err" hidden></span>
       </div>`
    : `<p class="${statusClass}">${slot.uiStatus}</p>`;
  return `
    <article class="slot">
      <h3>${slot.type.toUpperCase()} <span class="${statusClass}">${mark} ${slot.uiStatus}</span></h3>
      <div class="slot-grid">
        <span>VoiceKey</span><span>${slot.voiceKey || '—'}</span>
        <span>Source</span><span>${slot.voiceSourceCardId || '—'}</span>
        <span>Mapping</span><span>${slot.mappingType || '—'}</span>
      </div>
      ${play}
    </article>
  `;
}

function bindPlay(root) {
  root.querySelectorAll('.play-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const musicFile = btn.dataset.music;
      const key = btn.dataset.key ? decodeURIComponent(btn.dataset.key) : null;
      const row = btn.parentElement;
      const audio = row.querySelector('audio');
      const err = row.querySelector('.err');
      err.hidden = true;
      btn.disabled = true;
      try {
        const url = musicFile
          ? '/api/music/' + encodeURIComponent(musicFile)
          : '/api/audio/' + encodeURIComponent(key);
        const t0 = performance.now();
        const res = await fetch(url);
        const ms = Math.round(performance.now() - t0);
        if (!res.ok) {
          let msg = 'Failed to extract audio';
          try { msg = (await res.json()).error || msg; } catch {}
          throw new Error(msg);
        }
        const blob = await res.blob();
        audio.src = URL.createObjectURL(blob);
        audio.dataset.cache = res.headers.get('X-Cache') || '';
        audio.dataset.ms = String(ms);
        await audio.play().catch(() => {});
      } catch (e) {
        err.textContent = e.message || 'Failed to extract audio';
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function selectCard(cardId) {
  $('results').querySelectorAll('.card-row').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === cardId);
  });
  const card = await api('/api/card/' + encodeURIComponent(cardId));
  const en = card.nameEn ? `<div class="kv"><b>English</b>${card.nameEn}</div>` : '';
  let musicHtml = '';
  try {
    const music = await api('/api/music-index');
    if (music && music.cardId === card.cardId && music.musicStinger && music.musicStinger.audioClip) {
      musicHtml = `
        <article class="slot">
          <h3>MUSIC STINGER <span class="ok">✓ Phase 0.10 sample</span></h3>
          <div class="slot-grid">
            <span>Clip</span><span>${music.musicStinger.audioClip || '—'}</span>
            <span>GUID</span><span>${music.musicStinger.guid || '—'}</span>
            <span>Duration</span><span>${music.musicStinger.duration != null ? Number(music.musicStinger.duration).toFixed(3) + 's' : '—'}</span>
          </div>
          <div class="play-row">
            <button class="play-btn" data-music="EX1_116_MusicStinger.wav">▶ Stinger</button>
            <audio controls preload="none"></audio>
            <span class="err" hidden></span>
          </div>
          <div class="play-row">
            <button class="play-btn" data-music="EX1_116_entrance_preview.wav">▶ Stinger + Play (t=0)</button>
            <audio controls preload="none"></audio>
            <span class="err" hidden></span>
          </div>
        </article>`;
    }
  } catch {}
  $('detail').innerHTML = `
    <div class="detail-head">
      <img class="art" src="${card.imageUrl}" alt="" onerror="this.onerror=null;this.src='${placeholder}'" />
      <div>
        <h2>${card.name}</h2>
        <div class="kv"><b>CardID</b><span class="meta-id">${card.cardId}</span></div>
        <div class="kv"><b>类型</b>${card.type}</div>
        <div class="kv"><b>收藏卡</b>${card.collectible ? '是' : '否'}</div>
        ${en}
      </div>
    </div>
    <div class="slots">
      ${slotView(card.voice.play)}
      ${slotView(card.voice.attack)}
      ${slotView(card.voice.death)}
      ${musicHtml}
    </div>
  `;
  bindPlay($('detail'));
}

let timer = null;
$('q').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const q = $('q').value;
    if (!q.trim()) { $('results').innerHTML = ''; return; }
    const data = await api('/api/search?q=' + encodeURIComponent(q));
    renderList(data.results);
  }, 150);
});

$('chips').innerHTML = SHORTCUTS.map(([id, label]) =>
  `<button data-id="${id}">${id}<br>${label}</button>`
).join('');
$('chips').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', async () => {
    $('q').value = b.dataset.id;
    const data = await api('/api/search?q=' + encodeURIComponent(b.dataset.id));
    renderList(data.results);
    selectCard(b.dataset.id);
  });
});

api('/api/manifest').then((m) => {
  $('manifest').textContent = `${m.game} ${m.productVersion || m.build} · ${m.cardCount} cards · ${m.clipCount} clips · local only`;
}).catch(() => {});
