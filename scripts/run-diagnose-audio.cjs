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

function bundle(entry, outfile) {
  const esbuild = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--outfile=' + outfile,
    ],
    { stdio: 'inherit', cwd: root },
  );
  if (esbuild.status !== 0) process.exit(esbuild.status || 1);
}

const entry = process.env.DIAGNOSE_ENTRY || 'src/validation/diagnoseCli.js';
const outfile = process.env.DIAGNOSE_OUT || 'tmp/diagnose-audio.cjs';
bundle(entry, outfile);

const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});
process.exit(run.status || 0);
