const { spawnSync } = require('child_process');
const path = require('path');
const { hearthstoneInstallPresent, skipDevelopmentOnly } = require('../test/devVerificationEnv.js');

if (!hearthstoneInstallPresent()) {
  skipDevelopmentOnly(
    'run-music-stinger-guid-live.cjs',
    'Hearthstone development verification assets unavailable',
  );
}

process.env.DIAGNOSE_ENTRY = 'test/musicStingerGuid.live.js';
process.env.DIAGNOSE_OUT = 'tmp/music-stinger-guid-live.cjs';
const r = spawnSync(process.execPath, [path.join(__dirname, 'run-diagnose-audio.cjs')], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
});
process.exit(r.status || 0);
