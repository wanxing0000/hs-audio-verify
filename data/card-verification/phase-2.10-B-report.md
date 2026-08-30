# Phase 2.10-B Related Card Audio Production Copy

========================================
PHASE 2.10-B RELATED AUDIO PRODUCTION RESULT
========================================

STATUS=COMPLETE_VERIFIED

TARGETS_TOTAL=12

SOURCE_FOUND=12
SOURCE_MISSING=0
WAV_VALID=12
WAV_INVALID=0
AMBIGUOUS=0

ALREADY_PRESENT=0
TO_COPY=12
CONFLICT=0

COPIED=12

----------------------------------------
PRODUCTION AUDIO
----------------------------------------

FILES_BEFORE=649
FILES_AFTER=661

BYTES_BEFORE=483129187
BYTES_AFTER=487882720

VOICE_BEFORE=350
VOICE_AFTER=362

MUSIC_BEFORE=200
MUSIC_AFTER=200

ENTRANCE_BEFORE=98
ENTRANCE_AFTER=98

MANIFEST_SHA256_BEFORE=8def0fcce41ee413a4503e9202b59322be787c71a6330e98015146f81ac1ab08
MANIFEST_SHA256_AFTER=9cd9d82fff14c39805229e169a49cb32ff173d5487993092e7f0fc684d7b7135

EXISTING_FILES_MODIFIED=0

NEW_WAV_BYTES=4749556
AUDIO_BYTES_AFTER=487681100

----------------------------------------
TARGETS
----------------------------------------

TIME_609t1=PASS play=VO_TIME_609t1_Female_HighElf_Play_01 sha256=aaf1f1f79e92a0752f47e3cd825b7fbdfa8fcf7c6f5cb0763e6686a1c9643cc3
TIME_609t2=PASS play=VO_TIME_609t2_Female_HighElf_Play_01 sha256=2541cdc94ecaa15dbd26a20656c98f16482e52a99c07431fa04840ce9d2abef2

TIME_005t1=PASS play=VO_TIME_005t1_Male_Ethereal_Play_01 sha256=8680ce727f38c589c231a5744ac5e40c619f2123e7afe19d1083c274b91996de
TIME_005t2=PASS play=VO_TIME_005t2_Male_Ethereal_Play_01 sha256=a72601bca0b024d6e599093c2051422eeb0477434bfdc6eee4b628ada3fab66e
TIME_005t3=PASS play=VO_TIME_005t3_Male_Ethereal_Play_01 sha256=a6f87eaba8934f9c1f88f60b19d5dba624d9c5a1607f6afe3c133edf09633526
TIME_005t4=PASS play=VO_TIME_005t4_Male_Ethereal_Play_01 sha256=f77676beb7fe02418009fbe8278f77d51adaedb7e33385793916950921ebaa55
TIME_005t5=PASS play=VO_TIME_005t5_Male_EtherealFaceless_Play_01 sha256=de50bb5ed19c6e341b18b8cf8cb87f6ce16f8ff5a37cc2eedf2498255d0abf6f
TIME_005t6=PASS play=VO_TIME_005t6_Male_EtherealDemon_Play_01 sha256=e17e1b955eaf930c78d27425934d3ef23c5afb8e88b8e693ff439e64aa0240ec
TIME_005t7=PASS play=VO_TIME_005t7_Male_Ethereal_Play_01 sha256=23a7b604e93c219a5272171740cd79959234d1d249834cf8e906f9ec5dc14f8f
TIME_005t8=PASS play=VO_TIME_005t8_Male_EtherealMurloc_Play_01 sha256=6ffa80c5394b2c9bf487604543d1119cc3be984860058b51e6515c73b263d7a7
TIME_005t9=PASS play=VO_TIME_005t9_Female_Ethereal_Play_01 sha256=a230b97f6edc022ca8b0f4ca09c87bfd5c09a192f2617b882e26a381879f8b6f
TIME_005t9t=PASS play=TIME_005t9t_Play sha256=fcc38e23de7e2f26678ce058fe6cb119bf6aa8c19173e3e745a313f3d6a9d91a

----------------------------------------
AVAILABILITY
----------------------------------------

TIME_609t1:
indexed=YES
production=YES
playable=YES

TIME_609t2:
indexed=YES
production=YES
playable=YES

TIME_005 family:
indexed=YES
production=YES
playable=YES

----------------------------------------
PARENT DETAIL
----------------------------------------

TIME_609=PASS
TIME_005=PASS

relatedCards displayed=YES
main catalog total=7263

----------------------------------------
NEGATIVE CASES
----------------------------------------

JAIL_443=PASS
CAP_107=PASS

----------------------------------------
TESTS
----------------------------------------

npm test=PASS
npm run test:production=PASS
npm run production:check-package=PASS
npm run audio:production:check=PASS

----------------------------------------
SCOPE
----------------------------------------

EXTRACTOR=NOT_CALLED
C:\Hearthstone=NOT_ACCESSED

VPS=NOT_MODIFIED
NGINX=NOT_MODIFIED
SYSTEMD=NOT_MODIFIED
ENV=NOT_MODIFIED

CATALOG=UNCHANGED

PRE_EXISTING_DIRTY=
- miniprogram/pages/card/card.js
- miniprogram/pages/card/card.wxml
- miniprogram/pages/card/card.wxss
- project.config.json
- project.private.config.json
- src/miniprogram/catalogAdapter.js
- src/miniprogram/miniServer.js
- test/latestImageBatch.test.js

THIS_PHASE_ALSO_TOUCHED=
- data/production-audio/voice/ (12 new play WAVs; gitignored)
- data/production-audio/manifest.json (gitignored)
- data/card-verification/phase-2.10-B-*.md/json
- src/audit/relatedAudioProductionCopy.js
- scripts/copy-related-audio-production.cjs
- test/phase210BProductionCopy.test.js
- test/relatedCardDisplay.test.js
- test/phase210RelatedAudioAudit.test.js
- package.json
- scripts/test-production.cjs

----------------------------------------
GIT
----------------------------------------

COMMIT=NO
PUSH=NO

WORKTREE=DIRTY
HEAD=d8576aca51197be49c25359ea7c77e6367209e39

----------------------------------------
FINAL
----------------------------------------

PHASE_2_10_B=COMPLETE_VERIFIED

NEXT_PHASE=NOT_STARTED
