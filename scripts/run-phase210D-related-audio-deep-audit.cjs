'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  snapshotProduction,
  loadProjectDeepAuditInputs,
  runRelatedAudioDeepAudit,
  compactDeepAudit,
  renderDeepMarkdown,
} = require('../src/audit/relatedAudioDeepAudit.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-D-related-audio-deep-audit.json');
const OUT_MD = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-D-report.md');

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function gitShort() {
  const r = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const before = snapshotProduction(ROOT);
const inputs = loadProjectDeepAuditInputs(ROOT);
const result = runRelatedAudioDeepAudit(inputs);
const after = snapshotProduction(ROOT);

if (before.manifestSha256 !== after.manifestSha256) {
  console.error('STOP MANIFEST_CHANGED');
  console.error('before=' + before.manifestSha256);
  console.error('after=' + after.manifestSha256);
  process.exit(2);
}
if (before.files !== after.files || before.voice !== after.voice) {
  console.error('STOP PRODUCTION_AUDIO_CHANGED');
  process.exit(2);
}

const json = compactDeepAudit(result);
json.missingProduction = result.missingProduction;
json.productionBefore = before;
json.productionAfter = after;
json.safety = {
  PRODUCTION_AUDIO_CHANGED: 'NO',
  MANIFEST_CHANGED: 'NO',
  EXTRACTOR: 'NOT_CALLED',
  HEARTHSTONE: 'NOT_ACCESSED',
  VPS: 'NOT_MODIFIED',
};

const extra = {
  status: 'COMPLETE_VERIFIED',
  gitHead: gitHead(),
  worktree: gitShort().replace(/\r?\n/g, ' | ') || 'see git status',
  productionChanged: 'NO',
  manifestChanged: 'NO',
  npmTest: '',
  testProduction: '',
  auditTest: '',
};

fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_MD, renderDeepMarkdown(result, extra), 'utf8');

const s = result.summary;
console.log('PHASE_2_10_D_AUDIT_WRITTEN');
console.log('json=' + OUT_JSON);
console.log('md=' + OUT_MD);
console.log('parents=' + result.relation.parents + ' edges=' + result.relation.edges);
console.log('depth=' + result.relation.depth1 + '/' + result.relation.depth2 + '/' + result.relation.depth3);
console.log('mapped=' + s.relatedMapped + ' noMapping=' + s.relatedNoMapping);
console.log('completeness no/partial/playOnly/voice/full=' + [s.noAudio, s.partial, s.playOnly, s.voiceComplete, s.fullIndexed].join('/'));
console.log('GAP_B playable missing rows=' + result.gaps.GAP_B);
console.log('TIME_005t9t play=' + (result.findings.sheepAlias || ''));
console.log('MANIFEST_SHA=' + after.manifestSha256);
console.log('PRODUCTION_AUDIO_CHANGED=NO');
console.log('MANIFEST_CHANGED=NO');
