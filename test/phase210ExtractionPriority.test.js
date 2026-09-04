'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { shouldDisplayRelatedEdge } = require('../src/miniprogram/relatedCards.js');
const {
  isForbiddenCandidate,
  isBattlegroundsCard,
  snapshotProduction,
  FOCUS_12,
} = require('../src/audit/relatedAudioProductionAudit.js');
const {
  RELATED_DEPTH_MAX,
  UI_SLICE,
  classifyCardPriority,
  selectFirstBatch,
  buildSlotPlan,
  missingExtractable,
  runExtractionPriority,
} = require('../src/audit/phase210ExtractionPriority.js');
const { createProductionAudioInventory } = require('../src/services/productionAudioAvailability.js');

const ROOT = path.resolve(__dirname, '..');
const inventory = createProductionAudioInventory(JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'production-audio', 'manifest.json'), 'utf8')
));

assert.strictEqual(RELATED_DEPTH_MAX, 2);
assert.strictEqual(UI_SLICE, 12);
assert.strictEqual(FOCUS_12.length, 12);
assert.strictEqual(isForbiddenCandidate({ type: 'ENCHANTMENT' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO_POWER' }), true);
assert.strictEqual(isBattlegroundsCard({ type: 'BATTLEGROUND_HERO_BUDDY' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO', set: 'HERO_SKINS' }), true);
assert.strictEqual(shouldDisplayRelatedEdge({
  relationConfidence: 'INFERRED',
  relationType: 'text_name',
}, { type: 'MINION' }), false);

function slots(spec) {
  function one(st) {
    if (st === 'missing') {
      return {
        indexed: true,
        voiceKey: 'VO_X',
        productionAvailable: false,
        sourceKnown: false,
        missingReason: 'SOURCE_MISSING',
        status: 'SOURCE_MISSING',
      };
    }
    if (st === 'present') {
      return {
        indexed: true,
        voiceKey: 'VO_X',
        productionAvailable: true,
        sourceKnown: true,
        missingReason: null,
        status: 'ALREADY_PRESENT',
      };
    }
    return {
      indexed: false,
      voiceKey: null,
      productionAvailable: false,
      sourceKnown: false,
      missingReason: 'NO_MAPPING',
      status: 'NO_MAPPING',
    };
  }
  return {
    play: one(spec.play),
    attack: one(spec.attack),
    death: one(spec.death),
  };
}

const p0 = classifyCardPriority({
  cardId: 'TOK_1',
  cardType: 'MINION',
  relationKind: 'STRUCTURED',
  uiVisible: true,
  depth: 1,
  audioSlots: slots({ play: 'missing', attack: 'missing', death: 'missing' }),
  flags: { ambiguous: 0, conflict: 0, heroSkin: 0 },
});
assert.strictEqual(p0.priority, 'P0');

const p1 = classifyCardPriority({
  cardId: 'TOK_2',
  cardType: 'MINION',
  relationKind: 'STRUCTURED',
  uiVisible: false,
  depth: 2,
  audioSlots: slots({ play: 'missing', attack: 'missing', death: 'missing' }),
  flags: { ambiguous: 0, conflict: 0, heroSkin: 0 },
});
assert.strictEqual(p1.priority, 'P1');

const p2 = classifyCardPriority({
  cardId: 'TOK_3',
  cardType: 'MINION',
  relationKind: 'STRUCTURED',
  uiVisible: true,
  depth: 1,
  audioSlots: slots({ play: 'present', attack: 'missing', death: 'missing' }),
  flags: { ambiguous: 0, conflict: 0, heroSkin: 0 },
});
assert.strictEqual(p2.priority, 'P2');

const p3 = classifyCardPriority({
  cardId: 'TOK_4',
  cardType: 'MINION',
  relationKind: 'STRUCTURED',
  uiVisible: true,
  depth: 1,
  audioSlots: slots({ play: 'missing', attack: 'none', death: 'none' }),
  flags: { ambiguous: 0, conflict: 0, heroSkin: 0 },
});
assert.strictEqual(p3.priority, 'P3');

const hist = classifyCardPriority({
  cardId: 'TIME_609t1',
  cardType: 'MINION',
  relationKind: 'STRUCTURED',
  uiVisible: true,
  depth: 1,
  audioSlots: slots({ play: 'present', attack: 'present', death: 'present' }),
  flags: { ambiguous: 0, conflict: 0, heroSkin: 0 },
});
assert.strictEqual(hist.priority, 'ALREADY_COMPLETE');

const amb = classifyCardPriority({
  cardId: 'TOK_A',
  cardType: 'MINION',
  relationKind: 'STRUCTURED',
  uiVisible: true,
  depth: 1,
  audioSlots: slots({ play: 'missing', attack: 'missing', death: 'missing' }),
  flags: { ambiguous: 1, conflict: 0, heroSkin: 0 },
});
assert.strictEqual(amb.priority, 'EXCLUDED');

assert.ok(p0.priority === 'P0' && p1.priority === 'P1', 'UI visible ranks above UI hidden');

function fakeFam(id, n, readyP0) {
  const cards = [];
  for (let i = 0; i < n; i++) {
    const audioSlots = slots({ play: 'missing', attack: 'missing', death: 'missing' });
    cards.push({
      cardId: id + 't' + i,
      cardType: 'MINION',
      set: 'CORE',
      priority: 'P0',
      uiVisible: true,
      rootParentId: id,
      audioSlots: audioSlots,
      flags: { ambiguous: readyP0 ? 0 : 1, conflict: 0, heroSkin: 0 },
      missingSlots: missingExtractable(audioSlots),
    });
  }
  return {
    rootParentId: id,
    name: id,
    cards: cards,
    stats: {
      CARD_COUNT: n,
      UI_VISIBLE_CARD_COUNT: n,
      MISSING_SLOT_COUNT: n * 3,
      PLAY_MISSING: n,
      ATTACK_MISSING: n,
      DEATH_MISSING: n,
      AMBIGUOUS_COUNT: readyP0 ? 0 : 1,
      CONFLICT_COUNT: 0,
      HERO_SKIN_COLLISION: 0,
      P0_COUNT: n,
      THREE_SLOT_P0: true,
      ALREADY_COMPLETE: false,
    },
  };
}

const blockedSel = selectFirstBatch([fakeFam('BAD', 2, false)]);
assert.strictEqual(blockedSel.status, 'FAMILY_BLOCKED');
assert.strictEqual(blockedSel.cards.length, 0);

const noP0 = selectFirstBatch([{
  rootParentId: 'X',
  name: 'X',
  cards: [{ cardId: 'X1', priority: 'P1', audioSlots: slots({ play: 'missing', attack: 'missing', death: 'missing' }), flags: { ambiguous: 0, conflict: 0, heroSkin: 0 } }],
  stats: {
    CARD_COUNT: 1,
    UI_VISIBLE_CARD_COUNT: 0,
    MISSING_SLOT_COUNT: 3,
    PLAY_MISSING: 1,
    ATTACK_MISSING: 1,
    DEATH_MISSING: 1,
    AMBIGUOUS_COUNT: 0,
    CONFLICT_COUNT: 0,
    HERO_SKIN_COLLISION: 0,
    P0_COUNT: 0,
    THREE_SLOT_P0: false,
    ALREADY_COMPLETE: false,
  },
}]);
assert.strictEqual(noP0.status, 'NO_P0_CANDIDATE');

const before = snapshotProduction(ROOT);
const live = runExtractionPriority({ root: ROOT });
const after = snapshotProduction(ROOT);
assert.strictEqual(before.manifestSha256, after.manifestSha256);
assert.strictEqual(before.files, after.files);
assert.strictEqual(before.bytes, after.bytes);
assert.strictEqual(live.blocked, false);
// Live production advances with each authorized deployment (e.g. L-3B TIME_609
// BGM raised music 200 -> 201; manifest is git-ignored deployment state, its
// integrity is verified by test:production). Regression protection = the
// pre-TIME_609 count stays a floor and TIME_609 music stays pinned.
assert.ok(live.productionBaseline.music >= 200, 'music must not regress below pre-TIME_609 floor');
assert.strictEqual(inventory.hasMusic('TIME_609'), true, 'TIME_609 BGM must stay deployed');
// PHASE 2.10-L-2C deployed 831 entrance assets globally (98 -> 929).
assert.strictEqual(live.productionBaseline.entrance, 929);
assert.strictEqual(live.productionBaseline.manifestSha256, before.manifestSha256);

FOCUS_12.forEach((id) => {
  assert.ok(live.firstBatch.cards.indexOf(id) < 0, 'historical 12 in first batch: ' + id);
  const row = live.priorityCards.find((c) => c.cardId === id);
  assert.ok(row, 'missing historical card ' + id);
  assert.strictEqual(row.priority, 'ALREADY_COMPLETE');
});

live.firstBatch.cards.forEach((id) => {
  const row = live.priorityCards.find((c) => c.cardId === id);
  assert.notStrictEqual(row.cardType, 'ENCHANTMENT');
  assert.notStrictEqual(row.cardType, 'HERO_POWER');
  assert.strictEqual(isBattlegroundsCard({ type: row.cardType, set: row.set }), false);
  assert.strictEqual(row.priority, 'P0');
  assert.strictEqual(row.uiVisible, true);
});

live.firstBatchSlotPlan.forEach((s) => {
  assert.strictEqual(s.indexed, true);
  assert.ok(s.voiceKey);
  assert.strictEqual(s.productionAvailable, false);
  assert.strictEqual(s.sourceKnown, false);
});

assert.strictEqual(live.readiness.AMBIGUOUS, 0);
if (live.readiness.READY_FOR_PHASE_2_10_I_1) {
  assert.strictEqual(live.readiness.CONFLICT, 0);
  assert.strictEqual(live.readiness.HERO_SKIN_COLLISION, 0);
  assert.strictEqual(live.readiness.ENCHANTMENT_CONTAMINATION, 0);
  assert.strictEqual(live.readiness.BG_CONTAMINATION, 0);
  assert.strictEqual(live.readiness.ALREADY_COMPLETE_INCLUDED, 0);
  assert.ok(live.firstBatch.cardCount > 0);
  assert.ok(live.firstBatch.slotCount > 0);
}

const p0Cards = live.priorityCards.filter((c) => c.priority === 'P0');
assert.strictEqual(live.prioritySummary.P0_CARDS, p0Cards.length);
assert.strictEqual(live.prioritySummary.P1_CARDS, live.priorityCards.filter((c) => c.priority === 'P1').length);
assert.strictEqual(live.prioritySummary.P2_CARDS, live.priorityCards.filter((c) => c.priority === 'P2').length);
assert.ok(p0Cards.every((c) => c.uiVisible === true));
const p1Cards = live.priorityCards.filter((c) => c.priority === 'P1');
assert.ok(p1Cards.every((c) => c.uiVisible === false));

const plan = buildSlotPlan(live.firstBatch.cards.map((id) => live.priorityCards.find((c) => c.cardId === id)).filter(Boolean));
assert.strictEqual(plan.length, live.firstBatchSlotPlan.length);

console.log('ok phase210ExtractionPriority', {
  p0: live.prioritySummary.P0_CARDS,
  p1: live.prioritySummary.P1_CARDS,
  firstBatch: live.firstBatch.cardCount,
  ready: live.readiness.READY_FOR_PHASE_2_10_I_1,
});
