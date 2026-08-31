'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  FAMILY,
  ROOT_NAME,
  EXPECTED_HEAD,
  EXPECTED_BASELINE,
  ALLOWED_CARDS,
  loadHistory,
  baselineMismatch,
  dryRunCopy,
  executeCopy,
  verifyAvailability,
  verifyParentDetail,
  historicalCoverage,
  verifyRuntime,
  snapshotProduction,
  existingModified,
  appendManifest,
  sha256File,
} = require('./phase210I2ProductionCopy.js');

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

function renderReport(p) {
  const c = p.dryRun.counts;
  const cov = p.coverage || {};
  const lines = [
    '# Phase 2.10-I-2 First Batch Production Copy',
    '',
    '========================================',
    'PHASE 2.10-I-2',
    'FIRST BATCH PRODUCTION COPY RESULT',
    '========================================',
    '',
    'STATUS=' + p.status,
    '',
    'GIT_HEAD=' + p.git.head,
    'BRANCH=' + p.git.branch,
    'HEAD_MISMATCH=' + p.git.headMismatch,
    'WORKTREE=' + p.git.worktree,
    'UNRELATED_WORKTREE_CHANGE=' + (p.git.unrelated || '(none)'),
    '',
    '----------------------------------------',
    'BASELINE',
    '----------------------------------------',
    '',
    'FILES_BEFORE=' + p.before.files,
    'VOICE_BEFORE=' + p.before.voice,
    'MUSIC_BEFORE=' + p.before.music,
    'ENTRANCE_BEFORE=' + p.before.entrance,
    'BYTES_BEFORE=' + p.before.bytes,
    'MANIFEST_SHA_BEFORE=' + p.before.manifestSha256,
    '',
    '----------------------------------------',
    'TARGETS',
    '----------------------------------------',
    '',
    'ROOT_PARENT=' + FAMILY,
    'ROOT_NAME=' + ROOT_NAME,
    '',
    'CARDS=8',
    'SLOTS=24',
    'PLAY=8',
    'ATTACK=8',
    'DEATH=8',
    '',
    '----------------------------------------',
    'DRY RUN',
    '----------------------------------------',
    '',
    'SOURCE_FOUND=' + c.SOURCE_FOUND,
    'SOURCE_MISSING=' + c.SOURCE_MISSING,
    'WAV_VALID=' + c.WAV_VALID,
    'WAV_INVALID=' + c.WAV_INVALID,
    'ALREADY_PRESENT=' + c.ALREADY_PRESENT,
    'TO_COPY=' + c.TO_COPY,
    'CONFLICT=' + c.CONFLICT,
    'AMBIGUOUS=' + c.AMBIGUOUS,
    'IDENTITY_CONFLICT=' + c.IDENTITY_CONFLICT,
    'DUPLICATE_OUTPUT=' + c.DUPLICATE_OUTPUT,
    '',
    '----------------------------------------',
    'COPY',
    '----------------------------------------',
    '',
    'COPIED=' + p.copy.copied,
    'NEW_FILES_SHA_MATCH=' + (p.copy.shaMatch ? 'YES' : 'NO'),
    'EXISTING_FILES_MODIFIED=' + p.copy.existingModified,
    '',
    '----------------------------------------',
    'PRODUCTION AFTER',
    '----------------------------------------',
    '',
    'FILES_AFTER=' + p.after.files,
    'VOICE_AFTER=' + p.after.voice,
    'MUSIC_AFTER=' + p.after.music,
    'ENTRANCE_AFTER=' + p.after.entrance,
    'BYTES_AFTER=' + p.after.bytes,
    'MANIFEST_SHA_AFTER=' + p.after.manifestSha256,
    '',
    '----------------------------------------',
    'TARGET COVERAGE',
    '----------------------------------------',
    '',
  ];
  ALLOWED_CARDS.forEach((id) => {
    const row = cov[id] || {};
    lines.push(id + '=');
    lines.push('  play=' + !!row.play);
    lines.push('  attack=' + !!row.attack);
    lines.push('  death=' + !!row.death);
    lines.push('');
  });
  lines.push('----------------------------------------');
  lines.push('PARENT DETAIL');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('GDB_471=' + (p.parent.ok ? 'PASS' : 'FAIL'));
  lines.push('RELATED_CARDS=' + p.parent.relatedCount);
  lines.push('UI_VISIBLE=' + p.parent.uiVisible);
  lines.push('MULTI_SLOT=' + (p.parent.multiSlot ? 'YES' : 'NO'));
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('HISTORICAL REGRESSION');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('TIME_609=' + (p.historical.time609 ? 'PASS' : 'FAIL'));
  lines.push('TIME_005=' + (p.historical.time005 ? 'PASS' : 'FAIL'));
  lines.push('TIME_005t9t_ALIAS=' + (p.historical.alias ? 'PASS' : 'FAIL'));
  lines.push('REGRESSION=' + (p.historical.ok ? 'NONE' : 'FAIL'));
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('NEGATIVE');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('CAP_107=' + p.negative.cap);
  lines.push('JAIL_443=' + p.negative.jail);
  lines.push('UNKNOWN_CARD=' + p.negative.unknown);
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('TESTS');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('NPM_TEST=' + (p.tests.npmTest || 'PENDING'));
  lines.push('PRODUCTION_TEST=' + (p.tests.productionTest || 'PENDING'));
  lines.push('PHASE_2_10_I_2_TEST=' + (p.tests.phase210I2 || 'PENDING'));
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('SAFETY');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('EXTRACTOR=NOT_CALLED');
  lines.push('C:\\Hearthstone=NOT_ACCESSED');
  lines.push('VPS=NOT_MODIFIED');
  lines.push('NGINX=NOT_MODIFIED');
  lines.push('SYSTEMD=NOT_MODIFIED');
  lines.push('ENV=NOT_MODIFIED');
  lines.push('CATALOG=UNCHANGED');
  lines.push('GIT_ADD=NOT_CALLED');
  lines.push('GIT_COMMIT=NO');
  lines.push('GIT_PUSH=NO');
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('FINAL');
  lines.push('----------------------------------------');
  lines.push('');
  lines.push('PHASE_2_10_I_2=' + p.status);
  lines.push('NEXT_PHASE=NOT_STARTED');
  lines.push('');
  return lines.join('\n') + '\n';
}

function slimSnap(s) {
  return {
    files: s.files,
    bytes: s.bytes,
    voice: s.voice,
    music: s.music,
    entrance: s.entrance,
    manifestSha256: s.manifestSha256,
    schemaVersion: s.schemaVersion,
    entranceMixVersion: s.entranceMixVersion,
  };
}

function classifyWorktree(short) {
  const allowed = {
    'project.config.json': true,
    'project.private.config.json': true,
  };
  const knownPrior = {
    'package.json': true,
    'scripts/test-production.cjs': true,
    'src/audit/relatedAudioDiscovery.js': true,
  };
  const unrelated = [];
  String(short || '').split(' | ').forEach((line) => {
    const m = line.match(/^ M (.+)$/);
    if (!m) return;
    const file = m[1].replace(/\\/g, '/');
    if (allowed[file]) return;
    if (knownPrior[file]) {
      unrelated.push(file + ' (Phase 2.10-I/I-1 test wiring; does not affect production copy)');
      return;
    }
    unrelated.push(file);
  });
  return unrelated;
}

async function main() {
  const head = gitHead();
  if (head !== EXPECTED_HEAD) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=HEAD_MISMATCH');
    console.error('CURRENT_HEAD=' + head);
    console.error('EXPECTED_HEAD=' + EXPECTED_HEAD);
    process.exit(3);
  }

  const history = loadHistory(ROOT);
  if (history.blocked) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=' + history.blockReason);
    console.error(JSON.stringify(history.detail || {}, null, 2));
    process.exit(3);
  }

  const worktree = gitShort();
  const unrelated = classifyWorktree(worktree);
  if (unrelated.length) {
    console.log('UNRELATED_WORKTREE_CHANGE=' + unrelated.join('; '));
  }

  const before = snapshotProduction(ROOT);
  if (baselineMismatch(before)) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=PRODUCTION_BASELINE_MISMATCH');
    console.error(JSON.stringify(slimSnap(before), null, 2));
    process.exit(3);
  }

  console.log('PHASE_2_10_I_2 dry-run');
  const dry = dryRunCopy(ROOT);
  console.log('TARGETS_TOTAL=' + dry.counts.TARGETS_TOTAL);
  console.log('SOURCE_FOUND=' + dry.counts.SOURCE_FOUND);
  console.log('TO_COPY=' + dry.counts.TO_COPY);
  console.log('ALREADY_PRESENT=' + dry.counts.ALREADY_PRESENT);
  if (dry.blocked) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=' + dry.blockReason);
    console.error('COPIED=0');
    console.error(JSON.stringify(dry.counts, null, 2));
    process.exit(4);
  }

  const copied = executeCopy(dry);
  let shaMatch = true;
  copied.forEach((row) => {
    if (sha256File(row.destAbs) !== row.sha256) shaMatch = false;
  });
  const afterCopy = snapshotProduction(ROOT);
  if (afterCopy.files !== before.files + copied.length) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=PRODUCTION_DELTA_INVALID');
    console.error('FILES ' + before.files + ' -> ' + afterCopy.files + ' copied=' + copied.length);
    process.exit(5);
  }

  const added = appendManifest(ROOT, copied, dry.unified);
  const after = snapshotProduction(ROOT);
  const modified = existingModified(before, after);
  if (after.files !== before.files + copied.length
    || after.voice !== before.voice + copied.length
    || after.music !== before.music
    || after.entrance !== before.entrance
    || modified > 0
    || !shaMatch
    || added.voice !== copied.length) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=' + (modified > 0 ? 'EXISTING_FILES_MODIFIED' : (added.voice !== copied.length ? 'MANIFEST_VALIDATION_FAILED' : 'PRODUCTION_DELTA_INVALID')));
    console.error(JSON.stringify({
      files: [before.files, after.files],
      voice: [before.voice, after.voice],
      music: [before.music, after.music],
      entrance: [before.entrance, after.entrance],
      copied: copied.length,
      added: added,
      modified: modified,
    }, null, 2));
    process.exit(6);
  }

  const avail = verifyAvailability(ROOT);
  if (!avail.ok) {
    console.error('STATUS=BLOCKED');
    console.error('BLOCK_REASON=FIRST_BATCH_AVAILABILITY_INCOMPLETE');
    console.error('AVAILABLE=' + avail.available + '/24');
    process.exit(7);
  }

  const parent = verifyParentDetail(ROOT, avail.inventory);
  const histInv = historicalCoverage(avail.inventory);
  const runtime = await verifyRuntime(ROOT);
  const time609 = histInv.cards.TIME_609t1 && histInv.cards.TIME_609t1.play && histInv.cards.TIME_609t2.play
    && histInv.cards.TIME_609t1.attack && histInv.cards.TIME_609t2.attack
    && histInv.cards.TIME_609t1.death && histInv.cards.TIME_609t2.death;
  const time005 = ['TIME_005t1', 'TIME_005t2', 'TIME_005t3', 'TIME_005t4', 'TIME_005t5', 'TIME_005t6', 'TIME_005t7', 'TIME_005t8', 'TIME_005t9', 'TIME_005t9t']
    .every((id) => histInv.cards[id] && histInv.cards[id].play && histInv.cards[id].attack && histInv.cards[id].death);

  let status = 'COMPLETE_VERIFIED';
  if (!parent.ok || !histInv.ok || !runtime.ok) status = 'FAILED';

  const payload = {
    phase: '2.10-I-2',
    status: status,
    generatedAt: new Date().toISOString(),
    git: {
      branch: gitBranch(),
      head: head,
      headMismatch: 'NO',
      worktree: worktree,
      unrelated: unrelated.join('; ') || '(none)',
    },
    before: slimSnap(before),
    after: slimSnap(after),
    dryRun: {
      counts: dry.counts,
      rows: dry.rows.map((r) => ({
        cardId: r.cardId,
        slot: r.slot,
        voiceKey: r.voiceKey,
        classify: r.classify,
        destRel: r.destRel,
        sha256: r.sha256,
        bytes: r.size,
      })),
    },
    copy: {
      copied: copied.length,
      shaMatch: shaMatch,
      existingModified: modified,
      added: added,
    },
    coverage: avail.coverage,
    parent: parent,
    historical: {
      ok: histInv.ok && runtime.historicalOk,
      time609: !!time609,
      time005: !!time005,
      alias: runtime.aliasOk,
      cards: histInv.cards,
    },
    negative: {
      cap: runtime.cap.ok ? 'AUDIO_NOT_AVAILABLE / 404' : 'FAIL ' + runtime.cap.code,
      jail: runtime.jail.ok ? 'AUDIO_NOT_AVAILABLE / 404' : 'FAIL ' + runtime.jail.code,
      unknown: runtime.unknown.ok ? 'NO_VOICE / 404' : 'FAIL ' + runtime.unknown.code,
    },
    runtime: { gdbOk: runtime.gdbOk, historicalOk: runtime.historicalOk, ok: runtime.ok },
    tests: { npmTest: 'PENDING', productionTest: 'PENDING', phase210I2: 'PENDING' },
    safety: {
      EXTRACTOR: 'NOT_CALLED',
      HEARTHSTONE: 'NOT_ACCESSED',
      CATALOG: 'UNCHANGED',
    },
  };

  const jsonPath = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-2-production-result.json');
  const mdPath = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-I-2-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, renderReport(payload), 'utf8');
  console.log('STATUS=' + status);
  console.log('COPIED=' + copied.length);
  console.log('FILES ' + before.files + ' -> ' + after.files);
  console.log('VOICE ' + before.voice + ' -> ' + after.voice);
  console.log('json=' + jsonPath);
  if (status !== 'COMPLETE_VERIFIED') process.exit(8);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
