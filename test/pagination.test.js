const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildCatalog,
  catalogPage,
  searchCardsPage,
  clampPage,
  clampPageSize,
  canLoadMore,
  mergePageItems,
  filterCards,
} = require('../src/miniprogram/catalogAdapter.js');

const ROOT = path.resolve(__dirname, '..');
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const catalog = buildCatalog(unified);

assert.strictEqual(clampPage(0), 1);
assert.strictEqual(clampPage(-3), 1);
assert.strictEqual(clampPage('nope'), 1);
assert.strictEqual(clampPage(null), 1);
assert.strictEqual(clampPage(2), 2);
assert.strictEqual(clampPageSize(999), 50);
assert.strictEqual(clampPageSize(0), 30);
assert.strictEqual(clampPageSize('x'), 30);
assert.strictEqual(clampPageSize(12), 12);

const p1 = catalogPage(catalog.cards, { page: 1, pageSize: 30 });
assert.strictEqual(p1.page, 1);
assert.strictEqual(p1.pageSize, 30);
assert.strictEqual(p1.items.length, 30);
assert.ok(p1.total > 30);
assert.strictEqual(p1.hasMore, true);
assert.ok(p1.items[0].quickPlay);

const p2 = catalogPage(catalog.cards, { page: 2, pageSize: 30 });
assert.strictEqual(p2.page, 2);
assert.strictEqual(p2.items.length, 30);
const ids1 = p1.items.map((c) => c.id);
const ids2 = p2.items.map((c) => c.id);
assert.strictEqual(new Set(ids1.concat(ids2)).size, 60);

const p1b = catalogPage(catalog.cards, { page: 1, pageSize: 30 });
assert.deepStrictEqual(p1b.items.map((c) => c.id), ids1);

const lastPage = Math.ceil(p1.total / 30);
const last = catalogPage(catalog.cards, { page: lastPage, pageSize: 30 });
assert.strictEqual(last.hasMore, false);
assert.ok(last.items.length > 0);
assert.ok(last.items.length <= 30);

const overflow = catalogPage(catalog.cards, { page: lastPage + 8, pageSize: 30 });
assert.strictEqual(overflow.items.length, 0);
assert.strictEqual(overflow.hasMore, false);

const bad = catalogPage(catalog.cards, { page: 'abc', pageSize: '999' });
assert.strictEqual(bad.page, 1);
assert.strictEqual(bad.pageSize, 50);
assert.ok(bad.items.length <= 50);

const mage1 = catalogPage(catalog.cards, { page: 1, pageSize: 30, classFilter: 'MAGE' });
const mage2 = catalogPage(catalog.cards, { page: 2, pageSize: 30, classFilter: 'MAGE' });
assert.ok(mage1.items.every((c) => c.class === 'MAGE'));
assert.ok(mage2.items.every((c) => c.class === 'MAGE'));
assert.strictEqual(new Set(mage1.items.concat(mage2.items).map((c) => c.id)).size, mage1.items.length + mage2.items.length);

const leeroy = searchCardsPage(catalog.cards, '火车王', { page: 1, pageSize: 30 });
assert.ok(leeroy.total >= 1);
assert.ok(leeroy.items.some((c) => c.id === 'EX1_116'));
assert.strictEqual(leeroy.items.find((c) => c.id === 'EX1_116').quickPlay.type, 'entrance');

const ysera = searchCardsPage(catalog.cards, '伊瑟拉', { page: 1, pageSize: 30 });
assert.ok(ysera.items.some((c) => c.id === 'EX1_572'));
assert.ok(!ysera.items.some((c) => c.id === 'EX1_116'));

const none = searchCardsPage(catalog.cards, 'definitely-not-a-hearthstone-card-zzz', { page: 1, pageSize: 30 });
assert.strictEqual(none.total, 0);
assert.strictEqual(none.hasMore, false);

const wide = searchCardsPage(catalog.cards, 'a', { page: 1, pageSize: 30 });
if (wide.total > 30) {
  const wide2 = searchCardsPage(catalog.cards, 'a', { page: 2, pageSize: 30 });
  assert.strictEqual(new Set(wide.items.concat(wide2.items).map((c) => c.id)).size, wide.items.length + wide2.items.length);
}

assert.strictEqual(canLoadMore({ loading: true, hasMore: true }), false);
assert.strictEqual(canLoadMore({ loadingMore: true, hasMore: true }), false);
assert.strictEqual(canLoadMore({ loading: false, hasMore: false }), false);
assert.strictEqual(canLoadMore({ loading: false, hasMore: true }), true);

const kept = mergePageItems([{ id: 'A' }, { id: 'B' }], [{ id: 'B' }, { id: 'C' }]);
assert.deepStrictEqual(kept.map((c) => c.id), ['A', 'B', 'C']);

const filtered = filterCards(catalog.cards, { classFilter: 'MAGE' });
assert.ok(filtered.every((c) => c.class === 'MAGE'));

const indexJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.js'), 'utf8');
assert.ok(indexJs.includes('onReachBottom'));
assert.ok(indexJs.includes('resetAndLoad'));
assert.ok(indexJs.includes('onBackTop'));
assert.ok(!/if\s*\(\s*card\.id\s*===\s*['"]EX1_116['"]/.test(indexJs));
assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.wxml'), 'utf8').includes('back-top'));
assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.wxml'), 'utf8').includes('catchtap="onPlay"'));

console.log('ok pagination', { total: p1.total, lastPage });
