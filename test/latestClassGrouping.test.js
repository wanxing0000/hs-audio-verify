const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildCatalog,
  loadLatestSetConfig,
  filterLatestCards,
  toListCard,
  CLASS_ORDER,
} = require('../src/miniprogram/catalogAdapter.js');
const { groupLatestCardsByClass } = require('../miniprogram/utils/latestGroups.js');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_COUNTS = {
  DEATHKNIGHT: 10,
  DEMONHUNTER: 10,
  DRUID: 10,
  HUNTER: 10,
  MAGE: 10,
  PALADIN: 10,
  SHAMAN: 10,
  PRIEST: 17,
  ROGUE: 17,
  WARLOCK: 17,
  WARRIOR: 17,
  NEUTRAL: 26,
};

const meta = loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set.json'));
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const catalog = buildCatalog(unified);
const latest = filterLatestCards(catalog.cards, meta.set).map(toListCard);
const originalIds = latest.map((c) => c.id);
const groups = groupLatestCardsByClass(latest);

function flatten(gs) {
  const out = [];
  for (let i = 0; i < gs.length; i++) {
    const cards = gs[i].cards || [];
    for (let j = 0; j < cards.length; j++) out.push(cards[j]);
  }
  return out;
}

function relativeIds(list, classId, legendary) {
  const ids = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.class !== classId) continue;
    const isL = c.rarity === 'LEGENDARY' || c.legendary === true;
    if (legendary ? isL : !isL) ids.push(c.id);
  }
  return ids;
}

// TEST 1: grouped total is 164
{
  assert.strictEqual(latest.length, 164);
  assert.strictEqual(flatten(groups).length, 164);
}

// TEST 2: every card belongs to exactly one group
{
  let sum = 0;
  for (let i = 0; i < groups.length; i++) sum += groups[i].cards.length;
  assert.strictEqual(sum, 164);
}

// TEST 3: group order follows CLASS_ORDER for classes that exist
{
  const expected = CLASS_ORDER.filter((id) => EXPECTED_COUNTS[id] > 0);
  assert.deepStrictEqual(groups.map((g) => g.class), expected);
}

// TEST 4: legendary before non-legendary in every group
{
  for (let i = 0; i < groups.length; i++) {
    const cards = groups[i].cards;
    let seenOther = false;
    for (let j = 0; j < cards.length; j++) {
      const isL = cards[j].rarity === 'LEGENDARY' || cards[j].legendary === true;
      if (!isL) seenOther = true;
      if (isL) assert.strictEqual(seenOther, false, groups[i].class + ' legendary after other');
    }
  }
}

// TEST 5: legendary relative order matches catalog
{
  for (let i = 0; i < CLASS_ORDER.length; i++) {
    const id = CLASS_ORDER[i];
    const before = relativeIds(latest, id, true);
    const after = relativeIds(flatten(groups.filter((g) => g.class === id)), id, true);
    assert.deepStrictEqual(after, before, 'legendary order ' + id);
  }
}

// TEST 6: non-legendary relative order matches catalog
{
  for (let i = 0; i < CLASS_ORDER.length; i++) {
    const id = CLASS_ORDER[i];
    const before = relativeIds(latest, id, false);
    const after = relativeIds(flatten(groups.filter((g) => g.class === id)), id, false);
    assert.deepStrictEqual(after, before, 'other order ' + id);
  }
}

// TEST 7: 31 legendary / 133 other
{
  const all = flatten(groups);
  const legend = all.filter((c) => c.rarity === 'LEGENDARY' || c.legendary === true);
  assert.strictEqual(legend.length, 31);
  assert.strictEqual(all.length - legend.length, 133);
  assert.strictEqual(all.length, 164);
}

// TEST 8: class counts match 1.5.5 snapshot
{
  const counts = {};
  for (let i = 0; i < groups.length; i++) counts[groups[i].class] = groups[i].cards.length;
  const keys = Object.keys(EXPECTED_COUNTS);
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i];
    assert.strictEqual(counts[id], EXPECTED_COUNTS[id], 'count ' + id);
  }
  assert.strictEqual(Object.keys(counts).length, keys.length);
}

// TEST 9: NEUTRAL is last
{
  assert.strictEqual(groups[groups.length - 1].class, 'NEUTRAL');
  assert.strictEqual(groups[groups.length - 1].classLabel, '中立');
}

// TEST 10: no duplicate ids
{
  const ids = flatten(groups).map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.deepStrictEqual(ids.slice().sort(), originalIds.slice().sort());
}

// TEST 11: grouping does not drop cards (including Mini Set members already in latest)
{
  assert.strictEqual(latest.length, 164);
  assert.strictEqual(flatten(groups).length, 164);
  const src = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'latestGroups.js'), 'utf8');
  assert.ok(!/isMiniSet/.test(src));
}

// TEST 12: unknown class does not crash and is not dropped
{
  const extra = latest.concat([{
    id: 'UNKNOWN_FIXTURE',
    name: '未知职业卡',
    class: 'UNKNOWN_CLASS',
    classLabel: '',
    rarity: 'COMMON',
    legendary: false,
  }]);
  const grouped = groupLatestCardsByClass(extra);
  const flat = flatten(grouped);
  assert.strictEqual(flat.length, 165);
  assert.ok(flat.some((c) => c.id === 'UNKNOWN_FIXTURE'));
  assert.strictEqual(grouped[grouped.length - 1].class, 'UNKNOWN_CLASS');
  assert.ok(grouped[grouped.length - 1].classLabel);
  const neutralIdx = grouped.findIndex((g) => g.class === 'NEUTRAL');
  const unknownIdx = grouped.findIndex((g) => g.class === 'UNKNOWN_CLASS');
  assert.ok(neutralIdx >= 0);
  assert.ok(unknownIdx > neutralIdx);
}

// grouping must not mutate the input array
{
  const copy = latest.slice();
  groupLatestCardsByClass(latest);
  assert.strictEqual(latest.length, copy.length);
  for (let i = 0; i < latest.length; i++) assert.strictEqual(latest[i], copy[i]);
}

// empty classes omitted
{
  const onlyMage = latest.filter((c) => c.class === 'MAGE');
  const grouped = groupLatestCardsByClass(onlyMage);
  assert.strictEqual(grouped.length, 1);
  assert.strictEqual(grouped[0].class, 'MAGE');
}

// page still uses card id for detail
{
  const latestJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'latest', 'latest.js'), 'utf8');
  assert.ok(latestJs.includes('/pages/card/card?id='));
  assert.ok(latestJs.includes('orderLatestCards'));
  assert.ok(latestJs.includes('sliceLatestVisible'));
  assert.ok(latestJs.includes('onReachBottom'));
  assert.ok(!latestJs.includes('ESCAPEFROM_VIOLET_HOLD'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'latest', 'latest.wxml'), 'utf8').includes('groups'));
}

console.log('ok latestClassGrouping', {
  groups: groups.length,
  total: flatten(groups).length,
  legendary: flatten(groups).filter((c) => c.rarity === 'LEGENDARY').length,
  last: groups[groups.length - 1].class,
});
