const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const {
  createHsjsonUpdater,
  parseRemoteMeta,
  compareOne,
  validateCardsArray,
  validateCollectibleArray,
  crossValidate,
  sha256File,
} = require('../src/services/hsjsonUpdater.js');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'tmp', 'hsjson-updater-test');

function makeCards(n, prefix) {
  prefix = prefix || 'ID_';
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: prefix + i,
      set: 'CORE',
      type: 'MINION',
      dbfId: i + 1,
      name: 'Card ' + i,
      collectible: i < Math.floor(n / 4),
    });
  }
  return out;
}

function makeCollectible(cards, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    out.push({
      id: c.id,
      set: c.set,
      type: c.type,
      dbfId: c.dbfId,
      collectible: true,
      name: c.name,
    });
  }
  return out;
}

function headers(map) {
  return new Headers(map);
}

function jsonBody(value) {
  return Readable.from([Buffer.from(JSON.stringify(value))]);
}

function mockFetch(spec) {
  return async function (url, init) {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const rec = spec[method + ' ' + url] || spec[url];
    if (!rec) return { ok: false, status: 404, headers: new Headers() };
    if (typeof rec === 'function') return rec(url, init);
    return rec;
  };
}

function seedProd(dir, cards, collectible, meta) {
  const prod = path.join(dir, 'data', 'hearthstonejson', 'zhCN');
  fs.mkdirSync(prod, { recursive: true });
  fs.writeFileSync(path.join(prod, 'cards.json'), JSON.stringify(cards));
  fs.writeFileSync(path.join(prod, 'cards.collectible.json'), JSON.stringify(collectible));
  if (meta) {
    fs.writeFileSync(path.join(prod, 'snapshot-meta.json'), JSON.stringify(meta, null, 2));
  }
  return prod;
}

function readProd(prod) {
  return {
    cards: JSON.parse(fs.readFileSync(path.join(prod, 'cards.json'), 'utf8')),
    collectible: JSON.parse(fs.readFileSync(path.join(prod, 'cards.collectible.json'), 'utf8')),
    meta: fs.existsSync(path.join(prod, 'snapshot-meta.json'))
      ? JSON.parse(fs.readFileSync(path.join(prod, 'snapshot-meta.json'), 'utf8'))
      : null,
  };
}

if (fs.existsSync(WORK)) fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

{
  const meta = parseRemoteMeta(headers({
    etag: '"abc123"',
    'last-modified': 'Wed, 26 Aug 2026 07:01:02 GMT',
    'content-length': '3401974',
  }), 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.json');
  assert.strictEqual(meta.etag, '"abc123"');
  assert.strictEqual(meta.lastModified, 'Wed, 26 Aug 2026 07:01:02 GMT');
  assert.strictEqual(meta.contentLength, 3401974);
  const empty = parseRemoteMeta(headers({}), 'https://example.test/cards.json');
  assert.strictEqual(empty.etag, null);
  assert.strictEqual(empty.lastModified, null);
  assert.strictEqual(empty.contentLength, null);
  console.log('ok TEST 1 remote metadata parsing');
}

(async function () {
  const cardsUrl = 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.json';
  const collUrl = 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json';
  const oldCards = makeCards(1200, 'OLD_');
  const oldColl = makeCollectible(oldCards, 200);
  const newCards = makeCards(1300, 'NEW_');
  const newColl = makeCollectible(newCards, 220);

  {
    const dir = path.join(WORK, 't2');
    const prod = seedProd(dir, oldCards, oldColl, {
      schemaVersion: 1,
      locale: 'zhCN',
      source: 'hearthstonejson',
      cards: { url: cardsUrl, etag: '"same"', lastModified: 'A', contentLength: 1, sha256: 'x', entryCount: 1200, downloadedAt: 't' },
      collectible: { url: collUrl, etag: '"samec"', lastModified: 'B', contentLength: 1, sha256: 'y', entryCount: 200, downloadedAt: 't' },
    });
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"same"', 'content-length': '99' }) },
        ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"samec"', 'content-length': '88' }) },
      }),
    });
    const r = await updater.checkRemoteSnapshot();
    assert.strictEqual(r.status, 'UP_TO_DATE');
    assert.strictEqual(r.changed, false);
    assert.ok(fs.existsSync(path.join(prod, 'cards.json')));
    console.log('ok TEST 2 up-to-date detection');
  }

  {
    const dir = path.join(WORK, 't3');
    seedProd(dir, oldCards, oldColl, {
      schemaVersion: 1,
      locale: 'zhCN',
      source: 'hearthstonejson',
      cards: { url: cardsUrl, etag: '"old"', lastModified: null, contentLength: 1, sha256: 'x', entryCount: 1200, downloadedAt: 't' },
      collectible: { url: collUrl, etag: '"oldc"', lastModified: null, contentLength: 1, sha256: 'y', entryCount: 200, downloadedAt: 't' },
    });
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"new"' }) },
        ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"oldc"' }) },
      }),
    });
    const r = await updater.checkRemoteSnapshot();
    assert.strictEqual(r.status, 'UPDATED_AVAILABLE');
    assert.strictEqual(r.changed, true);
    console.log('ok TEST 3 changed detection');
  }

  {
    const dir = path.join(WORK, 't4');
    seedProd(dir, oldCards, oldColl, null);
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['HEAD ' + cardsUrl]: { ok: true, status: 200, headers: headers({}) },
        ['HEAD ' + collUrl]: { ok: true, status: 200, headers: headers({}) },
      }),
    });
    const r = await updater.checkRemoteSnapshot();
    assert.strictEqual(r.status, 'UNKNOWN');
    assert.strictEqual(compareOne({ etag: null, lastModified: null, contentLength: null }, {}).status, 'unknown');
    console.log('ok TEST 4 unknown metadata handling');
  }

  {
    validateCardsArray(makeCards(1101));
    console.log('ok TEST 5 valid cards JSON');
  }

  {
    validateCollectibleArray(makeCollectible(makeCards(200), 151));
    console.log('ok TEST 6 valid collectible JSON');
  }

  {
    const dir = path.join(WORK, 't7');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cards.json'), '{not json');
    fs.writeFileSync(path.join(dir, 'cards.collectible.json'), '[]');
    const updater = createHsjsonUpdater({ rootDir: WORK });
    let failed = false;
    try { updater.validateSnapshot(dir); } catch (e) {
      failed = true;
      assert.strictEqual(e.code, 'VALIDATION_FAILED');
    }
    assert.ok(failed);
    console.log('ok TEST 7 invalid JSON rejected');
  }

  {
    const dir = path.join(WORK, 't8');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cards.json'), '{}');
    fs.writeFileSync(path.join(dir, 'cards.collectible.json'), JSON.stringify(makeCollectible(oldCards, 151)));
    const updater = createHsjsonUpdater({ rootDir: WORK });
    let failed = false;
    try { updater.validateSnapshot(dir); } catch (e) {
      failed = true;
      assert.strictEqual(e.code, 'VALIDATION_FAILED');
    }
    assert.ok(failed);
    console.log('ok TEST 8 wrong top-level type rejected');
  }

  {
    let failed = false;
    try { validateCardsArray([]); } catch (e) {
      failed = true;
      assert.strictEqual(e.code, 'VALIDATION_FAILED');
    }
    assert.ok(failed);
    failed = false;
    try { validateCollectibleArray([]); } catch (e) {
      failed = true;
    }
    assert.ok(failed);
    console.log('ok TEST 9 empty dataset rejected');
  }

  {
    const cards = makeCards(1100, 'A_');
    const coll = makeCollectible(makeCards(200, 'B_'), 151);
    let failed = false;
    try { crossValidate(cards, coll); } catch (e) {
      failed = true;
      assert.strictEqual(e.code, 'VALIDATION_FAILED');
    }
    assert.ok(failed);
    const okCross = crossValidate(oldCards, oldColl);
    assert.ok(okCross.overlapRatio > 0.9);
    assert.strictEqual(okCross.cardsCount, 1200);
    assert.strictEqual(okCross.collectibleCount, 200);
    console.log('ok TEST 10 cross validation');
  }

  {
    const dir = path.join(WORK, 't11');
    seedProd(dir, oldCards, oldColl, null);
    const updater = createHsjsonUpdater({
      rootDir: dir,
      newId: () => 'stage11',
      fetch: mockFetch({
        ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"n"' }), body: jsonBody(newCards) },
        ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"nc"' }), body: jsonBody(newColl) },
      }),
    });
    const staging = await updater.downloadSnapshotToStaging();
    assert.ok(fs.existsSync(path.join(staging.dir, 'cards.json')));
    assert.ok(fs.existsSync(path.join(staging.dir, 'cards.collectible.json')));
    assert.ok(fs.existsSync(path.join(staging.dir, 'metadata.json')));
    const prod = readProd(path.join(dir, 'data', 'hearthstonejson', 'zhCN'));
    assert.strictEqual(prod.cards[0].id, 'OLD_0');
    console.log('ok TEST 11 staging download');
  }

  {
    const dir = path.join(WORK, 't12');
    const prod = seedProd(dir, oldCards, oldColl, {
      schemaVersion: 1,
      locale: 'zhCN',
      source: 'hearthstonejson',
      cards: { url: cardsUrl, etag: '"old"', lastModified: null, contentLength: 1, sha256: 'x', entryCount: 1200, downloadedAt: 't' },
      collectible: { url: collUrl, etag: '"oldc"', lastModified: null, contentLength: 1, sha256: 'y', entryCount: 200, downloadedAt: 't' },
    });
    const updater = createHsjsonUpdater({
      rootDir: dir,
      nowIso: () => '2026-08-29T00:00:00.000Z',
      fetch: mockFetch({
        ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"new"' }), body: jsonBody(newCards) },
        ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"newc"' }), body: jsonBody(newColl) },
      }),
    });
    const result = await updater.updateSnapshot();
    assert.strictEqual(result.status, 'UPDATED');
    const after = readProd(prod);
    assert.strictEqual(after.cards[0].id, 'NEW_0');
    assert.strictEqual(after.collectible[0].id, 'NEW_0');
    assert.strictEqual(after.meta.cards.etag, '"new"');
    assert.strictEqual(after.meta.schemaVersion, 1);
    assert.ok(!fs.existsSync(path.join(prod, 'cards.json.bak.' + 'x')));
    console.log('ok TEST 12 successful atomic commit');
    console.log('ok TEST 17 snapshot metadata generated');
  }

  {
    const dir = path.join(WORK, 't13');
    const prod = seedProd(dir, oldCards, oldColl, { schemaVersion: 1, locale: 'zhCN', source: 'hearthstonejson', cards: { etag: '"o"' }, collectible: { etag: '"oc"' } });
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({}), body: jsonBody(newCards) },
        ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({}), body: jsonBody(newColl) },
      }),
      replaceFile: function (src, dest) {
        if (path.basename(dest) === 'cards.json') throw new Error('cards replace boom');
        fs.renameSync(src, dest);
      },
    });
    const staging = await updater.downloadSnapshotToStaging();
    const validation = updater.validateSnapshot(staging.dir);
    let failed = false;
    try { updater.commitSnapshot(staging, validation); } catch (e) {
      failed = true;
      assert.strictEqual(e.code, 'COMMIT_FAILED');
    }
    assert.ok(failed);
    const after = readProd(prod);
    assert.strictEqual(after.cards[0].id, 'OLD_0');
    assert.strictEqual(after.collectible[0].id, 'OLD_0');
    console.log('ok TEST 13 cards replacement failure rollback');
  }

  {
    const dir = path.join(WORK, 't14');
    const prod = seedProd(dir, oldCards, oldColl, { schemaVersion: 1, locale: 'zhCN', source: 'hearthstonejson', cards: { etag: '"o"' }, collectible: { etag: '"oc"' } });
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({}), body: jsonBody(newCards) },
        ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({}), body: jsonBody(newColl) },
      }),
      replaceFile: function (src, dest) {
        if (path.basename(dest) === 'cards.collectible.json') throw new Error('collectible replace boom');
        fs.renameSync(src, dest);
      },
    });
    const staging = await updater.downloadSnapshotToStaging();
    const validation = updater.validateSnapshot(staging.dir);
    let failed = false;
    try { updater.commitSnapshot(staging, validation); } catch (e) { failed = true; }
    assert.ok(failed);
    const after = readProd(prod);
    assert.strictEqual(after.cards[0].id, 'OLD_0');
    assert.strictEqual(after.collectible[0].id, 'OLD_0');
    console.log('ok TEST 14 collectible replacement failure rollback');
  }

  {
    const dir = path.join(WORK, 't15');
    const oldMeta = { schemaVersion: 1, locale: 'zhCN', source: 'hearthstonejson', cards: { etag: '"keep"' }, collectible: { etag: '"keepc"' } };
    const prod = seedProd(dir, oldCards, oldColl, oldMeta);
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['GET ' + cardsUrl]: { ok: true, status: 200, headers: headers({ etag: '"n"' }), body: jsonBody(newCards) },
        ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({ etag: '"nc"' }), body: jsonBody(newColl) },
      }),
      writeFileSync: function (p, data) {
        if (path.basename(p) === 'snapshot-meta.json') throw new Error('meta boom');
        fs.writeFileSync(p, data);
      },
    });
    const staging = await updater.downloadSnapshotToStaging();
    const validation = updater.validateSnapshot(staging.dir);
    let failed = false;
    try { updater.commitSnapshot(staging, validation); } catch (e) { failed = true; }
    assert.ok(failed);
    const after = readProd(prod);
    assert.strictEqual(after.cards[0].id, 'OLD_0');
    assert.strictEqual(after.collectible[0].id, 'OLD_0');
    assert.strictEqual(after.meta.cards.etag, '"keep"');
    console.log('ok TEST 15 metadata failure rollback');
  }

  {
    const dir = path.join(WORK, 't16');
    const prod = seedProd(dir, oldCards, oldColl, {
      schemaVersion: 1, locale: 'zhCN', source: 'hearthstonejson',
      cards: { etag: '"o"', sha256: 'old' }, collectible: { etag: '"oc"', sha256: 'oldc' },
    });
    const before = readProd(prod);
    const updater = createHsjsonUpdater({
      rootDir: dir,
      fetch: mockFetch({
        ['GET ' + cardsUrl]: { ok: false, status: 500, headers: headers({}) },
        ['GET ' + collUrl]: { ok: true, status: 200, headers: headers({}), body: jsonBody(newColl) },
      }),
    });
    const result = await updater.updateSnapshot();
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.preserved, true);
    const after = readProd(prod);
    assert.deepStrictEqual(after.cards[0].id, before.cards[0].id);
    assert.deepStrictEqual(after.collectible[0].id, before.collectible[0].id);
    assert.strictEqual(after.meta.cards.etag, '"o"');
    console.log('ok TEST 16 failed update preserves original snapshot');
  }

  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'hsjsonUpdater.js'), 'utf8');
    const scripts = [
      fs.readFileSync(path.join(ROOT, 'scripts', 'run-hsjson-check.cjs'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'scripts', 'run-hsjson-update.cjs'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'scripts', 'run-hsjson-check-live.cjs'), 'utf8'),
    ].join('\n');
    const blob = src + scripts;
    const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (service) assert.ok(!blob.includes(service));
    assert.ok(!blob.includes('SUPABASE_SERVICE_ROLE_KEY'));
    const updater = createHsjsonUpdater({ rootDir: path.join(WORK, 't18') });
    const log = updater.formatCheckLog({
      status: 'UP_TO_DATE',
      remote: { cards: { etag: '"x"' }, collectible: { etag: '"y"' } },
      local: { cards: { sha256: 'aa' }, collectible: { sha256: 'bb' } },
    });
    if (service) assert.ok(!log.includes(service));
    assert.ok(!/password|service_role|sb_secret_/i.test(log));
    console.log('ok TEST 18 no secret appears in updater output');
  }

  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'hsjsonUpdater.js'), 'utf8');
    const updateCli = fs.readFileSync(path.join(ROOT, 'scripts', 'run-hsjson-update.cjs'), 'utf8');
    assert.ok(!/run-phase08|phase08-build|index:voice/.test(src + updateCli));
    console.log('ok TEST 19 does not invoke phase08');
    assert.ok(!/run-phase11|phase11-build|index:audio/.test(src + updateCli));
    console.log('ok TEST 20 does not invoke phase11');
  }

  {
    const walk = [];
    function walkDir(dir) {
      fs.readdirSync(dir).forEach((name) => {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          if (name === 'node_modules' || name === 'tmp') return;
          walkDir(p);
        } else if (/\.(js|cjs|mjs|html|css|json)$/.test(name)) walk.push(p);
      });
    }
    ['src', 'scripts', 'test', 'admin', 'public'].forEach((rel) => {
      const p = path.join(ROOT, rel);
      if (fs.existsSync(p)) walkDir(p);
    });
    const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    walk.forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      if (service) assert.ok(!text.includes(service), file);
    });
    const hsDir = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN');
    fs.readdirSync(hsDir).forEach((name) => {
      assert.ok(/^(cards\.json|cards\.collectible\.json|snapshot-meta\.json)$/.test(name), name);
    });
  }

  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) {}
  console.log('ok hsjsonUpdater');
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
}).then(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 200);
});
