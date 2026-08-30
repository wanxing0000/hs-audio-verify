'use strict';

const fs = require('fs');
const path = require('path');
const { shouldPublish, voicePlayable, musicPlayable } = require('../miniprogram/catalogAdapter.js');
const { createProductionAudioInventory } = require('../services/productionAudioAvailability.js');

const TOKEN_SUFFIX_RE = /^(.*)(t\d{1,2}|t|[abc]|e\d{1,2}|e)$/;
const NO_AUDIO_TYPES = {
  ENCHANTMENT: true,
  HERO_POWER: true,
  BATTLEGROUND_SPELL: true,
};
const SPECIAL_TYPES = {
  HERO: true,
  HERO_POWER: true,
  ENCHANTMENT: true,
  LOCATION: true,
};
const PLAYABLE_RELATED_TYPES = {
  MINION: true,
  SPELL: true,
  WEAPON: true,
  HERO: true,
  LOCATION: true,
};

function stripOneTokenSuffix(cardId) {
  const id = String(cardId || '');
  const m = id.match(TOKEN_SUFFIX_RE);
  if (!m || !m[1]) return null;
  return { parentId: m[1], suffix: m[2] };
}

function isStructuredTokenChild(parentId, childId) {
  const parent = String(parentId || '');
  const child = String(childId || '');
  if (!parent || !child || child === parent) return false;
  let cursor = child;
  let hops = 0;
  while (hops < 8) {
    const step = stripOneTokenSuffix(cursor);
    if (!step) return false;
    if (step.parentId === parent) return true;
    cursor = step.parentId;
    hops += 1;
  }
  return false;
}

function immediateStructuredParent(childId, idSet) {
  let cursor = String(childId || '');
  let hops = 0;
  let lastSuffix = null;
  while (cursor && hops < 8) {
    const step = stripOneTokenSuffix(cursor);
    if (!step) return null;
    lastSuffix = lastSuffix || step.suffix;
    if (!idSet || idSet[step.parentId]) {
      return {
        parentId: step.parentId,
        suffix: lastSuffix,
        relationType: suffixRelationType(lastSuffix),
        confidence: 'STRUCTURED',
      };
    }
    cursor = step.parentId;
    hops += 1;
  }
  return null;
}

function suffixRelationType(suffix) {
  const s = String(suffix || '');
  if (/^e\d{0,2}$/i.test(s) || s === 'e') return 'enchantment';
  if (/^[abc]$/i.test(s)) return 'choice';
  return 'token';
}

function collectStructuredRelations(cards) {
  const idSet = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    const id = cards[i] && cards[i].id;
    if (id) idSet[id] = true;
  }
  const edges = [];
  const seen = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    const child = cards[i];
    if (!child || !child.id) continue;
    const immediate = immediateStructuredParent(child.id, idSet);
    if (!immediate) continue;
    const key = immediate.parentId + '->' + child.id;
    if (seen[key]) continue;
    seen[key] = true;
    edges.push({
      parentCardId: immediate.parentId,
      relatedCardId: child.id,
      relationType: immediate.relationType,
      relationConfidence: 'STRUCTURED',
      source: 'cardId_token_suffix',
    });
  }
  return edges;
}

function collectExplicitRelations(cards) {
  const byDbf = Object.create(null);
  const byId = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || !card.id) continue;
    byId[card.id] = card;
    if (card.dbfId != null) byDbf[card.dbfId] = card;
  }
  const edges = [];
  const seen = Object.create(null);

  function add(parent, relatedId, relationType, source) {
    if (!parent || !relatedId || relatedId === parent.id) return;
    const key = parent.id + '->' + relatedId + ':' + relationType;
    if (seen[key]) return;
    seen[key] = true;
    edges.push({
      parentCardId: parent.id,
      relatedCardId: relatedId,
      relationType: relationType,
      relationConfidence: 'EXPLICIT',
      source: source,
    });
  }

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || !card.id) continue;
    if (card.heroPowerDbfId != null && byDbf[card.heroPowerDbfId]) {
      add(card, byDbf[card.heroPowerDbfId].id, 'hero_power', 'heroPowerDbfId');
    }
    if (card.battlegroundsBuddyDbfId != null && byDbf[card.battlegroundsBuddyDbfId]) {
      add(card, byDbf[card.battlegroundsBuddyDbfId].id, 'battlegrounds_buddy', 'battlegroundsBuddyDbfId');
    }
    if (card.battlegroundsRelatedCard != null && byDbf[card.battlegroundsRelatedCard]) {
      add(card, byDbf[card.battlegroundsRelatedCard].id, 'battlegrounds_related', 'battlegroundsRelatedCard');
    }
    if (card.battlegroundsSkinParentId != null && byDbf[card.battlegroundsSkinParentId]) {
      add(card, byDbf[card.battlegroundsSkinParentId].id, 'battlegrounds_skin_parent', 'battlegroundsSkinParentId');
    }
    if (card.questReward) {
      const rewardId = String(card.questReward);
      if (byId[rewardId]) add(card, rewardId, 'quest_reward', 'questReward');
    }
    if (Array.isArray(card.entourage)) {
      for (let j = 0; j < card.entourage.length; j++) {
        const eid = card.entourage[j];
        if (byId[eid]) add(card, eid, 'entourage', 'entourage');
      }
    }
  }
  return edges;
}

function collectCopyAliases(cards) {
  const byDbf = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (card && card.dbfId != null) byDbf[card.dbfId] = card;
  }
  const aliases = [];
  const seen = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || card.countAsCopyOfDbfId == null) continue;
    const src = byDbf[card.countAsCopyOfDbfId];
    if (!src || src.id === card.id) continue;
    const key = card.id + '->' + src.id;
    if (seen[key]) continue;
    seen[key] = true;
    aliases.push({
      cardId: card.id,
      aliasOf: src.id,
      relationType: 'count_as_copy',
      relationConfidence: 'EXPLICIT',
      source: 'countAsCopyOfDbfId',
    });
  }
  return aliases;
}

function mergePrimaryRelations(structured, explicit) {
  const edges = structured.slice();
  const seen = Object.create(null);
  for (let i = 0; i < edges.length; i++) {
    seen[edges[i].parentCardId + '->' + edges[i].relatedCardId] = true;
  }
  for (let i = 0; i < explicit.length; i++) {
    const edge = explicit[i];
    if (edge.relationType !== 'quest_reward' && edge.relationType !== 'entourage') continue;
    const key = edge.parentCardId + '->' + edge.relatedCardId;
    if (seen[key]) continue;
    seen[key] = true;
    edges.push(edge);
  }
  return edges;
}

function indexAudioFromRaw(raw) {
  const play = voicePlayable(raw && raw.voice && raw.voice.play);
  const attack = voicePlayable(raw && raw.voice && raw.voice.attack);
  const death = voicePlayable(raw && raw.voice && raw.voice.death);
  const music = musicPlayable(raw && raw.music);
  const entrance = !!(raw && raw.entrancePreview && raw.entrancePreview.available);
  const types = [];
  if (play) types.push('play');
  if (attack) types.push('attack');
  if (death) types.push('death');
  if (music) types.push('music');
  if (entrance) types.push('entrance');
  return {
    present: !!raw,
    play: play,
    attack: attack,
    death: death,
    music: music,
    entrance: entrance,
    hasVoice: play || attack || death,
    hasAny: types.length > 0,
    types: types,
    playVoiceKey: play ? raw.voice.play.voiceKey : null,
    playSourceCardId: play ? (raw.voice.play.sourceCardId || null) : null,
    musicSourceCardId: music ? (raw.music.sourceCardId || null) : null,
    musicAssetId: music ? (raw.music.musicAssetId || null) : null,
  };
}

function productionAudioForCard(cardId, inventory) {
  if (!inventory) {
    return { play: false, attack: false, death: false, music: false, entrance: false, hasVoice: false, hasAny: false, types: [] };
  }
  const play = inventory.hasVoice(cardId, 'play');
  const attack = inventory.hasVoice(cardId, 'attack');
  const death = inventory.hasVoice(cardId, 'death');
  const music = inventory.hasMusic(cardId);
  const entrance = inventory.hasEntrance(cardId);
  const types = [];
  if (play) types.push('play');
  if (attack) types.push('attack');
  if (death) types.push('death');
  if (music) types.push('music');
  if (entrance) types.push('entrance');
  return {
    play: play,
    attack: attack,
    death: death,
    music: music,
    entrance: entrance,
    hasVoice: play || attack || death,
    hasAny: types.length > 0,
    types: types,
  };
}

function clipPresent(clips, voiceKey) {
  if (!voiceKey || !clips) return false;
  const rec = clips[voiceKey];
  if (!rec) return false;
  const zh = rec.zhcnBundles && rec.zhcnBundles.length;
  const pb = rec.prefabBundles && rec.prefabBundles.length;
  return !!(zh || pb);
}

function buildClipLookup(clips) {
  const byPrefix = Object.create(null);
  if (!clips) return byPrefix;
  const keys = Object.keys(clips);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!clipPresent(clips, key)) continue;
    const prefixes = [];
    if (key.indexOf('VO_') === 0) {
      const rest = key.slice(3);
      const cut = rest.indexOf('_');
      if (cut > 0) prefixes.push('VO_' + rest.slice(0, cut) + '_');
    }
    const play = key.indexOf('_Play');
    const attack = key.indexOf('_Attack');
    const death = key.indexOf('_Death');
    const mark = play >= 0 ? play : (attack >= 0 ? attack : death);
    if (mark > 0) prefixes.push(key.slice(0, mark));
    for (let j = 0; j < prefixes.length; j++) {
      const p = prefixes[j];
      if (!byPrefix[p]) byPrefix[p] = [];
      if (byPrefix[p].indexOf(key) === -1) byPrefix[p].push(key);
    }
  }
  return byPrefix;
}

function findUnindexedClips(cardId, clipLookup) {
  if (!clipLookup || !cardId) return [];
  const groups = [
    clipLookup['VO_' + cardId + '_'] || [],
    clipLookup[cardId] || [],
  ];
  const hits = [];
  const seen = Object.create(null);
  for (let i = 0; i < groups.length; i++) {
    for (let j = 0; j < groups[i].length; j++) {
      const key = groups[i][j];
      if (seen[key]) continue;
      seen[key] = true;
      hits.push(key);
    }
  }
  return hits;
}

function noAudioExpected(hs, indexInfo) {
  const type = hs && hs.type;
  if (NO_AUDIO_TYPES[type]) return true;
  if (type === 'HERO' && !indexInfo.hasAny) return true;
  if (type === 'LOCATION' && !indexInfo.hasAny) return true;
  return false;
}

function exclusiveCategory(row) {
  if (row.production.hasAny && !row.index.hasAny) return 'AUDIO_EXISTS_NOT_ADVERTISED';
  if (row.production.hasAny && row.index.hasAny && !row.catalog.present) return 'AUDIO_EXISTS_NOT_ADVERTISED';
  if (row.catalog.present && row.index.hasAny && row.production.hasAny) return 'FULLY_AVAILABLE';
  if (row.index.hasAny && !row.production.hasAny) return 'MAPPING_EXISTS_PRODUCTION_MISSING';
  if (!row.index.hasAny && noAudioExpected(row.hs, row.index)) return 'NO_AUDIO_EXPECTED';
  if (row.isPrimaryRelated && !row.catalog.present) return 'RELATED_CARD_NOT_IN_CATALOG';
  if (!row.index.hasAny) return 'CARD_EXISTS_NO_AUDIO_MAPPING';
  return 'CARD_EXISTS_NO_AUDIO_MAPPING';
}

function relationGapKind(relatedRow) {
  if (relatedRow.index.hasAny && !relatedRow.production.hasAny) return 'AUDIO_INDEX_EXISTS_BUT_PRODUCTION_MISSING';
  if (!relatedRow.index.hasAny && relatedRow.unindexedClips.length) return 'AUDIO_EXISTS_BUT_UNINDEXED';
  if (!relatedRow.index.hasAny) return 'AUDIO_TRULY_ABSENT';
  return 'AUDIO_INDEXED';
}

function collectPhysicalStems(packageDir) {
  const stems = Object.create(null);
  if (!packageDir || !fs.existsSync(packageDir)) return stems;
  const kinds = ['voice', 'music', 'entrance'];
  for (let i = 0; i < kinds.length; i++) {
    const dir = path.join(packageDir, kinds[i]);
    if (!fs.existsSync(dir)) continue;
    const names = fs.readdirSync(dir);
    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      if (!/\.wav$/i.test(name)) continue;
      stems[name.replace(/\.wav$/i, '')] = kinds[i] + '/' + name;
    }
  }
  return stems;
}

function inferNameMentions(parent, cardsByName, alreadyRelated) {
  const text = String((parent.collectionText || parent.text || '')).replace(/<[^>]+>/g, '');
  if (!text) return [];
  const hits = [];
  const names = Object.keys(cardsByName);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name || name.length < 2) continue;
    if (name === parent.name) continue;
    if (text.indexOf(name) === -1) continue;
    const candidates = cardsByName[name] || [];
    for (let j = 0; j < candidates.length; j++) {
      const other = candidates[j];
      if (!other || other.id === parent.id) continue;
      if (alreadyRelated[parent.id + '->' + other.id]) continue;
      if (parent.set && other.set && parent.set !== other.set) continue;
      hits.push({
        parentCardId: parent.id,
        relatedCardId: other.id,
        relationType: 'text_name',
        relationConfidence: 'INFERRED',
        source: 'card_text_name',
      });
    }
  }
  return hits;
}

function groupCardsByName(cards) {
  const map = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || !card.name) continue;
    if (!map[card.name]) map[card.name] = [];
    map[card.name].push(card);
  }
  return map;
}

function summarizeParents(edges) {
  const byParent = Object.create(null);
  for (let i = 0; i < edges.length; i++) {
    const parentId = edges[i].parentCardId;
    if (!byParent[parentId]) byParent[parentId] = [];
    byParent[parentId].push(edges[i]);
  }
  const parentIds = Object.keys(byParent);
  let one = 0;
  let two = 0;
  let threePlus = 0;
  const relatedSet = Object.create(null);
  for (let i = 0; i < parentIds.length; i++) {
    const n = byParent[parentIds[i]].length;
    if (n === 1) one += 1;
    else if (n === 2) two += 1;
    else threePlus += 1;
    const kids = byParent[parentIds[i]];
    for (let j = 0; j < kids.length; j++) relatedSet[kids[j].relatedCardId] = true;
  }
  return {
    byParent: byParent,
    totalParents: parentIds.length,
    totalEdges: edges.length,
    totalRelated: Object.keys(relatedSet).length,
    with1: one,
    with2: two,
    with3Plus: threePlus,
    relatedSet: relatedSet,
  };
}

function cardIdentity(hs, audioRaw) {
  return {
    cardId: (hs && hs.id) || (audioRaw && audioRaw.id) || null,
    dbfId: (hs && hs.dbfId) != null ? hs.dbfId : (audioRaw && audioRaw.dbfId != null ? audioRaw.dbfId : null),
    name: (hs && hs.name) || (audioRaw && audioRaw.name) || null,
    set: (hs && hs.set) || (audioRaw && audioRaw.set) || null,
    type: (hs && hs.type) || (audioRaw && audioRaw.type) || null,
    collectible: !!(hs && hs.collectible === true) || !!(audioRaw && audioRaw.collectible === true),
    class: (hs && (hs.cardClass || hs.class)) || (audioRaw && audioRaw.class) || null,
  };
}

function collectDescendantEdges(parentId, byParent, seen) {
  const out = [];
  const kids = byParent[parentId] || [];
  for (let i = 0; i < kids.length; i++) {
    const edge = kids[i];
    if (seen[edge.relatedCardId]) continue;
    seen[edge.relatedCardId] = true;
    out.push(edge);
    const nested = collectDescendantEdges(edge.relatedCardId, byParent, seen);
    for (let j = 0; j < nested.length; j++) out.push(nested[j]);
  }
  return out;
}

function buildCase(parentId, ctx) {
  const parent = ctx.byId[parentId] || null;
  const parentHs = ctx.hsById[parentId] || null;
  const childEdges = collectDescendantEdges(parentId, ctx.primary.byParent, Object.create(null));
  const explicitExtra = ctx.explicit.filter((e) => e.parentCardId === parentId && e.relationType === 'hero_power');
  const sameName = [];
  const parentName = parentHs && parentHs.name;
  if (parentName && ctx.byName[parentName]) {
    for (let i = 0; i < ctx.byName[parentName].length; i++) {
      const other = ctx.byName[parentName][i];
      if (other.id === parentId) continue;
      sameName.push(cardIdentity(other, ctx.audioCards[other.id]));
    }
  }
  const related = childEdges.map((edge) => {
    const row = ctx.rows[edge.relatedCardId];
    return {
      cardId: edge.relatedCardId,
      name: row && row.identity.name,
      type: row && row.identity.type,
      collectible: row && row.identity.collectible,
      relationType: edge.relationType,
      relationConfidence: edge.relationConfidence,
      catalog: row && row.catalog,
      audioIndex: row && row.index.types,
      production: row && row.production.types,
      exclusiveCategory: row && row.exclusiveCategory,
      gapKind: row && relationGapKind(row),
      unindexedClips: row && row.unindexedClips,
    };
  });
  const inferred = inferNameMentions(parentHs || {}, ctx.byName, (function () {
    const map = Object.create(null);
    for (let i = 0; i < childEdges.length; i++) {
      map[parentId + '->' + childEdges[i].relatedCardId] = true;
    }
    return map;
  })());
  return {
    parent: Object.assign(cardIdentity(parentHs, parent), {
      catalog: ctx.rows[parentId] && ctx.rows[parentId].catalog,
      audioIndex: ctx.rows[parentId] && ctx.rows[parentId].index.types,
      production: ctx.rows[parentId] && ctx.rows[parentId].production.types,
      exclusiveCategory: ctx.rows[parentId] && ctx.rows[parentId].exclusiveCategory,
    }),
    related: related,
    heroPowerRelations: explicitExtra,
    sameNameUnrelated: sameName,
    inferredOnly: inferred,
  };
}

function runRelatedAudioAudit(opts) {
  opts = opts || {};
  const hsCards = Array.isArray(opts.hsCards) ? opts.hsCards : [];
  const audioCards = (opts.audioIndex && opts.audioIndex.cards) || {};
  const clips = (opts.clipIndex && opts.clipIndex.clips) || opts.clips || null;
  const inventory = opts.inventory || createProductionAudioInventory(opts.manifest || {});
  const now = opts.generatedAt || new Date().toISOString();

  const structured = collectStructuredRelations(hsCards);
  const explicit = collectExplicitRelations(hsCards);
  const primary = mergePrimaryRelations(structured, explicit);
  const copyAliases = collectCopyAliases(hsCards);
  const primaryStats = summarizeParents(primary);
  const explicitHero = explicit.filter((e) => e.relationType === 'hero_power');
  const explicitBg = explicit.filter((e) => String(e.relationType).indexOf('battlegrounds_') === 0);

  const hsById = Object.create(null);
  for (let i = 0; i < hsCards.length; i++) {
    if (hsCards[i] && hsCards[i].id) hsById[hsCards[i].id] = hsCards[i];
  }
  const byName = groupCardsByName(hsCards);

  const allIds = Object.create(null);
  for (let i = 0; i < hsCards.length; i++) {
    if (hsCards[i] && hsCards[i].id) allIds[hsCards[i].id] = true;
  }
  const audioIds = Object.keys(audioCards);
  for (let i = 0; i < audioIds.length; i++) allIds[audioIds[i]] = true;
  const clipLookup = buildClipLookup(clips);

  const rows = Object.create(null);
  const idList = Object.keys(allIds);
  for (let i = 0; i < idList.length; i++) {
    const id = idList[i];
    const hs = hsById[id] || null;
    const raw = audioCards[id] || null;
    const index = indexAudioFromRaw(raw);
    const production = productionAudioForCard(id, inventory);
    const catalog = { present: shouldPublish(raw || hs) };
    const isPrimaryRelated = !!primaryStats.relatedSet[id];
    const unindexedClips = (!index.hasVoice && clips) ? findUnindexedClips(id, clipLookup) : [];
    const aliases = [];
    if (index.playSourceCardId && index.playSourceCardId !== id) {
      aliases.push({ kind: 'voice_sourceCardId', from: id, to: index.playSourceCardId, voiceKey: index.playVoiceKey });
    }
    if (index.musicSourceCardId && index.musicSourceCardId !== id) {
      aliases.push({ kind: 'music_sourceCardId', from: id, to: index.musicSourceCardId, musicAssetId: index.musicAssetId });
    }
    if (index.playVoiceKey && index.playVoiceKey.indexOf(id) === -1) {
      aliases.push({ kind: 'voiceKey_not_cardId', from: id, voiceKey: index.playVoiceKey });
    }
    const row = {
      identity: cardIdentity(hs, raw),
      hs: hs,
      catalog: catalog,
      index: index,
      production: production,
      isPrimaryRelated: isPrimaryRelated,
      unindexedClips: unindexedClips,
      aliases: aliases,
    };
    row.exclusiveCategory = exclusiveCategory(row);
    rows[id] = row;
  }

  const categoryCounts = {
    FULLY_AVAILABLE: 0,
    MAPPING_EXISTS_PRODUCTION_MISSING: 0,
    CARD_EXISTS_NO_AUDIO_MAPPING: 0,
    RELATED_CARD_NOT_IN_CATALOG: 0,
    AUDIO_EXISTS_NOT_ADVERTISED: 0,
    NO_AUDIO_EXPECTED: 0,
  };
  const zeroAudio = {
    total: 0,
    collectible: 0,
    nonCollectible: 0,
    generatedToken: 0,
    byType: Object.create(null),
  };
  const productionMissing = [];
  const relatedNotInCatalog = [];
  const audioUnindexed = [];
  const aliasMappings = [];
  const seenAlias = Object.create(null);

  for (let i = 0; i < idList.length; i++) {
    const row = rows[idList[i]];
    if (categoryCounts[row.exclusiveCategory] != null) categoryCounts[row.exclusiveCategory] += 1;
    if (!row.index.hasAny) {
      zeroAudio.total += 1;
      if (row.identity.collectible) zeroAudio.collectible += 1;
      else zeroAudio.nonCollectible += 1;
      if (row.isPrimaryRelated) zeroAudio.generatedToken += 1;
      const t = row.identity.type || 'UNKNOWN';
      zeroAudio.byType[t] = (zeroAudio.byType[t] || 0) + 1;
    }
    if (row.index.hasAny && !row.production.hasAny) {
      productionMissing.push({
        cardId: row.identity.cardId,
        name: row.identity.name,
        type: row.identity.type,
        collectible: row.identity.collectible,
        catalogPresent: row.catalog.present,
        indexTypes: row.index.types,
        related: row.isPrimaryRelated,
      });
    }
    if (row.isPrimaryRelated && !row.catalog.present) {
      relatedNotInCatalog.push({
        cardId: row.identity.cardId,
        name: row.identity.name,
        type: row.identity.type,
        exclusiveCategory: row.exclusiveCategory,
        indexTypes: row.index.types,
      });
    }
    if (row.unindexedClips.length) {
      audioUnindexed.push({
        cardId: row.identity.cardId,
        name: row.identity.name,
        clips: row.unindexedClips,
      });
    }
    for (let a = 0; a < row.aliases.length; a++) {
      const al = row.aliases[a];
      const key = al.kind + ':' + al.from + ':' + (al.to || al.voiceKey || '');
      if (seenAlias[key]) continue;
      seenAlias[key] = true;
      aliasMappings.push(al);
    }
  }

  const parentAudioRelatedZero = [];
  const parentAudioRelatedZeroPlayable = [];
  const parentIds = Object.keys(primaryStats.byParent);
  for (let i = 0; i < parentIds.length; i++) {
    const parentRow = rows[parentIds[i]];
    if (!parentRow || !parentRow.index.hasAny) continue;
    const kids = primaryStats.byParent[parentIds[i]];
    for (let j = 0; j < kids.length; j++) {
      const childRow = rows[kids[j].relatedCardId];
      if (!childRow || childRow.index.hasAny) continue;
      const rec = {
        parentCardId: parentIds[i],
        parentName: parentRow.identity.name,
        relatedCardId: childRow.identity.cardId,
        relatedName: childRow.identity.name,
        relatedType: childRow.identity.type,
        relationType: kids[j].relationType,
        relationConfidence: kids[j].relationConfidence,
        parentAudioTypes: parentRow.index.types,
        relatedAudioTypes: childRow.index.types,
        catalogStatus: childRow.catalog.present ? 'in_catalog' : 'not_in_catalog',
        productionStatus: childRow.production.hasAny ? 'present' : 'missing',
        gapKind: relationGapKind(childRow),
        exclusiveCategory: childRow.exclusiveCategory,
      };
      parentAudioRelatedZero.push(rec);
      if (PLAYABLE_RELATED_TYPES[childRow.identity.type]) parentAudioRelatedZeroPlayable.push(rec);
    }
  }

  const ctx = {
    byId: audioCards,
    hsById: hsById,
    audioCards: audioCards,
    byName: byName,
    primary: primaryStats,
    explicit: explicit,
    rows: rows,
  };

  const sylvanas = buildCase('TIME_609', ctx);
  const rafaam = buildCase('TIME_005', ctx);

  const threePlus = parentIds.filter((id) => primaryStats.byParent[id].length >= 3).map((id) => ({
    parentCardId: id,
    parentName: rows[id] && rows[id].identity.name,
    relatedCount: primaryStats.byParent[id].length,
    collectible: rows[id] && rows[id].identity.collectible,
    related: primaryStats.byParent[id].map((e) => ({
      cardId: e.relatedCardId,
      name: rows[e.relatedCardId] && rows[e.relatedCardId].identity.name,
      type: rows[e.relatedCardId] && rows[e.relatedCardId].identity.type,
      relationType: e.relationType,
    })),
  }));
  threePlus.sort((a, b) => b.relatedCount - a.relatedCount || String(a.parentCardId).localeCompare(String(b.parentCardId)));

  return {
    phase: '2.10',
    mode: 'read-only-audit',
    generatedAt: now,
    cardDatabase: opts.cardDatabasePath || null,
    audioIndex: opts.audioIndexPath || null,
    productionManifest: opts.manifestPath || null,
    audioModel: {
      cardIdentity: ['id', 'dbfId', 'name', 'type', 'class', 'collectible', 'set'],
      voice: ['play', 'attack', 'death'],
      music: ['music.status', 'musicAssetId', 'audioClipName', 'sourceCardId'],
      entrance: ['entrancePreview.available = play AND music'],
      productionAvailability: 'catalog mapping AND production manifest',
      catalogPublish: 'collectible === true OR VERIFY_IDS',
    },
    relationRules: {
      explicitFieldsFound: ['heroPowerDbfId', 'questReward', 'battlegroundsBuddyDbfId', 'battlegroundsRelatedCard', 'battlegroundsSkinParentId', 'countAsCopyOfDbfId'],
      explicitFieldsAbsent: ['entourage', 'relatedCardDbfIds'],
      structured: 'cardId token suffix t/tN/a/b/c/e/eN, immediate parent only if prefix exists',
      projectIndexed: 'none for generated-card relations; sourceCardId is reprint/audio alias',
      inferred: 'same-set exact name mention in card text; never counted as confirmed missing',
      primaryGraph: 'structured token suffix + explicit questReward/entourage',
    },
    summary: {
      hsCardCount: hsCards.length,
      audioIndexCardCount: audioIds.length,
      primaryParents: primaryStats.totalParents,
      primaryEdges: primaryStats.totalEdges,
      primaryRelated: primaryStats.totalRelated,
      parentsWith1: primaryStats.with1,
      parentsWith2: primaryStats.with2,
      parentsWith3Plus: primaryStats.with3Plus,
      explicitHeroPowerEdges: explicitHero.length,
      explicitBattlegroundsEdges: explicitBg.length,
      copyAliases: copyAliases.length,
      zeroAudio: zeroAudio,
      categories: categoryCounts,
      parentWithAudioRelatedWithoutAudio: parentAudioRelatedZero.length,
      parentWithAudioRelatedWithoutAudioPlayable: parentAudioRelatedZeroPlayable.length,
      mappingProductionMissing: categoryCounts.MAPPING_EXISTS_PRODUCTION_MISSING,
      relatedCardNotInCatalog: relatedNotInCatalog.length,
      audioExistsButUnindexed: audioUnindexed.length,
      audioExistsNotAdvertised: categoryCounts.AUDIO_EXISTS_NOT_ADVERTISED,
    },
    cases: [
      { id: 'TIME_609', name: '游侠将军希尔瓦娜斯', detail: sylvanas },
      { id: 'TIME_005', name: '时空大盗拉法姆', detail: rafaam },
    ],
    relations: primary.map((e) => ({
      parentCardId: e.parentCardId,
      relatedCardId: e.relatedCardId,
      relationType: e.relationType,
      relationConfidence: e.relationConfidence,
      source: e.source,
    })),
    threePlusParents: threePlus.slice(0, 80),
    missingAudio: parentAudioRelatedZeroPlayable.slice(0, 80),
    missingAudioIncludingEnchantments: parentAudioRelatedZero.slice(0, 50),
    productionMissing: productionMissing.filter((r) => r.collectible || r.related).slice(0, 200),
    relatedNotInCatalog: relatedNotInCatalog.slice(0, 200),
    audioUnindexed: audioUnindexed.slice(0, 80),
    aliasMappings: aliasMappings.slice(0, 80),
    copyAliases: copyAliases.slice(0, 40),
    parentAudioRelatedZeroPlayable: parentAudioRelatedZeroPlayable.slice(0, 50),
    parentAudioRelatedZeroAll: parentAudioRelatedZero.slice(0, 50),
    categoryCounts: categoryCounts,
    _rows: rows,
    _primaryStats: primaryStats,
    _structured: structured,
    _explicit: explicit,
    _copyAliases: copyAliases,
  };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadProjectAuditInputs(root) {
  const cardDatabasePath = path.join(root, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
  const audioIndexPath = path.join(root, 'data', 'index', 'card-audio-index.json');
  const clipIndexPath = path.join(root, 'data', 'index', 'audio-index.json');
  const manifestPath = path.join(root, 'data', 'production-audio', 'manifest.json');
  const hsCards = loadJson(cardDatabasePath);
  const audioIndex = loadJson(audioIndexPath);
  const clipIndex = loadJson(clipIndexPath);
  const manifest = loadJson(manifestPath);
  return {
    hsCards: hsCards,
    audioIndex: audioIndex,
    clipIndex: clipIndex,
    manifest: manifest,
    inventory: createProductionAudioInventory(manifest),
    cardDatabasePath: cardDatabasePath,
    audioIndexPath: audioIndexPath,
    clipIndexPath: clipIndexPath,
    manifestPath: manifestPath,
    physicalStems: collectPhysicalStems(path.join(root, 'data', 'production-audio')),
  };
}

function runProjectRelatedAudioAudit(root, opts) {
  const inputs = loadProjectAuditInputs(root);
  return runRelatedAudioAudit(Object.assign({}, inputs, opts || {}));
}

function compactAuditJson(result) {
  const copy = Object.assign({}, result);
  delete copy._rows;
  delete copy._primaryStats;
  delete copy._structured;
  delete copy._explicit;
  delete copy._copyAliases;
  return copy;
}

function yn(v) {
  return v ? 'YES' : 'NO';
}

function renderMarkdown(result) {
  const s = result.summary;
  const syl = result.cases[0].detail;
  const raf = result.cases[1].detail;
  function relatedBlock(detail) {
    if (!detail.related.length) return 'None.';
    return detail.related.map((r, i) => {
      return (i + 1) + '. `' + r.cardId + '` ' + r.name
        + ' (' + r.type + ', collectible=' + r.collectible + ', ' + r.relationConfidence + '/' + r.relationType + ')'
        + ' catalog=' + yn(r.catalog && r.catalog.present)
        + ' index=[' + (r.audioIndex || []).join(',') + ']'
        + ' production=[' + (r.production || []).join(',') + ']'
        + ' gap=' + r.gapKind
        + ' category=' + r.exclusiveCategory;
    }).join('\n');
  }
  const playableD = result.parentAudioRelatedZeroPlayable || [];
  const three = (result.threePlusParents || []).slice(0, 20);
  return [
    '# Phase 2.10 Related / Generated Card Audio Integrity Audit',
    '',
    '## 1. Executive Summary',
    '',
    'This is a **read-only** audit. No production audio, catalog, index, or VPS files were modified.',
    '',
    'The current HSJSON snapshot has **no `entourage` / `relatedCardDbfIds` fields**. Confirmed generated-card relations therefore come from **structured cardId token suffixes** (`t` / `tN` / `a` / `b` / `c` / `e`) plus a small number of explicit `questReward` pointers.',
    '',
    '- Primary parents: **' + s.primaryParents + '**',
    '- Primary relation edges: **' + s.primaryEdges + '**',
    '- Related cards: **' + s.primaryRelated + '**',
    '- Parents with 3+ related: **' + s.parentsWith3Plus + '**',
    '- Zero-audio cards: **' + s.zeroAudio.total + '** (collectible ' + s.zeroAudio.collectible + ', non-collectible ' + s.zeroAudio.nonCollectible + ', generated/token ' + s.zeroAudio.generatedToken + ')',
    '- Mapping exists / production missing: **' + s.mappingProductionMissing + '**',
    '- Related card not in catalog: **' + s.relatedCardNotInCatalog + '**',
    '- Parent has index audio / related has none (playable types): **' + s.parentWithAudioRelatedWithoutAudioPlayable + '**',
    '- Audio exists but unindexed (clip-name probe): **' + s.audioExistsButUnindexed + '**',
    '',
    'Headline cases:',
    '',
    '- **游侠将军希尔瓦娜斯 (`TIME_609`)** has **2 structured minion tokens** with full unique voice mappings. They are **not in catalog** (`collectible=false`) and **not in production-audio**.',
    '- **时空大盗拉法姆 (`TIME_005`)** has **10 structured minion tokens** (9 siblings + 1 nested sheep) with voice mappings. Same catalog/production gap.',
    '- Both collectible parents themselves have **full audio-index mappings and zero production files**. In the miniapp this is `catalog mapping AND production manifest`, so users currently see **no playable audio** for these cards.',
    '',
    '## 2. Data Sources',
    '',
    '| Role | Path |',
    '|---|---|',
    '| Card database | `data/hearthstonejson/zhCN/cards.json` |',
    '| Audio index / catalog source | `data/index/card-audio-index.json` |',
    '| Production manifest | `data/production-audio/manifest.json` |',
    '| Clip metadata | `data/index/audio-index.json` |',
    '',
    'Catalog is built from `card-audio-index.json` via `shouldPublish` (collectible or `VERIFY_IDS`). It is not a second card database.',
    '',
    '## 3. Audio Model',
    '',
    '```',
    'CURRENT_AUDIO_MODEL',
    '',
    'Card identity: id, dbfId, name, type, class, rarity, collectible, set',
    'Voice mapping: voice.play / voice.attack / voice.death',
    '  available when status is available|shared AND voiceKey is set',
    'Music mapping: music.status available|shared AND audioClipName or musicAssetId',
    'Entrance mapping: entrancePreview.available = play mapping AND music mapping',
    'Production availability: overlay — catalog/index mapping AND production manifest',
    'Catalog availability: published only if collectible === true (plus VERIFY_IDS)',
    '```',
    '',
    'Phase 2.9-A rule is unchanged: advertised playable audio requires **both** index mapping and a production manifest entry. Mapping alone is not enough on the production miniapp.',
    '',
    '## 4. Relation Detection Rules',
    '',
    '| Level | Name | What this project actually has | Used in primary graph |',
    '|---|---|---|---|',
    '| 1 | EXPLICIT | `heroPowerDbfId`, `questReward`, Battlegrounds buddy/related/skin, `countAsCopyOfDbfId`. **`entourage` is absent.** | `questReward` / `entourage` only |',
    '| 2 | STRUCTURED | Immediate `cardId` token suffix when the prefix exists as another card | YES |',
    '| 3 | PROJECT_INDEXED | No parent→generated index. `sourceCardId` is reprint/shared-audio alias | NO (alias only) |',
    '| 4 | INFERRED | Same-set exact card-name mention in text | Reported, never counted as missing |',
    '',
    'Hero-power edges (' + s.explicitHeroPowerEdges + ') and Battlegrounds edges (' + s.explicitBattlegroundsEdges + ') are recorded but **excluded** from primary generated-card totals so skins and BG buddies do not inflate the graph.',
    '',
    '## 5. Sylvanas Case',
    '',
    'Collectible minion parent: `' + syl.parent.cardId + '` ' + syl.parent.name + ' set=' + syl.parent.set + ' type=' + syl.parent.type + ' dbfId=' + syl.parent.dbfId + '.',
    '',
    relatedBlock(syl),
    '',
    'Same-name cards that are **not** generated relations: ' + (syl.sameNameUnrelated.map((c) => '`' + c.cardId + '` ' + c.set + '/' + c.type).join('; ') || 'none') + '.',
    '',
    'Text mentions 奥蕾莉亚 / 温蕾萨. Those names are already covered by structured tokens `TIME_609t1` / `TIME_609t2`. They are not extra inferred edges.',
    '',
    'Enchantment `TIME_609t2e` 风行者之誓 has no voice mapping. That is expected for `ENCHANTMENT`.',
    '',
    '## 6. Rafaam Case',
    '',
    'Collectible minion parent: `' + raf.parent.cardId + '` ' + raf.parent.name + ' set=' + raf.parent.set + ' type=' + raf.parent.type + ' dbfId=' + raf.parent.dbfId + '.',
    '',
    relatedBlock(raf),
    '',
    'Same-name cards that are **not** generated relations: ' + (raf.sameNameUnrelated.map((c) => '`' + c.cardId + '` ' + c.set + '/' + c.type).join('; ') || 'none') + '.',
    '',
    '`TIME_005t9t` 拉法姆绵羊 is a nested token of `TIME_005t9`, then of `TIME_005`. Its voiceKeys are filename-style (`TIME_005t9t_Play`) rather than `VO_TIME_005t9t_...`. That is an alias/id mismatch, not a missing mapping.',
    '',
    '## 7. Global Relation Statistics',
    '',
    '| Metric | Count |',
    '|---|---|',
    '| TOTAL_PARENT_CARDS | ' + s.primaryParents + ' |',
    '| TOTAL_RELATION_EDGES | ' + s.primaryEdges + ' |',
    '| TOTAL_RELATED_CARDS | ' + s.primaryRelated + ' |',
    '| TOTAL_CARDS_WITH_1_RELATED | ' + s.parentsWith1 + ' |',
    '| TOTAL_CARDS_WITH_2_RELATED | ' + s.parentsWith2 + ' |',
    '| TOTAL_CARDS_WITH_3_PLUS_RELATED | ' + s.parentsWith3Plus + ' |',
    '',
    'Largest 3+ parents (first 20):',
    '',
    three.map((p) => '- `' + p.parentCardId + '` ' + p.parentName + ' → ' + p.relatedCount + ' (' + p.related.map((r) => r.cardId).join(', ') + ')').join('\n'),
    '',
    '## 8. Zero-Audio Cards',
    '',
    'Cards with no play/attack/death/music index mapping:',
    '',
    '| Slice | Count |',
    '|---|---|',
    '| TOTAL_CARDS_WITH_ZERO_AUDIO | ' + s.zeroAudio.total + ' |',
    '| collectible | ' + s.zeroAudio.collectible + ' |',
    '| non-collectible | ' + s.zeroAudio.nonCollectible + ' |',
    '| generated/token (primary related) | ' + s.zeroAudio.generatedToken + ' |',
    '',
    'By type: ' + Object.keys(s.zeroAudio.byType).sort().map((t) => t + '=' + s.zeroAudio.byType[t]).join(', ') + '.',
    '',
    'Zero audio is **not** automatically a bug. Enchantments, most hero skins, hero powers, locations, and many spells have no minion voice system.',
    '',
    '## 9. Parent-With-Audio / Related-Without-Audio',
    '',
    'Primary graph, parent has **audio-index** mapping, related has none.',
    '',
    '- All related types: **' + s.parentWithAudioRelatedWithoutAudio + '**',
    '- Playable types only (minion/spell/weapon/hero/location): **' + s.parentWithAudioRelatedWithoutAudioPlayable + '**',
    '',
    'Enchantments dominate the all-types list and are usually `NO_AUDIO_EXPECTED`. The playable-type list is the residual after that cut, but it is still **not** a list of missing Sylvanas-style token voices. Many rows are choice forms, spell/weapon tokens, or Battlegrounds tokens with no minion VO. TIME_609 / TIME_005 minion tokens do **not** appear here because they already have audio-index mappings.',
    '',
    'TOP playable residuals:',
    '',
    playableD.slice(0, 50).map((r, i) => (i + 1) + '. `' + r.parentCardId + '` ' + r.parentName + ' → `' + r.relatedCardId + '` ' + r.relatedName + ' (' + r.relatedType + ', ' + r.relationType + ', ' + r.gapKind + ')').join('\n') || 'None.',
    '',
    '## 10. Mapping Exists / Production Missing',
    '',
    'Exclusive category `MAPPING_EXISTS_PRODUCTION_MISSING`: **' + s.mappingProductionMissing + '**.',
    '',
    'This is the largest actionable bucket. TIME_TRAVEL parents and their voiced tokens sit here: the index already points at real zhCN clips, but `data/production-audio` was built from previously extracted featured/latest waves, not from this set.',
    '',
    '## 11. Related Card Missing From Catalog',
    '',
    'Related cards with `collectible !== true` are excluded by `shouldPublish`. Count: **' + s.relatedCardNotInCatalog + '**.',
    '',
    'This is **catalog modeling**, not a missing HSJSON row. Tokens exist in both `cards.json` and `card-audio-index.json`.',
    '',
    '## 12. Audio Exists But Unindexed',
    '',
    'Probe: card has no voice mapping, but `audio-index.json` has a clip named `VO_{cardId}_*` or `{cardId}_Play/Attack/Death`. Count: **' + s.audioExistsButUnindexed + '**.',
    '',
    'Treat as a hypothesis, not proof the card should speak. Clip-name coincidence can happen.',
    '',
    '## 13. Alias / ID Mapping',
    '',
    'Normal and expected:',
    '',
    '- `sourceCardId !== cardId` for shared reprints and shared music (tokens reuse parent stingers).',
    '- `voiceKey` may be `VO_{id}_...` or a filename stem such as `TIME_005t9t_Play` / `JAIL_*_Play`. File stem != cardId is **not** missing audio.',
    '- `countAsCopyOfDbfId` is a reprint/copy pointer, not a generated-card relation (' + s.copyAliases + ' rows).',
    '',
    '## 14. False Positive Risks',
    '',
    '1. Treating hero skins (`HERO_05z`, `HERO_07bk`) as generated forms of the minion. Same Chinese name, different id/set/type. **Rejected.**',
    '2. Treating every `heroPowerDbfId` as a generated atlas card. **Excluded from primary graph.**',
    '3. Treating Battlegrounds buddy/skin/related pointers as constructed-token relations. **Excluded from primary graph.**',
    '4. Treating enchantment suffixes (`e` / `e2`) as missing voices. Usually `NO_AUDIO_EXPECTED`.',
    '5. Treating card-text “召唤 XX” as a database relation. **INFERRED only.**',
    '6. Assuming catalog absence means the card is absent from the database. Tokens are present; catalog simply does not publish non-collectibles.',
    '7. Assuming production absence means the clip was never indexed. For TIME_609 / TIME_005 families the clips **are** indexed.',
    '',
    '## 15. Recommended Next Phase',
    '',
    'RECOMMENDED_NEXT_ACTION (do not execute in 2.10):',
    '',
    '1. Extend catalog/relation model so a collectible parent can list structured tokens (`TIME_609t1`, `TIME_609t2`, `TIME_005t*`).',
    '2. Decide product policy: publish voiced tokens in the atlas, or only show them on the parent detail page.',
    '3. If those tokens should be playable in production, expand the production-audio package to include their already-indexed voiceKeys (and parent TIME_TRAVEL audio).',
    '4. Re-run production availability after any package change.',
    '5. Do **not** extract from Windows Hearthstone or rewrite catalog publish rules in this phase.',
    '',
    '## 16. Safety / Change Summary',
    '',
    '- production-audio: NOT MODIFIED',
    '- manifest: NOT MODIFIED',
    '- extractor: NOT CALLED',
    '- Hearthstone install: NOT ACCESSED',
    '- VPS / Nginx / systemd / env: NOT MODIFIED',
    '- git commit / push: NOT DONE',
    '',
    '## Q&A',
    '',
    '### Q1 游侠将军希尔瓦娜斯是否有明确关联卡？',
    '',
    '**YES** — structured tokens `TIME_609t1` 游侠队长奥蕾莉亚, `TIME_609t2` 游侠新兵温蕾萨, plus expected enchantment `TIME_609t2e` 风行者之誓. Hero skin `HERO_05z` is the same name only.',
    '',
    '### Q2 这些关联卡是否存在于当前 catalog？',
    '',
    '**NO** for the tokens/enchantment (`collectible=false`). Parent `TIME_609` **is** published. Hero skin `HERO_05z` is collectible and therefore catalog-eligible, but it is not a generated child.',
    '',
    '### Q3 这些关联卡是否存在 audio index？',
    '',
    '**YES** for both minion tokens (own play/attack/death + shared parent music). Enchantment: **NO** mapping (expected).',
    '',
    '### Q4 这些关联卡是否存在 production-audio？',
    '',
    '**NO**. Parent `TIME_609` is also absent from the production manifest.',
    '',
    '### Q5 时空大盗拉法姆是否有明确关联卡？',
    '',
    '**YES** — `TIME_005t1`…`TIME_005t9` plus nested `TIME_005t9t`, and enchantments `TIME_005t2e` / `TIME_005t8e`. Hero skin `HERO_07bk` is same-name only.',
    '',
    '### Q6 这些关联卡是否存在音频？',
    '',
    '**Index YES / production NO** for the minion tokens. Enchantments have no mapping. Parent also index YES / production NO.',
    '',
    '### Q7 全项目数量',
    '',
    '- zero-audio cards: **' + s.zeroAudio.total + '**',
    '- related cards without audio (playable types / all types): **' + s.parentWithAudioRelatedWithoutAudioPlayable + ' / ' + s.parentWithAudioRelatedWithoutAudio + '**',
    '- mapping-but-production-missing: **' + s.mappingProductionMissing + '**',
    '- audio-but-unindexed: **' + s.audioExistsButUnindexed + '**',
    '- related-card-not-in-catalog: **' + s.relatedCardNotInCatalog + '**',
    '',
    '### Q8 这些问题分别是什么性质？',
    '',
    '| Observation | Nature |',
    '|---|---|',
    '| Tokens missing from catalog | Catalog modeling (`shouldPublish` = collectible only) |',
    '| TIME_609 / TIME_005 and voiced tokens have index but no WAV in production-audio | Production package did not include those already-indexed clips |',
    '| Enchantments / most hero skins / hero powers have no mapping | Normal no-audio |',
    '| Parent has audio and a playable related card has none | Residual true index gap; see playable D list |',
    '| Clip-name probe hits | Hypothesis only |',
    '',
    'Generated at `' + result.generatedAt + '`.',
    '',
  ].join('\n');
}

module.exports = {
  TOKEN_SUFFIX_RE,
  stripOneTokenSuffix,
  isStructuredTokenChild,
  immediateStructuredParent,
  collectStructuredRelations,
  collectExplicitRelations,
  collectCopyAliases,
  mergePrimaryRelations,
  indexAudioFromRaw,
  productionAudioForCard,
  exclusiveCategory,
  relationGapKind,
  inferNameMentions,
  runRelatedAudioAudit,
  loadProjectAuditInputs,
  runProjectRelatedAudioAudit,
  compactAuditJson,
  renderMarkdown,
  collectPhysicalStems,
  buildClipLookup,
  findUnindexedClips,
};
