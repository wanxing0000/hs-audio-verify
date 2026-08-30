const { CLASS_ORDER } = require('./labels.js');

function isLegendary(card) {
  return !!(card && (card.rarity === 'LEGENDARY' || card.legendary === true));
}

function classKey(card) {
  if (!card || card.class == null || card.class === '') return '';
  return String(card.class);
}

function legendaryFirst(cards) {
  const legend = [];
  const rest = [];
  for (let i = 0; i < cards.length; i++) {
    if (isLegendary(cards[i])) legend.push(cards[i]);
    else rest.push(cards[i]);
  }
  return legend.concat(rest);
}

function groupLabel(cards, key) {
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (card && card.classLabel) return card.classLabel;
  }
  return key || '未知';
}

const LATEST_BATCH_SIZE = 20;

function flattenLatestGroups(groups) {
  const out = [];
  const list = Array.isArray(groups) ? groups : [];
  for (let i = 0; i < list.length; i++) {
    const cards = list[i] && list[i].cards;
    if (!Array.isArray(cards)) continue;
    for (let j = 0; j < cards.length; j++) out.push(cards[j]);
  }
  return out;
}

function orderLatestCards(cards) {
  return flattenLatestGroups(groupLatestCardsByClass(cards));
}

function sliceLatestVisible(orderedCards, displayCount) {
  const all = Array.isArray(orderedCards) ? orderedCards : [];
  let n = Number(displayCount);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.min(Math.floor(n), all.length);
  const visible = all.slice(0, n);
  return {
    visible: visible,
    groups: groupLatestCardsByClass(visible),
    displayCount: visible.length,
    hasMore: visible.length < all.length,
  };
}

function groupLatestCardsByClass(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const buckets = Object.create(null);
  const unknownKeys = [];
  for (let i = 0; i < list.length; i++) {
    const card = list[i];
    if (!card) continue;
    const key = classKey(card);
    if (!buckets[key]) {
      buckets[key] = [];
      if (CLASS_ORDER.indexOf(key) < 0) unknownKeys.push(key);
    }
    buckets[key].push(card);
  }

  const groups = [];
  function pushGroup(key) {
    const bucket = buckets[key];
    if (!bucket || !bucket.length) return;
    groups.push({
      class: key,
      classLabel: groupLabel(bucket, key),
      cards: legendaryFirst(bucket),
    });
  }

  for (let i = 0; i < CLASS_ORDER.length; i++) pushGroup(CLASS_ORDER[i]);
  for (let i = 0; i < unknownKeys.length; i++) pushGroup(unknownKeys[i]);
  return groups;
}

module.exports = {
  LATEST_BATCH_SIZE,
  flattenLatestGroups,
  orderLatestCards,
  sliceLatestVisible,
  groupLatestCardsByClass,
  legendaryFirst,
  isLegendary,
};
