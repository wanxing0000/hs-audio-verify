# Phase 2.9-A Production Audio Availability Truth

## Root Cause

Catalog Audio Mapping means the Hearthstone/index data knows a voice, music, or entrance mapping (for example JAIL_443 `entrancePreview` from play + stinger). Production Audio Availability means the WAV is listed in `data/production-audio/manifest.json` and can be served. The Mini Program was using mapping as playable truth, so JAIL_443 advertised `entrancePreview.available=true` while `GET /api/audio/entrance/JAIL_443` returned 404 `AUDIO_NOT_AVAILABLE` and DevTools tried to decode JSON as audio.

## Architecture

- Mapping source: `card-audio-index.json` via `adaptCard` / `getCardAudioAvailability` / `publicDetail`
- Production availability source: read-only `manifest.json` via `src/services/productionAudioAvailability.js`
- Final source of truth for Mini Program `available` flags in production: mapping AND manifest
- Development: no overlay; production-audio is not required

## JAIL_443

- catalog mapping exists: YES (entrance + music + play voice)
- production entrance file missing
- production voice play present
- production music missing
- final advertised entrance availability: false
- audio endpoint: HTTP 404 `AUDIO_NOT_AVAILABLE`

## Positive Cases

- AT_003 voice play: advertised true
- AT_027 music: advertised true
- AT_072 entrance: advertised true

## Production Miss

- CAP_107 voice play: advertised false (still 404 `AUDIO_NOT_AVAILABLE`)

## Tests

- npm test: PASS
- npm run test:production: PASS

## Production Audio Integrity

- Before SHA256: `8def0fcce41ee413a4503e9202b59322be787c71a6330e98015146f81ac1ab08`
- After SHA256: `8def0fcce41ee413a4503e9202b59322be787c71a6330e98015146f81ac1ab08`
- Files: 649
- voice=350 music=200 entrance=98

## Extractor

NOT CALLED

## Windows Hearthstone

NOT REQUIRED

## Git

NO COMMIT
NO PUSH
.env not tracked
data/production-audio not tracked
