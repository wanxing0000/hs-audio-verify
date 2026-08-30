const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(script, env, cwd) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    env: env || process.env,
  });
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.strictEqual(pkg.scripts['start:production'], 'node scripts/run-production-mini.cjs');
assert.strictEqual(pkg.scripts['production:check-package'], 'node scripts/check-production-package.cjs');
assert.strictEqual(pkg.scripts['production:check-env'], 'node scripts/check-production-env.cjs');
assert.ok(pkg.scripts.mini);
assert.ok(pkg.scripts['audio:production:build']);
assert.ok(pkg.scripts['audio:production:check']);

const pack = run('check-production-package.cjs');
assert.strictEqual(pack.status, 0, pack.stderr || pack.stdout);
assert.ok(/status=PACKAGE_READY/.test(pack.stdout), pack.stdout);

const git = run('check-git-readiness.cjs');
assert.strictEqual(git.status, 0, git.stderr || git.stdout);
assert.ok(/GIT_NOT_INITIALIZED|GIT_INITIALIZED|status=GIT_READY/.test(git.stdout), git.stdout);
assert.strictEqual(pkg.scripts['git:check'], 'node scripts/check-git-release.cjs');
assert.strictEqual(pkg.scripts['test:production'], 'node scripts/test-production.cjs');

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-env-check-'));
const cleanEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  windir: process.env.windir,
};
const missing = run('check-production-env.cjs', cleanEnv, isolated);
assert.notStrictEqual(missing.status, 0);
assert.ok(/\.env: MISSING/.test(missing.stdout), missing.stdout);
assert.ok(/status=ENV_INVALID/.test(missing.stdout), missing.stdout);
assert.ok(/SUPABASE_URL: OPTIONAL\/MISSING/.test(missing.stdout), missing.stdout);
assert.ok(!/eyJ/.test(missing.stdout + missing.stderr));

const audioOnly = run('check-production-env.cjs', Object.assign({}, cleanEnv, {
  NODE_ENV: 'production',
  HS_AUDIO_SOURCE: 'production',
  MINI_HOST: '0.0.0.0',
  MINI_PORT: '8767',
}), isolated);
assert.strictEqual(audioOnly.status, 0, audioOnly.stdout);
assert.ok(/status=ENV_VALID/.test(audioOnly.stdout), audioOnly.stdout);
assert.ok(/MINI_HOST: SET/.test(audioOnly.stdout));
assert.ok(/MINI_PORT: SET/.test(audioOnly.stdout));
assert.ok(/SUPABASE_URL: OPTIONAL\/MISSING/.test(audioOnly.stdout));
assert.ok(/SUPABASE_ANON_KEY: OPTIONAL\/MISSING/.test(audioOnly.stdout));
assert.ok(/SUPABASE_SERVICE_ROLE_KEY: OPTIONAL\/MISSING/.test(audioOnly.stdout));

const valid = run('check-production-env.cjs', Object.assign({}, cleanEnv, {
  NODE_ENV: 'production',
  HS_AUDIO_SOURCE: 'production',
  MINI_HOST: '0.0.0.0',
  MINI_PORT: '8767',
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}), isolated);
assert.strictEqual(valid.status, 0, valid.stdout);
assert.ok(/status=ENV_VALID/.test(valid.stdout));
assert.ok(/SUPABASE_URL: SET/.test(valid.stdout));
assert.ok(/SUPABASE_ANON_KEY: SET/.test(valid.stdout));
assert.ok(/SUPABASE_SERVICE_ROLE_KEY: SET/.test(valid.stdout));
assert.ok(!/test-service-role-key/.test(valid.stdout + valid.stderr));
assert.ok(!/https:\/\/example\.invalid/.test(valid.stdout + valid.stderr));

const docs = fs.readFileSync(path.join(ROOT, 'docs', 'production-deployment.md'), 'utf8');
assert.ok(docs.includes('<REPOSITORY_URL>'));
assert.ok(docs.includes('npm run start:production'));
assert.ok(!/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(docs));

console.log('ok productionDeploymentPackage');
