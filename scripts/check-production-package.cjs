const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function listFiles(rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile());
}

function fail(code, message) {
  console.log('status=' + code);
  console.error(message);
  process.exit(1);
}

const required = [
  'package.json',
  'package-lock.json',
  'src/miniprogram/miniServer.js',
  'data/index',
  'data/index/card-audio-index.json',
  'data/index/latest-set.json',
  'admin',
  'miniprogram',
  '.env.example',
];

const missing = required.filter((rel) => !exists(rel));
if (missing.length) fail('PACKAGE_INCOMPLETE', 'missing: ' + missing.join(', '));

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
} catch (e) {
  fail('PACKAGE_INCOMPLETE', 'package.json is not valid JSON');
}
if (!pkg.scripts || pkg.scripts['start:production'] !== 'node scripts/run-production-mini.cjs') {
  fail('PACKAGE_INCOMPLETE', 'package.json missing start:production');
}

const audioRoot = path.join(root, 'data', 'production-audio');
const audioPresent = fs.existsSync(audioRoot);
if (!audioPresent) {
  console.log('PRODUCTION_AUDIO_NOT_INCLUDED');
  console.log('status=PACKAGE_READY_WITHOUT_AUDIO');
  process.exit(0);
}

const audioRequired = [
  'data/production-audio/voice',
  'data/production-audio/music',
  'data/production-audio/entrance',
  'data/production-audio/manifest.json',
];
const audioMissing = audioRequired.filter((rel) => !exists(rel));
if (audioMissing.length) fail('PRODUCTION_AUDIO_INVALID', 'missing: ' + audioMissing.join(', '));

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(audioRoot, 'manifest.json'), 'utf8'));
} catch (e) {
  fail('PRODUCTION_AUDIO_INVALID', 'manifest.json is not valid JSON');
}
if (!manifest || typeof manifest !== 'object') fail('PRODUCTION_AUDIO_INVALID', 'manifest is empty');
if (!Array.isArray(manifest.voice) || !Array.isArray(manifest.music) || !Array.isArray(manifest.entrance)) {
  fail('PRODUCTION_AUDIO_INVALID', 'manifest missing voice/music/entrance arrays');
}

const voiceFiles = listFiles('data/production-audio/voice');
const musicFiles = listFiles('data/production-audio/music');
const entranceFiles = listFiles('data/production-audio/entrance');
if (manifest.voice.length !== voiceFiles.length) {
  fail('PRODUCTION_AUDIO_INVALID', 'voice count mismatch manifest=' + manifest.voice.length + ' files=' + voiceFiles.length);
}
if (manifest.music.length !== musicFiles.length) {
  fail('PRODUCTION_AUDIO_INVALID', 'music count mismatch manifest=' + manifest.music.length + ' files=' + musicFiles.length);
}
if (manifest.entrance.length !== entranceFiles.length) {
  fail('PRODUCTION_AUDIO_INVALID', 'entrance count mismatch manifest=' + manifest.entrance.length + ' files=' + entranceFiles.length);
}

const manifestText = JSON.stringify(manifest);
const forbidden = [
  'C:\\Hearthstone',
  'C:/Hearthstone',
  'unity3d',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'sb_secret_',
  'password',
];
const hit = forbidden.filter((needle) => manifestText.indexOf(needle) >= 0);
if (hit.length) fail('PRODUCTION_AUDIO_INVALID', 'manifest contains forbidden token');
if (/[A-Za-z]:\\/.test(manifestText)) fail('PRODUCTION_AUDIO_INVALID', 'manifest contains absolute Windows path');

console.log('production-audio: local package verified');
console.log('voice=' + manifest.voice.length + ' music=' + manifest.music.length + ' entrance=' + manifest.entrance.length);
console.log('status=PACKAGE_READY');
process.exit(0);
