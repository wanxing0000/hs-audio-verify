const { spawnSync } = require('child_process');
const path = require('path');
const { loadProjectEnv } = require('../src/services/supabaseClient.js');
const {
  prepareProductionMiniEnv,
  assertProductionRuntimeReady,
} = require('../src/services/productionRuntime.js');

const root = path.resolve(__dirname, '..');
process.chdir(root);
loadProjectEnv(root);

let env;
try {
  env = prepareProductionMiniEnv(process.env);
  assertProductionRuntimeReady(root);
} catch (e) {
  console.error('[start:production]', e.message);
  process.exit(1);
}

const run = spawnSync(process.execPath, [path.join(root, 'src', 'miniprogram', 'miniServer.js')], {
  stdio: 'inherit',
  cwd: root,
  env: env,
});
process.exit(run.status || 0);
