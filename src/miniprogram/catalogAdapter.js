const fs = require('fs');
const { slotUi } = require('./audioAvailability.js');
const { pickCanonicalCardId } = require('../music/musicStingerRules.js');

const ART_BASE = 'https://art.hearthstonejson.com/v1/render/latest/zhCN/256x';

const CLASS_ZH = {
  DEATHKNIGHT: '死亡骑士',
  DEMONHUNTER: '恶魔猎手',
  DRUID: '德鲁伊',
  HUNTER: '猎人',
  MAGE: '法师',
  PALADIN: '圣骑士',
  PRIEST: '牧师',
  ROGUE: '潜行者',
  SHAMAN: '萨满祭司',
  WARLOCK: '术士',
  WARRIOR: '战士',
  NEUTRAL: '中立',
};

const TYPE_ZH = {
  MINION: '随从',
  SPELL: '法术',
  WEAPON: '武器',
  HERO: '英雄',
  HERO_POWER: '英雄技能',
  ENCHANTMENT: '附魔',
  LOCATION: '地标',
};

const RARITY_ZH = {
  FREE: '免费',
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
};

const CLASS_ORDER = [
  'DEATHKNIGHT',
  'DEMONHUNTER',
  'DRUID',
  'HUNTER',
  'MAGE',
  'PALADIN',
  'PRIEST',
  'ROGUE',
  'SHAMAN',
  'WARLOCK',
  'WARRIOR',
  'NEUTRAL',
];

const RARITY_ORDER = ['LEGENDARY', 'EPIC', 'RARE', 'COMMON'];

const VERIFY_IDS = [
  'EX1_116',
  'VAN_NEW1_010',
  'CORE_DMF_067',
  'WON_302',
  'VAC_954',
  'CFM_335',
  'CAP_107',
  'ETC_409',
];

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function stripMarkup(s) {
  if (!s) return null;
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\$/g, '')
    .trim() || null;
}

function getCardImageUrl(card) {
  const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
  if (!id) return '';
  return ART_BASE + '/' + id + '.png';
}

function voicePlayable(slot) {
  return !!(slot && (slot.status === 'available' || slot.status === 'shared') && slot.voiceKey);
}

function musicPlayable(music) {
  return !!(
    music
    && (music.status === 'available' || music.status === 'shared')
    && (music.audioClipName || music.musicAssetId)
  );
}

function adaptSlot(slot) {
  const available = voicePlayable(slot);
  const shared = available && slot.status === 'shared';
  return {
    available,
    shared,
    voiceKey: available ? slot.voiceKey : null,
    sourceCardId: available ? (slot.sourceCardId || null) : null,
  };
}

function adaptCard(raw) {
  if (!raw || !raw.id) return null;
  const voice = {
    play: adaptSlot(raw.voice && raw.voice.play),
    attack: adaptSlot(raw.voice && raw.voice.attack),
    death: adaptSlot(raw.voice && raw.voice.death),
  };
  const musicOn = musicPlayable(raw.music);
  const music = {
    available: musicOn,
    shared: musicOn && raw.music.status === 'shared',
    musicAssetId: musicOn ? raw.music.musicAssetId : null,
    audioClipName: musicOn ? raw.music.audioClipName : null,
    sourceCardId: musicOn ? (raw.music.sourceCardId || null) : null,
  };
  const entranceOn = !!(voice.play.available && musicOn);
  return {
    id: raw.id,
    name: raw.name || raw.id,
    text: stripMarkup(raw.text),
    flavor: stripMarkup(raw.flavor),
    type: raw.type || 'UNKNOWN',
    typeLabel: TYPE_ZH[raw.type] || raw.type || '',
    class: raw.class || null,
    classLabel: CLASS_ZH[raw.class] || raw.class || '',
    rarity: raw.rarity || null,
    rarityLabel: RARITY_ZH[raw.rarity] || raw.rarity || '',
    collectible: raw.collectible === true,
    set: raw.set || null,
    dbfId: raw.dbfId == null ? null : raw.dbfId,
    imageUrl: getCardImageUrl(raw),
    voice,
    music,
    entrancePreview: { available: entranceOn },
  };
}

function resolveQuickPlay(card) {
  const playOn = !!(card && card.voice && card.voice.play && card.voice.play.available);
  const musicOn = !!(card && card.music && card.music.available);
  const entranceOn = !!(card && card.entrancePreview && card.entrancePreview.available);
  if ((entranceOn || (playOn && musicOn)) && playOn && musicOn) {
    return { type: 'entrance', available: true, label: '🎵 完整登场' };
  }
  if (playOn) {
    return { type: 'voice', available: true, label: '🔊 登场语音' };
  }
  if (musicOn) {
    return { type: 'music', available: true, label: '🎵 登场音乐' };
  }
  return { type: 'none', available: false, label: null };
}

function toListCard(card) {
  const quickPlay = resolveQuickPlay(card);
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    class: card.class,
    classLabel: card.classLabel,
    rarity: card.rarity,
    rarityLabel: card.rarityLabel,
    collectible: card.collectible,
    set: card.set,
    dbfId: card.dbfId,
    imageUrl: card.imageUrl,
    hasPlay: !!(card.voice && card.voice.play && card.voice.play.available),
    hasMusic: !!(card.music && card.music.available),
    hasEntrance: !!(card.entrancePreview && card.entrancePreview.available),
    legendary: card.rarity === 'LEGENDARY',
    quickPlay,
  };
}

function publicDetail(card, diag) {
  const availability = diag || (card && card.audioAvailability) || null;
  const slot = (s, sharedNote, trackDiag) => {
    const status = (trackDiag && trackDiag.status)
      || (s && s.available ? 'available' : 'unavailable');
    const ui = slotUi(status);
    return {
      available: status === 'available',
      shared: !!(s && s.shared),
      note: s && s.shared ? sharedNote : null,
      status: status,
      emptyLabel: ui.emptyLabel,
      disabled: ui.disabled,
    };
  };
  const playDiag = availability && availability.play;
  const attackDiag = availability && availability.attack;
  const deathDiag = availability && availability.death;
  const musicDiag = availability && availability.music;
  const special = !!(availability && availability.special);
  return {
    id: card.id,
    name: card.name,
    text: card.text,
    flavor: card.flavor,
    type: card.type,
    typeLabel: card.typeLabel,
    class: card.class,
    classLabel: card.classLabel,
    rarity: card.rarity,
    rarityLabel: card.rarityLabel,
    collectible: card.collectible,
    set: card.set,
    dbfId: card.dbfId,
    imageUrl: card.imageUrl,
    voice: {
      play: slot(card.voice.play, '使用原卡语音', playDiag),
      attack: slot(card.voice.attack, '使用原卡语音', attackDiag),
      death: slot(card.voice.death, '使用原卡语音', deathDiag),
    },
    music: card.music.available
      ? {
        available: true,
        shared: !!card.music.shared,
        status: card.music.shared ? 'shared' : 'available',
        musicAssetId: card.music.musicAssetId || null,
        sourceCardId: card.music.sourceCardId || null,
        audioClipName: card.music.audioClipName || null,
        note: card.music.shared ? '使用原卡登场音乐' : null,
        emptyLabel: null,
        disabled: false,
      }
      : {
        available: false,
        shared: false,
        status: (musicDiag && musicDiag.status) || 'unavailable',
        musicAssetId: (card.music && card.music.musicAssetId) || null,
        sourceCardId: (card.music && card.music.sourceCardId) || null,
        audioClipName: (card.music && card.music.audioClipName) || null,
        note: null,
        emptyLabel: slotUi(musicDiag && musicDiag.status).emptyLabel || '无登场语音',
        disabled: true,
      },
    entrancePreview: { available: !!(card.entrancePreview && card.entrancePreview.available) },
    audio: {
      cardAudioStatus: (availability && availability.cardAudioStatus) || (card.entrancePreview && card.entrancePreview.available ? 'full' : 'partial'),
      special: special,
      message: special ? '该卡使用特殊语音系统，当前版本暂未完整收录' : null,
    },
  };
}

function shouldPublish(raw) {
  return !!(raw && (raw.collectible === true || VERIFY_IDS.indexOf(raw.id) >= 0));
}

function playSourceCardId(card) {
  const src = card && card.voice && card.voice.play && card.voice.play.sourceCardId;
  if (src == null || src === '') return '';
  return String(src);
}

function defaultFoldWarn(msg) {
  try { console.warn('[catalog] ' + msg); } catch (e) {}
}

function resolveFoldCanonicalId(card, publishedById, warn) {
  const self = String(card.id);
  const src = playSourceCardId(card);
  if (!src || src === self) return self;
  if (!publishedById[src]) {
    warn('sourceCardId ' + src + ' not found, keep current card ' + self);
    return self;
  }
  const srcSrc = playSourceCardId(publishedById[src]);
  if (srcSrc && srcSrc === self) {
    warn('cyclic sourceCardId ' + self + ' <-> ' + src + ', keep both as safe candidates');
  } else if (srcSrc && srcSrc !== src) {
    warn('sourceCardId chain ' + self + ' -> ' + src + ' -> ' + srcSrc + ', fold one hop only');
  }
  return src;
}

function pickFoldWinner(groupKey, members, publishedById, warn) {
  for (let i = 0; i < members.length; i++) {
    if (members[i] && members[i].id === groupKey) return members[i];
  }
  const ids = [];
  for (let i = 0; i < members.length; i++) {
    if (members[i] && members[i].id) ids.push(members[i].id);
  }
  const picked = pickCanonicalCardId(ids, publishedById);
  const winner = (picked && publishedById[picked])
    || members.slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })[0];
  warn('canonical card ' + groupKey + ' missing, keep ' + (winner && winner.id));
  return winner;
}

function foldSharedReprints(cards, opts) {
  opts = opts || {};
  const warnings = [];
  const userWarn = opts.warn;
  const warn = function (msg) {
    const line = String(msg);
    warnings.push(line);
    if (typeof userWarn === 'function') userWarn(line);
  };
  const list = Array.isArray(cards) ? cards : [];
  const publishedById = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    const card = list[i];
    if (card && card.id) publishedById[card.id] = card;
  }
  const groups = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    const card = list[i];
    if (!card || !card.id) continue;
    const key = resolveFoldCanonicalId(card, publishedById, warn);
    if (!groups[key]) groups[key] = [];
    groups[key].push(card);
  }
  const keys = Object.keys(groups);
  keys.sort();
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < keys.length; i++) {
    const winner = pickFoldWinner(keys[i], groups[keys[i]], publishedById, warn);
    if (!winner || !winner.id || seen[winner.id]) continue;
    seen[winner.id] = true;
    out.push(winner);
  }
  return {
    cards: out,
    before: list.length,
    after: out.length,
    folded: list.length - out.length,
    groups: keys.length,
    warnings: warnings,
  };
}

function buildCatalog(unified) {
  const adapted = [];
  const byId = Object.create(null);
  const cards = (unified && unified.cards) || {};
  for (const id of Object.keys(cards)) {
    const raw = cards[id];
    if (!shouldPublish(raw)) continue;
    const card = adaptCard(raw);
    if (!card) continue;
    adapted.push(card);
    byId[card.id] = card;
  }
  const folded = foldSharedReprints(adapted);
  if (folded.warnings.length) {
    defaultFoldWarn(
      'reprint fold before=' + folded.before
      + ' after=' + folded.after
      + ' folded=' + folded.folded
      + ' warnings=' + folded.warnings.length
    );
  }
  return {
    schemaVersion: (unified && unified.schemaVersion) || '1.0',
    clientVersion: (unified && unified.clientVersion) || null,
    locale: (unified && unified.locale) || 'zhCN',
    cards: folded.cards,
    byId,
    foldStats: {
      before: folded.before,
      after: folded.after,
      folded: folded.folded,
      groups: folded.groups,
      warningCount: folded.warnings.length,
      warnings: folded.warnings,
    },
  };
}

function scoreCard(card, q) {
  const id = String(card.id || '').toLowerCase();
  const name = String(card.name || '').toLowerCase();
  const en = String(card.nameEn || '').toLowerCase();
  let score = 0;
  if (id === q) score = 100;
  else if (id.startsWith(q)) score = 80;
  else if (id.includes(q)) score = 60;
  if (name === q) score = Math.max(score, 95);
  else if (name.startsWith(q)) score = Math.max(score, 88);
  else if (name.includes(q)) score = Math.max(score, 70);
  if (en) {
    if (en === q) score = Math.max(score, 93);
    else if (en.startsWith(q)) score = Math.max(score, 82);
    else if (en.includes(q)) score = Math.max(score, 65);
  }
  return score;
}

function filterCards(cards, { classFilter, rarityFilter, legendaryMusic } = {}) {
  let list = cards || [];
  if (classFilter && classFilter !== 'ALL') list = list.filter((c) => c.class === classFilter);
  if (rarityFilter && rarityFilter !== 'ALL') list = list.filter((c) => c.rarity === rarityFilter);
  if (legendaryMusic) {
    list = list.filter((c) => c.type === 'MINION' && c.rarity === 'LEGENDARY' && c.music && c.music.available);
  }
  return list;
}

function searchCards(cards, query, opts) {
  const filtered = filterCards(cards, opts || {});
  const q = normalize(query);
  const limit = Math.max(1, Math.min(60, Number((opts && opts.limit) || 40)));
  if (!q) return filtered.slice(0, limit);
  const scored = [];
  for (const card of filtered) {
    const score = scoreCard(card, q);
    if (score > 0) scored.push({ score, card });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(String(b.card.id)));
  return scored.slice(0, limit).map((row) => row.card);
}

function clampPage(value) {
  const n = parseInt(String(value == null ? '' : value), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function clampPageSize(value) {
  const n = parseInt(String(value == null ? '' : value), 10);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(50, n);
}

function homeRank(card) {
  const collectible = !!(card && card.collectible === true);
  const entrance = !!(card && card.entrancePreview && card.entrancePreview.available);
  const play = !!(card && card.voice && card.voice.play && card.voice.play.available);
  if (collectible && entrance) return 1;
  if (collectible && play) return 2;
  if (collectible) return 3;
  return 4;
}

function compareHome(a, b) {
  const ra = homeRank(a);
  const rb = homeRank(b);
  if (ra !== rb) return ra - rb;
  const da = a.dbfId == null ? Number.MAX_SAFE_INTEGER : Number(a.dbfId);
  const db = b.dbfId == null ? Number.MAX_SAFE_INTEGER : Number(b.dbfId);
  if (da !== db) return da - db;
  return String(a.id).localeCompare(String(b.id));
}

function paginateList(list, page, pageSize) {
  const p = clampPage(page);
  const s = clampPageSize(pageSize);
  const total = Array.isArray(list) ? list.length : 0;
  const start = (p - 1) * s;
  const items = start >= total ? [] : list.slice(start, start + s);
  return {
    items,
    page: p,
    pageSize: s,
    total,
    hasMore: start + items.length < total,
  };
}

function catalogPage(cards, opts) {
  const filtered = filterCards(cards, opts || {});
  const ranked = filtered.slice().sort(compareHome);
  const page = paginateList(ranked, opts && opts.page, opts && opts.pageSize);
  return {
    items: page.items.map(toListCard),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
  };
}

function latestSetConfigError() {
  const err = new Error('最新扩展包配置无效');
  err.code = 'LATEST_SET_CONFIG_INVALID';
  err.userMessage = '最新扩展包配置无效';
  return err;
}

function parseLatestSetConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw latestSetConfigError();
  const set = typeof raw.set === 'string' ? raw.set.trim() : '';
  const nameEn = typeof raw.nameEn === 'string' ? raw.nameEn.trim() : '';
  const nameZh = typeof raw.nameZh === 'string' ? raw.nameZh.trim() : '';
  const releaseDate = typeof raw.releaseDate === 'string' ? raw.releaseDate.trim() : '';
  if (!set || !nameEn || !nameZh || !releaseDate) throw latestSetConfigError();
  return {
    set: set,
    nameEn: nameEn,
    nameZh: nameZh,
    releaseDate: releaseDate,
    source: typeof raw.source === 'string' ? raw.source : '',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '',
    verified: raw.verified === true,
  };
}

function loadLatestSetConfig(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw latestSetConfigError();
  }
  return parseLatestSetConfig(raw);
}

function filterLatestCards(cards, setId) {
  const id = String(setId || '');
  const list = Array.isArray(cards) ? cards : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].set === id) out.push(list[i]);
  }
  return out;
}

function latestCardsPage(cards, config, opts) {
  const parsed = parseLatestSetConfig(config);
  const filtered = filterLatestCards(cards, parsed.set);
  const page = paginateList(filtered, opts && opts.page, opts && opts.pageSize);
  const items = page.items.map(toListCard);
  return {
    set: parsed.set,
    nameEn: parsed.nameEn,
    nameZh: parsed.nameZh,
    releaseDate: parsed.releaseDate,
    count: filtered.length,
    cards: items,
    items: items,
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
  };
}

function searchCardsPage(cards, query, opts) {
  const filtered = filterCards(cards, opts || {});
  const q = normalize(query);
  let ranked;
  if (!q) ranked = filtered.slice().sort(compareHome);
  else {
    const scored = [];
    for (const card of filtered) {
      const score = scoreCard(card, q);
      if (score > 0) scored.push({ score, card });
    }
    scored.sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(String(b.card.id)));
    ranked = scored.map((row) => row.card);
  }
  const page = paginateList(ranked, opts && opts.page, opts && opts.pageSize);
  return {
    items: page.items.map(toListCard),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
  };
}

function canLoadMore(state) {
  if (!state) return false;
  if (state.loading || state.loadingMore) return false;
  if (state.hasMore === false) return false;
  return true;
}

function mergePageItems(oldItems, newItems) {
  const seen = Object.create(null);
  const out = [];
  const add = (card) => {
    if (!card || !card.id || seen[card.id]) return;
    seen[card.id] = true;
    out.push(card);
  };
  for (const card of oldItems || []) add(card);
  for (const card of newItems || []) add(card);
  return out;
}

function featuredCards(cards, { limit = 12 } = {}) {
  const pool = (cards || []).filter((c) => (
    c.collectible
    && c.type === 'MINION'
    && c.rarity === 'LEGENDARY'
    && c.entrancePreview
    && c.entrancePreview.available
  ));
  pool.sort((a, b) => {
    const da = a.dbfId == null ? Number.MAX_SAFE_INTEGER : Number(a.dbfId);
    const db = b.dbfId == null ? Number.MAX_SAFE_INTEGER : Number(b.dbfId);
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
  return pool.slice(0, limit).map(toListCard);
}

function classFilters() {
  return [{ id: 'ALL', label: '全部' }].concat(CLASS_ORDER.map((id) => ({ id, label: CLASS_ZH[id] })));
}

function rarityFilters() {
  return [{ id: 'ALL', label: '全部' }].concat(RARITY_ORDER.map((id) => ({ id, label: RARITY_ZH[id] })));
}

module.exports = {
  ART_BASE,
  CLASS_ZH,
  TYPE_ZH,
  RARITY_ZH,
  CLASS_ORDER,
  RARITY_ORDER,
  VERIFY_IDS,
  getCardImageUrl,
  voicePlayable,
  musicPlayable,
  adaptCard,
  resolveQuickPlay,
  toListCard,
  publicDetail,
  shouldPublish,
  foldSharedReprints,
  playSourceCardId,
  buildCatalog,
  searchCards,
  searchCardsPage,
  catalogPage,
  parseLatestSetConfig,
  loadLatestSetConfig,
  filterLatestCards,
  latestCardsPage,
  paginateList,
  clampPage,
  clampPageSize,
  canLoadMore,
  mergePageItems,
  filterCards,
  featuredCards,
  classFilters,
  rarityFilters,
  stripMarkup,
  normalize,
};
