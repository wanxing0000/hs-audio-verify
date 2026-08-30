const assert = require('assert');
const {
  snapshotFingerprint,
  makeVersionLabel,
  createMemoryDataVersionStore,
  createDataVersionService,
} = require('../src/services/dataVersionService.js');

const CARDS_SHA = 'a'.repeat(64);
const COLL_SHA = 'b'.repeat(64);

function service() {
  return createDataVersionService(createMemoryDataVersionStore(), {
    nowIso: function () { return '2026-08-29T12:00:00.000Z'; },
    newId: function () { return '11111111-1111-4111-8111-111111111111'; },
  });
}

(async function () {
  {
    const svc = service();
    const row = await svc.createDataVersion({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
      cardsCount: 2000,
      collectibleCount: 200,
    });
    assert.strictEqual(row.status, 'STAGED');
    assert.strictEqual(row.source, 'hearthstonejson');
    assert.strictEqual(row.locale, 'zhCN');
    assert.strictEqual(row.build, null);
    assert.ok(row.version.indexOf('hs-') === 0);
    assert.ok(!/250339/.test(row.version));
    console.log('ok TEST 1 create data version');
  }

  {
    const a = snapshotFingerprint({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    const b = snapshotFingerprint({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    const c = snapshotFingerprint({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: 'c'.repeat(64),
      collectibleSha256: COLL_SHA,
    });
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.strictEqual(a.length, 64);
    const label = makeVersionLabel({ fingerprint: a, build: null });
    assert.strictEqual(label, 'hs-' + a.slice(0, 12));
    console.log('ok TEST 2 fingerprint stable');
  }

  {
    const svc = service();
    const first = await svc.createDataVersion({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    const second = await svc.createDataVersion({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    assert.strictEqual(first.id, second.id);
    const listed = await svc.listDataVersions();
    assert.strictEqual(listed.length, 1);
    console.log('ok TEST 3 duplicate fingerprint reuse');
  }

  {
    const svc = service();
    const row = await svc.createDataVersion({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    const validated = await svc.markValidated(row.id);
    assert.strictEqual(validated.status, 'VALIDATED');
    const ready = await svc.markReady(validated.id);
    assert.strictEqual(ready.status, 'READY');
    const active = await svc.markActive(ready.id);
    assert.strictEqual(active.status, 'ACTIVE');
    console.log('ok TEST 4 status transition');
  }

  {
    const svc = service();
    const row = await svc.createDataVersion({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    await assert.rejects(
      () => svc.updateDataVersionStatus(row.id, 'ACTIVE'),
      function (err) { return err && err.code === 'DATA_VERSION_STATUS_INVALID'; },
    );
    await assert.rejects(
      () => svc.updateDataVersionStatus(row.id, 'READY'),
      function (err) { return err && err.code === 'DATA_VERSION_STATUS_INVALID'; },
    );
    await assert.rejects(
      () => svc.createDataVersion({
        source: 'hearthstonejson',
        locale: 'zhCN',
        cardsSha256: 'd'.repeat(64),
        collectibleSha256: COLL_SHA,
        status: 'READY',
      }),
      function (err) { return err && err.code === 'DATA_VERSION_STATUS_INVALID'; },
    );
    console.log('ok TEST 5 invalid status rejected');
  }

  {
    const svc = service();
    const meta = {
      source: 'hearthstonejson',
      locale: 'zhCN',
      cards: {
        url: 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.json',
        sha256: CARDS_SHA,
        entryCount: 2000,
        downloadedAt: '2026-08-29T12:00:00.000Z',
        etag: 'W/"abc"',
      },
      collectible: {
        url: 'https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json',
        sha256: COLL_SHA,
        entryCount: 200,
        downloadedAt: '2026-08-29T12:00:00.000Z',
      },
    };
    const row = await svc.createDataVersion({ snapshotMeta: meta });
    assert.strictEqual(row.build, null);
    assert.strictEqual(row.cards_count, 2000);
    assert.strictEqual(row.collectible_count, 200);
    assert.strictEqual(row.snapshot_meta.downloadedAt, '2026-08-29T12:00:00.000Z');
    assert.strictEqual(row.snapshot_meta.cards.sha256, CARDS_SHA);
    assert.ok(!Object.prototype.hasOwnProperty.call(meta, 'build') || row.build == null);
    console.log('ok TEST 6 metadata mapping');
  }

  {
    const svc = service();
    const row = await svc.createDataVersion({
      source: 'hearthstonejson',
      locale: 'zhCN',
      cardsSha256: CARDS_SHA,
      collectibleSha256: COLL_SHA,
    });
    const failed = await svc.markFailed(row.id);
    assert.strictEqual(failed.status, 'FAILED');
    console.log('ok TEST 7 failed version');
  }

  console.log('ok dataVersionService');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
