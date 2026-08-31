'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  EXPECTED_FAMILY,
  loadAndValidateTargets,
  createSession,
  dryRunTargets,
  extractFound,
  identityCheck,
  groupByCard,
  snapshotProduction,
} = require('./phase210I1TargetedExtraction.js');

const ROOT = process.cwd();

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function gitBranch() {
  const r = spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function gitShort() {
  const r = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim().replace(/\r?\n/g, ' | ');
}

function renderReport(payload) {
  const d = payload.dryRun.counts;
  const e = payload.extraction;
  const w = payload.wav;
  const idn = payload.identity;
  const pb = payload.productionBefore;
  const pa = payload.productionAfter;
  const lines = [
    '# Phase 2.10-I-1 First Batch Targeted Extraction',
    '',
    '========================================',
    'PHASE 2.10-I-1',
    'FIRST BATCH TARGETED EXTRACTION RESULT',
    '========================================',
    '',
    'STATUS=' + payload.status,
    '',
    '----------------------------------------',
    'GIT',
    '----------------------------------------',
    '',
    'BRANCH=' + payload.git.branch,
    'HEAD=' + payload.git.head,
    'HEAD_MISMATCH=' + payload.git.headMismatch,
    'WORKTREE_BASELINE=' + payload.git.worktree,
    '',
    '----------------------------------------',
    'FIRST BATCH',
    '----------------------------------------',
    '',
    'ROOT_PARENT=' + EXPECTED_FAMILY,
    'NAME=沃罗尼招募官',
    '',
    'TARGET_CARDS=8',
    'TARGET_SLOTS=24',
    'PLAY=8',
    'ATTACK=8',
    'DEATH=8',
    '',
    '----------------------------------------',
    'TARGET VALIDATION',
    '----------------------------------------',
    '',
    'INDEXED=' + payload.validation.stats.INDEXED,
    'VOICEKEY_RESOLVED=' + payload.validation.stats.VOICEKEY_RESOLVED,
    'ALIAS_MAPPING=' + payload.validation.stats.ALIAS_MAPPING,
    'AMBIGUOUS=' + payload.validation.stats.AMBIGUOUS,
    'NO_MAPPING=' + payload.validation.stats.NO_MAPPING,
    'INVALID_TYPE=' + payload.validation.stats.INVALID_TYPE,
    'HERO_SKIN_COLLISION=' + payload.validation.stats.HERO_SKIN_COLLISION,
    '',
    '----------------------------------------',
    'SOURCE DISCOVERY',
    '----------------------------------------',
    '',
    'TARGETS_TOTAL=24',
    'SOURCE_FOUND=' + d.FOUND,
    'SOURCE_MISSING=' + d.MISSING,
    'AMBIGUOUS=' + d.AMBIGUOUS,
    'INVALID=' + d.INVALID,
    'PARTIAL_EXTRACTION=' + (payload.partial ? 'YES' : 'NO'),
    '',
    '----------------------------------------',
    'EXTRACTION',
    '----------------------------------------',
    '',
    'EXTRACTION_ATTEMPTED=' + e.attempted,
    'EXTRACTION_SUCCESS=' + e.success,
    'EXTRACTION_FAILED=' + e.failed,
    '',
    '----------------------------------------',
    'WAV VALIDATION',
    '----------------------------------------',
    '',
    'WAV_VALID=' + w.valid,
    'WAV_INVALID=' + w.invalid,
    'WAV_MISSING=' + w.missing,
    '',
    '----------------------------------------',
    'IDENTITY',
    '----------------------------------------',
    '',
    'IDENTITY_CONFLICT=' + idn.IDENTITY_CONFLICT,
    'DUPLICATE_OUTPUT=' + idn.DUPLICATE_OUTPUT,
    'SHA_CONFLICT=' + idn.SHA_CONFLICT,
    '',
    '----------------------------------------',
    'PER CARD',
    '----------------------------------------',
    '',
  ];
  payload.perCard.forEach((card) => {
    lines.push('CARD_ID=' + card.cardId);
    lines.push('CARD_NAME=' + card.name);
    SLOT: {
      const order = ['play', 'attack', 'death'];
      order.forEach((slot) => {
        const s = card.slots[slot];
        if (!s) {
          lines.push(slot + '=MISSING_ROW');
          return;
        }
        lines.push(slot + '=');
        lines.push('  voiceKey=' + s.voiceKey);
        lines.push('  sourceStatus=' + s.sourceStatus);
        lines.push('  extracted=' + s.extracted);
        lines.push('  wavValid=' + s.wavValid);
      });
    }
    lines.push('');
  });
  lines.push('----------------------------------------');
  lines.push('PRODUCTION INTEGRITY');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('FILES_BEFORE=' + pb.files);
  lines.push('FILES_AFTER=' + pa.files);
  lines.push('VOICE_BEFORE=' + pb.voice);
  lines.push('VOICE_AFTER=' + pa.voice);
  lines.push('MUSIC_BEFORE=' + pb.music);
  lines.push('MUSIC_AFTER=' + pa.music);
  lines.push('ENTRANCE_BEFORE=' + pb.entrance);
  lines.push('ENTRANCE_AFTER=' + pa.entrance);
  lines.push('BYTES_BEFORE=' + pb.bytes);
  lines.push('BYTES_AFTER=' + pa.bytes);
  lines.push('MANIFEST_SHA_BEFORE=' + pb.manifestSha256);
  lines.push('MANIFEST_SHA_AFTER=' + pa.manifestSha256);
  lines.push('PRODUCTION_AUDIO_CHANGED=' + (payload.productionChanged ? 'YES' : 'NO'));
  lines.push('');
  lines.push('TEMP_OUTPUT=' + payload.destDir);
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('TESTS');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('npm test=' + (payload.tests && payload.tests.npmTest || 'PENDING'));
  lines.push('npm run test:production=' + (payload.tests && payload.tests.productionTest || 'PENDING'));
  lines.push('phase210I1 test=' + (payload.tests && payload.tests.phase210I1 || 'PENDING'));
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('SAFETY');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('FULL_EXTRACTOR=NOT_CALLED');
  lines.push('C_HEARTHSTONE_ACCESSED=YES');
  lines.push('TARGETED_ONLY=YES');
  lines.push('PRODUCTION_AUDIO_MODIFIED=NO');
  lines.push('MANIFEST_MODIFIED=NO');
  lines.push('WAV_COPIED_TO_PRODUCTION=0');
  lines.push('VPS=NOT_MODIFIED');
  lines.push('NGINX=NOT_MODIFIED');
  lines.push('SYSTEMD=NOT_MODIFIED');
  lines.push('ENV=NOT_MODIFIED');
  lines.push('GIT_ADD=NOT_CALLED');
  lines.push('GIT_COMMIT=NO');
  lines.push('GIT_PUSH=NO');
  lines.push('');
  lines.push('PHASE_2_10_I_1=' + payload.status);
  lines.push('NEXT_PHASE=NOT_STARTED');
  lines.push('');
  return lines.join('\n') + '\n';
}

async function main() {
  const expectedHead = '1d7ba785a196ac1e83ed13f5f910086e92467fac';
  const head = gitHead();
  const before = snapshotProduction(ROOT);
  const validated = loadAndValidateTargets(ROOT);
  if (validated.blocked) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=' + validated.blockReason);
    console.error(JSON.stringify(validated.stats || validated.detail || {}, null, 2));
    process.exit(3);
  }

  const session = createSession(ROOT);
  console.log('PHASE_2_10_I_1 targeted extract');
  console.log('FAMILY=' + EXPECTED_FAMILY);
  console.log('TARGETS=' + validated.targets.length);
  console.log('DEST=' + session.destDir);
  console.log('HS_WIN=' + session.hsWin);
  console.log('DRY_RUN=START');

  const dry = await dryRunTargets(session, validated.targets);
  console.log('SOURCE_FOUND=' + dry.counts.FOUND);
  console.log('SOURCE_MISSING=' + dry.counts.MISSING);
  console.log('AMBIGUOUS=' + dry.counts.AMBIGUOUS);
  console.log('INVALID=' + dry.counts.INVALID);

  if ((dry.counts.AMBIGUOUS || 0) > 0 || (dry.counts.INVALID || 0) > 0) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=SOURCE_RESOLUTION_AMBIGUOUS_OR_INVALID');
    process.exit(4);
  }

  const extracted = await extractFound(session, dry.rows);
  const identity = identityCheck(extracted);
  if (identity.IDENTITY_CONFLICT > 0 || identity.DUPLICATE_OUTPUT > 0 || identity.SHA_CONFLICT > 0) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=EXTRACTION_IDENTITY_CONFLICT');
    console.error(JSON.stringify(identity));
    process.exit(5);
  }

  const attempted = extracted.filter((r) => r.sourceFound).length;
  const success = extracted.filter((r) => r.extracted && r.wavValid).length;
  const failed = extracted.filter((r) => r.sourceFound && (!r.extracted || !r.wavValid)).length;
  const wavValid = extracted.filter((r) => r.wavValid).length;
  const wavInvalid = extracted.filter((r) => r.extracted && !r.wavValid).length;
  const wavMissing = extracted.filter((r) => r.sourceFound && !r.extracted).length;
  const after = snapshotProduction(ROOT);
  const slim = (s) => ({
    files: s.files,
    bytes: s.bytes,
    voice: s.voice,
    music: s.music,
    entrance: s.entrance,
    manifestSha256: s.manifestSha256,
    schemaVersion: s.schemaVersion,
    entranceMixVersion: s.entranceMixVersion,
  });
  const changed = before.manifestSha256 !== after.manifestSha256
    || before.files !== after.files
    || before.bytes !== after.bytes
    || before.voice !== after.voice;

  if (changed) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=UNEXPECTED_PRODUCTION_MUTATION');
    process.exit(6);
  }
  if (wavInvalid > 0) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=WAV_INVALID');
  }

  const partial = dry.counts.FOUND < 24 || success < dry.counts.FOUND;
  let status = 'COMPLETE_VERIFIED';
  if (wavInvalid > 0) status = 'BLOCKED';
  else if (partial) status = 'PARTIAL_VERIFIED';

  const payload = {
    phase: '2.10-I-1',
    status: status,
    generatedAt: new Date().toISOString(),
    extractorMode: 'TARGETED_ONLY',
    family: EXPECTED_FAMILY,
    git: {
      branch: gitBranch(),
      head: head,
      headMismatch: head === expectedHead ? 'NO' : 'YES',
      worktree: gitShort(),
    },
    validation: { stats: validated.stats, cards: validated.cards },
    dryRun: { counts: dry.counts, rows: dry.rows },
    extraction: { attempted: attempted, success: success, failed: failed },
    wav: { valid: wavValid, invalid: wavInvalid, missing: wavMissing },
    identity: identity,
    partial: partial,
    destDir: path.relative(ROOT, session.destDir).replace(/\\/g, '/'),
    productionBefore: slim(before),
    productionAfter: slim(after),
    productionChanged: false,
    tests: {
      npmTest: 'PENDING',
      productionTest: 'PENDING',
      phase210I1: 'PENDING',
    },
    results: extracted,
    perCard: groupByCard(extracted),
    safety: {
      FULL_EXTRACTOR: 'NOT_CALLED',
      TARGETED_ONLY: 'YES',
      PRODUCTION_AUDIO_MODIFIED: 'NO',
      C_HEARTHSTONE_ACCESSED: 'YES',
    },
  };

  const jsonPath = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-1-extraction-result.json');
  const mdPath = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-1-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, renderReport(payload), 'utf8');
  console.log('STATUS=' + status);
  console.log('json=' + jsonPath);
  console.log('md=' + mdPath);
  if (status === 'BLOCKED') process.exit(7);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
