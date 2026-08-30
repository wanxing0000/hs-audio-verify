# Phase 2.3 Production Audio Migration & Core Coverage Report

## Architecture

development source:

- `HS_AUDIO_SOURCE` unset / empty / `development`
- files: `tmp/audio`, `tmp/music`, `tmp/preview`
- cache hit: play WAV, do not call extractor
- cache miss: allow read-only Hearthstone extract into `tmp`

production source:

- `HS_AUDIO_SOURCE=production` (required; not inferred from `NODE_ENV`)
- files: `data/production-audio/voice|music|entrance`
- cache hit: play WAV
- cache miss: HTTP 404 `{ "error": "暂时无法播放", "code": "AUDIO_NOT_AVAILABLE" }`
- extractor is a guard only; `extractVoice` / bundle scan / entrance mix are not used
- illegal `HS_AUDIO_SOURCE` values fail at Mini boot (`HS_AUDIO_SOURCE_INVALID`)

miss behavior:

- `NO_VOICE` / `NO_MUSIC` / `UNAVAILABLE`: card has no playable slot in the index
- `AUDIO_NOT_AVAILABLE`: slot exists in the index, file is not in the production package
- both are HTTP 404; responses do not include absolute paths

## Production Audio

```text
voice count:     350
music count:     200
entrance count:  98
total bytes:     482931544  (~460.6 MB)
```

Layout:

```text
data/production-audio/
  manifest.json
  voice/{safeName(voiceKey)}.wav
  music/{cardId}_MusicStinger.wav  (or clip name when that is the cache key)
  entrance/{cardId}_entrance_v3.wav
```

Excluded from the package: non-WAV, `*.fsb`, `EX1_116_entrance_preview*`, entrance v1/v2, `tmp/audio` music leftovers, clips not mapped from a card voice slot.

## Manifest

```text
schema version:        1
source:                local-production-audio
entranceMixVersion:    3
voice entries:         350
music entries:         200
entrance entries:      98
hash verification:     PASS (npm run audio:production:check)
```

Each entry has `file`, `bytes`, `sha256`. Voice also has `voiceKey`, `cardIds`, `types`. Music has `cardId` / `audioClip` / `cardIds`. Entrance has `cardId`.

Manifest contains no game install path, no `.unity3d`, no Supabase secrets.

## Core Coverage

Featured (from `featuredCards()`, not hardcoded IDs; 12 cards):

```text
play:      12/12  already_present=10  newly_extracted=2  unavailable=0  failed=0
music:     12/12  already_present=10  newly_extracted=2  unavailable=0  failed=0
entrance:  12/12  already_present=7   newly_extracted=5  unavailable=0  failed=0
```

Newly extracted Featured: `NEW1_024` / `NEW1_038` play+music; `EX1_573` / `EX1_560` / `EX1_563` / `NEW1_024` / `NEW1_038` entrance v3.

Latest (runtime set `ESCAPEFROM_VIOLET_HOLD`, 164 cards; only `play` was filled):

```text
total cards:           164
playable play:         96
already_present:       23
newly_extracted:       71
unavailable by index:  68   (spells/weapons/locations with no play voice)
extraction_failed:     2
play coverage:         94/96 playable
```

Failed extracts (index says available; local extract failed; package not aborted):

- `CAP_107` 火炮长 — `VO_CAP_106t_Male_Draenei_Play_01`
- `JAIL_502` 狂乱报警机 — `Matic_Play`

Production miss for those two returns `AUDIO_NOT_AVAILABLE`.

```text
newly extracted (all kinds):  80
extraction failed:            2
unavailable by index:         68
```

## Production Safety

Verified by unit tests (mock extractor counters) and a real Mini process with `HS_AUDIO_SOURCE=production` (port 18767, `MINI_SKIP_LAN_WRITE=1`).

```text
production extractor calls = 0
production Hearthstone reads = 0
production dynamic mix = 0
```

Hit examples: `AT_122` play, `AT_027` music, `AT_072` entrance, then after fill `NEW1_024` play/music/entrance and `JAIL_850` play.

Miss examples: `AT_005t`, `CAP_107`, `JAIL_502` → 404 `AUDIO_NOT_AVAILABLE`.

## Regression

```text
Mini health:           PASS (200, catalog 7263)
Catalog:               7263 (unchanged)
Latest:                ESCAPEFROM_VIOLET_HOLD / 164 (unchanged)
Admin routes:          PASS (/admin/login, /admin, /admin/latest, /admin/data, /admin/feedback)
npm test:              PASS
miniprogram apiBase:   unchanged (apiBase.lan.js still 192.168.0.111:8767)
```

## Security

```text
secret actual values NOT FOUND
SUPABASE_SERVICE_ROLE_KEY actual value NOT FOUND
access token NOT FOUND
password NOT FOUND
.env contents NOT FOUND
C:\Hearthstone not written to manifest or API responses
```

Scanned: `data/production-audio/manifest.json`, new scripts, `test/productionAudio.test.js`, extract report.

## Git / future publish

`data/production-audio/` is **not** a Git publish artifact (~461 MB WAV). It is gitignored together with staging/backup and `tmp/production-audio-extract/`. Future deploy should use rsync / SCP / Docker volume / object storage. Do not `git add` this tree.

## How to run

```text
# local development (default)
npm run mini

# production mode (VPS)
HS_AUDIO_SOURCE=production npm run mini

# rebuild package from tmp + extract overlay
npm run audio:production:build
npm run audio:production:check
```

Do not run `index:voice` / `index:audio` (Phase08 / Phase11) for this package.

## Snapshot / pipeline

```text
HSJSON snapshot changed: NO
  cards.json            10038512  sha256 4c815ace15781d07e45588265971a7e4e46e2b91bc47c640378c488fea16e5bf
  cards.collectible.json 3401974  sha256 c2512895b549bacd2ecd6420d384a054b44641d7afb6c0d8327bacbdec24f383
data:update executed: NO
Phase08 executed: NO
Phase11 executed: NO
Catalog rebuilt: NO
Latest Set changed: NO
```

## Phase 2.4

ALLOWED. Not started.
