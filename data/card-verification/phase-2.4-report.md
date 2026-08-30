# Phase 2.4 Linux Production Readiness Report

## 1. Phase Status

```text
Phase 2.4:
COMPLETE VERIFIED
```

Real Linux runtime was not executed. Linux claims below are **static only**.

```text
VPS purchase: NO
Public deployment: NO
Domain / HTTPS / Nginx: NO
Git init / commit / push: NO
Dockerfile: NO
Phase 2.5: ALLOWED (not started)
```

## 2. Production Start

Current `npm run mini` still:

```text
scripts/run-mini.cjs
  → esbuild src/miniprogram/miniServer.js → tmp/mini-server.cjs
  → copy unity/fmod wasm into tmp/
  → node tmp/mini-server.cjs
```

That is the **development** entry. It is unchanged.

New production entry:

```text
Production command:
npm run start:production

Implementation:
node scripts/run-production-mini.cjs
  → prepareProductionMiniEnv (read process env; default NODE_ENV / HS_AUDIO_SOURCE to production)
  → refuse HS_AUDIO_SOURCE=development
  → assert required files exist
  → node src/miniprogram/miniServer.js
```

No `set NODE_ENV=...` in `package.json`.

Environment variables (names only):

```text
NODE_ENV                 default production for this command if unset
HS_AUDIO_SOURCE          default production for this command if unset; must stay production
MINI_HOST                default 0.0.0.0 (resolveMiniListen)
MINI_PORT                default 8767
MINI_SKIP_LAN_WRITE      default 1 for this command (do not write miniprogram LAN files)
SUPABASE_URL             server + Admin browser config
SUPABASE_ANON_KEY        Admin browser only
SUPABASE_SERVICE_ROLE_KEY  server only
MINI_API_BASE            optional banner/listen override
```

Linux command:

```bash
NODE_ENV=production \
HS_AUDIO_SOURCE=production \
MINI_HOST=0.0.0.0 \
MINI_PORT=8767 \
npm run start:production
```

Or set the same variables in the server `.env` and run `npm run start:production`.

Windows development remains `npm run mini`.

## 3. Linux Compatibility

```text
STATIC_LINUX_COMPATIBILITY: PASS
REAL_LINUX_RUNTIME_TEST: NOT RUN
Reason: no usable existing Linux runtime (Docker not installed; WSL not available as a working distro). Did not install Docker or WSL.
```

`start:production` uses `path.join`, `process.execPath`, and unbundled CommonJS. It does not copy wasm, does not run esbuild, and does not load `HearthstoneAudioExtractor`.

## 4. Windows Path Audit

### PRODUCTION_SAFE

- `src/explorer/HearthstoneAudioExtractor.js` default `C:\Hearthstone\Data\Win` — required only in the development branch of Mini. Production constructs `createProductionExtractorGuard()` and never `require`s the extractor.
- `scripts/run-mini.cjs` wasm → `tmp/` — development bundle only.
- `src/miniprogram/lanListen.js` banner text mentions `C:\Hearthstone` — console string only, no filesystem read.
- `src/validation/*` and `src/explorer/server.js` HS paths — Explorer / diagnose / extract CLIs, not `start:production`.

### BLOCKER

None in the production start chain.

### TEST_ONLY

- `test/audioBundleResolver.test.js`, `test/musicStinger.test.js`, live extract tests that mention `C:\Hearthstone`.

Development extract via `tmp` miss → local Hearthstone is preserved.

## 5. Production Audio

Verified on a **separate** Mini (`HS_AUDIO_SOURCE=production`, port **18768**). Port 8767 was not killed.

```text
HS_AUDIO_SOURCE=production

voice hit  AT_122/play:     PASS 200 audio/wav
voice miss CAP_107/play:    PASS 404 AUDIO_NOT_AVAILABLE
music hit  AT_027:          PASS 200 audio/wav
music miss AT_063:          PASS 404 AUDIO_NOT_AVAILABLE
entrance hit AT_072:        PASS 200 audio/wav
entrance miss AT_009:       PASS 404 AUDIO_NOT_AVAILABLE

Hearthstone extractor: NOT CALLED in production
(dynamic mix / extractVoice / bundle scan not used on miss)
```

`CAP_107` music/entrance return `NO_MUSIC` / `UNAVAILABLE` because the index has no those slots — that is not a package miss.

Health on 18768: `audioSource=production`. `miniprogram/utils/apiBase.lan.js` unchanged (`192.168.0.111:8767`).

## 6. Production Required Files

MUST DEPLOY:

```text
package.json
package-lock.json
src/                          (Mini require graph; include services + wavPcm16)
admin/
data/index/card-audio-index.json
data/index/audio-index.json
data/index/music-assets.json
data/index/latest-set.json
data/production-audio/        (manifest.json, voice/, music/, entrance/)
.env                          (created on the server from .env.example; not from git)
```

Runtime created if missing:

```text
data/production-audio/{voice,music,entrance}   AudioCache mkdir (package should already exist)
```

`start:production` does **not** create `tmp/` or write wechat LAN files.

DO NOT COPY:

```text
tmp/
node_modules/          DO NOT COPY FROM WINDOWS
                       INSTALL ON LINUX VIA npm ci
C:\Hearthstone/
public/                Explorer; Mini production does not serve it
data/hearthstonejson/  Mini boot reads data/index only
```

`package-lock.json` exists. Production install: `npm ci`. Lockfile was not modified.

## 7. Environment Variables

| Name | Purpose | Scope |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Server; also injected into `/admin/config.js` |
| `SUPABASE_ANON_KEY` | Admin browser client | Browser-safe in current Admin architecture |
| `SUPABASE_SERVICE_ROLE_KEY` | Node service role | **Server only** — never `/admin/config.js`, never miniprogram |
| `MINI_HOST` | Listen address | Server |
| `MINI_PORT` | Listen port | Server |
| `NODE_ENV` | Process mode label | Server |
| `HS_AUDIO_SOURCE` | `development` \| `production` | Server |
| `MINI_SKIP_LAN_WRITE` | Skip wechat LAN file write | Server |
| `MINI_API_BASE` | Optional LAN/banner override | Server |

No real values are recorded here. `/admin/config.js` only emits `supabaseUrl` + `anonKey`.

## 8. Dependencies

```text
PURE_NODE:
  @supabase/supabase-js
  dotenv

LIKELY_LINUX_COMPATIBLE:
  esbuild          (optional per-OS binaries; Linux packages exist)
                   not used by start:production
  @arkntools/unity-js  (JS + wasm)
                   not loaded by start:production

NATIVE_BUILD_REQUIRED:
  none on the production Mini start path

WINDOWS_ONLY:
  none

BLOCKERS:
  none
```

Recommend Node 18+ on the VPS (`esbuild` engines field). Not verified on Linux.

## 9. Tests

```text
npm test: PASS
new tests: test/productionLinuxReadiness.test.js
```

New tests cover: production dirs, `start:production` script shape, invalid `HS_AUDIO_SOURCE`, required files, `.env.example` / `.gitignore`, production hit/miss without calling a mock extractor. They do not read `C:\Hearthstone`, do not copy production-audio, and do not download HSJSON.

## 10. Mini Regression

Existing **8767** process was **not** restarted.

```text
GET /api/mini/health     200  audioSource=development  host=0.0.0.0 port=8767
Catalog total            7263
Latest Set               ESCAPEFROM_VIOLET_HOLD / 164
GET /admin/login         200
```

## 11. Security

Scanned `src/`, `scripts/`, `admin/`, `miniprogram/`, `test/`, `.env.example`, `package.json` (not `.env` contents).

```text
service role actual value: NOT FOUND
access token: NOT FOUND
password: NOT FOUND
```

`.env.example` has empty secret slots only.

## Git / ignore

`.gitignore` now includes `node_modules/`, `tmp/`, `data/production-audio/` and keeps `!.env.example`. `data/index/` is **not** ignored. No `git init`.

## Phase 2.5

```text
Production Audio = READY
Production Startup = READY
STATIC Linux Compatibility = PASS
No Linux Blocker
npm test = PASS
Mini Regression = PASS
Security = PASS

Phase 2.5: ALLOWED
```

Not started. Phase 2.5 is where VPS purchase and a real Linux deploy would begin.
