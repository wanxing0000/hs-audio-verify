const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  foldSharedReprints,
  buildCatalog,
  shouldPublish,
  searchCards,
  searchCardsPage,
  catalogPage,
} = require('../src/miniprogram/catalogAdapter.js');

function card(id, opts) {
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
    voice: {
      play: {
        available: true,
        sourceCardId: opts.sourceCardId === undefined ? id : opts.sourceCardId,
      },
    },
    music: { available: true },
    entrancePreview: { available: true },
  };
}

function idsOf(result) {
  return (result.cards || result).map((c) => c.id);
}

function fold(list) {
  const warnings = [];
  const out = foldSharedReprints(list, {
    warn: function (msg) { warnings.push(String(msg)); },
  });
  return { ids: idsOf(out), warnings: warnings, folded: out };
}

// TEST 1: independent card with no foreign source
{
  const r = fold([card('TOY_330', { sourceCardId: 'TOY_330', name: '奇利亚斯豪华版3000型' })]);
  assert.deepStrictEqual(r.ids, ['TOY_330']);
}

{
  const r = fold([card('TOY_330', { sourceCardId: null, name: '奇利亚斯豪华版3000型' })]);
  assert.deepStrictEqual(r.ids, ['TOY_330']);
}

// TEST 2: canonical + shared reprint
{
  const r = fold([
    card('BOT_548', { sourceCardId: 'BOT_548', dbfId: 49184 }),
    card('CORE_BOT_548', { sourceCardId: 'BOT_548', dbfId: 97112 }),
  ]);
  assert.deepStrictEqual(r.ids, ['BOT_548']);
}

// TEST 3: shared reprint listed first — still keep canonical
{
  const r = fold([
    card('CORE_BOT_548', { sourceCardId: 'BOT_548', dbfId: 97112 }),
    card('BOT_548', { sourceCardId: 'BOT_548', dbfId: 49184 }),
  ]);
  assert.deepStrictEqual(r.ids, ['BOT_548']);
}

// TEST 4: multiple shared reprints
{
  const r = fold([
    card('VAN_NEW1_010', { sourceCardId: 'NEW1_010', dbfId: 70078 }),
    card('CORE_NEW1_010', { sourceCardId: 'NEW1_010', dbfId: 69632 }),
    card('NEW1_010', { sourceCardId: 'NEW1_010', dbfId: 32 }),
  ]);
  assert.deepStrictEqual(r.ids, ['NEW1_010']);
}

// TEST 5: same name, not shared — keep both
{
  const r = fold([
    card('CARD_A', { name: '同名卡', sourceCardId: 'CARD_A', dbfId: 1 }),
    card('CARD_B', { name: '同名卡', sourceCardId: 'CARD_B', dbfId: 2 }),
  ]);
  assert.strictEqual(r.ids.indexOf('CARD_A') >= 0, true);
  assert.strictEqual(r.ids.indexOf('CARD_B') >= 0, true);
  assert.strictEqual(r.ids.length, 2);
}

// TEST 6: 奇利亚斯 scene
{
  const r = fold([
    card('BOT_548', { name: '奇利亚斯', sourceCardId: 'BOT_548' }),
    card('CORE_BOT_548', { name: '奇利亚斯', sourceCardId: 'BOT_548' }),
    card('TOY_330', { name: '奇利亚斯豪华版3000型', sourceCardId: 'TOY_330' }),
  ]);
  assert.deepStrictEqual(r.ids.slice().sort(), ['BOT_548', 'TOY_330']);
  assert.strictEqual(r.ids.indexOf('CORE_BOT_548'), -1);
}

// TEST 7: collectible=false still unpublished
{
  assert.strictEqual(shouldPublish({ id: 'THD_026', collectible: false }), false);
  const catalog = buildCatalog({
    cards: {
      THD_026: { id: 'THD_026', name: '风领主奥拉基尔', collectible: false, type: 'HERO' },
      NEW1_010: {
        id: 'NEW1_010',
        name: '风领主奥拉基尔',
        collectible: true,
        type: 'MINION',
        class: 'SHAMAN',
        rarity: 'LEGENDARY',
        set: 'EXPERT1',
        dbfId: 32,
        voice: { play: { status: 'available', voiceKey: 'x', sourceCardId: 'NEW1_010' }, attack: {}, death: {} },
        music: { status: 'unavailable' },
      },
    },
  });
  assert.ok(!catalog.cards.some((c) => c.id === 'THD_026'));
  assert.ok(!catalog.byId.THD_026);
}

// TEST 8: missing sourceCardId keeps the card and warns
{
  const r = fold([card('CARD_A', { sourceCardId: 'NOT_EXIST' })]);
  assert.deepStrictEqual(r.ids, ['CARD_A']);
  assert.ok(r.warnings.some((w) => w.indexOf('NOT_EXIST') >= 0 && w.indexOf('keep current card') >= 0));
}

// TEST 9: do not mutate card.id
{
  const a = card('CORE_BOT_548', { sourceCardId: 'BOT_548' });
  const b = card('BOT_548', { sourceCardId: 'BOT_548' });
  fold([a, b]);
  assert.strictEqual(a.id, 'CORE_BOT_548');
  assert.strictEqual(b.id, 'BOT_548');
}

// TEST 10: pagination sees canonical only once
{
  const published = fold([
    card('NEW1_010', { sourceCardId: 'NEW1_010', dbfId: 32, name: '风领主奥拉基尔' }),
    card('CORE_NEW1_010', { sourceCardId: 'NEW1_010', dbfId: 69632, name: '风领主奥拉基尔' }),
    card('VAN_NEW1_010', { sourceCardId: 'NEW1_010', dbfId: 70078, name: '风领主奥拉基尔' }),
    card('EX1_116', { sourceCardId: 'EX1_116', dbfId: 559, name: '火车王里诺艾' }),
  ]).folded.cards;
  const seen = {};
  let alakir = 0;
  for (let p = 1; p <= 3; p++) {
    const page = catalogPage(published, { page: p, pageSize: 2 });
    for (const item of page.items) {
      assert.ok(!seen[item.id], 'duplicate id across pages ' + item.id);
      seen[item.id] = true;
      if (item.id === 'NEW1_010') alakir += 1;
      assert.notStrictEqual(item.id, 'CORE_NEW1_010');
      assert.notStrictEqual(item.id, 'VAN_NEW1_010');
    }
  }
  assert.strictEqual(alakir, 1);
}

// folding must not key off display names
{
  const src = fs.readFileSync(path.join(__dirname, '../src/miniprogram/catalogAdapter.js'), 'utf8');
  const foldFn = src.split('function foldSharedReprints')[1].split('function buildCatalog')[0];
  assert.ok(!/seenNames/.test(foldFn));
  assert.ok(!/card\.name/.test(foldFn));
}

// Live index: 奇利亚斯 / 风领主奥拉基尔
{
  const ROOT = path.resolve(__dirname, '..');
  const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
  const catalog = buildCatalog(unified);
  const z = searchCards(catalog.cards, '奇利亚斯', { limit: 60 });
  const zIds = z.map((c) => c.id).sort();
  assert.deepStrictEqual(zIds, ['BOT_548', 'TOY_330']);
  assert.ok(!z.some((c) => c.id === 'CORE_BOT_548'));
  const a = searchCards(catalog.cards, '风领主奥拉基尔', { limit: 60 });
  assert.deepStrictEqual(a.map((c) => c.id), ['NEW1_010']);
  assert.ok(!catalog.cards.some((c) => c.id === 'CORE_NEW1_010' || c.id === 'VAN_NEW1_010'));
  const home = searchCardsPage(catalog.cards, '', { page: 1, pageSize: 50 });
  const homeAlakir = [];
  const last = Math.ceil((catalog.foldStats.after || catalog.cards.length) / 30);
  for (let p = 1; p <= last; p++) {
    const page = catalogPage(catalog.cards, { page: p, pageSize: 30 });
    for (const item of page.items) {
      if (item.name === '风领主奥拉基尔') homeAlakir.push(item.id);
    }
  }
  assert.deepStrictEqual(homeAlakir, ['NEW1_010']);
  assert.ok(catalog.byId.CORE_BOT_548, 'detail lookup for reprint id must remain');
  assert.ok(catalog.byId.VAN_NEW1_010);
  assert.ok(catalog.foldStats.before > catalog.foldStats.after);
  assert.ok(catalog.foldStats.folded > 0);
  console.log('ok catalogFold', {
    zIds: zIds,
    alakir: a.map((c) => c.id),
    before: catalog.foldStats.before,
    after: catalog.foldStats.after,
    folded: catalog.foldStats.folded,
    groups: catalog.foldStats.groups,
    warningCount: catalog.foldStats.warningCount,
    homeFirst: home.items[0] && home.items[0].id,
  });
}
