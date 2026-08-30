const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const LIMIT = 100 * 1024 * 1024;

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
}

function listCandidateFiles() {
  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  let others = [];
  try {
    others = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  } catch (e) {
    others = [];
  }
  const seen = Object.create(null);
  const out = [];
  tracked.concat(others).forEach((rel) => {
    const norm = rel.replace(/\\/g, '/');
    if (!seen[norm]) {
      seen[norm] = true;
      out.push(norm);
    }
  });
  return out;
}

function looksSecretName(rel) {
  const base = path.basename(rel).toLowerCase();
  if (base === '.env' || /^\.env\./.test(base) && base !== '.env.example') return true;
  if (/\.(pem|p12|pfx|key)$/i.test(base)) return true;
  if (base === 'credentials.json' || base === 'id_rsa' || base === 'id_ed25519') return true;
  return false;
}

function fileHasSecretPattern(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.wav', '.mp3', '.zip', '.wasm'].indexOf(ext) >= 0) return false;
  let text;
  try {
    const abs = path.join(root, rel);
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return false;
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return false;
  }
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return true;
  if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text)) return true;
  const sbHits = text.match(/sb_secret_[A-Za-z0-9_-]{8,}/g) || [];
  const sbReal = sbHits.filter((hit) => !/should_never_appear|placeholder|example|redacted|never_appear/i.test(hit));
  if (sbReal.length) return true;
  if (/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['\"]?eyJ/.test(text)) return true;
  return false;
}

if (!fs.existsSync(path.join(root, '.git'))) {
  console.log('GIT_RELEASE_CHECK');
  console.log('status=RELEASE_BLOCKED');
  console.log('reason=GIT_NOT_INITIALIZED');
  process.exit(1);
}

const files = listCandidateFiles();
const envTracked = files.some((f) => f === '.env' || /(^|\/)\.env$/.test(f));
const envDotTracked = files.some((f) => /(^|\/)\.env\./.test(f) && !f.endsWith('.env.example'));
const nmTracked = files.some((f) => f === 'node_modules' || f.indexOf('node_modules/') === 0);
const tmpTracked = files.some((f) => f === 'tmp' || f.indexOf('tmp/') === 0);
const audioTracked = files.some((f) => f.indexOf('data/production-audio/') === 0 || f === 'data/production-audio');
const large = [];
files.forEach((rel) => {
  try {
    const st = fs.statSync(path.join(root, rel));
    if (st.isFile() && st.size > LIMIT) large.push(rel);
  } catch (e) {}
});
const secretName = files.filter(looksSecretName);
const secretFiles = [];
for (let i = 0; i < files.length; i++) {
  if (fileHasSecretPattern(files[i])) secretFiles.push(files[i]);
}
const secretContent = secretFiles.length > 0;

const indexPresent = fs.existsSync(path.join(root, 'data', 'index', 'card-audio-index.json'));
const lockPresent = fs.existsSync(path.join(root, 'package-lock.json'));
const examplePresent = fs.existsSync(path.join(root, '.env.example'));

console.log('GIT_RELEASE_CHECK');
console.log('env tracked: ' + (envTracked || envDotTracked ? 'YES' : 'NO'));
console.log('node_modules tracked: ' + (nmTracked ? 'YES' : 'NO'));
console.log('tmp tracked: ' + (tmpTracked ? 'YES' : 'NO'));
console.log('production-audio tracked: ' + (audioTracked ? 'YES' : 'NO'));
console.log('large file >100MB: ' + (large.length ? 'YES' : 'NO'));
console.log('secret detected: ' + (secretName.length || secretContent ? 'YES' : 'NO'));
console.log('data/index present: ' + (indexPresent ? 'YES' : 'NO'));
console.log('package-lock present: ' + (lockPresent ? 'YES' : 'NO'));
console.log('env.example present: ' + (examplePresent ? 'YES' : 'NO'));

const blocked = envTracked || envDotTracked || nmTracked || tmpTracked || audioTracked
  || large.length > 0 || secretName.length > 0 || secretContent
  || !indexPresent || !lockPresent || !examplePresent;
console.log(blocked ? 'RELEASE_BLOCKED' : 'RELEASE_SAFE');
process.exit(blocked ? 1 : 0);
