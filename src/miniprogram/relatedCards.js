'use strict';

const { adaptCard, getCardImageUrl, TYPE_ZH, voicePlayable } = require('./catalogAdapter.js');
const {
  collectStructuredRelations,
  indexAudioFromRaw,
  productionAudioForCard,
} = require('../audit/relatedAudioAudit.js');

const DISPLAY_TYPES = {
  MINION: true,
  SPELL: true,
  WEAPON: true,
  LOCATION: true,
  HERO: true,
};

const HIDDEN_TYPES = {
  ENCHANTMENT: true,
  HERO_POWER: true,
};

const HIDDEN_RELATION_TYPES = {
  enchantment: true,
  hero_power: true,
  battlegrounds_buddy: true,
  battlegrounds_related: true,
  battlegrounds_skin_parent: true,
};

const DISPLAY_CONFIDENCE = {
  STRUCTURED: true,
  PROJECT_INDEXED: true,
};

const RELATED_DEPTH_MAX = 2;

function shouldDisplayRelatedEdge(edge, childRaw) {
  if (!edge || !childRaw) return false;
  if (!DISPLAY_CONFIDENCE[edge.relationConfidence]) return false;
  if (HIDDEN_RELATION_TYPES[edge.relationType]) return false;
  const type = childRaw.type;
  if (HIDDEN_TYPES[type]) return false;
  if (!DISPLAY_TYPES[type]) return false;
  return true;
}

function createRelatedCardIndex(cardsMap) {
  const byId = cardsMap || {};
  const list = [];
  const ids = Object.keys(byId);
  for (let i = 0; i < ids.length; i++) {
    const raw = byId[ids[i]];
    if (raw && raw.id) list.push(raw);
  }
  const edges = collectStructuredRelations(list);
  const byParent = Object.create(null);
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!byParent[edge.parentCardId]) byParent[edge.parentCardId] = [];
    byParent[edge.parentCardId].push(edge);
  }
  const parentIds = Object.keys(byParent);
  for (let i = 0; i < parentIds.length; i++) {
    byParent[parentIds[i]].sort(function (a, b) {
      return String(a.relatedCardId).localeCompare(String(b.relatedCardId));
    });
  }
  return { byId: byId, byParent: byParent };
}

function relatedAudioStatus(raw, inventory) {
  const indexed = indexAudioFromRaw(raw);
  const production = productionAudioForCard(raw && raw.id, inventory);
  const hasVoice = !!(indexed.hasVoice && production.hasVoice);
  const hasMusic = !!(indexed.music && production.music);
  const hasEntrance = !!(indexed.entrance && production.entrance);
  return {
    indexed: indexed.hasAny,
    productionAvailable: production.hasAny,
    playable: !!(hasVoice || hasMusic || hasEntrance),
    hasVoice: hasVoice,
    hasMusic: hasMusic,
    hasEntrance: hasEntrance,
    production: {
      hasVoice: production.hasVoice,
      hasMusic: production.music,
      hasEntrance: production.entrance,
    },
  };
}

function relatedVoiceSlot(raw, inventory, type) {
  const slot = raw && raw.voice && raw.voice[type];
  const mapped = voicePlayable(slot);
  const present = !!(inventory && raw && inventory.hasVoice(raw.id, type));
  return {
    available: !!(mapped && present),
    voiceKey: mapped ? slot.voiceKey : null,
  };
}

function relatedAudioSlots(raw, inventory) {
  return {
    play: relatedVoiceSlot(raw, inventory, 'play'),
    attack: relatedVoiceSlot(raw, inventory, 'attack'),
    death: relatedVoiceSlot(raw, inventory, 'death'),
  };
}

function canPlayRelatedSlot(related, slot) {
  if (!related || !related.audioSlots) return false;
  if (slot !== 'play' && slot !== 'attack' && slot !== 'death') return false;
  const rec = related.audioSlots[slot];
  return !!(rec && rec.available === true);
}

function toRelatedCardDto(edge, raw, inventory, children) {
  const audio = relatedAudioStatus(raw, inventory);
  const audioSlots = relatedAudioSlots(raw, inventory);
  return {
    id: raw.id,
    dbfId: raw.dbfId == null ? null : raw.dbfId,
    name: raw.name || raw.id,
    imageUrl: getCardImageUrl(raw),
    type: raw.type || 'UNKNOWN',
    typeLabel: TYPE_ZH[raw.type] || raw.type || '',
    collectible: raw.collectible === true,
    relationType: edge.relationType,
    relationConfidence: edge.relationConfidence,
    audio: audio,
    audioSlots: audioSlots,
    relatedCards: Array.isArray(children) ? children : [],
  };
}

function collectDisplayRelated(parentId, index, inventory, depth) {
  if (!index || depth > RELATED_DEPTH_MAX) return [];
  const edges = (index.byParent && index.byParent[parentId]) || [];
  const out = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const raw = index.byId[edge.relatedCardId];
    if (!shouldDisplayRelatedEdge(edge, raw)) continue;
    const children = depth < RELATED_DEPTH_MAX
      ? collectDisplayRelated(edge.relatedCardId, index, inventory, depth + 1)
      : [];
    out.push(toRelatedCardDto(edge, raw, inventory, children));
  }
  return out;
}

function getDisplayRelatedCards(parentId, index, inventory) {
  return collectDisplayRelated(parentId, index, inventory, 1);
}

function resolveDetailCard(cardId, catalog, unified) {
  const id = String(cardId || '');
  if (!id) return null;
  if (catalog && catalog.byId && catalog.byId[id]) return catalog.byId[id];
  const raw = unified && unified.cards && unified.cards[id];
  if (!raw) return null;
  return adaptCard(raw);
}

function attachRelatedCards(detail, index, inventory) {
  if (!detail) return detail;
  detail.relatedCards = getDisplayRelatedCards(detail.id, index, inventory);
  return detail;
}

module.exports = {
  DISPLAY_TYPES,
  HIDDEN_TYPES,
  RELATED_DEPTH_MAX,
  shouldDisplayRelatedEdge,
  createRelatedCardIndex,
  relatedAudioStatus,
  relatedAudioSlots,
  canPlayRelatedSlot,
  getDisplayRelatedCards,
  resolveDetailCard,
  attachRelatedCards,
};
