'use strict';

const fs = require('fs');
const path = require('path');
const { voicePlayable } = require('../miniprogram/catalogAdapter.js');
const { RELATED_DEPTH_MAX } = require('../miniprogram/relatedCards.js');
const {
  FOCUS_12,
  PLAYABLE_TYPES,
  snapshotProduction,
  isForbiddenCandidate,
  isBattlegroundsCard,
} = require('./relatedAudioProductionAudit.js');
const {
  UI_SLICE,
  MAX_DEPTH,
  collectUiVisible,
} = require('./relatedAudioDiscovery.js');

const VOICE_TYPES = ['play', 'attack', 'death'];
const G_JSON = path.join('data', 'card-verification', 'phase-2.10-G-related-audio-discovery.json');
const EXPECTED_SHA = 'a7cd2e1e923348123064e4f67dafe1aa255a266576871ae47493f90569376bec';
const BATCH_CARD_MIN = 5;
const BATCH_CARD_MAX = 20;
const BATCH_SLOT_MAX = 50;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isHeroSkin(raw) {
  return !!(raw && raw.set === 'HERO_SKINS');
}

function emptySlot() {
  return {
    indexed: false,
    voiceKey: null,
    productionAvailable: false,
    sourceKnown: false,
    missingReason: 'NO_MAPPING',
    status: 'NO_MAPPING',
    alias: false,
    ambiguous: false,
    conflict: false,
  };
}

function buildSlotMap(g) {
  const map = Object.create(null);
  function ensure(id) {
    if (!map[id]) {
      map[id] = {
        play: emptySlot(),
        attack: emptySlot(),
        death: emptySlot(),
      };
    }
    return map[id];
  }
  (g.noMapping || []).forEach((row) => {
    const rec = ensure(row.cardId)[row.slot];
    if (!rec) return;
    rec.indexed = false;
    rec.missingReason = 'NO_MAPPING';
    rec.status = 'NO_MAPPING';
  });
  (g.alreadyPresent || []).forEach((row) => {
    const rec = ensure(row.cardId)[row.slot];
    if (!rec) return;
    rec.indexed = true;
    rec.voiceKey = row.voiceKey || null;
    rec.productionAvailable = true;
    rec.sourceKnown = true;
    rec.missingReason = null;
    rec.status = 'ALREADY_PRESENT';
  });
  (g.sourceMissing || []).forEach((row) => {
    const rec = ensure(row.cardId)[row.slot];
    if (!rec) return;
    rec.indexed = true;
    rec.voiceKey = row.voiceKey || null;
    rec.productionAvailable = false;
    rec.sourceKnown = false;
    rec.missingReason = 'SOURCE_MISSING';
    rec.status = 'SOURCE_MISSING';
  });
  (g.conflicts || []).forEach((row) => {
    const rec = ensure(row.cardId)[row.slot];
    if (!rec) return;
    rec.conflict = true;
    rec.status = 'CONFLICT';
  });
  return map;
}

function buildVoiceKeyIndex(cards) {
  const byKey = Object.create(null);
  Object.keys(cards || {}).forEach((id) => {
    const raw = cards[id];
    VOICE_TYPES.forEach((type) => {
      const slot = raw && raw.voice && raw.voice[type];
      if (!voicePlayable(slot) || !slot.voiceKey) return;
      if (!byKey[slot.voiceKey]) byKey[slot.voiceKey] = [];
      byKey[slot.voiceKey].push({ cardId: id, type: type, set: raw.set, cardType: raw.type });
    });
  });
  return byKey;
}

function slotFlags(slots, voiceKeyIndex) {
  let ambiguous = 0;
  let conflict = 0;
  let heroSkin = 0;
  VOICE_TYPES.forEach((type) => {
    const s = slots[type];
    if (!s) return;
    if (s.status === 'AMBIGUOUS' || s.ambiguous) ambiguous += 1;
    if (s.status === 'CONFLICT' || s.conflict) conflict += 1;
    if (s.voiceKey && voiceKeyIndex[s.voiceKey]) {
      if (voiceKeyIndex[s.voiceKey].some((o) => o.set === 'HERO_SKINS')) {
        s.heroSkinCollision = true;
        heroSkin += 1;
      }
    }
  });
  return { ambiguous: ambiguous, conflict: conflict, heroSkin: heroSkin };
}

function indexedCount(slots) {
  return VOICE_TYPES.filter((t) => slots[t] && slots[t].indexed).length;
}

function missingExtractable(slots) {
  return VOICE_TYPES.filter((t) => {
    const s = slots[t];
    return s && s.indexed && s.productionAvailable === false && s.missingReason === 'SOURCE_MISSING';
  });
}

function classifyCardPriority(input) {
  const reasons = [];
  if (input.excluded) {
    return { priority: 'EXCLUDED', reasons: input.excludeReasons || ['EXCLUDED'] };
  }
  const slots = input.audioSlots;
  const flags = input.flags || { ambiguous: 0, conflict: 0, heroSkin: 0 };
  if (FOCUS_12.indexOf(input.cardId) >= 0) {
    reasons.push('HISTORICAL_12');
    return { priority: 'ALREADY_COMPLETE', reasons: reasons };
  }
  const indexed = indexedCount(slots);
  const missing = missingExtractable(slots);
  const allProd = indexed > 0 && VOICE_TYPES.every((t) => {
    const s = slots[t];
    return !s.indexed || s.productionAvailable === true;
  });
  if (allProd) {
    reasons.push('ALL_INDEXED_IN_PRODUCTION');
    return { priority: 'ALREADY_COMPLETE', reasons: reasons };
  }
  if (flags.ambiguous || flags.conflict || flags.heroSkin) {
    if (flags.ambiguous) reasons.push('AMBIGUOUS');
    if (flags.conflict) reasons.push('CONFLICT');
    if (flags.heroSkin) reasons.push('HERO_SKIN_COLLISION');
    return { priority: 'EXCLUDED', reasons: reasons };
  }

  const playable = !!PLAYABLE_TYPES[input.cardType];
  const structured = input.relationKind === 'STRUCTURED' || input.relationKind === 'PROJECT_INDEXED';
  const uiDepthOk = input.depth <= RELATED_DEPTH_MAX;
  const playProd = !!(slots.play && slots.play.indexed && slots.play.productionAvailable);
  const attackMiss = missing.indexOf('attack') >= 0;
  const deathMiss = missing.indexOf('death') >= 0;

  if (input.uiVisible && playable && structured && uiDepthOk && playProd && (attackMiss || deathMiss) && indexed === 3) {
    reasons.push('UI_VISIBLE');
    reasons.push('PLAY_PRESENT_ATTACK_OR_DEATH_MISSING');
    return { priority: 'P2', reasons: reasons };
  }
  if (indexed === 1 && missing.length) {
    reasons.push('SINGLE_VOICE_SLOT');
    return { priority: 'P3', reasons: reasons };
  }
  if (input.uiVisible && playable && structured && uiDepthOk && missing.length) {
    reasons.push('UI_VISIBLE');
    reasons.push('INDEXED_SOURCE_MISSING');
    return { priority: 'P0', reasons: reasons };
  }
  if (!input.uiVisible && playable && structured && uiDepthOk && missing.length) {
    reasons.push('UI_HIDDEN');
    reasons.push('DEPTH_WITHIN_UI');
    reasons.push('INDEXED_SOURCE_MISSING');
    return { priority: 'P1', reasons: reasons };
  }
  reasons.push('LOW_VALUE_OR_UNMAPPED');
  return { priority: 'P4', reasons: reasons };
}

function familyStats(cards) {
  const missingPlay = cards.filter((c) => missingExtractable(c.audioSlots).indexOf('play') >= 0).length;
  const missingAttack = cards.filter((c) => missingExtractable(c.audioSlots).indexOf('attack') >= 0).length;
  const missingDeath = cards.filter((c) => missingExtractable(c.audioSlots).indexOf('death') >= 0).length;
  const missingSlots = cards.reduce((n, c) => n + missingExtractable(c.audioSlots).length, 0);
  const uiVisible = cards.filter((c) => c.uiVisible).length;
  const ambiguous = cards.reduce((n, c) => n + ((c.flags && c.flags.ambiguous) || 0), 0);
  const conflict = cards.reduce((n, c) => n + ((c.flags && c.flags.conflict) || 0), 0);
  const heroSkin = cards.reduce((n, c) => n + ((c.flags && c.flags.heroSkin) || 0), 0);
  const p0 = cards.filter((c) => c.priority === 'P0');
  const complete = cards.every((c) => c.priority === 'ALREADY_COMPLETE');
  const threeSlotP0 = p0.length > 0 && p0.every((c) => indexedCount(c.audioSlots) === 3);
  return {
    CARD_COUNT: cards.length,
    UI_VISIBLE_CARD_COUNT: uiVisible,
    MISSING_SLOT_COUNT: missingSlots,
    PLAY_MISSING: missingPlay,
    ATTACK_MISSING: missingAttack,
    DEATH_MISSING: missingDeath,
    AMBIGUOUS_COUNT: ambiguous,
    CONFLICT_COUNT: conflict,
    HERO_SKIN_COLLISION: heroSkin,
    P0_COUNT: p0.length,
    THREE_SLOT_P0: threeSlotP0,
    ALREADY_COMPLETE: complete,
  };
}

function familyReady(stats) {
  return stats.AMBIGUOUS_COUNT === 0
    && stats.CONFLICT_COUNT === 0
    && stats.HERO_SKIN_COLLISION === 0
    && stats.P0_COUNT > 0
    && stats.THREE_SLOT_P0;
}

function familyScore(fam) {
  const s = fam.stats;
  if (!s.P0_COUNT) return -1;
  let score = 0;
  if (s.THREE_SLOT_P0) score += 100000;
  if (s.AMBIGUOUS_COUNT === 0 && s.CONFLICT_COUNT === 0 && s.HERO_SKIN_COLLISION === 0) score += 50000;
  if (s.CARD_COUNT <= 12) score += 10000;
  if (s.CARD_COUNT <= 8) score += 3000;
  if (s.UI_VISIBLE_CARD_COUNT === s.P0_COUNT) score += 2000;
  score += s.UI_VISIBLE_CARD_COUNT * 20;
  score += s.PLAY_MISSING * 5;
  score -= s.CARD_COUNT;
  return score;
}

function selectFirstBatch(families) {
  const ranked = families
    .filter((f) => f.stats.P0_COUNT > 0)
    .slice()
    .sort((a, b) => familyScore(b) - familyScore(a) || String(a.rootParentId).localeCompare(String(b.rootParentId)));

  const blocked = [];
  const eligible = [];
  ranked.forEach((fam) => {
    if (!familyReady(fam.stats)) {
      blocked.push({
        rootParentId: fam.rootParentId,
        name: fam.name,
        reason: fam.stats.AMBIGUOUS_COUNT ? 'AMBIGUOUS'
          : fam.stats.CONFLICT_COUNT ? 'CONFLICT'
            : fam.stats.HERO_SKIN_COLLISION ? 'HERO_SKIN_COLLISION'
              : 'NOT_THREE_SLOT_P0',
        stats: fam.stats,
      });
      return;
    }
    eligible.push(fam);
  });

  if (!eligible.length) {
    return {
      status: ranked.some((f) => f.stats.P0_COUNT > 0) ? 'FAMILY_BLOCKED' : 'NO_P0_CANDIDATE',
      exceedsDefault: false,
      families: [],
      cards: [],
      blockedFamilies: blocked,
    };
  }

  const first = eligible[0];
  const firstP0 = first.cards.filter((c) => c.priority === 'P0');
  const firstSlots = firstP0.reduce((n, c) => n + missingExtractable(c.audioSlots).length, 0);
  if (firstP0.length > BATCH_CARD_MAX || firstSlots > BATCH_SLOT_MAX) {
    return {
      status: 'BATCH_SIZE_EXCEEDS_DEFAULT',
      exceedsDefault: true,
      families: [first.rootParentId],
      cards: firstP0,
      blockedFamilies: blocked,
      exceed: { cards: firstP0.length, slots: firstSlots, family: first.rootParentId },
    };
  }

  const chosen = [];
  let cardN = 0;
  let slotN = 0;
  for (let i = 0; i < eligible.length; i++) {
    const fam = eligible[i];
    const p0 = fam.cards.filter((c) => c.priority === 'P0');
    const slots = p0.reduce((n, c) => n + missingExtractable(c.audioSlots).length, 0);
    if (cardN + p0.length > BATCH_CARD_MAX || slotN + slots > BATCH_SLOT_MAX) continue;
    chosen.push(fam);
    cardN += p0.length;
    slotN += slots;
    if (cardN >= BATCH_CARD_MIN) break;
  }
  if (!chosen.length) {
    return {
      status: 'BATCH_SIZE_EXCEEDS_DEFAULT',
      exceedsDefault: true,
      families: [],
      cards: [],
      blockedFamilies: blocked,
    };
  }
  const cards = [];
  chosen.forEach((fam) => {
    fam.cards.filter((c) => c.priority === 'P0').forEach((c) => cards.push(c));
  });
  return {
    status: 'SELECTED',
    exceedsDefault: false,
    families: chosen.map((f) => f.rootParentId),
    cards: cards,
    blockedFamilies: blocked,
  };
}

function buildSlotPlan(cards) {
  const plan = [];
  cards.forEach((card) => {
    missingExtractable(card.audioSlots).forEach((slot) => {
      const s = card.audioSlots[slot];
      plan.push({
        cardId: card.cardId,
        slot: slot,
        voiceKey: s.voiceKey,
        indexed: true,
        productionAvailable: false,
        sourceKnown: false,
        priority: card.priority,
        family: card.rootParentId,
      });
    });
  });
  return plan;
}

function runExtractionPriority(opts) {
  opts = opts || {};
  const root = opts.root;
  const gPath = opts.gJsonPath || path.join(root, G_JSON);
  if (!fs.existsSync(gPath)) {
    return { blocked: true, blockReason: 'PHASE_2_10_G_DISCOVERY_MISSING' };
  }
  const baseline = snapshotProduction(root);

  const g = opts.gJson || loadJson(gPath);
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const cardsMap = (unified && unified.cards) || {};
  const ui = collectUiVisible(unified);
  const slotMap = buildSlotMap(g);
  const voiceKeyIndex = buildVoiceKeyIndex(cardsMap);
  const focusSet = Object.create(null);
  FOCUS_12.forEach((id) => { focusSet[id] = true; });

  const excludedSummary = {
    ENCHANTMENT: 0,
    HERO_POWER: 0,
    BATTLEGROUNDS: 0,
    HERO_SKIN: 0,
    INFERRED: 0,
    OTHER: 0,
  };
  const gFilters = g.filters || {};
  excludedSummary.ENCHANTMENT = gFilters.enchantment || 0;
  excludedSummary.HERO_POWER = gFilters.heroPower || 0;
  excludedSummary.BATTLEGROUNDS = gFilters.battlegrounds || 0;
  excludedSummary.HERO_SKIN = gFilters.heroSkin || 0;
  excludedSummary.INFERRED = gFilters.inferred || 0;
  excludedSummary.OTHER = gFilters.other || 0;

  const items = (g.candidates && g.candidates.items) || [];
  const priorityCards = items.map((item) => {
    const raw = cardsMap[item.relatedCardId] || {};
    const slots = slotMap[item.relatedCardId] || {
      play: emptySlot(),
      attack: emptySlot(),
      death: emptySlot(),
    };
    VOICE_TYPES.forEach((type) => {
      if (slots[type].indexed && !slots[type].voiceKey) {
        const vs = raw.voice && raw.voice[type];
        if (voicePlayable(vs)) slots[type].voiceKey = vs.voiceKey;
      }
    });
    const flags = slotFlags(slots, voiceKeyIndex);
    const excludeReasons = [];
    if (isForbiddenCandidate(raw)) {
      if (raw.type === 'ENCHANTMENT') excludeReasons.push('ENCHANTMENT');
      else if (raw.type === 'HERO_POWER') excludeReasons.push('HERO_POWER');
      else if (isBattlegroundsCard(raw)) excludeReasons.push('BATTLEGROUNDS');
      else if (isHeroSkin(raw)) excludeReasons.push('HERO_SKIN');
      else excludeReasons.push('UNPLAYABLE_TYPE');
    }
    if (item.relationSource === 'INFERRED') excludeReasons.push('INFERRED');
    const classified = classifyCardPriority({
      cardId: item.relatedCardId,
      cardType: item.cardType || raw.type,
      relationKind: item.relationSource || 'STRUCTURED',
      uiVisible: !!ui.visible[item.relatedCardId],
      uiDisplayable: !!ui.displayable[item.relatedCardId],
      depth: item.depth,
      audioSlots: slots,
      flags: flags,
      excluded: excludeReasons.length > 0,
      excludeReasons: excludeReasons,
    });
    return {
      cardId: item.relatedCardId,
      dbfId: raw.dbfId == null ? null : raw.dbfId,
      name: item.relatedName || raw.name || item.relatedCardId,
      parentId: item.parentCardId,
      rootParentId: item.parentCardId,
      parentName: item.parentName || item.parentCardId,
      depth: item.depth,
      cardType: item.cardType || raw.type || 'UNKNOWN',
      set: raw.set || null,
      collectible: item.collectible === true,
      relationKind: item.relationSource || 'STRUCTURED',
      uiVisible: !!ui.visible[item.relatedCardId],
      uiDisplayable: !!ui.displayable[item.relatedCardId],
      audioSlots: slots,
      productionSlots: {
        play: !!(slots.play && slots.play.productionAvailable),
        attack: !!(slots.attack && slots.attack.productionAvailable),
        death: !!(slots.death && slots.death.productionAvailable),
      },
      missingSlots: missingExtractable(slots),
      sourceStatus: missingExtractable(slots).length ? 'SOURCE_MISSING' : (indexedCount(slots) ? 'PRODUCTION_OR_PARTIAL' : 'NO_MAPPING'),
      flags: flags,
      priority: classified.priority,
      priorityReasons: classified.reasons,
    };
  });

  const byPriority = { P0: [], P1: [], P2: [], P3: [], P4: [], EXCLUDED: [], ALREADY_COMPLETE: [] };
  priorityCards.forEach((c) => {
    if (!byPriority[c.priority]) byPriority[c.priority] = [];
    byPriority[c.priority].push(c);
  });

  const familiesMap = Object.create(null);
  priorityCards.forEach((c) => {
    const key = c.rootParentId;
    if (!familiesMap[key]) {
      familiesMap[key] = {
        rootParentId: key,
        name: c.parentName,
        cards: [],
      };
    }
    familiesMap[key].cards.push(c);
  });
  const families = Object.keys(familiesMap).sort().map((key) => {
    const fam = familiesMap[key];
    fam.stats = familyStats(fam.cards);
    const prios = fam.cards.map((c) => c.priority);
    if (fam.stats.ALREADY_COMPLETE) fam.priority = 'ALREADY_COMPLETE';
    else if (prios.indexOf('P0') >= 0) fam.priority = 'P0';
    else if (prios.indexOf('P2') >= 0) fam.priority = 'P2';
    else if (prios.indexOf('P1') >= 0) fam.priority = 'P1';
    else if (prios.indexOf('P3') >= 0) fam.priority = 'P3';
    else if (prios.indexOf('EXCLUDED') >= 0 && prios.every((p) => p === 'EXCLUDED')) fam.priority = 'EXCLUDED';
    else fam.priority = 'P4';
    fam.ready = familyReady(fam.stats);
    fam.gap = fam.stats.MISSING_SLOT_COUNT > 0;
    return fam;
  });

  const p0Families = families.filter((f) => f.priority === 'P0');
  const gapFamilies = families.filter((f) => f.gap && f.priority !== 'ALREADY_COMPLETE');
  const batch = selectFirstBatch(families);
  const slotPlan = buildSlotPlan(batch.cards || []);

  const enchantInBatch = (batch.cards || []).filter((c) => c.cardType === 'ENCHANTMENT').length;
  const hpInBatch = (batch.cards || []).filter((c) => c.cardType === 'HERO_POWER').length;
  const bgInBatch = (batch.cards || []).filter((c) => isBattlegroundsCard({ type: c.cardType, set: c.set })).length;
  const completeInBatch = (batch.cards || []).filter((c) => focusSet[c.cardId] || c.priority === 'ALREADY_COMPLETE').length;
  const allIndexed = slotPlan.every((s) => s.indexed === true);
  const allKeys = slotPlan.every((s) => !!s.voiceKey);
  const planAmbiguous = (batch.cards || []).reduce((n, c) => n + ((c.flags && c.flags.ambiguous) || 0), 0);
  const planConflict = (batch.cards || []).reduce((n, c) => n + ((c.flags && c.flags.conflict) || 0), 0);
  const planSkin = (batch.cards || []).reduce((n, c) => n + ((c.flags && c.flags.heroSkin) || 0), 0);
  const prodTrue = slotPlan.filter((s) => s.productionAvailable === true).length;

  let ready = false;
  let blockReason = null;
  if (batch.status === 'NO_P0_CANDIDATE') {
    blockReason = 'NO_P0_CANDIDATE';
  } else if (batch.status === 'FAMILY_BLOCKED') {
    blockReason = 'FAMILY_BLOCKED';
  } else if (batch.status === 'BATCH_SIZE_EXCEEDS_DEFAULT') {
    blockReason = 'BATCH_SIZE_EXCEEDS_DEFAULT';
  } else if (!(batch.cards || []).length || !slotPlan.length) {
    blockReason = 'EMPTY_BATCH';
  } else if (!allIndexed || !allKeys) {
    blockReason = 'UNRESOLVED_VOICE_KEYS';
  } else if (planAmbiguous || planConflict || planSkin || enchantInBatch || hpInBatch || bgInBatch || completeInBatch || prodTrue) {
    blockReason = 'BATCH_SAFETY_FAILED';
  } else {
    ready = true;
  }

  const topFamilies = families
    .filter((f) => f.stats.MISSING_SLOT_COUNT > 0 && f.priority !== 'EXCLUDED')
    .slice()
    .sort((a, b) => {
      const pa = a.priority === 'P0' ? 0 : a.priority === 'P2' ? 1 : a.priority === 'P1' ? 2 : 3;
      const pb = b.priority === 'P0' ? 0 : b.priority === 'P2' ? 1 : b.priority === 'P1' ? 2 : 3;
      if (pa !== pb) return pa - pb;
      return familyScore(b) - familyScore(a);
    })
    .slice(0, 10)
    .map((f) => ({
      ROOT_PARENT: f.rootParentId,
      NAME: f.name,
      CARD_COUNT: f.stats.CARD_COUNT,
      UI_VISIBLE: f.stats.UI_VISIBLE_CARD_COUNT,
      MISSING_PLAY: f.stats.PLAY_MISSING,
      MISSING_ATTACK: f.stats.ATTACK_MISSING,
      MISSING_DEATH: f.stats.DEATH_MISSING,
      TOTAL_MISSING: f.stats.MISSING_SLOT_COUNT,
      PRIORITY: f.priority,
      AMBIGUOUS: f.stats.AMBIGUOUS_COUNT,
      READY: f.ready,
    }));

  const slotGap = { play: 0, attack: 0, death: 0, sourceMissing: 0, noMapping: 0, productionMissing: 0, alreadyCompleteCards: byPriority.ALREADY_COMPLETE.length };
  priorityCards.forEach((c) => {
    VOICE_TYPES.forEach((t) => {
      const s = c.audioSlots[t];
      if (!s.indexed) slotGap.noMapping += 1;
      else if (!s.productionAvailable) {
        slotGap.productionMissing += 1;
        slotGap[t] += 1;
        if (s.missingReason === 'SOURCE_MISSING') slotGap.sourceMissing += 1;
      }
    });
  });

  return {
    blocked: false,
    phase: '2.10-I',
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceDiscovery: 'phase-2.10-G-related-audio-discovery.json',
      relationModel: 'structured+playable as in Phase 2.10-D/G',
      extractor: 'NOT_CALLED',
      hearthstone: 'NOT_ACCESSED',
    },
    productionBaseline: {
      files: baseline.files,
      voice: baseline.voice,
      music: baseline.music,
      entrance: baseline.entrance,
      bytes: baseline.bytes,
      manifestSha256: baseline.manifestSha256,
    },
    relationBaseline: g.relationSummary || g.relation || {},
    uiBaseline: {
      UI_DEPTH_LIMIT: RELATED_DEPTH_MAX,
      AUDIT_DEPTH_LIMIT: MAX_DEPTH,
      UI_CARD_LIMIT: UI_SLICE,
      UI_VISIBLE_COUNT: priorityCards.filter((c) => c.uiVisible).length,
      UI_HIDDEN_COUNT: priorityCards.filter((c) => !c.uiVisible).length,
      LEGAL_RELATED_CARDS: priorityCards.length,
    },
    prioritySummary: {
      P0_CARDS: byPriority.P0.length,
      P0_FAMILIES: families.filter((f) => f.priority === 'P0').length,
      P1_CARDS: byPriority.P1.length,
      P1_FAMILIES: families.filter((f) => f.priority === 'P1').length,
      P2_CARDS: byPriority.P2.length,
      P2_FAMILIES: families.filter((f) => f.priority === 'P2').length,
      P3_CARDS: byPriority.P3.length,
      P3_FAMILIES: families.filter((f) => f.priority === 'P3').length,
      P4_CARDS: byPriority.P4.length,
      P4_FAMILIES: families.filter((f) => f.priority === 'P4').length,
      EXCLUDED: byPriority.EXCLUDED.length,
      ALREADY_COMPLETE: byPriority.ALREADY_COMPLETE.length,
    },
    audioGap: {
      TOTAL_SLOT_CANDIDATES: priorityCards.length * 3,
      PLAY: slotGap.play,
      ATTACK: slotGap.attack,
      DEATH: slotGap.death,
      ALREADY_COMPLETE: slotGap.alreadyCompleteCards,
      PRODUCTION_MISSING: slotGap.productionMissing,
      SOURCE_MISSING: slotGap.sourceMissing,
      NO_MAPPING: slotGap.noMapping,
    },
    priorityCards: priorityCards,
    families: families.map((f) => ({
      rootParentId: f.rootParentId,
      name: f.name,
      priority: f.priority,
      ready: f.ready,
      stats: f.stats,
      cardIds: f.cards.map((c) => c.cardId),
    })),
    topPriorityFamilies: topFamilies,
    firstBatch: {
      status: batch.status,
      exceedsDefault: !!batch.exceedsDefault,
      families: batch.families,
      cards: (batch.cards || []).map((c) => c.cardId),
      cardCount: (batch.cards || []).length,
      slotCount: slotPlan.length,
      play: slotPlan.filter((s) => s.slot === 'play').length,
      attack: slotPlan.filter((s) => s.slot === 'attack').length,
      death: slotPlan.filter((s) => s.slot === 'death').length,
      exceed: batch.exceed || null,
    },
    firstBatchSlotPlan: slotPlan,
    blockedFamilies: batch.blockedFamilies || [],
    excludedSummary: excludedSummary,
    familySummary: {
      FAMILY_TOTAL: families.length,
      FAMILY_WITH_GAP: gapFamilies.length,
      P0_FAMILIES: p0Families.length,
      P1_FAMILIES: families.filter((f) => f.priority === 'P1').length,
    },
    readiness: {
      READY_FOR_PHASE_2_10_I_1: ready,
      BLOCK_REASON: blockReason,
      FIRST_BATCH_CARD_COUNT: (batch.cards || []).length,
      FIRST_BATCH_SLOT_COUNT: slotPlan.length,
      ALL_INDEXED: allIndexed,
      ALL_VOICE_KEYS_RESOLVED: allKeys,
      AMBIGUOUS: planAmbiguous,
      CONFLICT: planConflict,
      HERO_SKIN_COLLISION: planSkin,
      ENCHANTMENT_CONTAMINATION: enchantInBatch,
      BG_CONTAMINATION: bgInBatch,
      HERO_POWER_CONTAMINATION: hpInBatch,
      ALREADY_COMPLETE_INCLUDED: completeInBatch,
      PRODUCTION_AVAILABLE_IN_PLAN: prodTrue,
    },
  };
}

function renderPriorityMarkdown(result, extra) {
  extra = extra || {};
  const s = result.prioritySummary || {};
  const u = result.uiBaseline || {};
  const a = result.audioGap || {};
  const b = result.firstBatch || {};
  const r = result.readiness || {};
  const pb = result.productionBaseline || {};
  const lines = [
    '# Phase 2.10-I Related Audio Extraction Priority Audit',
    '',
    '========================================',
    'PHASE 2.10-I RELATED AUDIO EXTRACTION PRIORITY AUDIT',
    '========================================',
    '',
    'STATUS=' + (extra.status || (result.blocked ? 'BLOCKED' : 'COMPLETE_VERIFIED')),
    '',
    'GIT_HEAD=' + (extra.gitHead || ''),
    'WORKTREE=' + (extra.worktree || ''),
    '',
    'This phase is a read-only priority audit. It did not call the extractor,',
    'did not access C:\\Hearthstone, did not copy WAV files, did not modify',
    'production-audio or manifest.json, did not modify the VPS, and did not commit or push.',
    'The first batch is a candidate list only. Phase 2.10-I-1 requires explicit user confirmation.',
    '',
    '----------------------------------------',
    'PRODUCTION BASELINE',
    '----------------------------------------',
    '',
    'FILES=' + pb.files,
    'VOICE=' + pb.voice,
    'MUSIC=' + pb.music,
    'ENTRANCE=' + pb.entrance,
    'MANIFEST_SHA=' + pb.manifestSha256,
    'PRODUCTION_MUTATION=' + (extra.mutation || 'NO'),
    '',
    '----------------------------------------',
    'RELATION / UI',
    '----------------------------------------',
    '',
    'LEGAL_RELATED_CARDS=' + u.LEGAL_RELATED_CARDS,
    'UI_VISIBLE=' + u.UI_VISIBLE_COUNT,
    'UI_HIDDEN=' + u.UI_HIDDEN_COUNT,
    'UI_DEPTH_LIMIT=' + u.UI_DEPTH_LIMIT,
    'AUDIT_DEPTH_LIMIT=' + u.AUDIT_DEPTH_LIMIT,
    'UI_CARD_LIMIT=' + u.UI_CARD_LIMIT,
    '',
    'UI hidden candidates are legal related cards that are beyond the first-12 parent slice',
    'or otherwise not attached in the current card-page tree. They must not be mixed into P0.',
    '',
    '----------------------------------------',
    'AUDIO GAP',
    '----------------------------------------',
    '',
    'TOTAL_SLOT_CANDIDATES=' + a.TOTAL_SLOT_CANDIDATES,
    'PLAY_MISSING_INDEXED=' + a.PLAY,
    'ATTACK_MISSING_INDEXED=' + a.ATTACK,
    'DEATH_MISSING_INDEXED=' + a.DEATH,
    'ALREADY_COMPLETE=' + a.ALREADY_COMPLETE,
    'PRODUCTION_MISSING=' + a.PRODUCTION_MISSING,
    'SOURCE_MISSING=' + a.SOURCE_MISSING,
    'NO_MAPPING=' + a.NO_MAPPING,
    '',
    '----------------------------------------',
    'PRIORITY SUMMARY',
    '----------------------------------------',
    '',
    'P0_CARDS=' + s.P0_CARDS,
    'P0_FAMILIES=' + s.P0_FAMILIES,
    'P1_CARDS=' + s.P1_CARDS,
    'P1_FAMILIES=' + s.P1_FAMILIES,
    'P2_CARDS=' + s.P2_CARDS,
    'P2_FAMILIES=' + s.P2_FAMILIES,
    'P3_CARDS=' + s.P3_CARDS,
    'P3_FAMILIES=' + s.P3_FAMILIES,
    'P4_CARDS=' + s.P4_CARDS,
    'P4_FAMILIES=' + s.P4_FAMILIES,
    'EXCLUDED=' + s.EXCLUDED,
    'ALREADY_COMPLETE=' + s.ALREADY_COMPLETE,
    '',
    '----------------------------------------',
    'TOP PRIORITY FAMILIES',
    '----------------------------------------',
    '',
  ];
  (result.topPriorityFamilies || []).forEach((f, i) => {
    lines.push((i + 1) + '. ROOT_PARENT=' + f.ROOT_PARENT);
    lines.push('   NAME=' + f.NAME);
    lines.push('   CARD_COUNT=' + f.CARD_COUNT + ' UI_VISIBLE=' + f.UI_VISIBLE);
    lines.push('   MISSING_PLAY=' + f.MISSING_PLAY + ' MISSING_ATTACK=' + f.MISSING_ATTACK + ' MISSING_DEATH=' + f.MISSING_DEATH);
    lines.push('   TOTAL_MISSING=' + f.TOTAL_MISSING + ' PRIORITY=' + f.PRIORITY + ' AMBIGUOUS=' + f.AMBIGUOUS + ' READY=' + f.READY);
    lines.push('');
  });
  lines.push('----------------------------------------');
  lines.push('FIRST BATCH');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('STATUS=' + b.status);
  lines.push('FAMILIES=' + (b.families || []).join(','));
  lines.push('CARDS=' + b.cardCount);
  lines.push('SLOTS=' + b.slotCount);
  lines.push('PLAY=' + b.play);
  lines.push('ATTACK=' + b.attack);
  lines.push('DEATH=' + b.death);
  lines.push('CARD_LIST=' + (b.cards || []).join(','));
  lines.push('SLOT_PLAN_FILE=data/card-verification/phase-2.10-I-extraction-priority.json');
  if (b.exceedsDefault) lines.push('BATCH_SIZE_EXCEEDS_DEFAULT=YES');
  lines.push('');
  lines.push('The first batch is a candidate only. Do not extract until the user confirms Phase 2.10-I-1.');
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('READINESS');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('READY_FOR_PHASE_2_10_I_1=' + r.READY_FOR_PHASE_2_10_I_1);
  lines.push('BLOCK_REASON=' + (r.BLOCK_REASON || 'NONE'));
  lines.push('ALL_INDEXED=' + r.ALL_INDEXED);
  lines.push('ALL_VOICE_KEYS_RESOLVED=' + r.ALL_VOICE_KEYS_RESOLVED);
  lines.push('AMBIGUOUS=' + r.AMBIGUOUS);
  lines.push('CONFLICT=' + r.CONFLICT);
  lines.push('HERO_SKIN_COLLISION=' + r.HERO_SKIN_COLLISION);
  lines.push('ENCHANTMENT_CONTAMINATION=' + r.ENCHANTMENT_CONTAMINATION);
  lines.push('BG_CONTAMINATION=' + r.BG_CONTAMINATION);
  lines.push('ALREADY_COMPLETE_INCLUDED=' + r.ALREADY_COMPLETE_INCLUDED);
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('SAFETY');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('EXTRACTOR=NOT_CALLED');
  lines.push('C:\\Hearthstone=NOT_ACCESSED');
  lines.push('WAV_COPIED=0');
  lines.push('PRODUCTION_AUDIO_MODIFIED=NO');
  lines.push('MANIFEST_MODIFIED=NO');
  lines.push('VPS=NOT_MODIFIED');
  lines.push('NGINX=NOT_MODIFIED');
  lines.push('SYSTEMD=NOT_MODIFIED');
  lines.push('ENV=NOT_MODIFIED');
  lines.push('GIT_COMMIT=NO');
  lines.push('GIT_PUSH=NO');
  lines.push('');
  lines.push('PHASE_2_10_I=' + (extra.status || 'COMPLETE_VERIFIED'));
  lines.push('NEXT_PHASE=' + (r.READY_FOR_PHASE_2_10_I_1 ? 'PHASE_2_10_I_1_REQUIRES_CONFIRMATION' : 'READY_FOR_USER_REVIEW'));
  lines.push('');
  return lines.join('\n') + '\n';
}

module.exports = {
  FOCUS_12,
  RELATED_DEPTH_MAX,
  UI_SLICE,
  BATCH_CARD_MIN,
  BATCH_CARD_MAX,
  BATCH_SLOT_MAX,
  EXPECTED_SHA,
  classifyCardPriority,
  selectFirstBatch,
  buildSlotPlan,
  missingExtractable,
  familyReady,
  runExtractionPriority,
  renderPriorityMarkdown,
};
