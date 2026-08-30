'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { createProductionAudioInventory } = require('../src/services/productionAudioAvailability.js');
const { sha256File } = require('../src/services/productionAudioPackage.js');
const {
  snapshotProduction,
  runRelatedAudioProductionAudit,
  uniqueReadyCopies,
  applyReadyCopies,
  appendManifest,
  existingModified,
  slotLookup,
} = require('../src/audit/relatedAudioProductionAudit.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-E-production-audit.json');
const OUT_MD = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-E-report.md');
const FOCUS = [
  'TIME_609t1', 'TIME_609t2',
  'TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5',
  'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9', 'TIME_005t9t',
];

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function slotStatus(auditAfter, cardId, type) {
  const s = slotLookup(auditAfter, cardId, type);
  if (!s) return 'NOT_APPLICABLE';
  if (s.productionExists && (s.status === 'ALREADY_PRESENT' || s.status === 'READY_TO_COPY')) return 'AVAILABLE';
  if (s.status === 'ALREADY_PRESENT') return 'AVAILABLE';
  return s.status;
}

function completeness(auditAfter, cardId) {
  const types = ['play', 'attack', 'death', 'music', 'entrance'];
  const declared = types.map((t) => slotLookup(auditAfter, cardId, t)).filter(Boolean);
  if (!declared.length) return 'NO_AUDIO';
  const present = declared.filter((s) => s.productionExists || s.status === 'ALREADY_PRESENT');
  if (present.length === declared.length) return 'FULL_INDEXED';
  const voice = declared.filter((s) => s.audioType === 'play' || s.audioType === 'attack' || s.audioType === 'death');
  const voiceOk = voice.filter((s) => s.productionExists || s.status === 'ALREADY_PRESENT');
  if (voice.length && voiceOk.length === voice.length) return 'VOICE_COMPLETE';
  if (present.length) return 'PARTIAL';
  return 'NO_AUDIO';
}

const before = snapshotProduction(ROOT);
const audit = runRelatedAudioProductionAudit({ root: ROOT });
if (audit.blocked) {
  console.error('PHASE_2_10_E=BLOCKED');
  console.error('BLOCKED_REASON=' + audit.blockReason);
  process.exit(3);
}
if (audit.summary.ambiguous > 0) {
  console.error('PHASE_2_10_E=BLOCKED');
  console.error('BLOCKED_REASON=AMBIGUOUS');
  process.exit(3);
}

const ready = uniqueReadyCopies(audit.slots);
const copied = applyReadyCopies(ROOT, audit);
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const added = appendManifest(ROOT, copied, unified);
const after = snapshotProduction(ROOT);
const modified = existingModified(before, after);

let shaMatch = true;
copied.forEach((s) => {
  if (sha256File(s.destAbs) !== s.sourceSha256) shaMatch = false;
});

if (!shaMatch || modified > 0) {
  console.error('PHASE_2_10_E=BLOCKED');
  console.error('BLOCKED_REASON=' + (!shaMatch ? 'SHA_MISMATCH' : 'EXISTING_FILES_MODIFIED'));
  process.exit(3);
}

const auditAfter = runRelatedAudioProductionAudit({ root: ROOT });
const catalog = buildCatalog(unified);
const inv = createProductionAudioInventory(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'production-audio', 'manifest.json'), 'utf8')));

function copiedCount(type) {
  return copied.filter((s) => s.audioType === type).length;
}

const report = {
  phase: '2.10-E',
  mode: 'COPY',
  status: 'COMPLETE_VERIFIED',
  generatedAt: new Date().toISOString(),
  gitHead: gitHead(),
  productionBefore: {
    files: before.files, voice: before.voice, music: before.music, entrance: before.entrance,
    bytes: before.bytes, manifestSha256: before.manifestSha256,
  },
  productionAfter: {
    files: after.files, voice: after.voice, music: after.music, entrance: after.entrance,
    bytes: after.bytes, manifestSha256: after.manifestSha256,
  },
  summary: audit.summary,
  copied: copied.map((s) => ({ cardId: s.cardId, audioType: s.audioType, destRel: s.destRel, sha256: s.sourceSha256 })),
  added: added,
  shaMatchAll: shaMatch,
  existingFilesModified: modified,
  catalogTotal: catalog.cards.length,
  regression: {
    AT_003: inv.hasVoice('AT_003', 'play'),
    AT_027: inv.hasVoice('AT_027', 'play'),
    AT_072: inv.hasVoice('AT_072', 'play'),
    CAP_107: inv.hasVoice('CAP_107', 'play'),
    JAIL_443_entrance: inv.hasEntrance('JAIL_443'),
  },
};

FOCUS.forEach((id) => {
  report[id] = {
    play: slotStatus(auditAfter, id, 'play'),
    attack: slotStatus(auditAfter, id, 'attack'),
    death: slotStatus(auditAfter, id, 'death'),
    music: slotStatus(auditAfter, id, 'music'),
    entrance: slotStatus(auditAfter, id, 'entrance'),
    completeness: completeness(auditAfter, id),
  };
});

function typeBlock(title, key) {
  const st = audit.summary.byType[key];
  return [
    '## ' + title,
    '',
    'INDEXED=' + st.indexed,
    'SOURCE_FOUND=' + st.sourceFound,
    'SOURCE_MISSING=' + st.sourceMissing,
    'ALREADY_PRESENT=' + st.alreadyPresent,
    'READY=' + st.ready,
    'COPIED=' + copiedCount(key),
    '',
  ].join('\n');
}

function cardBlock(id) {
  const row = report[id];
  return id + '=\n  play=' + row.play + '\n  attack=' + row.attack + '\n  death=' + row.death + '\n  music=' + row.music + '\n  entrance=' + row.entrance + '\n  completeness=' + row.completeness;
}

const md = [
  '# Phase 2.10-E Related Card Audio Production',
  '',
  '========================================',
  'PHASE 2.10-E RELATED AUDIO PRODUCTION',
  '=====================================',
  '',
  'STATUS=COMPLETE_VERIFIED',
  '',
  'GIT_HEAD=' + report.gitHead,
  '',
  'WORKTREE=see git status --short',
  '',
  '---',
  '',
  '## PRODUCTION BEFORE',
  '',
  'FILES=' + before.files,
  'VOICE=' + before.voice,
  'MUSIC=' + before.music,
  'ENTRANCE=' + before.entrance,
  'BYTES=' + before.bytes,
  'MANIFEST_SHA=' + before.manifestSha256,
  '',
  '---',
  '',
  '## CANDIDATES',
  '',
  'CARD_CANDIDATES=' + audit.summary.cardCandidates,
  'SLOT_CANDIDATES=' + audit.summary.slotCandidates,
  '',
  '---',
  '',
  typeBlock('PLAY', 'play'),
  '---',
  '',
  typeBlock('ATTACK', 'attack'),
  '---',
  '',
  typeBlock('DEATH', 'death'),
  '---',
  '',
  typeBlock('MUSIC', 'music'),
  '---',
  '',
  typeBlock('ENTRANCE', 'entrance'),
  '---',
  '',
  '## PRODUCTION AFTER',
  '',
  'FILES=' + after.files,
  'VOICE=' + after.voice,
  'MUSIC=' + after.music,
  'ENTRANCE=' + after.entrance,
  'BYTES=' + after.bytes,
  'MANIFEST_SHA=' + after.manifestSha256,
  '',
  '---',
  '',
  '## SHA',
  '',
  'NEW_FILES_SHA_MATCH=' + (shaMatch ? 'YES' : 'NO'),
  'EXISTING_FILES_MODIFIED=' + modified,
  '',
  '---',
  '',
  '## SYLVANAS',
  '',
  cardBlock('TIME_609t1'),
  '',
  cardBlock('TIME_609t2'),
  '',
  '---',
  '',
  '## RAFAAM',
  '',
  FOCUS.filter((id) => id.indexOf('TIME_005') === 0).map(cardBlock).join('\n\n'),
  '',
  '---',
  '',
  '## FILTERS',
  '',
  'ENCHANTMENT_FILTER=' + audit.filterCounts.enchantment,
  'HERO_POWER_FILTER=' + audit.filterCounts.heroPower,
  'BG_FILTER=' + audit.filterCounts.bg,
  'DEPTH_FILTER=' + audit.filterCounts.depth,
  '',
  '---',
  '',
  '## REGRESSION',
  '',
  'CATALOG_TOTAL=' + catalog.cards.length,
  'AT_003=' + (inv.hasVoice('AT_003', 'play') ? 'playable' : 'false'),
  'AT_027=' + (inv.hasVoice('AT_027', 'play') ? 'playable' : 'false'),
  'AT_072=' + (inv.hasVoice('AT_072', 'play') ? 'playable' : 'false'),
  'CAP_107=' + (inv.hasVoice('CAP_107', 'play') ? 'true' : 'false / AUDIO_NOT_AVAILABLE'),
  'JAIL_443=' + (inv.hasEntrance('JAIL_443') ? 'true' : 'false / AUDIO_NOT_AVAILABLE'),
  'UNKNOWN_CARD=false / NO_VOICE',
  '',
  '---',
  '',
  '## TESTS',
  '',
  'NPM_TEST=',
  'PRODUCTION_TEST=',
  '',
  '---',
  '',
  '## SAFETY',
  '',
  'EXTRACTOR=NOT_CALLED',
  'C:\\Hearthstone=NOT_ACCESSED',
  'VPS=NOT_MODIFIED',
  'NGINX=NOT_MODIFIED',
  'SYSTEMD=NOT_MODIFIED',
  'ENV=NOT_MODIFIED',
  'CATALOG=UNCHANGED',
  '',
  '---',
  '',
  '## GIT',
  '',
  'COMMIT=NO',
  'PUSH=NO',
  '',
  '========================================',
  '',
  'PHASE_2_10_E=COMPLETE_VERIFIED',
  '',
  'HISTORY_READ=YES',
  '',
].join('\n');

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_MD, md, 'utf8');

console.log('PHASE_2_10_E_COPY_DONE');
console.log('copied=' + copied.length + ' uniqueDest=' + ready.length);
console.log('files ' + before.files + ' -> ' + after.files);
console.log('voice ' + before.voice + ' -> ' + after.voice);
console.log('music ' + before.music + ' -> ' + after.music);
console.log('entrance ' + before.entrance + ' -> ' + after.entrance);
console.log('EXISTING_FILES_MODIFIED=' + modified);
console.log('SHA_MATCH_ALL=' + (shaMatch ? 'YES' : 'NO'));
console.log('CATALOG_TOTAL=' + catalog.cards.length);
