# Phase 2.8-D Production Server Local HTTP Verification

Phase 2.8-D: COMPLETE VERIFIED

## System

- Ubuntu 24.04.4 LTS
- x86_64
- Node v22.23.2

## Git

- branch: master
- HEAD: a7230d6
- working tree: CLEAN (except this untracked report)

## Production audio

- 649 files
- 483129187 bytes (du -sh: 463M)
- voice=350
- music=200
- entrance=98
- manifest VALID (schemaVersion=1, entranceMixVersion=3)

## Production ENV

ENV_VALID

NODE_ENV=production
HS_AUDIO_SOURCE=production
MINI_HOST=127.0.0.1
MINI_PORT=8767
Supabase: OPTIONAL/MISSING

`.env` was not modified. Bind address is 127.0.0.1 as configured.

## Production package

PACKAGE_READY

## Production tests

PRODUCTION_TESTS_PASS

## Production Server

STARTED = YES
PORT = 8767
BIND = 127.0.0.1

`/health` is 404 (route does not exist). Actual health route: `/api/mini/health`.

## HTTP

Health (`/api/mini/health`) = PASS
Catalog (`/api/mini/catalog`, total=7263) = PASS
Latest (`/api/mini/latest`, ESCAPEFROM_VIOLET_HOLD, 164) = PASS
Voice HIT (`/api/audio/voice/AT_003/play`, 200 audio/wav, 415788 bytes) = PASS
Music HIT (`/api/audio/music/AT_027`, 200 audio/wav, 1305228 bytes) = PASS
Entrance HIT (`/api/audio/entrance/AT_072`, 200 audio/wav, 2843628 bytes) = PASS
Production MISS (`/api/audio/voice/CAP_107/play`, 404 AUDIO_NOT_AVAILABLE) = PASS
AUDIO_NOT_AVAILABLE = PASS

Unknown id `ZZZ_NO_SUCH_CARD_999` returned 404 `NO_VOICE` (not in catalog). CAP_107 is catalog-playable with no production file and returned `AUDIO_NOT_AVAILABLE`.

## Extractor

NOT CALLED

Startup log: `loading card-audio-index.json (no Hearthstone scan)...`
Banner mentions `未修改 C:\Hearthstone` as a static notice, not an extractor call.

## Windows Hearthstone dependency

NONE

## Server after test

STOPPED

8767 no longer listening.

## Deployment

Nginx: NOT CONFIGURED
HTTPS: NOT CONFIGURED
Public HTTP: NOT TESTED
UFW: NOT MODIFIED

## Security

.env NOT TRACKED
production-audio NOT TRACKED

No git add / commit / push.
