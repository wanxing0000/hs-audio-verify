# Phase 2.8-B Test Separation Report

## Environment

- OS: win32 (this workspace)
- architecture: x64
- Node version: v24.16.0

Linux VPS (Ubuntu 24.04.4 / Node v22.23.2) was not executed from this session. Skip paths are implemented for that environment.

## Problem

`musicStinger.test.js` is a Windows/Hearthstone development-only test.

It depends on Phase 0.10 WAV/FSB verification artifacts under `tmp/` (for example `tmp/music/EX1_116_MusicStinger.wav` and `.fsb`).

Those artifacts are not production deployment dependencies. `data/index/` and `data/production-audio/` are sufficient for Linux production.

## Changes

- `test/devVerificationEnv.js` (new): detect Phase 0.10 artifacts and `C:\Hearthstone\Data\Win`
- `scripts/test-production.cjs` (new): production-safe runner
- `package.json`: add `test:production` only; `test` command unchanged
- `test/musicStinger.test.js`: skip when Phase 0.10 WAV/FSB artifacts are missing; core assertions unchanged
- `test/musicPlaybackCoverage.test.js`: catalog assertions always run; extract section skips without Hearthstone
- `scripts/run-audio-bundle-resolver-live.cjs`: skip without Hearthstone
- `scripts/run-music-stinger-guid-live.cjs`: skip without Hearthstone
- `test/productionDeploymentPackage.test.js`: assert `test:production` script exists

## Test separation

- `npm test`: full development suite (Windows + Hearthstone + Phase 0.10 artifacts). Unchanged coverage.
- `npm run test:production`: Linux VPS / production deployment verification. Independent of `npm test`. Does not extract from Hearthstone, does not write production audio, does not rebuild catalog.

Development-only tests (skip when assets missing):

- `test/musicStinger.test.js`
- `test/musicPlaybackCoverage.test.js` extract section
- `scripts/run-audio-bundle-resolver-live.cjs`
- `scripts/run-music-stinger-guid-live.cjs`

Skip output is `SKIP ...` plus reason and environment. It is not printed as `ok` / PASS.

## Production tests

`npm run test:production` executed:

- production audio package (`test/productionAudio.test.js`)
- production audio miss / Linux readiness / production configuration (`test/productionLinuxReadiness.test.js`)
- deployment package (`test/productionDeploymentPackage.test.js`)
- voice mapping rules
- catalog voice index
- card repository
- audio service
- catalog fold
- latest set
- latest class grouping
- card audio index
- miniprogram catalog
- tabBar
- music mapping rules

## Results

    npm test: PASS

    npm run test:production: PASS

On this Windows workspace, Phase 0.10 artifacts and Hearthstone are present, so development-only tests ran fully (`musicStinger.test.js ok`). They were not SKIP.

On Linux VPS without those artifacts, the same files should print SKIP and exit 0.

## Production audio

- voice count: 350
- music count: 200
- entrance count: 98
- total size: ~461 MB class package (file count unchanged)

    unchanged

Before and after this phase: voice=350 music=200 entrance=98

## Safety

- no Hearthstone copied
- no production audio regenerated
- no production audio modified
- no tmp bulk generation beyond existing `npm test` fixtures
- no data/index modification
- no secrets exposed
- no git add / commit / push

## Status

    Phase 2.8-B: COMPLETE VERIFIED
