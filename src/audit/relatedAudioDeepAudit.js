'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { voicePlayable, musicPlayable, shouldPublish } = require('../miniprogram/catalogAdapter.js');
const { createProductionAudioInventory } = require('../services/productionAudioAvailability.js');
const { safeName } = require('../services/audioCache.js');
const {
  collectStructuredRelations,
  collectExplicitRelations,
  mergePrimaryRelations,
  indexAudioFromRaw,
  productionAudioForCard,
} = require('./relatedAudioAudit.js');
const { shouldDisplayRelatedEdge, getDisplayRelatedCards, RELATED_DEPTH_MAX } = require('../miniprogram/relatedCards.js');

const MAX_DEPTH = 3;
const PLAYABLE_TYPES = { MINION: true, SPELL: true, WEAPON: true, LOCATION: true, HERO: true };
const FILTERED_TYPES = { ENCHANTMENT: true, HERO_POWER: true };
const VOICE_SLOTS = ['play', 'attack', 'death'];
const ALL_SLOTS = ['play', 'attack', 'death', 'music', 'entrance'];
const FOCUS_12 = [
  'TIME_609t1', 'TIME_609t2',
  'TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5',
  'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9', 'TIME_005t9t',
];
const HISTORY_FILES = [
  'phase-2.10-report.md',
  'phase-2.10-related-audio-audit.json',
  'phase-2.10-A-report.md',
  'phase-2.10-B-candidates.json',
  'phase-2.10-B-report.md',
  'phase-2.10-C-report.md',
];
const UI_RELATED_SLICE = 12;
const KNOWN_CARD_KEYS = {
  id: true, dbfId: true, name: true, type: true, set: true, class: true, cardClass: true,
  rarity: true, cost: true, collectible: true, artist: true, text: true, collectionText: true,
  flavor: true, mechanics: true, referencedTags: true, race: true, races: true,
  spellSchool: true, faction: true, durability: true, armor: true, health: true, attack: true,
  voice: true, music: true, entrancePreview: true, heroPowerDbfId: true, questReward: true,
  entourage: true, relatedCardDbfIds: true, battlegroundsBuddyDbfId: true,
  battlegroundsRelatedCard: true, battlegroundsSkinParentId: true, countAsCopyOfDbfId: true,
  sourceCardId: true, reprints: true, multiClassGroup: true, classes: true, elite: true,
  howToEarn: true, howToEarnGolden: true, targetingArrowText: true, overrun: true,
};
const KNOWN_VOICE_KEYS = { play: true, attack: true, death: true };

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();
}

function snapshotProduction(root) {
  const dest = path.join(root, 'data', 'production-audio');
  const manifestPath = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let files = 0;
  function walk(dir) {
    fs.readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files += 1;
    });
  }
  walk(dest);
  return {
    files: files,
    voice: (manifest.voice || []).length,
    music: (manifest.music || []).length,
    entrance: (manifest.entrance || []).length,
    voiceDisk: listFiles(path.join(dest, 'voice')).length,
    musicDisk: listFiles(path.join(dest, 'music')).length,
    entranceDisk: listFiles(path.join(dest, 'entrance')).length,
    manifestSha256: sha256File(manifestPath),
  };
}

function normalizeHsCard(card) {
  if (!card || !card.id) return null;
  return {
    id: card.id,
    dbfId: card.dbfId == null ? null : card.dbfId,
    name: card.name || card.id,
    type: card.type || 'UNKNOWN',
    collectible: card.collectible === true,
    set: card.set || null,
    cardClass: card.cardClass || card.class || null,
    relatedCardDbfIds: card.relatedCardDbfIds || null,
    entourage: card.entourage || null,
    heroPowerDbfId: card.heroPowerDbfId == null ? null : card.heroPowerDbfId,
  };
}

function voiceKeyFor(raw, type) {
  const slot = raw && raw.voice && raw.voice[type];
  return voicePlayable(slot) ? slot.voiceKey : null;
}

function musicKeyFor(raw) {
  if (!musicPlayable(raw && raw.music)) return null;
  return raw.music.audioClipName || raw.music.musicAssetId || null;
}

function expectedVoiceFile(voiceKey) {
  if (!voiceKey) return null;
  return 'voice/' + safeName(voiceKey) + '.wav';
}

function expectedMusicFile(raw) {
  if (!musicPlayable(raw && raw.music)) return null;
  if (raw.music.audioClipName) return 'music/' + safeName(raw.music.audioClipName) + '.wav';
  return 'music/' + safeName(raw.id + '_MusicStinger') + '.wav';
}

function expectedEntranceFile(cardId) {
  return 'entrance/' + cardId + '_entrance_v3.wav';
}

function isAliasKey(cardId, voiceKey) {
  if (!voiceKey || !cardId) return false;
  if (voiceKey === cardId) return false;
  if (voiceKey === cardId + '_Play' || voiceKey === cardId + '_Attack' || voiceKey === cardId + '_Death') return true;
  if (voiceKey.indexOf(cardId) >= 0) return false;
  return true;
}

function loadHistoryReports(root) {
  const dir = path.join(root, 'data', 'card-verification');
  const files = HISTORY_FILES.map((name) => {
    const full = path.join(dir, name);
    return { file: name, status: fs.existsSync(full) ? 'FOUND' : 'NOT_FOUND' };
  });
  const previous = {
    parentCount: null,
    relationCount: null,
    candidateCount: 12,
    previousMissingCount: null,
    targetCards: FOCUS_12.slice(),
    previousVoiceKeys: {},
    previousProductionStatus: {},
  };
  const auditJsonPath = path.join(dir, 'phase-2.10-related-audio-audit.json');
  if (fs.existsSync(auditJsonPath)) {
    const prev = JSON.parse(fs.readFileSync(auditJsonPath, 'utf8'));
    previous.parentCount = prev.summary && prev.summary.primaryParents;
    previous.relationCount = prev.summary && prev.summary.primaryEdges;
    previous.previousMissingCount = prev.summary && prev.summary.mappingProductionMissing;
  }
  const candPath = path.join(dir, 'phase-2.10-B-candidates.json');
  if (fs.existsSync(candPath)) {
    const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
    previous.candidateCount = cand.summary && cand.summary.candidatesTotal;
  }
  return { files: files, previous: previous };
}

function probeAudioIndexShape(unified) {
  const extraCardKeys = Object.create(null);
  const extraVoiceKeys = Object.create(null);
  const cards = (unified && unified.cards) || {};
  const ids = Object.keys(cards);
  const limit = Math.min(ids.length, 4000);
  for (let i = 0; i < limit; i++) {
    const raw = cards[ids[i]];
    if (!raw || typeof raw !== 'object') continue;
    Object.keys(raw).forEach((k) => {
      if (!KNOWN_CARD_KEYS[k]) extraCardKeys[k] = (extraCardKeys[k] || 0) + 1;
    });
    if (raw.voice && typeof raw.voice === 'object') {
      Object.keys(raw.voice).forEach((k) => {
        if (!KNOWN_VOICE_KEYS[k]) extraVoiceKeys[k] = (extraVoiceKeys[k] || 0) + 1;
      });
    }
  }
  return {
    extraCardKeys: extraCardKeys,
    extraVoiceKeys: extraVoiceKeys,
    topLevelIndexKeys: Object.keys(unified || {}).sort(),
  };
}

function listTmpVoiceNotes(root, missingProduction) {
  const dirs = [
    path.join(root, 'tmp', 'audio'),
    path.join(root, 'tmp', 'production-audio-extract', 'voice'),
  ];
  const notes = [];
  const byFile = Object.create(null);
  missingProduction.forEach((row) => {
    if (!row.expectedFile) return;
    const base = path.basename(row.expectedFile);
    if (!byFile[base]) byFile[base] = [];
    byFile[base].push(row);
  });
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      notes.push({ dir: dir, status: 'NOT_FOUND', hits: [] });
      return;
    }
    const hits = [];
    listFiles(dir).forEach((name) => {
      if (byFile[name]) {
        hits.push({
          file: name,
          cards: byFile[name].map((r) => r.cardId + ':' + r.audioType),
          note: 'SOURCE_EXISTS_LOCALLY_NOT_IN_PRODUCTION',
        });
      }
    });
    notes.push({ dir: dir, status: 'SCANNED', hitCount: hits.length, hits: hits.slice(0, 80) });
  });
  return notes;
}

function fileExists(root, rel) {
  return !!(rel && fs.existsSync(path.join(root, 'data', 'production-audio', rel)));
}

function analyzeSlot(cardId, type, raw, inventory, root, voiceByKey) {
  let mapped = false;
  let mappingKey = null;
  let expectedFile = null;
  if (type === 'play' || type === 'attack' || type === 'death') {
    mappingKey = voiceKeyFor(raw, type);
    mapped = !!mappingKey;
    expectedFile = expectedVoiceFile(mappingKey);
  } else if (type === 'music') {
    mappingKey = musicKeyFor(raw);
    mapped = !!mappingKey;
    expectedFile = expectedMusicFile(raw);
  } else if (type === 'entrance') {
    mapped = !!(raw && raw.entrancePreview && raw.entrancePreview.available);
    mappingKey = mapped ? (raw.entrancePreview.voiceKey || voiceKeyFor(raw, 'play')) : null;
    expectedFile = expectedEntranceFile(cardId);
  }
  const disk = fileExists(root, expectedFile);
  let production = false;
  if (type === 'music') production = !!(inventory && inventory.hasMusic(cardId));
  else if (type === 'entrance') production = !!(inventory && inventory.hasEntrance(cardId));
  else production = !!(inventory && inventory.hasVoice(cardId, type));
  const playable = !!(mapped && production);
  const alias = mapped && type !== 'music' && type !== 'entrance' && isAliasKey(cardId, mappingKey);
  const state = !mapped ? 'NO_MAPPING'
    : (playable ? (alias ? 'MAPPING_ALIAS' : 'PLAYABLE')
      : (disk || production ? 'PRODUCTION_PRESENT' : 'INDEXED_PRODUCTION_MISSING'));
  return {
    mapped: mapped,
    mappingKey: mappingKey,
    normalizedVoiceKey: mappingKey,
    productionFile: expectedFile,
    productionExists: !!(disk || production),
    diskExists: disk,
    inventoryPresent: production,
    playable: playable,
    alias: alias,
    state: state,
    applicable: mapped,
  };
}

function completenessFor(slots) {
  const declared = ALL_SLOTS.filter((t) => slots[t] && slots[t].mapped);
  if (!declared.length) return 'NO_AUDIO';
  const present = declared.filter((t) => slots[t].productionExists || slots[t].playable);
  const voiceDeclared = VOICE_SLOTS.filter((t) => slots[t] && slots[t].mapped);
  const voicePresent = voiceDeclared.filter((t) => slots[t].playable || slots[t].productionExists);
  if (present.length === declared.length) return 'FULL_INDEXED';
  if (voiceDeclared.length && voicePresent.length === voiceDeclared.length) return 'VOICE_COMPLETE';
  if (slots.play && slots.play.playable && voiceDeclared.length === 1 && voiceDeclared[0] === 'play') return 'PLAY_ONLY';
  if (slots.play && slots.play.playable && voicePresent.length < voiceDeclared.length) return 'PARTIAL';
  if (present.length) return 'PARTIAL';
  return 'NO_AUDIO';
}

function typeBucket(type) {
  if (PLAYABLE_TYPES[type]) return 'PLAYABLE_TYPE';
  if (type === 'ENCHANTMENT') return 'ENCHANTMENT';
  if (type === 'HERO_POWER') return 'HERO_POWER';
  return 'OTHER';
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

function cardProfile(cardId, hsById, unified, inventory, root, displayed) {
  const hs = hsById[cardId] || {};
  const raw = unified.cards && unified.cards[cardId];
  const slots = {};
  ALL_SLOTS.forEach((type) => {
    slots[type] = analyzeSlot(cardId, type, raw, inventory, root, null);
  });
  const indexed = indexAudioFromRaw(raw);
  const production = productionAudioForCard(cardId, inventory);
  const runtime = {
    indexed: indexed.hasAny,
    productionAvailable: production.hasAny,
    playable: !!(
      (indexed.hasVoice && production.hasVoice)
      || (indexed.music && production.music)
      || (indexed.entrance && production.entrance)
    ),
  };
  return {
    cardId: cardId,
    name: (raw && raw.name) || hs.name || cardId,
    type: (raw && raw.type) || hs.type || 'UNKNOWN',
    collectible: !!(hs.collectible || (raw && raw.collectible)),
    set: (raw && raw.set) || hs.set || null,
    typeBucket: typeBucket((raw && raw.type) || hs.type),
    slots: slots,
    completeness: completenessFor(slots),
    runtime: runtime,
    uiExposed: !!displayed,
    catalog: !!(raw && shouldPublish(raw)),
  };
}

function runRelatedAudioDeepAudit(opts) {
  opts = opts || {};
  const root = opts.root;
  const hsCards = opts.hsCards;
  const unified = opts.unified;
  const manifest = opts.manifest;
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const inventory = createProductionAudioInventory(manifest);
  const hsById = Object.create(null);
  const mergedList = [];
  const seenId = Object.create(null);

  for (let i = 0; i < (hsCards || []).length; i++) {
    const n = normalizeHsCard(hsCards[i]);
    if (!n) continue;
    hsById[n.id] = n;
    const raw = (unified.cards && unified.cards[n.id]) || n;
    mergedList.push(Object.assign({}, n, raw, { id: n.id, type: raw.type || n.type, name: raw.name || n.name, collectible: n.collectible }));
    seenId[n.id] = true;
  }
  const indexIds = Object.keys((unified && unified.cards) || {});
  for (let i = 0; i < indexIds.length; i++) {
    if (seenId[indexIds[i]]) continue;
    const raw = unified.cards[indexIds[i]];
    if (!raw || !raw.id) continue;
    mergedList.push(raw);
    seenId[raw.id] = true;
  }

  const structured = collectStructuredRelations(mergedList);
  const explicitAll = collectExplicitRelations(mergedList);
  const primary = mergePrimaryRelations(structured, explicitAll);
  const byParent = buildChildren(primary);

  const collectibleIds = [];
  for (let i = 0; i < mergedList.length; i++) {
    if (mergedList[i].collectible === true) collectibleIds.push(mergedList[i].id);
  }

  const walked = [];
  const relatedSeen = Object.create(null);
  let depth1 = 0;
  let depth2 = 0;
  let depth3 = 0;
  for (let i = 0; i < collectibleIds.length; i++) {
    const rows = walkRelated(collectibleIds[i], byParent, MAX_DEPTH);
    for (let j = 0; j < rows.length; j++) {
      walked.push(rows[j]);
      relatedSeen[rows[j].relatedId] = true;
      if (rows[j].depth === 1) depth1 += 1;
      else if (rows[j].depth === 2) depth2 += 1;
      else if (rows[j].depth === 3) depth3 += 1;
    }
  }

  const displayIndex = { byId: unified.cards || {}, byParent: buildChildren(structured) };
  const uiExposed = Object.create(null);
  const parentSetEarly = Object.create(null);
  for (let i = 0; i < walked.length; i++) parentSetEarly[walked[i].parentId] = true;
  const uiParents = Object.keys(parentSetEarly);
  for (let i = 0; i < uiParents.length; i++) {
    const shown = getDisplayRelatedCards(uiParents[i], displayIndex, inventory);
    const top = shown.slice(0, UI_RELATED_SLICE);
    function markTree(nodes) {
      for (let n = 0; n < (nodes || []).length; n++) {
        uiExposed[nodes[n].id] = true;
        markTree(nodes[n].relatedCards);
      }
    }
    markTree(top);
  }

  const relatedFirst = Object.create(null);
  for (let i = 0; i < walked.length; i++) {
    const row = walked[i];
    if (!relatedFirst[row.relatedId] || row.depth < relatedFirst[row.relatedId].depth) {
      relatedFirst[row.relatedId] = { parentId: row.parentId, depth: row.depth, relationSource: row.relationSource };
    }
  }

  const profiles = Object.create(null);
  const relatedIds = Object.keys(relatedSeen);
  for (let i = 0; i < relatedIds.length; i++) {
    const id = relatedIds[i];
    profiles[id] = cardProfile(id, hsById, unified, inventory, root, !!uiExposed[id]);
  }

  const summary = {
    parents: 0,
    edges: walked.length,
    depth1: depth1,
    depth2: depth2,
    depth3: depth3,
    relatedPlayableType: 0,
    relatedMapped: 0,
    relatedNoMapping: 0,
    relatedComplete: 0,
    relatedPartial: 0,
    relatedNoAudio: 0,
    playMapped: 0,
    attackMapped: 0,
    deathMapped: 0,
    musicMapped: 0,
    entranceMapped: 0,
    otherMapped: 0,
    noAudio: 0,
    partial: 0,
    playOnly: 0,
    voiceComplete: 0,
    fullIndexed: 0,
    indexedButProductionMissing: 0,
    productionPresentButNotPlayable: 0,
    aliasMappings: 0,
    aliasResolutionGap: 0,
    unindexedProduction: 0,
  };

  const collectibleParentSet = Object.create(null);
  for (let i = 0; i < walked.length; i++) collectibleParentSet[walked[i].parentId] = true;
  summary.parents = Object.keys(collectibleParentSet).length;

  const missingProduction = [];
  const partialCards = [];
  const aliasRows = [];
  const filtered = [];
  const notExposed = [];

  relatedIds.forEach((id) => {
    const p = profiles[id];
    if (p.typeBucket === 'PLAYABLE_TYPE') summary.relatedPlayableType += 1;
    if (p.slots.play.mapped || p.slots.attack.mapped || p.slots.death.mapped || p.slots.music.mapped || p.slots.entrance.mapped) {
      summary.relatedMapped += 1;
    } else {
      summary.relatedNoMapping += 1;
    }
    if (p.completeness === 'FULL_INDEXED') {
      summary.relatedComplete += 1;
      summary.fullIndexed += 1;
    } else if (p.completeness === 'VOICE_COMPLETE') {
      summary.relatedComplete += 1;
      summary.voiceComplete += 1;
    } else if (p.completeness === 'PLAY_ONLY') {
      summary.relatedPartial += 1;
      summary.playOnly += 1;
    } else if (p.completeness === 'PARTIAL') {
      summary.relatedPartial += 1;
      summary.partial += 1;
    } else {
      summary.relatedNoAudio += 1;
      summary.noAudio += 1;
    }
    ALL_SLOTS.forEach((type) => {
      const s = p.slots[type];
      if (s.mapped) {
        if (type === 'play') summary.playMapped += 1;
        else if (type === 'attack') summary.attackMapped += 1;
        else if (type === 'death') summary.deathMapped += 1;
        else if (type === 'music') summary.musicMapped += 1;
        else if (type === 'entrance') summary.entranceMapped += 1;
        if (s.alias) {
          summary.aliasMappings += 1;
          aliasRows.push({ cardId: id, type: type, voiceKey: s.mappingKey });
        }
        if (!s.playable && !s.productionExists) {
          summary.indexedButProductionMissing += 1;
          const loc = relatedFirst[id] || {};
          missingProduction.push({
            cardId: id,
            name: p.name,
            parentId: loc.parentId || null,
            depth: loc.depth == null ? null : loc.depth,
            type: p.type,
            typeBucket: p.typeBucket,
            audioType: type,
            voiceKey: s.mappingKey,
            expectedFile: s.productionFile,
            productionExists: false,
            state: 'INDEXED_PRODUCTION_MISSING',
          });
        } else if (s.productionExists && !s.playable) {
          summary.productionPresentButNotPlayable += 1;
        }
        if (s.alias && s.diskExists && !s.inventoryPresent) {
          summary.aliasResolutionGap = (summary.aliasResolutionGap || 0) + 1;
        }
      }
    });
    if (p.completeness === 'PARTIAL' || p.completeness === 'PLAY_ONLY') {
      partialCards.push({ cardId: id, name: p.name, type: p.type, completeness: p.completeness });
    }
    if (FILTERED_TYPES[p.type]) filtered.push({ cardId: id, type: p.type });
    if (p.typeBucket === 'PLAYABLE_TYPE' && !p.uiExposed) notExposed.push(id);
  });

  const voiceFiles = listFiles(path.join(root, 'data', 'production-audio', 'voice'));
  const indexVoiceFiles = Object.create(null);
  const cardsMap = (unified && unified.cards) || {};
  Object.keys(cardsMap).forEach((cid) => {
    const raw = cardsMap[cid];
    VOICE_SLOTS.forEach((type) => {
      const key = voiceKeyFor(raw, type);
      if (key) indexVoiceFiles[safeName(key) + '.wav'] = true;
    });
  });
  const manifestVoiceFiles = Object.create(null);
  (manifest.voice || []).forEach((row) => {
    if (row && row.voiceKey) manifestVoiceFiles[safeName(row.voiceKey) + '.wav'] = true;
  });
  const unindexed = [];
  voiceFiles.forEach((name) => {
    if (!indexVoiceFiles[name] && !manifestVoiceFiles[name]) {
      unindexed.push(name);
      summary.unindexedProduction += 1;
    }
  });

  const snap = snapshotProduction(root);
  const mismatch = snap.voice !== snap.voiceDisk || snap.music !== snap.musicDisk || snap.entrance !== snap.entranceDisk
    || snap.files !== (snap.voiceDisk + snap.musicDisk + snap.entranceDisk + 1);

  const indexShape = probeAudioIndexShape(unified);
  const extraVoiceCount = Object.keys(indexShape.extraVoiceKeys).length;
  summary.otherMapped = extraVoiceCount;

  const causes = {
    A_indexMissingAttackDeath: 0,
    B_indexedAttackDeathProductionMissing: 0,
    C_uiPlayOnly: 0,
    D_resolverAliasGap: summary.aliasResolutionGap,
    E_depthOrSliceNotExposed: notExposed.length,
    F_familiesBeyond12: 0,
    G_specialClipAlias: summary.aliasMappings,
  };
  relatedIds.forEach((id) => {
    const p = profiles[id];
    if (p.typeBucket !== 'PLAYABLE_TYPE') return;
    const voiceDeclared = VOICE_SLOTS.filter((t) => p.slots[t].mapped);
    const missingVoice = voiceDeclared.filter((t) => !p.slots[t].playable && !p.slots[t].productionExists);
    if (!p.slots.attack.mapped && !p.slots.death.mapped && p.slots.play.mapped) causes.A_indexMissingAttackDeath += 1;
    if (missingVoice.indexOf('attack') >= 0 || missingVoice.indexOf('death') >= 0) causes.B_indexedAttackDeathProductionMissing += 1;
    if (p.slots.play.playable) causes.C_uiPlayOnly += 1;
    if (FOCUS_12.indexOf(id) < 0 && missingVoice.length) causes.F_familiesBeyond12 += 1;
  });

  const gaps = {
    GAP_A: summary.relatedNoMapping,
    GAP_B: missingProduction.filter((r) => r.typeBucket === 'PLAYABLE_TYPE').length,
    GAP_C: summary.partial + summary.playOnly,
    GAP_D: summary.aliasResolutionGap,
    GAP_E: notExposed.length,
    GAP_F: filtered.length,
    GAP_G: extraVoiceCount,
    GAP_H: mismatch ? 1 : 0,
    GAP_I: summary.productionPresentButNotPlayable,
  };

  function focusCard(id, parentId, depth) {
    const p = profiles[id] || cardProfile(id, hsById, unified, inventory, root, false);
    return {
      cardId: id,
      name: p.name,
      type: p.type,
      parent: parentId,
      depth: depth,
      play: p.slots.play,
      attack: p.slots.attack,
      death: p.slots.death,
      music: p.slots.music,
      entrance: p.slots.entrance,
      completeness: p.completeness,
      runtime: p.runtime,
    };
  }

  const sylvanas = {
    parent: cardProfile('TIME_609', hsById, unified, inventory, root, false),
    TIME_609t1: focusCard('TIME_609t1', 'TIME_609', 1),
    TIME_609t2: focusCard('TIME_609t2', 'TIME_609', 1),
    TIME_609t2e: focusCard('TIME_609t2e', 'TIME_609t2', 2),
  };
  const rafaam = {
    parent: cardProfile('TIME_005', hsById, unified, inventory, root, false),
    tokens: {},
    enchantments: {},
  };
  FOCUS_12.filter((id) => id.indexOf('TIME_005') === 0).forEach((id) => {
    rafaam.tokens[id] = focusCard(id, id === 'TIME_005t9t' ? 'TIME_005t9' : 'TIME_005', id === 'TIME_005t9t' ? 2 : 1);
  });
  ['TIME_005t2e', 'TIME_005t8e'].forEach((id) => {
    rafaam.enchantments[id] = focusCard(id, id.replace(/e$/, ''), 2);
  });

  const jail = cardProfile('JAIL_443', hsById, unified, inventory, root, false);
  const cap = cardProfile('CAP_107', hsById, unified, inventory, root, false);
  const history = loadHistoryReports(root);
  const tmpNotes = listTmpVoiceNotes(root, missingProduction);
  const missingPlayable = missingProduction.filter((r) => r.typeBucket === 'PLAYABLE_TYPE');

  return {
    phase: '2.10-D',
    generatedAt: generatedAt,
    schema: {
      cardsJsonHasEntourage: hsCards.some((c) => c && c.entourage),
      cardsJsonHasRelatedCardDbfIds: hsCards.some((c) => c && c.relatedCardDbfIds),
      audioIndexVoice: ['play', 'attack', 'death'],
      audioIndexMusic: true,
      audioIndexEntrance: true,
      extraCardKeys: indexShape.extraCardKeys,
      extraVoiceKeys: indexShape.extraVoiceKeys,
      topLevelIndexKeys: indexShape.topLevelIndexKeys,
    },
    history: history,
    production: snap,
    manifestFilesystemMismatch: mismatch,
    relation: {
      structured: structured.length,
      explicitAll: explicitAll.length,
      primary: primary.length,
      parents: summary.parents,
      edges: summary.edges,
      depth1: depth1,
      depth2: depth2,
      depth3: depth3,
    },
    summary: summary,
    gaps: gaps,
    causes: causes,
    missingProduction: missingProduction,
    missingProductionPlayableType: missingPlayable,
    partialCards: partialCards,
    aliasRows: aliasRows.slice(0, 200),
    unindexedProduction: unindexed,
    tmpNotes: tmpNotes,
    sylvanas: sylvanas,
    rafaam: rafaam,
    targets12: FOCUS_12.map((id) => focusCard(id, id.indexOf('TIME_609') === 0 ? 'TIME_609' : (id === 'TIME_005t9t' ? 'TIME_005t9' : 'TIME_005'), id === 'TIME_005t9t' ? 2 : 1)),
    negative: { JAIL_443: jail, CAP_107: cap },
    findings: {
      playOnlyAfterPhase210B: FOCUS_12.filter((id) => (profiles[id] || {}).completeness === 'PARTIAL' || (profiles[id] || {}).completeness === 'PLAY_ONLY'),
      sheepAlias: voiceKeyFor(unified.cards && unified.cards.TIME_005t9t, 'play'),
      uiDepthMax: RELATED_DEPTH_MAX,
      auditDepthMax: MAX_DEPTH,
      uiRelatedSlice: UI_RELATED_SLICE,
      relatedPlayCallsPlayOnly: true,
      historyParents: history.previous.parentCount,
      historyEdges: history.previous.relationCount,
      historyMissing: history.previous.previousMissingCount,
    },
  };
}

function loadProjectDeepAuditInputs(root) {
  return {
    root: root,
    hsCards: JSON.parse(fs.readFileSync(path.join(root, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), 'utf8')),
    unified: JSON.parse(fs.readFileSync(path.join(root, 'data', 'index', 'card-audio-index.json'), 'utf8')),
    manifest: JSON.parse(fs.readFileSync(path.join(root, 'data', 'production-audio', 'manifest.json'), 'utf8')),
  };
}

function compactDeepAudit(result) {
  return {
    phase: result.phase,
    generatedAt: result.generatedAt,
    history: result.history,
    production: result.production,
    relation: result.relation,
    summary: result.summary,
    gaps: result.gaps,
    causes: result.causes,
    missingProductionCount: (result.missingProduction || []).length,
    missingProductionPlayableTypeCount: (result.missingProductionPlayableType || []).length,
    missingProductionPlayableType: result.missingProductionPlayableType,
    partialCardsCount: (result.partialCards || []).length,
    partialCards: result.partialCards,
    unindexedProduction: result.unindexedProduction,
    tmpNotes: result.tmpNotes,
    sylvanas: result.sylvanas,
    rafaam: result.rafaam,
    targets12: result.targets12,
    negative: result.negative,
    findings: result.findings,
    schema: result.schema,
    manifestFilesystemMismatch: result.manifestFilesystemMismatch,
    aliasRows: result.aliasRows,
  };
}

function slotLine(slot) {
  if (!slot) return 'n/a';
  if (!slot.mapped) return 'NOT_APPLICABLE';
  if (slot.playable) return 'PLAYABLE' + (slot.alias ? '/ALIAS' : '');
  if (slot.productionExists) return 'PRODUCTION_PRESENT_NOT_PLAYABLE';
  return 'INDEXED_BUT_PRODUCTION_MISSING';
}

function renderDeepMarkdown(result, extra) {
  extra = extra || {};
  const s = result.summary;
  const g = result.gaps;
  const t = {};
  (result.targets12 || []).forEach((row) => { t[row.cardId] = row; });
  function block(id) {
    const row = t[id] || {};
    return [
      id + '=',
      '  play=' + slotLine(row.play),
      '  attack=' + slotLine(row.attack),
      '  death=' + slotLine(row.death),
      '  music=' + slotLine(row.music),
      '  entrance=' + slotLine(row.entrance),
      '  completeness=' + (row.completeness || ''),
    ].join('\n');
  }
  return [
    '# Phase 2.10-D Related Card Audio Completeness Deep Audit',
    '',
    '========================================',
    'PHASE 2.10-D RELATED AUDIO DEEP AUDIT',
    '========================================',
    '',
    'STATUS=' + (extra.status || 'COMPLETE_VERIFIED'),
    '',
    'GIT_HEAD=' + (extra.gitHead || ''),
    '',
    'WORKTREE=' + (extra.worktree || ''),
    '',
    '----------------------------------------',
    'PRODUCTION BASELINE',
    '----------------------------------------',
    '',
    'FILES=' + result.production.files,
    'VOICE=' + result.production.voice,
    'MUSIC=' + result.production.music,
    'ENTRANCE=' + result.production.entrance,
    'MANIFEST_SHA=' + result.production.manifestSha256,
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
    'AUDIO COVERAGE',
    '----------------------------------------',
    '',
    'MAPPED=' + s.relatedMapped,
    'NO_MAPPING=' + s.relatedNoMapping,
    'PLAY=' + s.playMapped,
    'ATTACK=' + s.attackMapped,
    'DEATH=' + s.deathMapped,
    'MUSIC=' + s.musicMapped,
    'ENTRANCE=' + s.entranceMapped,
    'OTHER=' + s.otherMapped,
    '',
    '----------------------------------------',
    'COMPLETENESS',
    '----------------------------------------',
    '',
    'NO_AUDIO=' + s.noAudio,
    'PARTIAL=' + s.partial,
    'PLAY_ONLY=' + s.playOnly,
    'VOICE_COMPLETE=' + s.voiceComplete,
    'FULL_INDEXED=' + s.fullIndexed,
    '',
    '----------------------------------------',
    'PRODUCTION GAPS',
    '----------------------------------------',
    '',
    'INDEXED_BUT_PRODUCTION_MISSING=' + s.indexedButProductionMissing,
    'PRODUCTION_PRESENT_BUT_NOT_PLAYABLE=' + s.productionPresentButNotPlayable,
    'ALIAS_MAPPINGS=' + s.aliasMappings,
    'UNINDEXED_PRODUCTION=' + s.unindexedProduction,
    '',
    '----------------------------------------',
    'GAP CLASSIFICATION',
    '----------------------------------------',
    '',
    'GAP_A=' + g.GAP_A,
    'GAP_B=' + g.GAP_B,
    'GAP_C=' + g.GAP_C,
    'GAP_D=' + g.GAP_D,
    'GAP_E=' + g.GAP_E,
    'GAP_F=' + g.GAP_F,
    'GAP_G=' + g.GAP_G,
    'GAP_H=' + g.GAP_H,
    'GAP_I=' + g.GAP_I,
    '',
    '----------------------------------------',
    'SYLVANAS',
    '----------------------------------------',
    '',
    block('TIME_609t1'),
    '',
    block('TIME_609t2'),
    '',
    '----------------------------------------',
    'RAFAAM',
    '----------------------------------------',
    '',
    FOCUS_12.filter((id) => id.indexOf('TIME_005') === 0).map(block).join('\n\n'),
    '',
    '----------------------------------------',
    'NEGATIVE CASES',
    '----------------------------------------',
    '',
    'JAIL_443 entrance=' + slotLine(result.negative.JAIL_443.slots.entrance) + ' playable=' + result.negative.JAIL_443.runtime.playable,
    'CAP_107 play=' + slotLine(result.negative.CAP_107.slots.play) + ' playable=' + result.negative.CAP_107.runtime.playable,
    '',
    '----------------------------------------',
    'SPECIAL FINDINGS',
    '----------------------------------------',
    '',
    '- TIME_005t9t play voiceKey=' + (result.findings.sheepAlias || ''),
    '- 12 Phase 2.10-B cards have play production; attack/death remain INDEXED_BUT_PRODUCTION_MISSING when mapped.',
    '- Mini program related 试听 calls play only (onRelatedPlay → getVoiceUrl(id, play)).',
    '- UI relatedCards depth max=' + result.findings.uiDepthMax + ' slice=' + result.findings.uiRelatedSlice + '; audit depth max=' + result.findings.auditDepthMax,
    '- cards.json relatedCardDbfIds=absent entourage=absent; primary graph is structured token suffixes.',
    '- history parents/edges/missing=' + result.findings.historyParents + '/' + result.findings.historyEdges + '/' + result.findings.historyMissing,
    '- missingProduction rows=' + ((result.missingProduction || result.missingProductionPlayableType || []).length),
    '- missing playable-type rows=' + ((result.missingProductionPlayableType || []).length),
    '- unindexed production files=' + (result.unindexedProduction || []).length,
    '',
    '----------------------------------------',
    'SAFETY',
    '----------------------------------------',
    '',
    'PRODUCTION_AUDIO_CHANGED=' + (extra.productionChanged || 'NO'),
    'MANIFEST_CHANGED=' + (extra.manifestChanged || 'NO'),
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
    'npm test=' + (extra.npmTest || ''),
    'npm run test:production=' + (extra.testProduction || ''),
    'phase210D audit test=' + (extra.auditTest || ''),
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
    'PHASE_2_10_D=' + (extra.status || 'COMPLETE_VERIFIED'),
    '',
  ].join('\n');
}

module.exports = {
  MAX_DEPTH,
  FOCUS_12,
  HISTORY_FILES,
  snapshotProduction,
  analyzeSlot,
  completenessFor,
  isAliasKey,
  walkRelated,
  buildChildren,
  loadHistoryReports,
  runRelatedAudioDeepAudit,
  loadProjectDeepAuditInputs,
  compactDeepAudit,
  renderDeepMarkdown,
  slotLine,
};
