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

const outfile = path.join(tmp, 'production-audio-extract.cjs');
const esbuild = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'src/validation/productionAudioExtractCli.js',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=' + outfile,
  ],
  { stdio: 'inherit', cwd: root },
);
if (esbuild.status !== 0) process.exit(esbuild.status || 1);

const run = spawnSync(process.execPath, [outfile], {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});
process.exit(run.status || 0);
