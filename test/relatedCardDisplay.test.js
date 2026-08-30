'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { adaptCard, publicDetail, buildCatalog, latestCardsPage } = require('../src/miniprogram/catalogAdapter.js');
const { getCardAudioAvailability } = require('../src/miniprogram/audioAvailability.js');
const {
  loadProductionAudioInventory,
  applyProductionToPublicDetail,
} = require('../src/services/productionAudioAvailability.js');
const {
  shouldDisplayRelatedEdge,
  createRelatedCardIndex,
  relatedAudioStatus,
  getDisplayRelatedCards,
  resolveDetailCard,
  attachRelatedCards,
} = require('../src/miniprogram/relatedCards.js');

const ROOT = path.resolve(__dirname, '..');
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const latestCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'latest-set.json'), 'utf8'));
const catalog = buildCatalog(unified);
const relatedIndex = createRelatedCardIndex(unified.cards);
const inventory = loadProductionAudioInventory(path.join(ROOT, 'data', 'production-audio'));

function cardPayload(id) {
  const card = resolveDetailCard(id, catalog, unified);
  if (!card) return null;
  const raw = unified.cards[id];
  let body = publicDetail(card, getCardAudioAvailability(raw, clips.clips));
  if (inventory) body = applyProductionToPublicDetail(body, inventory);
  return attachRelatedCards(body, relatedIndex, inventory);
}

function relatedIds(list) {
  return (list || []).map((row) => row.id);
}

const catalogBefore = catalog.cards.length;
assert.strictEqual(catalogBefore, 7263);

assert.deepStrictEqual(publicDetail(adaptCard(unified.cards.EX1_116)).relatedCards, []);

const syl = cardPayload('TIME_609');
assert.ok(syl);
const sylIds = relatedIds(syl.relatedCards);
assert.ok(sylIds.indexOf('TIME_609t1') >= 0, 'TIME_609 missing TIME_609t1');
assert.ok(sylIds.indexOf('TIME_609t2') >= 0, 'TIME_609 missing TIME_609t2');
assert.strictEqual(sylIds.indexOf('TIME_609t2e'), -1);
assert.strictEqual(syl.relatedCards.length, 2);

const alleria = syl.relatedCards.find((row) => row.id === 'TIME_609t1');
assert.strictEqual(alleria.name, '游侠队长奥蕾莉亚');
assert.strictEqual(alleria.relationConfidence, 'STRUCTURED');
assert.strictEqual(alleria.audio.indexed, true);
assert.strictEqual(alleria.audio.productionAvailable, true);
assert.strictEqual(alleria.audio.playable, true);

const vereesa = syl.relatedCards.find((row) => row.id === 'TIME_609t2');
assert.strictEqual(vereesa.name, '游侠新兵温蕾萨');
assert.strictEqual(vereesa.audio.playable, true);

const raf = cardPayload('TIME_005');
const rafIds = relatedIds(raf.relatedCards);
['TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5', 'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9'].forEach(function (id) {
  assert.ok(rafIds.indexOf(id) >= 0, 'TIME_005 missing ' + id);
});
assert.strictEqual(rafIds.indexOf('TIME_005t2e'), -1);
assert.strictEqual(rafIds.indexOf('TIME_005t8e'), -1);
assert.strictEqual(rafIds.indexOf('TIME_005t9t'), -1);

const mage = raf.relatedCards.find((row) => row.id === 'TIME_005t9');
assert.ok(mage);
assert.deepStrictEqual(relatedIds(mage.relatedCards), ['TIME_005t9t']);
assert.strictEqual(mage.relatedCards[0].name, '拉法姆绵羊');
assert.strictEqual(mage.relatedCards[0].audio.indexed, true);
assert.strictEqual(mage.relatedCards[0].audio.playable, true);

const tokenDetail = cardPayload('TIME_609t1');
assert.ok(tokenDetail);
assert.strictEqual(tokenDetail.id, 'TIME_609t1');
assert.strictEqual(tokenDetail.name, '游侠队长奥蕾莉亚');
assert.ok(!catalog.byId.TIME_609t1);

const t9 = cardPayload('TIME_005t9');
assert.deepStrictEqual(relatedIds(t9.relatedCards), ['TIME_005t9t']);

assert.strictEqual(shouldDisplayRelatedEdge({
  relationConfidence: 'INFERRED',
  relationType: 'text_name',
}, unified.cards.TIME_609t1), false);

const noRelation = cardPayload('AT_003');
assert.ok(Array.isArray(noRelation.relatedCards));
assert.deepStrictEqual(noRelation.relatedCards, []);

const at003 = cardPayload('AT_003');
assert.strictEqual(at003.voice.play.available, true);

const none = relatedAudioStatus(unified.cards.TIME_609t1, inventory);
assert.strictEqual(none.indexed, true);
assert.strictEqual(none.productionAvailable, true);
assert.strictEqual(none.playable, true);

assert.strictEqual(buildCatalog(unified).cards.length, catalogBefore);
assert.strictEqual(catalog.cards.length, 7263);

function listen(handler) {
  return new Promise(function (resolve) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      resolve({
        server: server,
        base: 'http://127.0.0.1:' + port,
        close: function () {
          return new Promise(function (done) { server.close(done); });
        },
      });
    });
  });
}

function getJson(base, pathname) {
  return new Promise(function (resolve, reject) {
    http.get(base + pathname, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: JSON.parse(text) });
      });
    }).on('error', reject);
  });
}

listen(function (req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  function send(status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  if (url.pathname === '/api/mini/health') return send(200, { ok: true });
  if (url.pathname === '/api/mini/catalog') {
    return send(200, { total: catalog.cards.length, items: catalog.cards.slice(0, 2) });
  }
  if (url.pathname === '/api/mini/latest') {
    const page = latestCardsPage(catalog.cards, latestCfg, { page: 1, pageSize: 1 });
    return send(200, { set: page.set, total: page.total });
  }
  if (url.pathname.indexOf('/api/mini/card/') === 0) {
    const id = decodeURIComponent(url.pathname.slice('/api/mini/card/'.length));
    const body = cardPayload(id);
    if (!body) return send(404, { error: '没有找到相关卡牌' });
    return send(200, body);
  }
  return send(404, { error: 'not found' });
}).then(async function (box) {
  const health = await getJson(box.base, '/api/mini/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.ok, true);

  const cat = await getJson(box.base, '/api/mini/catalog');
  assert.strictEqual(cat.status, 200);
  assert.strictEqual(cat.body.total, 7263);

  const latest = await getJson(box.base, '/api/mini/latest');
  assert.strictEqual(latest.status, 200);
  assert.ok(latest.body.total > 0);

  const normal = await getJson(box.base, '/api/mini/card/AT_003');
  assert.strictEqual(normal.status, 200);
  assert.strictEqual(normal.body.voice.play.available, true);

  const parent = await getJson(box.base, '/api/mini/card/TIME_609');
  assert.strictEqual(parent.status, 200);
  assert.strictEqual(relatedIds(parent.body.relatedCards).indexOf('TIME_609t1') >= 0, true);

  const rafaam = await getJson(box.base, '/api/mini/card/TIME_005');
  assert.strictEqual(rafaam.status, 200);
  assert.ok(relatedIds(rafaam.body.relatedCards).indexOf('TIME_005t9') >= 0);

  const child = await getJson(box.base, '/api/mini/card/TIME_609t1');
  assert.strictEqual(child.status, 200);
  assert.strictEqual(child.body.id, 'TIME_609t1');

  await box.close();
  console.log('ok relatedCardDisplay', {
    catalog: catalog.cards.length,
    sylvanas: sylIds,
    rafaam: rafIds.length,
    sheep: mage.relatedCards[0].id,
  });
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
