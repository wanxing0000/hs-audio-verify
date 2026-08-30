const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'run-diagnose-audio.cjs'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: root,
    env: Object.assign({}, process.env, {
      DIAGNOSE_ENTRY: 'src/validation/runPhase135Entry.js',
      DIAGNOSE_OUT: 'tmp/phase135.cjs',
    }),
  },
);
process.exit(run.status || 0);
