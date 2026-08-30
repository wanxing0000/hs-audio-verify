'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PRODUCTION_API_BASE,
  DEFAULT_API_BASE,
  getApiBase,
  resolveApiBase,
} = require('../miniprogram/utils/config.js');
const audio = require('../miniprogram/utils/audio.js');

const ROOT = path.resolve(__dirname, '..');
const MINI = path.join(ROOT, 'miniprogram');
const FORBIDDEN = /101\.43\.155\.194|127\.0\.0\.1:8767|localhost:8767|http:\/\/api\.hsvoiceguide\.online/;

function readMini(rel) {
  return fs.readFileSync(path.join(MINI, rel), 'utf8');
}

assert.strictEqual(PRODUCTION_API_BASE, 'https://api.hsvoiceguide.online');
assert.strictEqual(DEFAULT_API_BASE, 'https://api.hsvoiceguide.online');
assert.ok(DEFAULT_API_BASE.startsWith('https://'));
assert.strictEqual(new URL(DEFAULT_API_BASE).hostname, 'api.hsvoiceguide.online');
assert.ok(!FORBIDDEN.test(DEFAULT_API_BASE));
assert.ok(!DEFAULT_API_BASE.includes(':8767'));
assert.strictEqual(getApiBase(), 'https://api.hsvoiceguide.online');
assert.strictEqual(
  resolveApiBase({ platform: 'devtools', override: null, lan: null }),
  'https://api.hsvoiceguide.online'
);
assert.strictEqual(
  resolveApiBase({ platform: 'ios', override: null, lan: 'https://api.hsvoiceguide.online' }),
  'https://api.hsvoiceguide.online'
);

assert.strictEqual(audio.getVoiceUrl('AT_003', 'play'), 'https://api.hsvoiceguide.online/api/audio/voice/AT_003/play');
assert.strictEqual(audio.getMusicUrl('AT_027'), 'https://api.hsvoiceguide.online/api/audio/music/AT_027');
assert.strictEqual(audio.getEntranceUrl('AT_072'), 'https://api.hsvoiceguide.online/api/audio/entrance/AT_072');

const productionFiles = [
  'utils/config.js',
  'utils/apiBase.lan.js',
  'utils/apiBase.override.js',
  'utils/audio.js',
  'utils/data.js',
  'app.js',
  'pages/index/index.js',
  'pages/latest/latest.js',
  'pages/card/card.js',
  'pages/more/more.js',
];

for (const rel of productionFiles) {
  const src = readMini(rel);
  assert.ok(!FORBIDDEN.test(src), rel + ' has forbidden production API host');
}

const overrideSrc = readMini('utils/apiBase.override.js');
assert.ok(/apiBase:\s*null/.test(overrideSrc));

const lanSrc = readMini('utils/apiBase.lan.js');
assert.ok(lanSrc.includes('https://api.hsvoiceguide.online'));
assert.ok(!lanSrc.includes('http://'));

console.log('ok miniappProductionApi');
