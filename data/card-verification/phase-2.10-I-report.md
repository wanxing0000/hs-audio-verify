# Phase 2.10-I Related Audio Extraction Priority Audit

========================================
PHASE 2.10-I RELATED AUDIO EXTRACTION PRIORITY AUDIT
========================================

STATUS=COMPLETE_VERIFIED

GIT_HEAD=1d7ba785a196ac1e83ed13f5f910086e92467fac
WORKTREE=M package.json |  M project.config.json |  M project.private.config.json |  M scripts/test-production.cjs |  M src/audit/relatedAudioDiscovery.js | ?? data/card-verification/phase-2.10-C-report.md | ?? phase-2.10-D-G-before-cleanup.patch | ?? scripts/run-phase210-extraction-priority.cjs | ?? src/audit/phase210ExtractionPriority.js | ?? test/phase210ExtractionPriority.test.js

This phase is a read-only priority audit. It did not call the extractor,
did not access C:\Hearthstone, did not copy WAV files, did not modify
production-audio or manifest.json, did not modify the VPS, and did not commit or push.
The first batch is a candidate list only. Phase 2.10-I-1 requires explicit user confirmation.

----------------------------------------
PRODUCTION BASELINE
----------------------------------------

FILES=685
VOICE=386
MUSIC=200
ENTRANCE=98
MANIFEST_SHA=a7cd2e1e923348123064e4f67dafe1aa255a266576871ae47493f90569376bec
PRODUCTION_MUTATION=NO

----------------------------------------
RELATION / UI
----------------------------------------

LEGAL_RELATED_CARDS=1191
UI_VISIBLE=1116
UI_HIDDEN=75
UI_DEPTH_LIMIT=2
AUDIT_DEPTH_LIMIT=3
UI_CARD_LIMIT=12

UI hidden candidates are legal related cards that are beyond the first-12 parent slice
or otherwise not attached in the current card-page tree. They must not be mixed into P0.

----------------------------------------
AUDIO GAP
----------------------------------------

TOTAL_SLOT_CANDIDATES=3573
PLAY_MISSING_INDEXED=1026
ATTACK_MISSING_INDEXED=1032
DEATH_MISSING_INDEXED=1033
ALREADY_COMPLETE=22
PRODUCTION_MISSING=3091
SOURCE_MISSING=3091
NO_MAPPING=408

----------------------------------------
PRIORITY SUMMARY
----------------------------------------

P0_CARDS=961
P0_FAMILIES=688
P1_CARDS=66
P1_FAMILIES=1
P2_CARDS=6
P2_FAMILIES=2
P3_CARDS=1
P3_FAMILIES=0
P4_CARDS=135
P4_FAMILIES=68
EXCLUDED=0
ALREADY_COMPLETE=22

----------------------------------------
TOP PRIORITY FAMILIES
----------------------------------------

1. ROOT_PARENT=GDB_471
   NAME=沃罗尼招募官
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

2. ROOT_PARENT=TOY_814
   NAME=玩具兵盒
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

3. ROOT_PARENT=TTN_480
   NAME=元素激励
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

4. ROOT_PARENT=TTN_719
   NAME=废料回收
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

5. ROOT_PARENT=WC_034
   NAME=小队集合
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

6. ROOT_PARENT=WW_345
   NAME=荒芜之地劫掠者
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

7. ROOT_PARENT=WW_810
   NAME=迷彩坐骑
   CARD_COUNT=8 UI_VISIBLE=8
   MISSING_PLAY=8 MISSING_ATTACK=8 MISSING_DEATH=8
   TOTAL_MISSING=24 PRIORITY=P0 AMBIGUOUS=0 READY=true

8. ROOT_PARENT=ICC_828
   NAME=死亡猎手雷克萨
   CARD_COUNT=7 UI_VISIBLE=7
   MISSING_PLAY=7 MISSING_ATTACK=7 MISSING_DEATH=7
   TOTAL_MISSING=21 PRIORITY=P0 AMBIGUOUS=0 READY=true

9. ROOT_PARENT=TRL_343
   NAME=战争德鲁伊罗缇
   CARD_COUNT=7 UI_VISIBLE=7
   MISSING_PLAY=7 MISSING_ATTACK=7 MISSING_DEATH=7
   TOTAL_MISSING=21 PRIORITY=P0 AMBIGUOUS=0 READY=true

10. ROOT_PARENT=CATA_550
   NAME=熔喉
   CARD_COUNT=6 UI_VISIBLE=6
   MISSING_PLAY=6 MISSING_ATTACK=6 MISSING_DEATH=6
   TOTAL_MISSING=18 PRIORITY=P0 AMBIGUOUS=0 READY=true

----------------------------------------
FIRST BATCH
----------------------------------------

STATUS=SELECTED
FAMILIES=GDB_471
CARDS=8
SLOTS=24
PLAY=8
ATTACK=8
DEATH=8
CARD_LIST=GDB_471t,GDB_471t2,GDB_471t3,GDB_471t4,GDB_471t5,GDB_471t6,GDB_471t7,GDB_471t8
SLOT_PLAN_FILE=data/card-verification/phase-2.10-I-extraction-priority.json

The first batch is a candidate only. Do not extract until the user confirms Phase 2.10-I-1.

----------------------------------------
READINESS
----------------------------------------

READY_FOR_PHASE_2_10_I_1=true
BLOCK_REASON=NONE
ALL_INDEXED=true
ALL_VOICE_KEYS_RESOLVED=true
AMBIGUOUS=0
CONFLICT=0
HERO_SKIN_COLLISION=0
ENCHANTMENT_CONTAMINATION=0
BG_CONTAMINATION=0
ALREADY_COMPLETE_INCLUDED=0

----------------------------------------
SAFETY
----------------------------------------

EXTRACTOR=NOT_CALLED
C:\Hearthstone=NOT_ACCESSED
WAV_COPIED=0
PRODUCTION_AUDIO_MODIFIED=NO
MANIFEST_MODIFIED=NO
VPS=NOT_MODIFIED
NGINX=NOT_MODIFIED
SYSTEMD=NOT_MODIFIED
ENV=NOT_MODIFIED
GIT_COMMIT=NO
GIT_PUSH=NO

PHASE_2_10_I=COMPLETE_VERIFIED
NEXT_PHASE=PHASE_2_10_I_1_REQUIRES_CONFIRMATION

