'use strict';

const fs = require('fs');
const path = require('path');
const {
  snapshotProduction,
  runRelatedAudioProductionAudit,
  renderDryRun,
} = require('../src/audit/relatedAudioProductionAudit.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-E-production-audit.json');
const OUT_MD = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-E-report.md');

const before = snapshotProduction(ROOT);
const audit = runRelatedAudioProductionAudit({ root: ROOT });
const after = snapshotProduction(ROOT);

if (before.manifestSha256 !== after.manifestSha256 || before.files !== after.files) {
  console.error('STOP audit mutated production');
  process.exit(2);
}

const json = {
  phase: '2.10-E',
  mode: 'DRY_RUN',
  generatedAt: audit.generatedAt,
  historyRead: 'YES',
  productionBefore: {
    files: before.files,
    voice: before.voice,
    music: before.music,
    entrance: before.entrance,
    bytes: before.bytes,
    manifestSha256: before.manifestSha256,
  },
  summary: audit.summary,
  filterCounts: audit.filterCounts,
  filterBug: audit.filterBug,
  blocked: audit.blocked,
  blockReason: audit.blockReason,
  conflicts: audit.slots.filter((s) => s.status === 'CONFLICT'),
  ambiguous: audit.slots.filter((s) => s.status === 'AMBIGUOUS'),
  ready: audit.slots.filter((s) => s.status === 'READY_TO_COPY'),
  sourceMissing: audit.slots.filter((s) => s.status === 'SOURCE_MISSING'),
  cards: audit.cards,
};

fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_MD, [
  '# Phase 2.10-E Related Audio Production (DRY RUN)',
  '',
  renderDryRun(audit),
  'HISTORY_READ=YES',
  'COPY=NOT_EXECUTED',
  'PRODUCTION_AUDIO_CHANGED=NO',
  '',
].join('\n'), 'utf8');

console.log(renderDryRun(audit));
console.log('json=' + OUT_JSON);
if (audit.blocked) {
  console.log('PHASE_2_10_E=BLOCKED');
  console.log('BLOCKED_REASON=' + audit.blockReason);
  process.exit(3);
}
console.log('DRY_RUN=PASS');
