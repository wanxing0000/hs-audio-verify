const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  buildCatalog,
  foldSharedReprints,
  loadLatestSetConfig,
  parseLatestSetConfig,
  filterLatestCards,
  latestCardsPage,
  toListCard,
} = require('../src/miniprogram/catalogAdapter.js');

const ROOT = path.resolve(__dirname, '..');
const META_PATH = path.join(ROOT, 'data', 'index', 'latest-set.json');
const INDEX_PATH = path.join(ROOT, 'data', 'index', 'card-audio-index.json');
const LATEST_SET = 'ESCAPEFROM_VIOLET_HOLD';
const CATALOG_SNAPSHOT = 7263;
const LATEST_SNAPSHOT = 164;

function fixtureCard(id, opts) {
  opts = opts || {};
  return {
    id: id,
    name: opts.name || id,
    collectible: opts.collectible !== false,
    dbfId: opts.dbfId == null ? 1 : opts.dbfId,
    type: opts.type || 'MINION',
    class: opts.class || 'NEUTRAL',
    rarity: opts.rarity || 'LEGENDARY',
    set: opts.set || 'EXPERT1',
    isMiniSet: opts.isMiniSet === true,
    voice: { play: { available: true, sourceCardId: opts.sourceCardId === undefined ? id : opts.sourceCardId } },
    music: { available: true },
    entrancePreview: { available: true },
  };
}

function expectInvalid(fn) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected LATEST_SET_CONFIG_INVALID');
  assert.strictEqual(err.code, 'LATEST_SET_CONFIG_INVALID');
}

function jsonGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { return reject(e); }
        resolve({ status: res.statusCode, body: body });
      });
    }).on('error', reject);
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server: server,
        port: port,
        url: 'http://127.0.0.1:' + port,
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function latestHandler(cards, config, loadError) {
  return function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/api/mini/latest') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (loadError || !config) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '最新扩展包配置无效', code: 'LATEST_SET_CONFIG_INVALID' }));
      return;
    }
    try {
      const page = latestCardsPage(cards, config, {
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(page));
    } catch (e) {
      const code = e && e.code === 'LATEST_SET_CONFIG_INVALID' ? 500 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: (e && e.userMessage) || '最新扩展包配置无效',
        code: (e && e.code) || 'LATEST_SET_CONFIG_INVALID',
      }));
    }
  };
}

const meta = loadLatestSetConfig(META_PATH);
const unified = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const catalog = buildCatalog(unified);

// TEST 1: latest metadata
{
  assert.strictEqual(meta.set, LATEST_SET);
  assert.ok(meta.nameEn);
  assert.ok(meta.nameZh);
  assert.ok(meta.releaseDate);
  assert.strictEqual(meta.nameEn, 'Escape from Violet Hold');
  assert.strictEqual(meta.nameZh, '逃离紫罗兰监狱');
}

// TEST 2: latest filter keeps only matching set
{
  const cards = [
    fixtureCard('A', { set: LATEST_SET }),
    fixtureCard('B', { set: 'CORE' }),
    fixtureCard('C', { set: 'TIME_TRAVEL' }),
  ];
  const ids = filterLatestCards(cards, meta.set).map((c) => c.id);
  assert.deepStrictEqual(ids, ['A']);
}

// TEST 3: same name, different set — keep latest set only; not name-dedup
{
  const cards = [
    fixtureCard('LATEST_A', { name: '测试卡', set: LATEST_SET }),
    fixtureCard('CORE_A', { name: '测试卡', set: 'CORE' }),
    fixtureCard('LATEST_B', { name: '测试卡', set: LATEST_SET }),
  ];
  const ids = filterLatestCards(cards, meta.set).map((c) => c.id);
  assert.deepStrictEqual(ids, ['LATEST_A', 'LATEST_B']);
  assert.strictEqual(ids.indexOf('CORE_A'), -1);
}

// TEST 4: Mini Set cards in latest set are kept
{
  const cards = [
    fixtureCard('MINI_A', { set: LATEST_SET, isMiniSet: true }),
    fixtureCard('CORE_MINI', { set: 'CORE', isMiniSet: true }),
  ];
  const out = filterLatestCards(cards, meta.set);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'MINI_A');
  assert.strictEqual(out[0].isMiniSet, true);
}

// TEST 5: latest uses already-folded catalog (no CORE reprint)
{
  const folded = foldSharedReprints([
    fixtureCard('BOT_548', { name: '奇利亚斯', set: 'BOOMSDAY', sourceCardId: 'BOT_548' }),
    fixtureCard('CORE_BOT_548', { name: '奇利亚斯', set: 'CORE', sourceCardId: 'BOT_548' }),
    fixtureCard('CAP_000', { name: '军情七处杀手', set: LATEST_SET, sourceCardId: 'CAP_000' }),
  ]);
  assert.strictEqual(folded.cards.some((c) => c.id === 'CORE_BOT_548'), false);
  const page = latestCardsPage(folded.cards, meta, { page: 1, pageSize: 50 });
  assert.strictEqual(page.cards.some((c) => c.id === 'CORE_BOT_548'), false);
  assert.strictEqual(page.cards.some((c) => c.id === 'CAP_000'), true);
  assert.strictEqual(page.count, 1);
}

// TEST 6: latest page card-item navigates by id
{
  const latestJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'latest', 'latest.js'), 'utf8');
  const latestWxml = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'latest', 'latest.wxml'), 'utf8');
  const cardItemJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.js'), 'utf8');
  assert.ok(latestJs.includes('/pages/card/card?id='));
  assert.ok(latestJs.includes('e.detail && e.detail.id'));
  assert.ok(!/dbfId/.test(latestJs));
  assert.ok(!/card\.name/.test(latestJs));
  assert.ok(latestWxml.includes('card-item'));
  assert.ok(cardItemJs.includes('id: card.id'));
  assert.ok(!latestJs.includes(LATEST_SET));
  assert.ok(!/ESCAPEFROM_VIOLET_HOLD/.test(latestJs));
  const list = toListCard(fixtureCard('CAP_001', { set: LATEST_SET }));
  assert.strictEqual(list.id, 'CAP_001');
  assert.ok(list.id);
}

// TEST 7: live folded catalog snapshot for latest set
{
  const filtered = filterLatestCards(catalog.cards, meta.set);
  assert.strictEqual(filtered.length, LATEST_SNAPSHOT, 'latest set snapshot count');
  assert.ok(filtered.every((c) => c.set === meta.set));
  const catalogOrder = catalog.cards.filter((c) => c.set === meta.set).map((c) => c.id);
  assert.deepStrictEqual(filtered.map((c) => c.id), catalogOrder);
}

// TEST 8: latest filter does not mutate catalog
{
  assert.strictEqual(catalog.cards.length, CATALOG_SNAPSHOT, 'catalog snapshot count');
  const beforeLen = catalog.cards.length;
  const beforeFirst = catalog.cards[0] && catalog.cards[0].id;
  const frozen = catalog.cards.slice();
  const filtered = filterLatestCards(catalog.cards, meta.set);
  latestCardsPage(catalog.cards, meta, { page: 1, pageSize: 30 });
  assert.strictEqual(catalog.cards.length, beforeLen);
  assert.strictEqual(catalog.cards.length, CATALOG_SNAPSHOT);
  assert.strictEqual(catalog.cards[0] && catalog.cards[0].id, beforeFirst);
  assert.strictEqual(catalog.cards, catalog.cards);
  assert.strictEqual(frozen.length, catalog.cards.length);
  for (let i = 0; i < frozen.length; i++) {
    assert.strictEqual(catalog.cards[i], frozen[i]);
  }
  assert.notStrictEqual(filtered, catalog.cards);
  assert.ok(filtered.length < catalog.cards.length);
}

// TEST 9: latest API contract (paginated)
{
  const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');
  assert.ok(serverSrc.includes('/api/mini/latest'));
  assert.ok(serverSrc.includes('latestCardsPage'));
  assert.ok(serverSrc.includes('LATEST_SET_CONFIG_INVALID'));
}

{
  let httpOk = false;
  listen(latestHandler(catalog.cards, meta, null)).then(async (box) => {
    try {
      const first = await jsonGet(box.url + '/api/mini/latest?page=1&pageSize=50');
      assert.strictEqual(first.status, 200);
      assert.strictEqual(first.body.set, LATEST_SET);
      assert.ok(Array.isArray(first.body.cards));
      assert.ok(Array.isArray(first.body.items));
      assert.strictEqual(first.body.count, LATEST_SNAPSHOT);
      assert.strictEqual(first.body.total, LATEST_SNAPSHOT);
      assert.strictEqual(first.body.cards.length, 50);
      assert.strictEqual(first.body.count, first.body.total);
      assert.strictEqual(first.body.hasMore, true);
      assert.ok(!first.body.cards.some((c) => c.id === 'CORE_BOT_548'));
      assert.ok(!first.body.cards.some((c) => c.set === 'CORE' || c.set === 'VANILLA'));
      const ids = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const res = await jsonGet(box.url + '/api/mini/latest?page=' + page + '&pageSize=50');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.count, LATEST_SNAPSHOT);
        for (const card of res.body.cards) ids.push(card.id);
        hasMore = !!res.body.hasMore;
        page += 1;
        assert.ok(page < 20, 'pagination runaway');
      }
      assert.strictEqual(ids.length, LATEST_SNAPSHOT);
      assert.strictEqual(new Set(ids).size, LATEST_SNAPSHOT);
      httpOk = true;
    } finally {
      await closeServer(box.server);
    }
  }).then(() => {
    assert.strictEqual(httpOk, true);
    finishAfterHttp();
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

function finishAfterHttp() {
  // TEST 10: missing/invalid metadata is an explicit error, never whole catalog
  expectInvalid(() => parseLatestSetConfig(null));
  expectInvalid(() => parseLatestSetConfig({}));
  expectInvalid(() => parseLatestSetConfig({ set: LATEST_SET }));
  expectInvalid(() => parseLatestSetConfig({ set: '', nameEn: 'x', nameZh: 'x', releaseDate: 'x' }));
  expectInvalid(() => loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set-missing.json')));
  const broken = path.join(os.tmpdir(), 'hs-latest-set-broken.json');
  fs.writeFileSync(broken, '{not json');
  expectInvalid(() => loadLatestSetConfig(broken));
  expectInvalid(() => latestCardsPage(catalog.cards, { set: LATEST_SET }));
  let threw = false;
  try {
    latestCardsPage(catalog.cards, {});
  } catch (e) {
    threw = true;
    assert.strictEqual(e.code, 'LATEST_SET_CONFIG_INVALID');
  }
  assert.strictEqual(threw, true);

  listen(latestHandler(catalog.cards, null, true)).then(async (box) => {
    try {
      const res = await jsonGet(box.url + '/api/mini/latest');
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.code, 'LATEST_SET_CONFIG_INVALID');
      assert.ok(!Array.isArray(res.body.cards) || res.body.cards.length === 0);
      assert.notStrictEqual(res.body.count, catalog.cards.length);
    } finally {
      await closeServer(box.server);
    }
    const hsjson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.collectible.json'), 'utf8'));
    const miniCount = hsjson.filter((c) => c.set === LATEST_SET && c.isMiniSet === true).length;
    console.log('ok latestCards', {
      set: meta.set,
      latestCount: LATEST_SNAPSHOT,
      catalogCount: catalog.cards.length,
      miniSetCollectible: miniCount,
      folded: catalog.foldStats && catalog.foldStats.folded,
    });
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
