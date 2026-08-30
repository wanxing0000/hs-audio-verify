const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const tmp = path.join(root, 'tmp');
fs.mkdirSync(tmp, { recursive: true });

const esbuild = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'src/validation/investigateCardAudioLive.mjs',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=tmp/investigate-card-audio.cjs',
  ],
  { stdio: 'inherit', cwd: root },
);
if (esbuild.status !== 0) process.exit(esbuild.status || 1);

const run = spawnSync(process.execPath, ['tmp/investigate-card-audio.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(run.status || 0);
