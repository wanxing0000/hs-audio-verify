const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildCatalog,
  loadLatestSetConfig,
  filterLatestCards,
  toListCard,
} = require('../src/miniprogram/catalogAdapter.js');
const {
  LATEST_BATCH_SIZE,
  flattenLatestGroups,
  groupLatestCardsByClass,
  orderLatestCards,
  sliceLatestVisible,
} = require('../miniprogram/utils/latestGroups.js');

const ROOT = path.resolve(__dirname, '..');
const meta = loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set.json'));
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const catalog = buildCatalog(unified);
const latest = filterLatestCards(catalog.cards, meta.set).map(toListCard);
const ordered = orderLatestCards(latest);
const fullGroups = groupLatestCardsByClass(latest);

assert.strictEqual(LATEST_BATCH_SIZE, 20);
assert.strictEqual(ordered.length, latest.length);
assert.deepStrictEqual(ordered.map((c) => c.id), flattenLatestGroups(fullGroups).map((c) => c.id));

const first = sliceLatestVisible(ordered, LATEST_BATCH_SIZE);
assert.strictEqual(first.displayCount, Math.min(LATEST_BATCH_SIZE, ordered.length));
assert.strictEqual(first.visible.length, first.displayCount);
assert.strictEqual(first.hasMore, ordered.length > LATEST_BATCH_SIZE);
assert.deepStrictEqual(first.visible.map((c) => c.id), ordered.slice(0, first.displayCount).map((c) => c.id));
assert.strictEqual(new Set(first.visible.map((c) => c.id)).size, first.visible.length);

const second = sliceLatestVisible(ordered, LATEST_BATCH_SIZE * 2);
assert.strictEqual(second.visible.length, Math.min(LATEST_BATCH_SIZE * 2, ordered.length));
assert.deepStrictEqual(second.visible.slice(0, first.displayCount).map((c) => c.id), first.visible.map((c) => c.id));
assert.strictEqual(new Set(second.visible.map((c) => c.id)).size, second.visible.length);

const all = sliceLatestVisible(ordered, ordered.length + 50);
assert.strictEqual(all.displayCount, ordered.length);
assert.strictEqual(all.hasMore, false);
assert.deepStrictEqual(all.visible.map((c) => c.id), ordered.map((c) => c.id));

const imageBase = 'https://art.hearthstonejson.com/v1/render/latest/zhCN/256x';
assert.ok(first.visible[0].imageUrl.startsWith(imageBase + '/'));
assert.ok(first.visible[0].imageUrl.endsWith('.png'));
assert.ok(!first.visible[0].imageUrl.includes('tiles'));
assert.ok(!first.visible[0].imageUrl.includes('/v1/256x/'));
assert.ok(!first.visible[0].imageUrl.includes('512x'));

const cardItem = fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.wxml'), 'utf8');
assert.ok(cardItem.includes('lazy-load'));
assert.ok(cardItem.includes('mode="widthFix"'));
assert.ok(cardItem.includes('src="{{card.imageUrl}}"'));

const cardPage = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.wxml'), 'utf8');
assert.ok(cardPage.includes('src="{{card.imageUrl}}"'));
const heroArt = cardPage.match(/<image class="art[\s\S]*?\/>/);
assert.ok(heroArt, 'card detail hero image');
assert.ok(!heroArt[0].includes('lazy-load'), 'detail hero image is not lazy-load');
assert.ok(/related-art[\s\S]*lazy-load/.test(cardPage), 'related card images stay lazy-load');

const latestWxss = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'latest', 'latest.wxss'), 'utf8');
assert.ok(/\.cell\s*\{[^}]*width:\s*33\.333%/.test(latestWxss), 'latest grid is three columns');
assert.ok(!/\.cell\s*\{[^}]*width:\s*50%/.test(latestWxss));

const latestJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'latest', 'latest.js'), 'utf8');
assert.ok(latestJs.includes('loadingMoreLatest'));
assert.ok(latestJs.includes('hasMoreLatest'));
assert.ok(latestJs.includes('loadLatestAll'));
assert.ok(!latestJs.includes('wx.getImageInfo'));
assert.ok(!latestJs.includes('hidden'));

const config = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'config.js'), 'utf8');
assert.ok(config.includes("imageBase: 'https://art.hearthstonejson.com/v1/render/latest/zhCN/256x'"));

console.log('ok latestImageBatch', {
  total: ordered.length,
  batch: LATEST_BATCH_SIZE,
  first: first.displayCount,
  hasMore: first.hasMore,
});
