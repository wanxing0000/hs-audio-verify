'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  snapshotProduction,
} = require('../src/audit/relatedAudioProductionAudit.js');
const {
  runRelatedAudioDiscovery,
  compactDiscovery,
  renderDiscoveryMarkdown,
} = require('../src/audit/relatedAudioDiscovery.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-G-related-audio-discovery.json');
const OUT_MD = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-G-report.md');
const EXPECTED_SHA = 'a7cd2e1e923348123064e4f67dafe1aa255a266576871ae47493f90569376bec';

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function gitShort() {
  const r = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim().replace(/\r?\n/g, ' | ');
}

const before = snapshotProduction(ROOT);
const drift = before.manifestSha256 !== EXPECTED_SHA || before.files !== 685 || before.voice !== 386;
const result = runRelatedAudioDiscovery({ root: ROOT });
const after = snapshotProduction(ROOT);
const mutated = before.manifestSha256 !== after.manifestSha256 || before.files !== after.files || before.bytes !== after.bytes;

if (mutated) {
  console.error('PRODUCTION_MUTATION_DETECTED');
}

const json = compactDiscovery(result);
json.git = { head: gitHead(), worktree: gitShort(), branch: 'master' };
json.baseline.after = {
  files: after.files,
  bytes: after.bytes,
  voice: after.voice,
  music: after.music,
  entrance: after.entrance,
  manifestSha256: after.manifestSha256,
};
json.baseline.drift = drift ? 'YES' : 'NO';
json.safety = {
  PRODUCTION_AUDIO_MODIFIED: mutated ? 'YES' : 'NO',
  EXTRACTOR: 'NOT_CALLED',
  HEARTHSTONE: 'NOT_ACCESSED',
};

const extra = {
  status: mutated ? 'BLOCKED' : 'COMPLETE_VERIFIED',
  gitHead: json.git.head,
  worktree: json.git.worktree,
  filesAfter: after.files,
  voiceAfter: after.voice,
  musicAfter: after.music,
  entranceAfter: after.entrance,
  manifestAfter: after.manifestSha256,
  mutation: mutated ? 'YES' : 'NO',
  drift: drift ? 'YES' : 'NO',
};

fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_MD, renderDiscoveryMarkdown(result, extra), 'utf8');

const s = result.summary;
console.log('PHASE_2_10_G_DISCOVERY_WRITTEN');
console.log('CARD_CANDIDATES=' + s.cardCandidates);
console.log('READY=' + s.ready);
console.log('SOURCE_MISSING=' + s.sourceMissing);
console.log('NO_MAPPING=' + s.noMapping);
console.log('CONFLICT=' + s.conflict);
console.log('REGRESSION=' + (result.regression ? 'YES' : 'NO'));
console.log('PRODUCTION_MUTATION=' + (mutated ? 'YES' : 'NO'));
console.log('BASELINE_DRIFT=' + (drift ? 'YES' : 'NO'));
if (mutated) process.exit(2);
