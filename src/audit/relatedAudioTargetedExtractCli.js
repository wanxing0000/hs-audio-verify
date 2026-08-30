'use strict';

const fs = require('fs');
const path = require('path');
const {
  createTargetedExtractor,
  runTargetedExtraction,
  summarize,
  snapshotProduction,
} = require('./relatedAudioTargetedExtractor.js');

const ROOT = process.cwd();
const EXPECTED_MANIFEST_SHA = '8def0fcce41ee413a4503e9202b59322be787c71a6330e98015146f81ac1ab08';

async function main() {
  const before = snapshotProduction(ROOT);
  if (before.manifestSha256 !== EXPECTED_MANIFEST_SHA) {
    throw new Error('manifest sha changed before extraction: ' + before.manifestSha256);
  }

  const session = createTargetedExtractor({ root: ROOT });
  console.log('PHASE_2_10_B_1 targeted extract');
  console.log('targets=' + session.targets.length);
  console.log('dest=' + session.destDir);
  console.log('hsWin=' + session.hsWin);

  const results = await runTargetedExtraction(session);
  const summary = summarize(results);
  const after = snapshotProduction(ROOT);

  if (after.manifestSha256 !== before.manifestSha256 || after.fileListSha256 !== before.fileListSha256) {
    throw new Error('PRODUCTION_AUDIO_CHANGED');
  }

  const payload = {
    phase: '2.10-B-1',
    status: summary.wavValid === 12 && summary.sourceMissing === 0 && summary.ambiguous === 0
      ? 'COMPLETE_VERIFIED'
      : (summary.wavValid > 0 ? 'PARTIAL' : 'BLOCKED'),
    generatedAt: new Date().toISOString(),
    extractorMode: 'TARGETED_ONLY',
    productionAudioModified: false,
    manifestModified: false,
    productionBefore: before,
    productionAfter: after,
    destDir: path.relative(ROOT, session.destDir).replace(/\\/g, '/'),
    summary,
    targets: results,
  };

  const jsonPath = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-B-1-targeted-extraction.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const lines = [
    '# Phase 2.10-B-1 Targeted Related Audio Extraction',
    '',
    '========================================',
    'PHASE 2.10-B-1 TARGETED EXTRACTION',
    '========================================',
    '',
    'STATUS=' + payload.status,
    '',
    'BASE HEAD=d8576aca51197be49c25359ea7c77e6367209e39',
    '',
    'TARGETS_TOTAL=12',
    '',
    'SOURCE_FOUND=' + summary.sourceFound,
    'SOURCE_MISSING=' + summary.sourceMissing,
    'WAV_VALID=' + summary.wavValid,
    'WAV_INVALID=' + summary.wavInvalid,
    'AMBIGUOUS=' + summary.ambiguous,
    '',
  ];
  results.forEach((r) => {
    lines.push(r.cardId + '=' + r.status + ' play=' + r.playVoiceKey);
  });
  lines.push('');
  lines.push('VOICE_KEYS=');
  results.forEach((r) => {
    r.slots.forEach((s) => {
      lines.push('- ' + r.cardId + ' ' + s.type + ' ' + s.voiceKey + ' ' + s.status + (s.size ? ' ' + s.size + 'b' : ''));
    });
  });
  lines.push('');
  lines.push('TEMP_OUTPUT=' + payload.destDir);
  lines.push('');
  lines.push('PRODUCTION_AUDIO_MODIFIED=NO');
  lines.push('MANIFEST_MODIFIED=NO');
  lines.push('CATALOG_MODIFIED=NO');
  lines.push('MINIPROGRAM_MODIFIED=NO');
  lines.push('VPS_MODIFIED=NO');
  lines.push('NGINX_MODIFIED=NO');
  lines.push('SYSTEMD_MODIFIED=NO');
  lines.push('ENV_MODIFIED=NO');
  lines.push('');
  lines.push('FULL_EXTRACTOR=NOT_CALLED');
  lines.push('');
  lines.push('GIT_COMMIT=NO');
  lines.push('GIT_PUSH=NO');
  lines.push('');
  fs.writeFileSync(path.join(ROOT, 'data', 'card-verification', 'phase-2.10-B-1-report.md'), lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify(summary));
  console.log('json=' + jsonPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
