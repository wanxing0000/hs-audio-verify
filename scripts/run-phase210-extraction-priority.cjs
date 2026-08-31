'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { snapshotProduction } = require('../src/audit/relatedAudioProductionAudit.js');
const {
  runExtractionPriority,
  renderPriorityMarkdown,
  EXPECTED_SHA,
} = require('../src/audit/phase210ExtractionPriority.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-extraction-priority.json');
const OUT_MD = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-report.md');

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function gitShort() {
  const r = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim().replace(/\r?\n/g, ' | ');
}

const before = snapshotProduction(ROOT);
const result = runExtractionPriority({ root: ROOT });
const after = snapshotProduction(ROOT);
const mutated = before.manifestSha256 !== after.manifestSha256
  || before.files !== after.files
  || before.bytes !== after.bytes;

if (result.blocked) {
  console.error('PHASE_2_10_I=BLOCKED');
  console.error('BLOCK_REASON=' + result.blockReason);
  if (result.expected) console.error('EXPECTED=' + JSON.stringify(result.expected));
  if (result.actual) console.error('ACTUAL=' + JSON.stringify(result.actual));
  process.exit(3);
}

if (mutated) {
  console.error('UNEXPECTED_PRODUCTION_MUTATION');
  process.exit(2);
}

const compact = {
  phase: result.phase,
  generatedAt: result.generatedAt,
  metadata: result.metadata,
  productionBaseline: result.productionBaseline,
  relationBaseline: result.relationBaseline,
  uiBaseline: result.uiBaseline,
  prioritySummary: result.prioritySummary,
  audioGap: result.audioGap,
  familySummary: result.familySummary,
  topPriorityFamilies: result.topPriorityFamilies,
  firstBatch: result.firstBatch,
  firstBatchSlotPlan: result.firstBatchSlotPlan,
  blockedFamilies: result.blockedFamilies,
  excludedSummary: result.excludedSummary,
  readiness: result.readiness,
  priorityCards: result.priorityCards,
  families: result.families,
  git: { head: gitHead(), worktree: gitShort() },
  safety: {
    EXTRACTOR: 'NOT_CALLED',
    HEARTHSTONE: 'NOT_ACCESSED',
    PRODUCTION_AUDIO_MODIFIED: 'NO',
    MANIFEST_MODIFIED: 'NO',
  },
};

const extra = {
  status: 'COMPLETE_VERIFIED',
  gitHead: compact.git.head,
  worktree: compact.git.worktree,
  mutation: 'NO',
};

fs.writeFileSync(OUT_JSON, JSON.stringify(compact, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_MD, renderPriorityMarkdown(result, extra), 'utf8');

console.log('PHASE_2_10_I_WRITTEN');
console.log('P0_CARDS=' + result.prioritySummary.P0_CARDS);
console.log('P0_FAMILIES=' + result.prioritySummary.P0_FAMILIES);
console.log('FIRST_BATCH_STATUS=' + result.firstBatch.status);
console.log('FIRST_BATCH_CARDS=' + result.firstBatch.cardCount);
console.log('FIRST_BATCH_SLOTS=' + result.firstBatch.slotCount);
console.log('READY_FOR_PHASE_2_10_I_1=' + result.readiness.READY_FOR_PHASE_2_10_I_1);
console.log('BLOCK_REASON=' + (result.readiness.BLOCK_REASON || 'NONE'));
console.log('PRODUCTION_MUTATION=NO');
console.log('MANIFEST_SHA=' + after.manifestSha256);
if (after.manifestSha256 !== EXPECTED_SHA) process.exit(2);
