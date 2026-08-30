# Phase 2.10-D Related Card Audio Completeness Deep Audit

========================================
PHASE 2.10-D RELATED AUDIO DEEP AUDIT
========================================

STATUS=COMPLETE_VERIFIED

GIT_HEAD=418b95ab35c05dfeb47d4288da32398863b46b81

WORKTREE=PRE_EXISTING: project.config.json project.private.config.json phase-2.10-C-report.md | PHASE_2_10_D: package.json scripts/test-production.cjs src/audit/relatedAudioDeepAudit.js scripts/run-phase210D-related-audio-deep-audit.cjs test/phase210DRelatedAudioDeepAudit.test.js phase-2.10-D-report.md phase-2.10-D-related-audio-deep-audit.json

----------------------------------------
PRODUCTION BASELINE
----------------------------------------

FILES=661
VOICE=362
MUSIC=200
ENTRANCE=98
MANIFEST_SHA=9cd9d82fff14c39805229e169a49cb32ff173d5487993092e7f0fc684d7b7135

----------------------------------------
RELATION GRAPH
----------------------------------------

PARENTS=2829
EDGES=4754
DEPTH_1=4383
DEPTH_2=367
DEPTH_3=4

----------------------------------------
AUDIO COVERAGE
----------------------------------------

MAPPED=1166
NO_MAPPING=3481
PLAY=1061
ATTACK=1107
DEATH=1146
MUSIC=236
ENTRANCE=207
OTHER=0

----------------------------------------
COMPLETENESS
----------------------------------------

NO_AUDIO=4617
PARTIAL=20
PLAY_ONLY=0
VOICE_COMPLETE=9
FULL_INDEXED=1

----------------------------------------
PRODUCTION GAPS
----------------------------------------

INDEXED_BUT_PRODUCTION_MISSING=3705
PRODUCTION_PRESENT_BUT_NOT_PLAYABLE=0
ALIAS_MAPPINGS=1213
UNINDEXED_PRODUCTION=0

----------------------------------------
GAP CLASSIFICATION
----------------------------------------

GAP_A=3481
GAP_B=3677
GAP_C=20
GAP_D=0
GAP_E=165
GAP_F=2513
GAP_G=0
GAP_H=0
GAP_I=0

----------------------------------------
SYLVANAS
----------------------------------------

TIME_609t1=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_609t2=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

----------------------------------------
RAFAAM
----------------------------------------

TIME_005t1=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t2=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t3=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t4=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t5=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t6=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t7=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t8=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t9=
  play=PLAYABLE
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=INDEXED_BUT_PRODUCTION_MISSING
  entrance=INDEXED_BUT_PRODUCTION_MISSING
  completeness=PARTIAL

TIME_005t9t=
  play=PLAYABLE/ALIAS
  attack=INDEXED_BUT_PRODUCTION_MISSING
  death=INDEXED_BUT_PRODUCTION_MISSING
  music=NOT_APPLICABLE
  entrance=NOT_APPLICABLE
  completeness=PARTIAL

----------------------------------------
NEGATIVE CASES
----------------------------------------

JAIL_443= entrance=INDEXED_BUT_PRODUCTION_MISSING cardRuntimePlayable=true (entrance still unavailable; other slots may be production-present)
CAP_107= play=INDEXED_BUT_PRODUCTION_MISSING cardRuntimePlayable=false

----------------------------------------
SPECIAL FINDINGS
----------------------------------------

- alias: TIME_005t9t play/attack/death = TIME_005t9t_Play / _Attack / _Death (MAPPING_ALIAS for play; attack/death still production-missing). VO_* keys that contain cardId are not counted as alias errors.
- nested relation: TIME_609 → t1/t2 → t2e; TIME_005 → t1..t9 → t9t plus t2e/t8e. Depth3 walked edges=4. UI depth max=2 so depth3 is not shown.
- missing production: 3705 slot-rows (3677 playable-type). By type: play=1026 attack=1090 death=1129 music=230 entrance=202. Full list in phase-2.10-D-related-audio-deep-audit.json.
- partial audio: 20 related cards. The 12 Phase 2.10-B targets plus AT_063t, BAR_034t5, DRG_620t2, DRG_620t3, HERO_01b, TRL_131t, ULD_156t3, WW_001t7.
- unindexed production: 0 voice files. Manifest vs disk: GAP_H=0.
- runtime resolver mismatch: GAP_D=0 / GAP_I=0. Alias keys resolve when the file is in production (TIME_005t9t play).
- relation exposure gap: GAP_E=165 (UI slice first 12 and/or depth>2). Enchantments/hero powers separately GAP_F=2513 FILTERED_NON_PLAYABLE_TYPE.
- Cause A (index has no attack/death): 1 playable-type card. Cause B (index has attack/death, production missing): 1132 cards. Cause C (mini program related 试听 is play-only): 29 cards currently playable via related UI. Cause F (families beyond the 12): 1121 playable-type cards still have missing declared voice slots.
- TIME_609 / TIME_005 parents themselves: index YES, production NO, runtime playable=false. Tokens only received play WAVs in 2.10-B.
- tmp/production-audio-extract/voice has 24 matching attack/death WAVs for the 12 cards (B-1 extract). tmp/audio has 6 matching names. NOT copied this phase.
- Primary structured graph still 7809 edges / same as Phase 2.10. This audit PARENTS=2829 / EDGES=4754 counts only walks from collectible parents at depth<=3 (non-collectible token parents are not roots).
- cards.json relatedCardDbfIds=absent entourage=absent.
- history: parents=5499 edges=7809 missing=11262 candidates=12. All six history files FOUND.

----------------------------------------
SAFETY
----------------------------------------

PRODUCTION_AUDIO_CHANGED=NO
MANIFEST_CHANGED=NO
EXTRACTOR=NOT_CALLED
C:\Hearthstone=NOT_ACCESSED
VPS=NOT_MODIFIED
NGINX=NOT_MODIFIED
SYSTEMD=NOT_MODIFIED
ENV=NOT_MODIFIED

----------------------------------------
TESTS
----------------------------------------

npm test=PASS
npm run test:production=PASS
phase210D audit test=PASS

----------------------------------------
GIT
----------------------------------------

COMMIT=NO
PUSH=NO

----------------------------------------
FINAL
----------------------------------------

PHASE_2_10_D=COMPLETE_VERIFIED
