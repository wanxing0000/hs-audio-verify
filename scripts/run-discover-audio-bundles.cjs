const { spawnSync } = require('child_process');
const path = require('path');

process.env.DIAGNOSE_ENTRY = 'src/validation/discoverCli.js';
process.env.DIAGNOSE_OUT = 'tmp/discover-audio-bundles.cjs';
const r = spawnSync(process.execPath, [path.join(__dirname, 'run-diagnose-audio.cjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
});
process.exit(r.status || 0);
