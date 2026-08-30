const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const tmp = path.join(root, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
const wasmSrc = path.join(root, 'node_modules', '@arkntools', 'unity-js-tools-wasm', 'index_bg.wasm');
if (fs.existsSync(wasmSrc)) fs.copyFileSync(wasmSrc, path.join(tmp, 'index_bg.wasm'));

const esbuild = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'phase11-build.mjs',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=tmp/phase11-build.cjs',
  ],
  { stdio: 'inherit', cwd: root },
);
if (esbuild.status !== 0) process.exit(esbuild.status || 1);

const run = spawnSync(process.execPath, ['tmp/phase11-build.cjs'], {
  stdio: 'inherit',
  cwd: root,
});
if (run.status) process.exit(run.status);

const validate = spawnSync(process.execPath, ['src/validation/validateCardAudioIndex.js'], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(validate.status || 0);
