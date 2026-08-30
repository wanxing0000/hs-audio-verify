const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  adaptCard,
  toListCard,
  resolveQuickPlay,
  buildCatalog,
  featuredCards,
  searchCards,
} = require('../src/miniprogram/catalogAdapter.js');
const { createAudioUrls } = require('../src/miniprogram/audioUrls.js');

const ROOT = path.resolve(__dirname, '..');
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const catalog = buildCatalog(unified);
const urls = createAudioUrls('http://127.0.0.1:8767');

function raw(id) {
  return unified.cards[id];
}

function list(id) {
  return toListCard(adaptCard(raw(id)));
}

const both = resolveQuickPlay({
  voice: { play: { available: true } },
  music: { available: true },
  entrancePreview: { available: true },
});
assert.strictEqual(both.type, 'entrance');
assert.strictEqual(both.available, true);
assert.strictEqual(both.label, '🎵 完整登场');

const playOnly = resolveQuickPlay({
  voice: { play: { available: true } },
  music: { available: false },
  entrancePreview: { available: false },
});
assert.strictEqual(playOnly.type, 'voice');
assert.strictEqual(playOnly.label, '🔊 登场语音');

const musicOnly = resolveQuickPlay({
  voice: { play: { available: false } },
  music: { available: true },
  entrancePreview: { available: false },
});
assert.strictEqual(musicOnly.type, 'music');
assert.strictEqual(musicOnly.label, '🎵 登场音乐');

const none = resolveQuickPlay({
  voice: { play: { available: false } },
  music: { available: false },
  entrancePreview: { available: false },
});
assert.strictEqual(none.type, 'none');
assert.strictEqual(none.available, false);

const sharedBoth = resolveQuickPlay({
  voice: { play: { available: true, shared: true } },
  music: { available: true, shared: true },
  entrancePreview: { available: true },
});
assert.strictEqual(sharedBoth.type, 'entrance');

const leeroy = list('EX1_116');
assert.strictEqual(leeroy.quickPlay.type, 'entrance');
assert.strictEqual(urls.getQuickPlayUrl(leeroy), 'http://127.0.0.1:8767/api/audio/entrance/EX1_116');

const ysera = list('EX1_572');
assert.strictEqual(ysera.quickPlay.type, 'entrance');

const van = list('VAN_NEW1_010');
assert.strictEqual(van.quickPlay.type, 'entrance');
assert.ok(van.quickPlay.available);

const coreLeeroy = list('CORE_EX1_116');
assert.strictEqual(coreLeeroy.quickPlay.type, 'entrance');
assert.strictEqual(urls.getQuickPlayUrl(coreLeeroy), 'http://127.0.0.1:8767/api/audio/entrance/CORE_EX1_116');

const bru = list('BAR_048');
assert.strictEqual(bru.quickPlay.type, 'entrance');
assert.ok(bru.hasMusic);

const etc = list('ETC_409');
assert.strictEqual(etc.quickPlay.type, 'voice');
assert.strictEqual(etc.quickPlay.label, '🔊 登场语音');
assert.notStrictEqual(etc.quickPlay.type, 'entrance');
assert.strictEqual(urls.getQuickPlayUrl(etc), 'http://127.0.0.1:8767/api/audio/voice/ETC_409/play');

const cap = adaptCard(raw('CAP_107'));
assert.ok(cap);
const capList = toListCard(cap);
assert.ok(capList.quickPlay);
assert.ok(capList.quickPlay.type === 'entrance' || capList.quickPlay.type === 'voice' || capList.quickPlay.type === 'music' || capList.quickPlay.type === 'none');
if (!capList.quickPlay.available) assert.strictEqual(capList.quickPlay.type, 'none');

const featured = featuredCards(catalog.cards, { limit: 12 });
assert.ok(featured.every((c) => c.quickPlay && c.quickPlay.type === 'entrance' && c.quickPlay.available));

const searchHits = searchCards(catalog.cards, '火车王', { limit: 20 }).map(toListCard);
assert.ok(searchHits.some((c) => c.id === 'EX1_116' && c.quickPlay.type === 'entrance'));
const etcSearch = searchCards(catalog.cards, 'ETC_409', { limit: 5 }).map(toListCard);
assert.ok(etcSearch.some((c) => c.id === 'ETC_409' && c.quickPlay.type === 'voice'));

const itemJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.js'), 'utf8');
const itemWxml = fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.wxml'), 'utf8');
assert.ok(itemJs.includes('getQuickPlayUrl'));
assert.ok(!/getVoiceUrl\(\s*card\s*,\s*['"]play['"]\s*\)/.test(itemJs));
assert.ok(itemWxml.includes('catchtap="onPlay"'));
assert.ok(itemWxml.includes('card.quickPlay.available'));
assert.ok(!itemWxml.includes('card.hasPlay'));
assert.ok(!/if\s*\(\s*card\.rarity\s*===\s*['"]LEGENDARY['"]/.test(itemJs));
assert.ok(!/if\s*\(\s*card\.id\s*===\s*['"]EX1_116['"]/.test(itemJs));

assert.strictEqual(urls.getQuickPlayUrl({ id: 'X', quickPlay: { type: 'none' } }), '');
assert.strictEqual(urls.getQuickPlayUrl({ id: 'X', quickPlay: { type: 'music' } }), 'http://127.0.0.1:8767/api/audio/music/X');

console.log('ok quickPlay');
