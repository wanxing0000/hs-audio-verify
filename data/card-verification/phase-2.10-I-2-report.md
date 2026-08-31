# Phase 2.10-I-2 First Batch Production Copy

========================================
PHASE 2.10-I-2
FIRST BATCH PRODUCTION COPY RESULT
========================================

STATUS=COMPLETE_VERIFIED

GIT_HEAD=1d7ba785a196ac1e83ed13f5f910086e92467fac
BRANCH=master
HEAD_MISMATCH=NO
WORKTREE=M package.json |  M project.config.json |  M project.private.config.json |  M scripts/test-production.cjs |  M src/audit/relatedAudioDiscovery.js | ?? data/card-verification/phase-2.10-C-report.md | ?? data/card-verification/phase-2.10-I-1-extraction-result.json | ?? data/card-verification/phase-2.10-I-1-report.md | ?? data/card-verification/phase-2.10-I-extraction-priority.json | ?? data/card-verification/phase-2.10-I-report.md | ?? phase-2.10-D-G-before-cleanup.patch | ?? scripts/run-phase210-I-1-first-batch-extraction.cjs | ?? scripts/run-phase210-I-2-first-batch-production-copy.cjs | ?? scripts/run-phase210-extraction-priority.cjs | ?? src/audit/phase210ExtractionPriority.js | ?? src/audit/phase210I1TargetedExtractCli.js | ?? src/audit/phase210I1TargetedExtraction.js | ?? src/audit/phase210I2ProductionCopy.js | ?? src/audit/phase210I2ProductionCopyCli.js | ?? test/phase210ExtractionPriority.test.js | ?? test/phase210I1TargetedExtraction.test.js | ?? test/phase210I2ProductionCopy.test.js
UNRELATED_WORKTREE_CHANGE=scripts/test-production.cjs (Phase 2.10-I/I-1 test wiring; does not affect production copy); src/audit/relatedAudioDiscovery.js (Phase 2.10-I/I-1 test wiring; does not affect production copy)

----------------------------------------
BASELINE
----------------------------------------

FILES_BEFORE=685
VOICE_BEFORE=386
MUSIC_BEFORE=200
ENTRANCE_BEFORE=98
BYTES_BEFORE=493400551
MANIFEST_SHA_BEFORE=a7cd2e1e923348123064e4f67dafe1aa255a266576871ae47493f90569376bec

----------------------------------------
TARGETS
----------------------------------------

ROOT_PARENT=GDB_471
ROOT_NAME=沃罗尼招募官

CARDS=8
SLOTS=24
PLAY=8
ATTACK=8
DEATH=8

----------------------------------------
DRY RUN
----------------------------------------

SOURCE_FOUND=24
SOURCE_MISSING=0
WAV_VALID=24
WAV_INVALID=0
ALREADY_PRESENT=0
TO_COPY=24
CONFLICT=0
AMBIGUOUS=0
IDENTITY_CONFLICT=0
DUPLICATE_OUTPUT=0

----------------------------------------
COPY
----------------------------------------

COPIED=24
NEW_FILES_SHA_MATCH=YES
EXISTING_FILES_MODIFIED=0

----------------------------------------
PRODUCTION AFTER
----------------------------------------

FILES_AFTER=709
VOICE_AFTER=410
MUSIC_AFTER=200
ENTRANCE_AFTER=98
BYTES_AFTER=496546284
MANIFEST_SHA_AFTER=45a26f2c67951e57b4442d81ebc7718bb3d09d2071486d5318685d76a9065ae7

----------------------------------------
TARGET COVERAGE
----------------------------------------

GDB_471t=
  play=true
  attack=true
  death=true

GDB_471t2=
  play=true
  attack=true
  death=true

GDB_471t3=
  play=true
  attack=true
  death=true

GDB_471t4=
  play=true
  attack=true
  death=true

GDB_471t5=
  play=true
  attack=true
  death=true

GDB_471t6=
  play=true
  attack=true
  death=true

GDB_471t7=
  play=true
  attack=true
  death=true

GDB_471t8=
  play=true
  attack=true
  death=true

----------------------------------------
PARENT DETAIL
----------------------------------------

GDB_471=PASS
RELATED_CARDS=8
UI_VISIBLE=8
MULTI_SLOT=YES

----------------------------------------
HISTORICAL REGRESSION
----------------------------------------

TIME_609=PASS
TIME_005=PASS
TIME_005t9t_ALIAS=PASS
REGRESSION=NONE

----------------------------------------
NEGATIVE
----------------------------------------

CAP_107=AUDIO_NOT_AVAILABLE / 404
JAIL_443=AUDIO_NOT_AVAILABLE / 404
UNKNOWN_CARD=NO_VOICE / 404

----------------------------------------
TESTS
----------------------------------------

NPM_TEST=PASS
PRODUCTION_TEST=PASS
PHASE_2_10_I_2_TEST=PASS

----------------------------------------
SAFETY
----------------------------------------

EXTRACTOR=NOT_CALLED
C:\Hearthstone=NOT_ACCESSED
VPS=NOT_MODIFIED
NGINX=NOT_MODIFIED
SYSTEMD=NOT_MODIFIED
ENV=NOT_MODIFIED
CATALOG=UNCHANGED
GIT_ADD=NOT_CALLED
GIT_COMMIT=NO
GIT_PUSH=NO

----------------------------------------
FINAL
----------------------------------------

PHASE_2_10_I_2=COMPLETE_VERIFIED
NEXT_PHASE=NOT_STARTED

