const { imageBase } = require('./config.js');
const { classFilters, rarityFilters } = require('./labels.js');

let list = [];
let byId = {};

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function getCardImageUrl(card) {
  const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
  if (!id) return '';
  return imageBase + '/' + id + '.png';
}

function initCatalog(cards) {
  list = Array.isArray(cards) ? cards.slice() : [];
  byId = {};
  for (let i = 0; i < list.length; i++) {
    const card = list[i];
    if (!card || !card.id) continue;
    if (!card.imageUrl) card.imageUrl = getCardImageUrl(card);
    byId[card.id] = card;
  }
  return list;
}

function allCards() {
  return list;
}

function getListCard(id) {
  return byId[id] || null;
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

function filterCards(cards, opts) {
  const classFilter = opts && opts.classFilter;
  const rarityFilter = opts && opts.rarityFilter;
  const legendaryMusic = opts && opts.legendaryMusic;
  let out = cards || [];
  if (classFilter && classFilter !== 'ALL') out = out.filter((c) => c.class === classFilter);
  if (rarityFilter && rarityFilter !== 'ALL') out = out.filter((c) => c.rarity === rarityFilter);
  if (legendaryMusic) {
    out = out.filter((c) => c.type === 'MINION' && c.rarity === 'LEGENDARY' && c.hasMusic);
  }
  return out;
}

function searchCards(query, opts) {
  const filtered = filterCards(list, opts || {});
  const q = normalize(query);
  const limit = Math.max(1, Math.min(60, Number((opts && opts.limit) || 40)));
  if (!q) return filtered.slice(0, limit);
  const scored = [];
  for (let i = 0; i < filtered.length; i++) {
    const score = scoreCard(filtered[i], q);
    if (score > 0) scored.push({ score: score, card: filtered[i] });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(String(b.card.id)));
  return scored.slice(0, limit).map((row) => row.card);
}

function featuredCards(limit) {
  const cap = limit || 12;
  const pool = list.filter((c) => c.collectible && c.type === 'MINION' && c.rarity === 'LEGENDARY' && c.hasEntrance);
  pool.sort((a, b) => {
    const da = a.dbfId == null ? 999999999 : Number(a.dbfId);
    const db = b.dbfId == null ? 999999999 : Number(b.dbfId);
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
  return pool.slice(0, cap);
}

function requestJson(url) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      timeout: 20000,
      success: function (res) {
        if (res.statusCode === 200 && res.data) resolve(res.data);
        else reject(new Error('http'));
      },
      fail: function () {
        reject(new Error('network'));
      },
    });
  });
}

function loadFeatured(apiBase) {
  return requestJson(apiBase + '/api/mini/featured').then(function (body) {
    return body.results || [];
  });
}

function pageQuery(opts) {
  opts = opts || {};
  return [
    'page=' + encodeURIComponent(opts.page || 1),
    'pageSize=' + encodeURIComponent(opts.pageSize || 30),
    'class=' + encodeURIComponent(opts.classFilter || 'ALL'),
    'rarity=' + encodeURIComponent(opts.rarityFilter || 'ALL'),
    'legendaryMusic=' + (opts.legendaryMusic ? '1' : '0'),
  ].join('&');
}

function normalizePage(body) {
  const items = (body && (body.items || body.results)) || [];
  return {
    items: items,
    page: body && body.page ? body.page : 1,
    pageSize: body && body.pageSize ? body.pageSize : items.length,
    total: body && body.total != null ? body.total : items.length,
    hasMore: !!(body && body.hasMore),
  };
}

function loadCatalogPage(apiBase, opts) {
  return requestJson(apiBase + '/api/mini/catalog?' + pageQuery(opts)).then(normalizePage);
}

function loadLatestPage(apiBase, opts) {
  opts = opts || {};
  const qs = [
    'page=' + encodeURIComponent(opts.page || 1),
    'pageSize=' + encodeURIComponent(opts.pageSize || 30),
  ].join('&');
  return requestJson(apiBase + '/api/mini/latest?' + qs).then(function (body) {
    const items = (body && (body.items || body.cards)) || [];
    const total = body && body.total != null
      ? body.total
      : (body && body.count != null ? body.count : items.length);
    return {
      items: items,
      page: body && body.page ? body.page : 1,
      pageSize: body && body.pageSize ? body.pageSize : items.length,
      total: total,
      count: body && body.count != null ? body.count : total,
      hasMore: !!(body && body.hasMore),
      set: body && body.set || '',
      nameEn: body && body.nameEn || '',
      nameZh: body && body.nameZh || '',
      releaseDate: body && body.releaseDate || '',
    };
  });
}

function loadLatestAll(apiBase) {
  const pageSize = 50;
  function next(page, acc) {
    return loadLatestPage(apiBase, { page: page, pageSize: pageSize }).then(function (body) {
      const merged = mergePageItems(acc.items, body.items || []);
      const nextAcc = {
        items: merged,
        count: body.count != null ? body.count : acc.count,
        set: body.set || acc.set,
        nameEn: body.nameEn || acc.nameEn,
        nameZh: body.nameZh || acc.nameZh,
        releaseDate: body.releaseDate || acc.releaseDate,
      };
      if (!body.hasMore) return nextAcc;
      if (page >= 40) throw new Error('latest pages');
      return next(page + 1, nextAcc);
    });
  }
  return next(1, {
    items: [],
    count: 0,
    set: '',
    nameEn: '',
    nameZh: '',
    releaseDate: '',
  });
}

function searchRemote(apiBase, query, opts) {
  opts = opts || {};
  const qs = pageQuery(opts) + '&q=' + encodeURIComponent(query || '');
  return requestJson(apiBase + '/api/mini/search?' + qs).then(normalizePage);
}

function mergePageItems(oldItems, newItems) {
  const seen = {};
  const out = [];
  function add(card) {
    if (!card || !card.id || seen[card.id]) return;
    seen[card.id] = true;
    out.push(card);
  }
  const oldList = oldItems || [];
  const newList = newItems || [];
  for (let i = 0; i < oldList.length; i++) add(oldList[i]);
  for (let j = 0; j < newList.length; j++) add(newList[j]);
  return out;
}

function loadCatalog(apiBase) {
  return requestJson(apiBase + '/api/mini/catalog?page=1&pageSize=30').then(function (body) {
    const page = normalizePage(body);
    initCatalog(page.items);
    return body;
  });
}

function loadCardDetail(apiBase, id) {
  return requestJson(apiBase + '/api/mini/card/' + encodeURIComponent(id)).then(function (body) {
    if (!body || !body.id) throw new Error('card');
    return body;
  });
}

module.exports = {
  getCardImageUrl,
  initCatalog,
  allCards,
  getListCard,
  searchCards,
  filterCards,
  featuredCards,
  loadFeatured,
  loadCatalogPage,
  loadLatestPage,
  loadLatestAll,
  searchRemote,
  mergePageItems,
  loadCatalog,
  loadCardDetail,
  classFilters,
  rarityFilters,
};
