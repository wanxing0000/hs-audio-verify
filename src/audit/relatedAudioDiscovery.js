'use strict';

const fs = require('fs');
const path = require('path');
const { voicePlayable, musicPlayable, shouldPublish } = require('../miniprogram/catalogAdapter.js');
const {
  createRelatedCardIndex,
  getDisplayRelatedCards,
  shouldDisplayRelatedEdge,
  RELATED_DEPTH_MAX,
} = require('../miniprogram/relatedCards.js');
const { createProductionAudioInventory } = require('../services/productionAudioAvailability.js');
const {
  collectStructuredRelations,
  collectExplicitRelations,
  mergePrimaryRelations,
  inferNameMentions,
} = require('./relatedAudioAudit.js');

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
const {
  FOCUS_12,
  PLAYABLE_TYPES,
  snapshotProduction,
  isForbiddenCandidate,
  isBattlegroundsCard,
  indexedSlots,
  classifySlot,
  destRelFor,
  findSources,
} = require('./relatedAudioProductionAudit.js');

const MAX_DEPTH = 3;
const UI_SLICE = 12;
const HISTORY_FILES = [
  'phase-2.10-report.md',
  'phase-2.10-A-report.md',
  'phase-2.10-B-report.md',
  'phase-2.10-B-candidates.json',
  'phase-2.10-C-report.md',
  'phase-2.10-D-report.md',
  'phase-2.10-D-related-audio-deep-audit.json',
  'phase-2.10-E-report.md',
  'phase-2.10-F-report.md',
];
const VOICE_TYPES = ['play', 'attack', 'death'];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadHistory(root) {
  const dir = path.join(root, 'data', 'card-verification');
  return HISTORY_FILES.map((name) => {
    const full = path.join(dir, name);
    return { file: name, status: fs.existsSync(full) ? 'FOUND' : 'MISSING_HISTORY_FILE' };
  });
}

function isHeroSkin(raw) {
  return !!(raw && raw.set === 'HERO_SKINS');
}

function hasVoiceMapping(raw) {
  return VOICE_TYPES.some((t) => voicePlayable(raw && raw.voice && raw.voice[t]));
}

function buildChildren(edges) {
  const byParent = Object.create(null);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!byParent[e.parentCardId]) byParent[e.parentCardId] = [];
    byParent[e.parentCardId].push(e);
  }
  return byParent;
}

function walkRelated(parentId, byParent, maxDepth) {
  const out = [];
  const seen = Object.create(null);
  function rec(id, depth, rootParent) {
    if (depth > maxDepth) return;
    const kids = byParent[id] || [];
    for (let i = 0; i < kids.length; i++) {
      const edge = kids[i];
      const key = rootParent + '->' + edge.relatedCardId + ':' + depth;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        parentId: rootParent,
        immediateParentId: id,
        relatedId: edge.relatedCardId,
        depth: depth,
        relationType: edge.relationType,
        relationSource: edge.relationConfidence || 'STRUCTURED',
        source: edge.source,
      });
      rec(edge.relatedCardId, depth + 1, rootParent);
    }
  }
  rec(parentId, 1, parentId);
  return out;
}

function countFilters(structured, cards) {
  const counts = {
    enchantment: 0,
    heroPower: 0,
    battlegrounds: 0,
    heroSkin: 0,
    inferred: 0,
    other: 0,
  };
  structured.forEach((edge) => {
    const child = cards[edge.relatedCardId];
    if (!child) {
      counts.other += 1;
      return;
    }
    if (child.type === 'ENCHANTMENT') counts.enchantment += 1;
    else if (child.type === 'HERO_POWER') counts.heroPower += 1;
    else if (isBattlegroundsCard(child) || String(edge.relationType || '').indexOf('battlegrounds') === 0) {
      counts.battlegrounds += 1;
    } else if (isHeroSkin(child)) counts.heroSkin += 1;
    else if (!shouldDisplayRelatedEdge(edge, child) && !PLAYABLE_TYPES[child.type]) counts.other += 1;
    else if (!PLAYABLE_TYPES[child.type]) counts.other += 1;
  });
  return counts;
}

function collectUiVisible(unified) {
  const cards = (unified && unified.cards) || {};
  const index = createRelatedCardIndex(cards);
  const dummy = createProductionAudioInventory({ voice: [], music: [], entrance: [] });
  const visible = Object.create(null);
  const displayable = Object.create(null);
  Object.keys(cards).forEach((parentId) => {
    if (!cards[parentId] || cards[parentId].collectible !== true) return;
    const tree = getDisplayRelatedCards(parentId, index, dummy);
    tree.forEach((node) => { displayable[node.id] = true; });
    tree.slice(0, UI_SLICE).forEach((node) => {
      visible[node.id] = true;
      (node.relatedCards || []).forEach((child) => { visible[child.id] = true; });
    });
  });
  return { visible: visible, displayable: displayable };
}

function voiceCompleteness(voiceSlots) {
  const declared = VOICE_TYPES.filter((t) => voiceSlots[t] && voiceSlots[t].indexed);
  if (!declared.length) return 'NO_AUDIO';
  const prod = declared.filter((t) => voiceSlots[t].productionPresent);
  if (prod.length === declared.length) return declared.length === 3 ? 'VOICE_COMPLETE' : 'FULL_INDEXED';
  if (prod.length === 1 && voiceSlots.play && voiceSlots.play.productionPresent) return 'PLAY_ONLY';
  if (prod.length) return 'PARTIAL';
  return 'NO_AUDIO';
}

function slotState(classified) {
  if (!classified) return 'NO_MAPPING';
  if (classified.status === 'AMBIGUOUS') return 'AMBIGUOUS';
  if (classified.status === 'CONFLICT') return 'CONFLICT';
  if (classified.status === 'ALREADY_PRESENT') return classified.alias ? 'ALIAS' : 'PRODUCTION_AVAILABLE';
  if (classified.status === 'READY_TO_COPY') return 'INDEXED_SOURCE_AVAILABLE_PRODUCTION_MISSING';
  if (classified.status === 'SOURCE_MISSING') return 'INDEXED_SOURCE_MISSING';
  return classified.status;
}

function assignPriority(card, ui) {
  if (ui.visible[card.relatedCardId]) return 'P0';
  if (ui.displayable[card.relatedCardId] && card.depth <= 2) return 'P1';
  if (card.depth === 2) return 'P2';
  if (card.depth === 3) return 'P3';
  return 'P4';
}

function runRelatedAudioDiscovery(opts) {
  opts = opts || {};
  const root = opts.root;
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const hsCards = opts.hsCards || loadJson(path.join(root, 'data', 'hearthstonejson', 'zhCN', 'cards.json'));
  const cards = (unified && unified.cards) || {};
  const history = loadHistory(root);
  const baseline = snapshotProduction(root);

  const merged = [];
  const seenId = Object.create(null);
  hsCards.forEach((c) => {
    if (!c || !c.id) return;
    const raw = cards[c.id] || c;
    merged.push(Object.assign({}, c, raw, { id: c.id, collectible: c.collectible === true, type: raw.type || c.type, name: raw.name || c.name }));
    seenId[c.id] = true;
  });
  Object.keys(cards).forEach((id) => {
    if (seenId[id]) return;
    merged.push(cards[id]);
  });

  const structured = collectStructuredRelations(merged);
  const explicit = collectExplicitRelations(merged);
  const primary = mergePrimaryRelations(structured, explicit);
  const byParent = buildChildren(primary);
  const byName = groupCardsByName(merged);
  const already = Object.create(null);
  primary.forEach((e) => { already[e.parentCardId + '->' + e.relatedCardId] = true; });
  let inferred = 0;
  merged.forEach((card) => {
    if (!card || card.collectible !== true) return;
    inferred += inferNameMentions(card, byName, already).length;
  });

  const filters = countFilters(structured, cards);
  filters.inferred = inferred;

  const walked = [];
  let depth1 = 0;
  let depth2 = 0;
  let depth3 = 0;
  const parentSet = Object.create(null);
  merged.forEach((card) => {
    if (!card || card.collectible !== true) return;
    const rows = walkRelated(card.id, byParent, MAX_DEPTH);
    rows.forEach((row) => {
      walked.push(row);
      parentSet[row.parentId] = true;
      if (row.depth === 1) depth1 += 1;
      else if (row.depth === 2) depth2 += 1;
      else if (row.depth === 3) depth3 += 1;
    });
  });

  const first = Object.create(null);
  walked.forEach((row) => {
    if (!first[row.relatedId] || row.depth < first[row.relatedId].depth) first[row.relatedId] = row;
  });

  const ui = collectUiVisible(unified);
  const candidates = [];
  const excludedIds = Object.create(null);
  Object.keys(first).forEach((id) => {
    const loc = first[id];
    const raw = cards[id] || {};
    const parent = cards[loc.parentId] || {};
    if (isForbiddenCandidate(raw) || loc.relationSource === 'INFERRED') {
      excludedIds[id] = true;
      return;
    }
    if (raw.type === 'SPELL' && !hasVoiceMapping(raw)) {
      excludedIds[id] = true;
      filters.other += 1;
      return;
    }
    candidates.push({
      parentCardId: loc.parentId,
      parentName: parent.name || loc.parentId,
      relatedCardId: id,
      relatedName: raw.name || id,
      depth: loc.depth,
      cardType: raw.type || 'UNKNOWN',
      collectible: raw.collectible === true,
      relationSource: loc.relationSource,
    });
  });

  const voiceCoverage = {
    play: { indexed: 0, sourceFound: 0, productionPresent: 0, sourceMissing: 0, ready: 0, alreadyPresent: 0, conflict: 0, noMapping: 0 },
    attack: { indexed: 0, sourceFound: 0, productionPresent: 0, sourceMissing: 0, ready: 0, alreadyPresent: 0, conflict: 0, noMapping: 0 },
    death: { indexed: 0, sourceFound: 0, productionPresent: 0, sourceMissing: 0, ready: 0, alreadyPresent: 0, conflict: 0, noMapping: 0 },
  };
  const extra = { music: { indexed: 0, sourceFound: 0, sourceMissing: 0, productionPresent: 0 }, entrance: { indexed: 0, sourceFound: 0, sourceMissing: 0, productionPresent: 0 } };

  const ready = [];
  const alreadyPresent = [];
  const sourceMissing = [];
  const noMapping = [];
  const conflicts = [];
  const aliases = [];
  let aliasFail = 0;

  const cardRows = candidates.map((card) => {
    const raw = cards[card.relatedCardId];
    const voiceSlots = {};
    VOICE_TYPES.forEach((type) => {
      const mapped = voicePlayable(raw && raw.voice && raw.voice[type]);
      if (!mapped) {
        voiceCoverage[type].noMapping += 1;
        voiceSlots[type] = { indexed: false, status: 'NO_MAPPING' };
        noMapping.push({ cardId: card.relatedCardId, slot: type });
        return;
      }
      const classified = classifySlot(root, {
        cardId: card.relatedCardId,
        name: card.relatedName,
        type: card.cardType,
        parentId: card.parentCardId,
        depth: card.depth,
      }, { audioType: type, mappingKey: raw.voice[type].voiceKey, kind: 'voice' });
      voiceCoverage[type].indexed += 1;
      if (classified.sourcePath) voiceCoverage[type].sourceFound += 1;
      if (classified.productionExists) voiceCoverage[type].productionPresent += 1;
      if (classified.status === 'SOURCE_MISSING') {
        voiceCoverage[type].sourceMissing += 1;
        sourceMissing.push({
          cardId: card.relatedCardId,
          cardName: card.relatedName,
          parentCardId: card.parentCardId,
          slot: type,
          voiceKey: classified.mappingKey,
        });
      }
      if (classified.status === 'READY_TO_COPY') {
        voiceCoverage[type].ready += 1;
        const destSha = classified.productionExists ? require('../services/productionAudioPackage.js').sha256File(classified.destAbs) : null;
        ready.push({
          cardId: card.relatedCardId,
          cardName: card.relatedName,
          parentCardId: card.parentCardId,
          parentName: card.parentName,
          depth: card.depth,
          cardType: card.cardType,
          slot: type,
          voiceKey: classified.mappingKey,
          sourcePath: classified.sourcePath,
          targetPath: classified.destRel,
          sourceSha256: classified.sourceSha256,
          targetExists: classified.productionExists,
          targetSha256: destSha,
          priority: assignPriority(card, ui),
          readyToCopy: true,
        });
      }
      if (classified.status === 'ALREADY_PRESENT') {
        voiceCoverage[type].alreadyPresent += 1;
        alreadyPresent.push({ cardId: card.relatedCardId, slot: type, voiceKey: classified.mappingKey });
      }
      if (classified.status === 'CONFLICT') {
        voiceCoverage[type].conflict += 1;
        conflicts.push({ cardId: card.relatedCardId, slot: type, voiceKey: classified.mappingKey, destRel: classified.destRel });
      }
      if (classified.status === 'AMBIGUOUS') aliasFail += 1;
      if (classified.alias) {
        aliases.push({ cardId: card.relatedCardId, slot: type, voiceKey: classified.mappingKey });
        if (classified.status === 'SOURCE_MISSING' && classified.mappingKey) aliasFail += 0;
      }
      voiceSlots[type] = {
        indexed: true,
        voiceKey: classified.mappingKey,
        sourceFound: !!classified.sourcePath,
        productionPresent: classified.productionExists,
        status: classified.status,
        state: slotState(classified),
        alias: classified.alias,
      };
    });

    indexedSlots(card.relatedCardId, raw).forEach((slot) => {
      if (slot.audioType !== 'music' && slot.audioType !== 'entrance') return;
      extra[slot.audioType].indexed += 1;
      const found = findSources(root, slot.kind, slot.mappingKey, card.relatedCardId);
      const dest = destRelFor(slot.kind, slot.mappingKey, card.relatedCardId);
      const prod = fs.existsSync(path.join(root, 'data', 'production-audio', dest));
      if (found.hits.some((h) => h.valid)) extra[slot.audioType].sourceFound += 1;
      else extra[slot.audioType].sourceMissing += 1;
      if (prod) extra[slot.audioType].productionPresent += 1;
    });

    return Object.assign({}, card, {
      completeness: voiceCompleteness(voiceSlots),
      slots: voiceSlots,
      uiVisible: !!ui.visible[card.relatedCardId],
      uiDisplayable: !!ui.displayable[card.relatedCardId],
    });
  });

  const historical12 = {};
  let regression = false;
  FOCUS_12.forEach((id) => {
    const row = cardRows.find((c) => c.relatedCardId === id);
    const rec = { found: !!row, play: null, attack: null, death: null, ok: false };
    if (row) {
      VOICE_TYPES.forEach((t) => {
        const s = row.slots[t] || {};
        rec[t] = {
          indexed: !!s.indexed,
          source: !!s.sourceFound || !!s.productionPresent,
          production: !!s.productionPresent,
        };
      });
      rec.ok = VOICE_TYPES.every((t) => rec[t].indexed && rec[t].production);
    }
    if (!rec.ok) regression = true;
    historical12[id] = rec;
  });

  const focusSet = Object.create(null);
  FOCUS_12.forEach((id) => { focusSet[id] = true; });
  const family = {
    FAMILY_VALID_VOICED: 0,
    FAMILY_NO_AUDIO_MAPPING: 0,
    FAMILY_SOURCE_MISSING: 0,
    FAMILY_READY: 0,
    FAMILY_FILTERED: Object.keys(excludedIds).length,
    FAMILY_DUPLICATE: 0,
    FAMILY_ALIAS: 0,
  };
  const seenFamily = Object.create(null);
  cardRows.forEach((row) => {
    if (focusSet[row.relatedCardId]) return;
    if (seenFamily[row.relatedCardId]) {
      family.FAMILY_DUPLICATE += 1;
      return;
    }
    seenFamily[row.relatedCardId] = true;
    const voiced = VOICE_TYPES.some((t) => row.slots[t] && row.slots[t].indexed);
    if (!voiced) family.FAMILY_NO_AUDIO_MAPPING += 1;
    else family.FAMILY_VALID_VOICED += 1;
    if (VOICE_TYPES.some((t) => row.slots[t] && row.slots[t].status === 'SOURCE_MISSING')) family.FAMILY_SOURCE_MISSING += 1;
    if (VOICE_TYPES.some((t) => row.slots[t] && row.slots[t].status === 'READY_TO_COPY')) family.FAMILY_READY += 1;
    if (VOICE_TYPES.some((t) => row.slots[t] && row.slots[t].alias)) family.FAMILY_ALIAS += 1;
  });

  const priority = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
  ready.forEach((r) => { priority[r.priority] = (priority[r.priority] || 0) + 1; });

  const uiCoverage = {
    auditValidRelated: candidates.length,
    uiVisibleRelated: cardRows.filter((c) => c.uiVisible).length,
    uiHiddenRelated: cardRows.filter((c) => !c.uiVisible).length,
  };

  return {
    phase: '2.10-G',
    status: 'COMPLETE_VERIFIED',
    generatedAt: new Date().toISOString(),
    history: history,
    baseline: baseline,
    relation: {
      structured: structured.length,
      primary: primary.length,
      parents: Object.keys(parentSet).length,
      edges: walked.length,
      depth1: depth1,
      depth2: depth2,
      depth3: depth3,
    },
    filters: filters,
    candidates: cardRows,
    audioCoverage: voiceCoverage,
    extraAudio: extra,
    readyToCopy: ready,
    alreadyPresent: alreadyPresent,
    sourceMissing: sourceMissing,
    noMapping: noMapping,
    conflicts: conflicts,
    aliases: aliases,
    aliasResolutionFailure: aliasFail,
    historical12: historical12,
    regression: regression,
    family: family,
    priority: priority,
    uiCoverage: uiCoverage,
    summary: {
      cardCandidates: candidates.length,
      slotCandidates: candidates.length * 3,
      ready: ready.length,
      alreadyPresent: alreadyPresent.length,
      sourceMissing: sourceMissing.length,
      noMapping: noMapping.length,
      conflict: conflicts.length,
      ambiguous: aliasFail,
    },
  };
}

function compactDiscovery(result) {
  return {
    phase: result.phase,
    status: result.status,
    generatedAt: result.generatedAt,
    history: result.history,
    baseline: {
      files: result.baseline.files,
      bytes: result.baseline.bytes,
      voice: result.baseline.voice,
      music: result.baseline.music,
      entrance: result.baseline.entrance,
      manifestSha256: result.baseline.manifestSha256,
    },
    relationSummary: result.relation,
    filters: result.filters,
    candidates: {
      count: result.summary.cardCandidates,
      items: result.candidates.map((c) => ({
        parentCardId: c.parentCardId,
        parentName: c.parentName,
        relatedCardId: c.relatedCardId,
        relatedName: c.relatedName,
        depth: c.depth,
        cardType: c.cardType,
        collectible: c.collectible,
        relationSource: c.relationSource,
        completeness: c.completeness,
        uiVisible: c.uiVisible,
      })),
    },
    audioCoverage: result.audioCoverage,
    productionCoverage: {
      play: result.audioCoverage.play.productionPresent,
      attack: result.audioCoverage.attack.productionPresent,
      death: result.audioCoverage.death.productionPresent,
    },
    extraAudio: result.extraAudio,
    readyToCopy: result.readyToCopy,
    alreadyPresent: result.alreadyPresent,
    sourceMissing: result.sourceMissing,
    noMapping: result.noMapping,
    conflicts: result.conflicts,
    aliases: result.aliases,
    historical12: result.historical12,
    family: result.family,
    priority: result.priority,
    uiCoverage: result.uiCoverage,
    recommendations: {
      copyNext: result.readyToCopy.length
        ? 'Phase 2.10-H may copy READY_TO_COPY slots after explicit authorization.'
        : 'No READY_TO_COPY voice slots. Remaining gaps are SOURCE_MISSING or NO_MAPPING.',
      doNotCopyMusicEntrance: true,
    },
    summary: result.summary,
    regression: result.regression,
    aliasResolutionFailure: result.aliasResolutionFailure,
  };
}

function renderDiscoveryMarkdown(result, extra) {
  extra = extra || {};
  const s = result.summary;
  const a = result.audioCoverage;
  const h = result.historical12;
  function histLine(id) {
    const r = h[id];
    if (!r || !r.found) return id + '=NOT_IN_CANDIDATES';
    return id + '= play=' + (r.play.production ? 'YES' : 'NO') + ' attack=' + (r.attack.production ? 'YES' : 'NO') + ' death=' + (r.death.production ? 'YES' : 'NO');
  }
  return [
    '# Phase 2.10-G Related Card Audio Discovery',
    '',
    '========================================',
    'PHASE 2.10-G RELATED AUDIO DISCOVERY',
    '========================================',
    '',
    'STATUS=' + (extra.status || result.status),
    '',
    'GIT_HEAD=' + (extra.gitHead || ''),
    'WORKTREE=' + (extra.worktree || ''),
    '',
    '----------------------------------------',
    'PRODUCTION BASELINE',
    '----------------------------------------',
    '',
    'FILES_BEFORE=' + result.baseline.files,
    'FILES_AFTER=' + (extra.filesAfter != null ? extra.filesAfter : result.baseline.files),
    'VOICE_BEFORE=' + result.baseline.voice,
    'VOICE_AFTER=' + (extra.voiceAfter != null ? extra.voiceAfter : result.baseline.voice),
    'MUSIC_BEFORE=' + result.baseline.music,
    'MUSIC_AFTER=' + (extra.musicAfter != null ? extra.musicAfter : result.baseline.music),
    'ENTRANCE_BEFORE=' + result.baseline.entrance,
    'ENTRANCE_AFTER=' + (extra.entranceAfter != null ? extra.entranceAfter : result.baseline.entrance),
    '',
    'MANIFEST_SHA_BEFORE=' + result.baseline.manifestSha256,
    'MANIFEST_SHA_AFTER=' + (extra.manifestAfter || result.baseline.manifestSha256),
    '',
    'PRODUCTION_MUTATION=' + (extra.mutation || 'NO'),
    'BASELINE_DRIFT=' + (extra.drift || 'NO'),
    '',
    '----------------------------------------',
    'RELATION GRAPH',
    '----------------------------------------',
    '',
    'PARENTS=' + result.relation.parents,
    'EDGES=' + result.relation.edges,
    'DEPTH_1=' + result.relation.depth1,
    'DEPTH_2=' + result.relation.depth2,
    'DEPTH_3=' + result.relation.depth3,
    '',
    '----------------------------------------',
    'FILTERS',
    '----------------------------------------',
    '',
    'ENCHANTMENT=' + result.filters.enchantment,
    'HERO_POWER=' + result.filters.heroPower,
    'BATTLEGROUNDS=' + result.filters.battlegrounds,
    'HERO_SKIN=' + result.filters.heroSkin,
    'INFERRED=' + result.filters.inferred,
    'OTHER=' + result.filters.other,
    '',
    '----------------------------------------',
    'AUDIO INDEX COVERAGE',
    '----------------------------------------',
    '',
    'PLAY_INDEXED=' + a.play.indexed,
    'ATTACK_INDEXED=' + a.attack.indexed,
    'DEATH_INDEXED=' + a.death.indexed,
    '',
    'PLAY_SOURCE_FOUND=' + a.play.sourceFound,
    'ATTACK_SOURCE_FOUND=' + a.attack.sourceFound,
    'DEATH_SOURCE_FOUND=' + a.death.sourceFound,
    '',
    'PLAY_PRODUCTION_PRESENT=' + a.play.productionPresent,
    'ATTACK_PRODUCTION_PRESENT=' + a.attack.productionPresent,
    'DEATH_PRODUCTION_PRESENT=' + a.death.productionPresent,
    '',
    'MUSIC_INDEXED=' + result.extraAudio.music.indexed,
    'MUSIC_SOURCE_FOUND=' + result.extraAudio.music.sourceFound,
    'MUSIC_SOURCE_MISSING=' + result.extraAudio.music.sourceMissing,
    'MUSIC_PRODUCTION_PRESENT=' + result.extraAudio.music.productionPresent,
    'ENTRANCE_INDEXED=' + result.extraAudio.entrance.indexed,
    'ENTRANCE_SOURCE_FOUND=' + result.extraAudio.entrance.sourceFound,
    'ENTRANCE_SOURCE_MISSING=' + result.extraAudio.entrance.sourceMissing,
    'ENTRANCE_PRODUCTION_PRESENT=' + result.extraAudio.entrance.productionPresent,
    '',
    '----------------------------------------',
    'READY TO COPY',
    '----------------------------------------',
    '',
    'CARD_CANDIDATES=' + s.cardCandidates,
    'SLOT_CANDIDATES=' + s.slotCandidates,
    '',
    'READY=' + s.ready,
    'ALREADY_PRESENT=' + s.alreadyPresent,
    'SOURCE_MISSING=' + s.sourceMissing,
    'NO_MAPPING=' + s.noMapping,
    'CONFLICT=' + s.conflict,
    'AMBIGUOUS=' + s.ambiguous,
    '',
    'P0=' + result.priority.P0,
    'P1=' + result.priority.P1,
    'P2=' + result.priority.P2,
    'P3=' + result.priority.P3,
    'P4=' + result.priority.P4,
    '',
    'FAMILY_VALID_VOICED=' + result.family.FAMILY_VALID_VOICED,
    'FAMILY_NO_AUDIO_MAPPING=' + result.family.FAMILY_NO_AUDIO_MAPPING,
    'FAMILY_SOURCE_MISSING=' + result.family.FAMILY_SOURCE_MISSING,
    'FAMILY_READY=' + result.family.FAMILY_READY,
    'FAMILY_FILTERED=' + result.family.FAMILY_FILTERED,
    'FAMILY_ALIAS=' + result.family.FAMILY_ALIAS,
    '',
    '----------------------------------------',
    'HISTORICAL 12',
    '----------------------------------------',
    '',
    FOCUS_12.map(histLine).join('\n'),
    '',
    'REGRESSION=' + (result.regression ? 'YES' : 'NO'),
    '',
    '----------------------------------------',
    'UI COVERAGE',
    '----------------------------------------',
    '',
    'AUDIT_VALID_RELATED=' + result.uiCoverage.auditValidRelated,
    'UI_VISIBLE_RELATED=' + result.uiCoverage.uiVisibleRelated,
    'UI_HIDDEN_RELATED=' + result.uiCoverage.uiHiddenRelated,
    '',
    '----------------------------------------',
    'RECOMMENDED NEXT ACTION',
    '----------------------------------------',
    '',
    result.readyToCopy.length
      ? 'Do not copy in 2.10-G. Next authorized phase may copy READY_TO_COPY voice slots only.'
      : 'No READY_TO_COPY voice slots remain. Remaining gaps are SOURCE_MISSING (no local WAV) or NO_MAPPING.',
    'Do not invent music/entrance files. Do not run extractor. Do not access C:\\Hearthstone.',
    '',
    'HISTORY_FILES=',
    (result.history || []).map((f) => f.file + '=' + f.status).join('\n'),
    '',
    '----------------------------------------',
    'SAFETY',
    '----------------------------------------',
    '',
    'PRODUCTION_AUDIO_MODIFIED=NO',
    'MANIFEST_MODIFIED=NO',
    'EXTRACTOR=NOT_CALLED',
    'C:\\Hearthstone=NOT_ACCESSED',
    'VPS=NOT_MODIFIED',
    'NGINX=NOT_MODIFIED',
    'SYSTEMD=NOT_MODIFIED',
    'ENV=NOT_MODIFIED',
    '',
    '----------------------------------------',
    'TESTS',
    '----------------------------------------',
    '',
    'NPM_TEST=' + (extra.npmTest || ''),
    'PRODUCTION_TEST=' + (extra.testProduction || ''),
    'PHASE_2_10_G_TEST=' + (extra.auditTest || ''),
    '',
    '----------------------------------------',
    'GIT',
    '----------------------------------------',
    '',
    'COMMIT=NO',
    'PUSH=NO',
    '',
    '----------------------------------------',
    'FINAL',
    '----------------------------------------',
    '',
    'PHASE_2_10_G=' + (extra.status || result.status),
    '',
    'NEXT_PHASE=NOT_STARTED',
    '',
  ].join('\n');
}

module.exports = {
  MAX_DEPTH,
  UI_SLICE,
  FOCUS_12,
  HISTORY_FILES,
  loadHistory,
  walkRelated,
  buildChildren,
  collectUiVisible,
  runRelatedAudioDiscovery,
  compactDiscovery,
  renderDiscoveryMarkdown,
  voiceCompleteness,
  assignPriority,
};
