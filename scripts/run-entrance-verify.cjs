const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const tmp = path.join(root, 'tmp');
fs.mkdirSync(tmp, { recursive: true });

function copyWasm(src, destName) {
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, destName));
}
copyWasm(path.join(root, 'node_modules', '@arkntools', 'unity-js-tools-wasm', 'index_bg.wasm'), 'index_bg.wasm');
copyWasm(path.join(root, 'node_modules', '@arkntools', 'fmod', 'fmod_reduced.wasm'), 'fmod_reduced.wasm');

const esbuild = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'src/validation/generateEntranceVerification.js',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=tmp/generate-entrance-verification.cjs',
  ],
  { stdio: 'inherit', cwd: root },
);
if (esbuild.status !== 0) process.exit(esbuild.status || 1);

const run = spawnSync(process.execPath, ['tmp/generate-entrance-verification.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(run.status || 0);
