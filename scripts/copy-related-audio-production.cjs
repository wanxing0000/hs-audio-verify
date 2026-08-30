'use strict';

const fs = require('fs');
const path = require('path');
const {
  EXPECTED_BASELINE,
  snapshotProduction,
  sourcePrecheck,
  classifyTargets,
  copyTargets,
  verifyCopies,
  appendManifestVoice,
  existingModified,
} = require('../src/audit/relatedAudioProductionCopy.js');

const ROOT = path.resolve(__dirname, '..');

function writeReports(payload) {
  const jsonPath = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-B-production-copy.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const s = payload.summary || {};
  const lines = [
    '# Phase 2.10-B Related Card Audio Production Copy',
    '',
    'STATUS=' + payload.status,
    'BLOCKED_REASON=' + (payload.blockedReason || ''),
    '',
    'TARGETS_TOTAL=12',
    'SOURCE_FOUND=' + (s.sourceFound != null ? s.sourceFound : ''),
    'SOURCE_MISSING=' + (s.sourceMissing != null ? s.sourceMissing : ''),
    'WAV_VALID=' + (s.wavValid != null ? s.wavValid : ''),
    'WAV_INVALID=' + (s.wavInvalid != null ? s.wavInvalid : ''),
    'AMBIGUOUS=' + (s.ambiguous != null ? s.ambiguous : ''),
    'DUPLICATE=' + (s.duplicate != null ? s.duplicate : ''),
    '',
    'ALREADY_PRESENT=' + (s.alreadyPresent != null ? s.alreadyPresent : ''),
    'TO_COPY=' + (s.toCopy != null ? s.toCopy : ''),
    'CONFLICT=' + (s.conflict != null ? s.conflict : ''),
    'COPIED=' + (s.copied != null ? s.copied : ''),
    '',
    'FILES_BEFORE=' + (payload.baseline && payload.baseline.files),
    'FILES_AFTER=' + (payload.after && payload.after.files),
    'BYTES_BEFORE=' + (payload.baseline && payload.baseline.bytes),
    'BYTES_AFTER=' + (payload.after && payload.after.bytes),
    'VOICE_BEFORE=' + (payload.baseline && payload.baseline.voice),
    'VOICE_AFTER=' + (payload.after && payload.after.voice),
    'MUSIC_AFTER=' + (payload.after && payload.after.music),
    'ENTRANCE_AFTER=' + (payload.after && payload.after.entrance),
    'MANIFEST_SHA256_BEFORE=' + (payload.baseline && payload.baseline.manifestSha256),
    'MANIFEST_SHA256_AFTER=' + (payload.after && payload.after.manifestSha256),
    'EXISTING_FILES_MODIFIED=' + (payload.existingFilesModified != null ? payload.existingFilesModified : ''),
    '',
    'EXTRACTOR=NOT_CALLED',
    'HEARTHSTONE=NOT_ACCESSED',
    'GIT_COMMIT=NO',
    'GIT_PUSH=NO',
    '',
  ];
  fs.writeFileSync(path.join(ROOT, 'data', 'card-verification', 'phase-2.10-B-report.md'), lines.join('\n') + '\n', 'utf8');
}

function blocked(payload, reason) {
  payload.status = 'BLOCKED';
  payload.blockedReason = reason;
  writeReports(payload);
  console.error('PHASE_2_10_B=BLOCKED ' + reason);
  process.exit(2);
}

function main() {
  const payload = {
    phase: '2.10-B',
    status: 'IN_PROGRESS',
    generatedAt: new Date().toISOString(),
    extractor: 'NOT_CALLED',
    hearthstone: 'NOT_ACCESSED',
  };

  const precheck = sourcePrecheck(ROOT);
  payload.sourcePrecheck = precheck.summary;
  payload.summary = Object.assign({}, precheck.summary);
  console.log('PHASE 2.10-B SOURCE PRECHECK');
  console.log(JSON.stringify(precheck.summary));
  if (!precheck.ok) {
    blocked(payload, 'SOURCE_PRECHECK_FAILED');
  }

  const baseline = snapshotProduction(ROOT);
  payload.baseline = {
    files: baseline.files,
    bytes: baseline.bytes,
    voice: baseline.voice,
    music: baseline.music,
    entrance: baseline.entrance,
    voiceFiles: baseline.voiceFiles,
    musicFiles: baseline.musicFiles,
    entranceFiles: baseline.entranceFiles,
    manifestSha256: baseline.manifestSha256,
    schemaVersion: baseline.schemaVersion,
  };
  console.log('PRODUCTION AUDIO BASELINE');
  console.log(JSON.stringify(payload.baseline));
  if (
    baseline.files !== EXPECTED_BASELINE.files
    || baseline.bytes !== EXPECTED_BASELINE.bytes
    || baseline.voice !== EXPECTED_BASELINE.voice
    || baseline.music !== EXPECTED_BASELINE.music
    || baseline.entrance !== EXPECTED_BASELINE.entrance
    || baseline.manifestSha256 !== EXPECTED_BASELINE.manifestSha256
    || baseline.voiceFiles !== EXPECTED_BASELINE.voice
    || baseline.musicFiles !== EXPECTED_BASELINE.music
    || baseline.entranceFiles !== EXPECTED_BASELINE.entrance
  ) {
    payload.baselineChanged = true;
    blocked(payload, 'BASELINE_CHANGED');
  }

  const classified = classifyTargets(ROOT, precheck);
  payload.summary.alreadyPresent = classified.alreadyPresent;
  payload.summary.toCopy = classified.toCopy;
  payload.summary.conflict = classified.conflict;
  console.log('PRODUCTION TARGET DRY RUN');
  console.log(JSON.stringify({
    alreadyPresent: classified.alreadyPresent,
    toCopy: classified.toCopy,
    conflict: classified.conflict,
  }));
  if (classified.conflict !== 0) {
    blocked(payload, 'CONFLICT');
  }
  if (classified.alreadyPresent + classified.toCopy !== 12) {
    blocked(payload, 'CLASSIFY_COUNT');
  }

  const copied = copyTargets(classified);
  payload.summary.copied = copied.length;
  payload.copiedCardIds = copied;

  const copyCheck = verifyCopies(classified);
  payload.copyVerification = copyCheck.rows;
  if (!copyCheck.ok) {
    blocked(payload, 'COPY_VERIFY_FAILED');
  }

  const manifestUpdate = appendManifestVoice(ROOT, classified);
  payload.manifestAdded = manifestUpdate.added;

  const after = snapshotProduction(ROOT);
  payload.after = {
    files: after.files,
    bytes: after.bytes,
    voice: after.voice,
    music: after.music,
    entrance: after.entrance,
    voiceFiles: after.voiceFiles,
    musicFiles: after.musicFiles,
    entranceFiles: after.entranceFiles,
    manifestSha256: after.manifestSha256,
  };
  payload.existingFilesModified = existingModified(baseline, after);

  const expectedFiles = baseline.files + classified.toCopy;
  const expectedVoice = baseline.voice + classified.toCopy;
  const newWavBytes = classified.targets
    .filter((t) => t.classify === 'TO_COPY')
    .reduce((s, t) => s + t.size, 0);
  const beforeManifestBytes = baseline.fileMap['manifest.json'].bytes;
  const afterManifestBytes = after.fileMap['manifest.json'].bytes;
  const expectedBytes = baseline.bytes - beforeManifestBytes + afterManifestBytes + newWavBytes;
  payload.summary.newWavBytes = newWavBytes;
  payload.summary.audioBytesAfter = baseline.bytes - beforeManifestBytes + newWavBytes;
  if (
    after.files !== expectedFiles
    || after.voice !== expectedVoice
    || after.music !== 200
    || after.entrance !== 98
    || after.voiceFiles !== expectedVoice
    || after.musicFiles !== 200
    || after.entranceFiles !== 98
    || after.bytes !== expectedBytes
    || payload.existingFilesModified !== 0
  ) {
    payload.afterExpected = { expectedFiles: expectedFiles, expectedVoice: expectedVoice, expectedBytes: expectedBytes };
    blocked(payload, 'AFTER_SNAPSHOT_MISMATCH');
  }

  payload.status = 'COPIED_VERIFIED';
  writeReports(payload);
  console.log('PHASE_2_10_B=COPIED_VERIFIED');
  console.log(JSON.stringify(payload.after));
}

main();
