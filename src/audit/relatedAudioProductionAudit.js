'use strict';

const fs = require('fs');
const path = require('path');
const { voicePlayable, musicPlayable } = require('../miniprogram/catalogAdapter.js');
const {
  createRelatedCardIndex,
  getDisplayRelatedCards,
  shouldDisplayRelatedEdge,
  RELATED_DEPTH_MAX,
} = require('../miniprogram/relatedCards.js');
const { createProductionAudioInventory } = require('../services/productionAudioAvailability.js');
const { safeName } = require('../services/audioCache.js');
const {
  isPlayableWav,
  isRiffWave,
  sha256File,
  buildVoiceKeyIndex,
  buildMusicIndex,
  verifyProductionPackage,
} = require('../services/productionAudioPackage.js');
const { collectStructuredRelations } = require('./relatedAudioAudit.js');

const AUDIO_TYPES = ['play', 'attack', 'death', 'music', 'entrance'];
const VOICE_TYPES = ['play', 'attack', 'death'];
const PLAYABLE_TYPES = { MINION: true, SPELL: true, WEAPON: true, LOCATION: true, HERO: true };
const FILTERED_TYPES = { ENCHANTMENT: true, HERO_POWER: true };
const FOCUS_12 = [
  'TIME_609t1', 'TIME_609t2',
  'TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5',
  'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9', 'TIME_005t9t',
];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  function walk(cur) {
    fs.readdirSync(cur).sort().forEach((name) => {
      const full = path.join(cur, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out.push(full);
    });
  }
  walk(dir);
  return out;
}

function snapshotProduction(root) {
  const dest = path.join(root, 'data', 'production-audio');
  const files = walkFiles(dest).map((full) => {
    const rel = path.relative(dest, full).replace(/\\/g, '/');
    return { rel: rel, bytes: fs.statSync(full).size, sha256: sha256File(full) };
  });
  const manifest = loadJson(path.join(dest, 'manifest.json'));
  return {
    files: files.length,
    bytes: files.reduce((s, f) => s + f.bytes, 0),
    voice: (manifest.voice || []).length,
    music: (manifest.music || []).length,
    entrance: (manifest.entrance || []).length,
    manifestSha256: sha256File(path.join(dest, 'manifest.json')),
    fileMap: files.reduce((acc, f) => { acc[f.rel] = f; return acc; }, Object.create(null)),
    schemaVersion: manifest.schemaVersion,
    entranceMixVersion: manifest.entranceMixVersion,
  };
}

function isBattlegroundsCard(raw) {
  if (!raw) return false;
  const type = String(raw.type || '');
  const set = String(raw.set || '');
  if (type.indexOf('BATTLEGROUND') === 0) return true;
  if (set === 'BATTLEGROUNDS' || set.indexOf('TB_BACON') === 0) return true;
  return false;
}

function isHeroSkin(raw) {
  return !!(raw && raw.set === 'HERO_SKINS');
}

function isForbiddenCandidate(raw) {
  if (!raw) return true;
  if (FILTERED_TYPES[raw.type]) return true;
  if (isBattlegroundsCard(raw)) return true;
  if (isHeroSkin(raw)) return true;
  if (!PLAYABLE_TYPES[raw.type]) return true;
  return false;
}

function sourceDirs(root, kind) {
  if (kind === 'voice') {
    return [
      path.join(root, 'tmp', 'production-audio-extract', 'voice'),
      path.join(root, 'tmp', 'audio'),
      path.join(root, 'tmp', 'audio-verification'),
    ];
  }
  if (kind === 'music') {
    return [
      path.join(root, 'tmp', 'production-audio-extract', 'music'),
      path.join(root, 'tmp', 'music'),
    ];
  }
  return [
    path.join(root, 'tmp', 'production-audio-extract', 'entrance'),
    path.join(root, 'tmp', 'preview'),
  ];
}

function candidateNames(kind, mappingKey, cardId) {
  if (kind === 'entrance') return [cardId + '_entrance_v3.wav'];
  const names = [];
  const a = mappingKey + '.wav';
  const b = safeName(mappingKey) + '.wav';
  names.push(a);
  if (b !== a) names.push(b);
  return names;
}

function findSources(root, kind, mappingKey, cardId) {
  const names = candidateNames(kind, mappingKey, cardId);
  const hits = [];
  const seen = Object.create(null);
  sourceDirs(root, kind).forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    names.forEach((name) => {
      const full = path.join(dir, name);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return;
      const abs = path.resolve(full);
      if (seen[abs]) return;
      seen[abs] = true;
      hits.push({
        path: full,
        bytes: fs.statSync(full).size,
        sha256: sha256File(full),
        valid: isPlayableWav(full) && isRiffWave(full),
      });
    });
  });
  const bySha = Object.create(null);
  hits.forEach((h) => {
    if (!bySha[h.sha256]) bySha[h.sha256] = [];
    bySha[h.sha256].push(h);
  });
  const uniqueSha = Object.keys(bySha);
  return { hits: hits, uniqueSha: uniqueSha, names: names };
}

function destRelFor(kind, mappingKey, cardId) {
  if (kind === 'voice') return 'voice/' + safeName(mappingKey) + '.wav';
  if (kind === 'music') return 'music/' + safeName(mappingKey) + '.wav';
  return 'entrance/' + cardId + '_entrance_v3.wav';
}

function slotKind(audioType) {
  if (audioType === 'music') return 'music';
  if (audioType === 'entrance') return 'entrance';
  return 'voice';
}

function indexedSlots(cardId, raw) {
  const out = [];
  VOICE_TYPES.forEach((type) => {
    const slot = raw && raw.voice && raw.voice[type];
    if (!voicePlayable(slot)) return;
    out.push({ audioType: type, mappingKey: slot.voiceKey, kind: 'voice' });
  });
  if (musicPlayable(raw && raw.music)) {
    const key = raw.music.audioClipName || raw.music.musicAssetId;
    if (key) out.push({ audioType: 'music', mappingKey: key, kind: 'music' });
  }
  if (raw && raw.entrancePreview && raw.entrancePreview.available) {
    out.push({ audioType: 'entrance', mappingKey: cardId + '_entrance_v3', kind: 'entrance' });
  }
  return out;
}

function collectDisplayableRelated(unified) {
  const cards = (unified && unified.cards) || {};
  const index = createRelatedCardIndex(cards);
  const dummyInv = createProductionAudioInventory({ voice: [], music: [], entrance: [] });
  const seen = Object.create(null);
  const cardsOut = [];
  const filterCounts = { enchantment: 0, heroPower: 0, bg: 0, depth: 0, heroSkin: 0, other: 0 };
  const structured = collectStructuredRelations(Object.keys(cards).map((id) => cards[id]));
  structured.forEach((edge) => {
    const child = cards[edge.relatedCardId];
    if (!child) return;
    if (FILTERED_TYPES[child.type] && child.type === 'ENCHANTMENT') filterCounts.enchantment += 1;
    else if (child.type === 'HERO_POWER') filterCounts.heroPower += 1;
    else if (isBattlegroundsCard(child) || (edge.relationType && String(edge.relationType).indexOf('battlegrounds') === 0)) {
      filterCounts.bg += 1;
    } else if (isHeroSkin(child)) filterCounts.heroSkin += 1;
    else if (!shouldDisplayRelatedEdge(edge, child)) filterCounts.other += 1;
  });

  Object.keys(cards).forEach((parentId) => {
    const parent = cards[parentId];
    if (!parent || parent.collectible !== true) return;
    const tree = getDisplayRelatedCards(parentId, index, dummyInv);
    function walk(nodes, depth, immediateParent) {
      (nodes || []).forEach((node) => {
        if (depth > RELATED_DEPTH_MAX) {
          filterCounts.depth += 1;
          return;
        }
        if (!seen[node.id]) {
          const raw = cards[node.id];
          if (isForbiddenCandidate(raw)) {
            if (FILTERED_TYPES[raw && raw.type]) {
              /* display model should have hidden these */
            }
            return;
          }
          seen[node.id] = {
            cardId: node.id,
            name: node.name,
            type: node.type,
            parentId: immediateParent,
            depth: depth,
            collectibleParentId: parentId,
          };
          cardsOut.push(seen[node.id]);
        }
        walk(node.relatedCards, depth + 1, node.id);
      });
    }
    walk(tree, 1, parentId);
  });

  return { cards: cardsOut, filterCounts: filterCounts, index: index };
}

function classifySlot(root, card, slot) {
  const destRel = destRelFor(slot.kind, slot.mappingKey, card.cardId);
  const destAbs = path.join(root, 'data', 'production-audio', destRel);
  const productionExists = fs.existsSync(destAbs);
  const found = findSources(root, slot.kind, slot.mappingKey, card.cardId);
  const validHits = found.hits.filter((h) => h.valid);
  const validSha = [];
  validHits.forEach((h) => {
    if (validSha.indexOf(h.sha256) < 0) validSha.push(h.sha256);
  });
  let status = 'SOURCE_MISSING';
  let source = null;
  if (validSha.length > 1) {
    status = 'AMBIGUOUS';
  } else if (validSha.length === 1) {
    source = validHits.find((h) => h.sha256 === validSha[0]);
    if (productionExists) {
      const destSha = sha256File(destAbs);
      status = destSha === source.sha256 ? 'ALREADY_PRESENT' : 'CONFLICT';
    } else {
      status = 'READY_TO_COPY';
    }
  } else if (productionExists) {
    status = 'ALREADY_PRESENT';
  } else {
    status = 'SOURCE_MISSING';
  }
  return {
    cardId: card.cardId,
    name: card.name,
    type: card.type,
    parentId: card.parentId,
    depth: card.depth,
    audioType: slot.audioType,
    mappingKey: slot.mappingKey,
    destRel: destRel,
    destAbs: destAbs,
    productionExists: productionExists,
    sourcePath: source ? source.path : null,
    sourceBytes: source ? source.bytes : 0,
    sourceSha256: source ? source.sha256 : null,
    status: status,
    alias: slot.kind === 'voice' && slot.mappingKey !== card.cardId,
  };
}

function emptyTypeStats() {
  const o = {};
  AUDIO_TYPES.forEach((t) => {
    o[t] = { indexed: 0, sourceFound: 0, sourceMissing: 0, alreadyPresent: 0, conflict: 0, ready: 0, ambiguous: 0, copied: 0 };
  });
  return o;
}

function runRelatedAudioProductionAudit(opts) {
  opts = opts || {};
  const root = opts.root;
  const unified = opts.unified || loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const collected = collectDisplayableRelated(unified);
  const filterBug = [];
  collected.cards.forEach((card) => {
    const raw = unified.cards[card.cardId];
    if (FILTERED_TYPES[raw && raw.type]) filterBug.push(card.cardId + ':' + (raw && raw.type));
  });

  const slots = [];
  collected.cards.forEach((card) => {
    const raw = unified.cards[card.cardId];
    indexedSlots(card.cardId, raw).forEach((slot) => {
      slots.push(classifySlot(root, card, slot));
    });
  });

  const byType = emptyTypeStats();
  slots.forEach((s) => {
    const st = byType[s.audioType];
    st.indexed += 1;
    if (s.sourcePath) st.sourceFound += 1;
    if (s.status === 'SOURCE_MISSING') st.sourceMissing += 1;
    if (s.status === 'ALREADY_PRESENT') st.alreadyPresent += 1;
    if (s.status === 'CONFLICT') st.conflict += 1;
    if (s.status === 'READY_TO_COPY') st.ready += 1;
    if (s.status === 'AMBIGUOUS') st.ambiguous += 1;
  });

  const summary = {
    cardCandidates: collected.cards.length,
    slotCandidates: slots.length,
    indexed: slots.length,
    sourceFound: slots.filter((s) => !!s.sourcePath).length,
    sourceMissing: slots.filter((s) => s.status === 'SOURCE_MISSING').length,
    alreadyPresent: slots.filter((s) => s.status === 'ALREADY_PRESENT').length,
    conflict: slots.filter((s) => s.status === 'CONFLICT').length,
    ready: slots.filter((s) => s.status === 'READY_TO_COPY').length,
    ambiguous: slots.filter((s) => s.status === 'AMBIGUOUS').length,
    filterBug: filterBug.length,
    byType: byType,
  };

  const blocked = summary.conflict > 0 || summary.filterBug > 0;
  return {
    phase: '2.10-E',
    generatedAt: new Date().toISOString(),
    summary: summary,
    filterCounts: collected.filterCounts,
    filterBug: filterBug,
    cards: collected.cards,
    slots: slots,
    blocked: blocked,
    blockReason: summary.filterBug > 0 ? 'FILTER_BUG' : (summary.conflict > 0 ? 'CONFLICT' : null),
  };
}

function uniqueReadyCopies(slots) {
  const seen = Object.create(null);
  const out = [];
  slots.forEach((s) => {
    if (s.status !== 'READY_TO_COPY') return;
    if (seen[s.destRel]) return;
    seen[s.destRel] = true;
    out.push(s);
  });
  return out;
}

function copyOne(src, dest) {
  if (fs.existsSync(dest)) throw new Error('refusing to overwrite ' + dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  fs.copyFileSync(src, tmp);
  if (!isPlayableWav(tmp) || sha256File(tmp) !== sha256File(src)) {
    fs.unlinkSync(tmp);
    throw new Error('temp copy failed validation for ' + dest);
  }
  fs.renameSync(tmp, dest);
}

function appendManifest(root, copiedSlots, unified) {
  const dest = path.join(root, 'data', 'production-audio');
  const manifestPath = path.join(dest, 'manifest.json');
  const manifest = loadJson(manifestPath);
  if (manifest.schemaVersion !== 1) throw new Error('unexpected schemaVersion');
  const voiceIndex = buildVoiceKeyIndex((unified && unified.cards) || {});
  const musicIndex = buildMusicIndex((unified && unified.cards) || {});
  const existing = { voice: Object.create(null), music: Object.create(null), entrance: Object.create(null) };
  (manifest.voice || []).forEach((row) => { existing.voice[row.file] = true; });
  (manifest.music || []).forEach((row) => { existing.music[row.file] = true; });
  (manifest.entrance || []).forEach((row) => { existing.entrance[row.file] = true; });
  const added = { voice: 0, music: 0, entrance: 0 };

  copiedSlots.forEach((s) => {
    const bytes = fs.statSync(s.destAbs).size;
    const sha = sha256File(s.destAbs);
    if (s.kind === 'voice' || s.audioType === 'play' || s.audioType === 'attack' || s.audioType === 'death') {
      if (existing.voice[s.destRel]) return;
      const rec = voiceIndex.get(s.mappingKey);
      if (!rec) throw new Error('voiceKey not in audio index: ' + s.mappingKey);
      manifest.voice.push({
        file: s.destRel,
        bytes: bytes,
        sha256: sha,
        voiceKey: rec.voiceKey,
        cardIds: rec.cardIds.slice(),
        types: rec.types.slice(),
      });
      existing.voice[s.destRel] = true;
      added.voice += 1;
    } else if (s.audioType === 'music') {
      if (existing.music[s.destRel]) return;
      const cardIds = (musicIndex.byClip.get(s.mappingKey) || [s.cardId]).slice();
      manifest.music.push({
        file: s.destRel,
        bytes: bytes,
        sha256: sha,
        cardId: s.cardId,
        audioClip: s.mappingKey,
        cardIds: cardIds,
      });
      existing.music[s.destRel] = true;
      added.music += 1;
    } else if (s.audioType === 'entrance') {
      if (existing.entrance[s.destRel]) return;
      manifest.entrance.push({
        file: s.destRel,
        bytes: bytes,
        sha256: sha,
        cardId: s.cardId,
      });
      existing.entrance[s.destRel] = true;
      added.entrance += 1;
    }
  });

  manifest.voice.sort((a, b) => String(a.file).localeCompare(String(b.file)));
  manifest.music.sort((a, b) => String(a.file).localeCompare(String(b.file)));
  manifest.entrance.sort((a, b) => String(a.file).localeCompare(String(b.file)));
  manifest.generatedAt = new Date().toISOString();
  const tmp = manifestPath + '.part';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, manifestPath);
  verifyProductionPackage(dest);
  return added;
}

function applyReadyCopies(root, audit) {
  if (audit.blocked) throw new Error('refusing copy: ' + audit.blockReason);
  const ready = uniqueReadyCopies(audit.slots);
  const copied = [];
  ready.forEach((s) => {
    copyOne(s.sourcePath, s.destAbs);
    copied.push(s);
  });
  return copied;
}

function existingModified(before, after) {
  let modified = 0;
  Object.keys(before.fileMap).forEach((rel) => {
    if (rel === 'manifest.json') return;
    const prev = before.fileMap[rel];
    const next = after.fileMap[rel];
    if (!next || next.sha256 !== prev.sha256 || next.bytes !== prev.bytes) modified += 1;
  });
  return modified;
}

function slotLookup(audit, cardId, audioType) {
  for (let i = 0; i < audit.slots.length; i++) {
    if (audit.slots[i].cardId === cardId && audit.slots[i].audioType === audioType) return audit.slots[i];
  }
  return null;
}

function cardSlotLine(audit, cardId, audioType) {
  const raw = arguments[3];
  const s = slotLookup(audit, cardId, audioType);
  if (!s) return 'NOT_APPLICABLE';
  if (s.status === 'ALREADY_PRESENT' || s.status === 'READY_TO_COPY') {
    if (s.productionExists || s.status === 'ALREADY_PRESENT') return 'AVAILABLE';
    return s.status;
  }
  return s.status;
}

function renderDryRun(audit) {
  const t = audit.summary.byType;
  const conflicts = audit.slots.filter((s) => s.status === 'CONFLICT');
  const missing = audit.slots.filter((s) => s.status === 'SOURCE_MISSING');
  const ready = audit.slots.filter((s) => s.status === 'READY_TO_COPY');
  function block(name, st) {
    return [
      name + '_INDEXED=' + st.indexed,
      name + '_SOURCE_FOUND=' + st.sourceFound,
      name + '_SOURCE_MISSING=' + st.sourceMissing,
      name + '_ALREADY_PRESENT=' + st.alreadyPresent,
      name + '_CONFLICT=' + st.conflict,
      name + '_READY=' + st.ready,
    ].join('\n');
  }
  return [
    '========================================',
    'PHASE 2.10-E DRY RUN',
    '====================',
    '',
    'CARD_CANDIDATES=' + audit.summary.cardCandidates,
    'SLOT_CANDIDATES=' + audit.summary.slotCandidates,
    '',
    block('PLAY', t.play),
    '',
    block('ATTACK', t.attack),
    '',
    block('DEATH', t.death),
    '',
    block('MUSIC', t.music),
    '',
    block('ENTRANCE', t.entrance),
    '',
    'TOTAL_READY_TO_COPY=' + audit.summary.ready,
    'CONFLICT=' + audit.summary.conflict,
    'AMBIGUOUS=' + audit.summary.ambiguous,
    'FILTER_BUG=' + audit.summary.filterBug,
    '',
    'CONFLICT_LIST=',
    conflicts.length ? conflicts.map((s) => s.cardId + ' ' + s.audioType + ' ' + s.destRel).join('\n') : '(none)',
    '',
    'SOURCE_MISSING_COUNT=' + missing.length,
    '',
    'READY_TO_COPY_FIRST_20=',
    ready.slice(0, 20).map((s) => s.cardId + ' ' + s.audioType + ' ' + s.mappingKey).join('\n') || '(none)',
    '',
    '========================================',
    '',
  ].join('\n');
}

module.exports = {
  AUDIO_TYPES,
  FOCUS_12,
  PLAYABLE_TYPES,
  snapshotProduction,
  isForbiddenCandidate,
  isBattlegroundsCard,
  collectDisplayableRelated,
  indexedSlots,
  classifySlot,
  runRelatedAudioProductionAudit,
  uniqueReadyCopies,
  applyReadyCopies,
  appendManifest,
  existingModified,
  slotLookup,
  renderDryRun,
  destRelFor,
  findSources,
};
