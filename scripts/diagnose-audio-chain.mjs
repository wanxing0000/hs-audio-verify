import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const run = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'run-diagnose-audio.cjs'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: root, env: process.env },
);
process.exit(run.status || 0);
