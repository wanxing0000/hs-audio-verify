const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ignorePath = path.join(root, '.gitignore');
if (!fs.existsSync(ignorePath)) {
  console.log('status=GITIGNORE_MISSING');
  process.exit(1);
}
const ignore = fs.readFileSync(ignorePath, 'utf8').replace(/\r\n/g, '\n');
const lines = ignore.split('\n').map((line) => line.trim()).filter(Boolean);

function ignored(pattern) {
  return lines.indexOf(pattern) >= 0;
}

const requiredIgnore = ['.env', '.env.*', 'node_modules/', 'tmp/', 'data/production-audio/'];
const missingIgnore = requiredIgnore.filter((pattern) => !ignored(pattern));
if (missingIgnore.length) {
  console.log('status=GITIGNORE_INCOMPLETE');
  console.error('missing ignore rules: ' + missingIgnore.join(', '));
  process.exit(1);
}

const indexIgnored = lines.some((line) => (
  line === 'data/index/'
  || line === 'data/index'
  || line === '/data/index/'
));
if (indexIgnored) {
  console.log('status=GITIGNORE_INDEX_IGNORED');
  console.error('data/index/ must not be ignored');
  process.exit(1);
}
if (!lines.includes('!.env.example')) {
  console.log('status=GITIGNORE_INCOMPLETE');
  console.error('!.env.example must remain un-ignored');
  process.exit(1);
}

const gitDir = path.join(root, '.git');
if (!fs.existsSync(gitDir)) {
  console.log('GIT_NOT_INITIALIZED');
  console.log('status=GIT_NOT_INITIALIZED');
  process.exit(0);
}

let trackedEnv = '';
try {
  trackedEnv = execFileSync('git', ['ls-files', '--error-unmatch', '.env'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  trackedEnv = '';
}
if (trackedEnv && trackedEnv.trim()) {
  console.log('SECURITY_BLOCKER_ENV_TRACKED');
  console.log('status=SECURITY_BLOCKER_ENV_TRACKED');
  process.exit(1);
}

let status = '';
try {
  status = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  });
} catch (e) {
  console.log('status=GIT_STATUS_FAILED');
  process.exit(1);
}
console.log('GIT_INITIALIZED');
console.log('git status --porcelain: ' + (status.trim() ? 'HAS_CHANGES' : 'CLEAN'));
console.log('status=GIT_READY');
process.exit(0);
