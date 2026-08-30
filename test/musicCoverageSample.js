function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, seed) {
  const copy = list.slice();
  const rng = mulberry32(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function legendaryMinions(unified) {
  const out = [];
  const cards = (unified && unified.cards) || {};
  for (const id of Object.keys(cards)) {
    const c = cards[id];
    if (c && c.collectible === true && c.type === 'MINION' && c.rarity === 'LEGENDARY') out.push(c);
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

function musicStatus(card) {
  return card && card.music && card.music.status;
}

function coverageLists(unified, seed) {
  const legend = legendaryMinions(unified);
  const available = legend.filter((c) => musicStatus(c) === 'available');
  const shared = legend.filter((c) => musicStatus(c) === 'shared');
  const unavailable = legend.filter((c) => musicStatus(c) === 'unavailable');
  const shuffledAvail = shuffle(available, seed);
  const shuffledShared = shuffle(shared, seed);
  return {
    seed,
    totalLegendaryMinions: legend.length,
    musicAvailable: available.length,
    musicShared: shared.length,
    musicUnavailable: unavailable.length,
    unavailableIds: unavailable.map((c) => c.id),
    apiAvailableIds: shuffledAvail.slice(0, 20).map((c) => c.id),
    apiSharedIds: shuffledShared.slice(0, 10).map((c) => c.id),
    wavAvailableIds: shuffledAvail.slice(0, 10).map((c) => c.id),
    wavSharedIds: shuffledShared.slice(0, 10).map((c) => c.id),
  };
}

module.exports = {
  mulberry32,
  shuffle,
  legendaryMinions,
  coverageLists,
};
