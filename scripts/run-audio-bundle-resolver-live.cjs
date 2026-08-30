const { spawnSync } = require('child_process');
const path = require('path');

process.env.DIAGNOSE_ENTRY = 'test/audioBundleResolver.live.js';
process.env.DIAGNOSE_OUT = 'tmp/audio-bundle-resolver-live.cjs';
const r = spawnSync(process.execPath, [path.join(__dirname, 'run-diagnose-audio.cjs')], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
});
process.exit(r.status || 0);
