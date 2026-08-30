const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { adaptCard, publicDetail, buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { coverageLists } = require('./musicCoverageSample.js');

const ROOT = path.resolve(__dirname, '..');
const SEED = 20260828;
const NO_MUSIC_IDS = ['ETC_409', 'PRO_001', 'VAN_PRO_001', 'WW_364'];

const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const catalog = buildCatalog(unified);
const lists = coverageLists(unified, SEED);

assert.ok(lists.totalLegendaryMinions >= 1000, 'legendary minion count');
assert.strictEqual(lists.totalLegendaryMinions, 1047);
assert.ok(lists.musicAvailable + lists.musicShared >= 1000, 'music available+shared');
assert.ok(lists.musicAvailable + lists.musicShared >= 1040);
assert.strictEqual(lists.musicUnavailable, 4);
assert.deepStrictEqual(lists.unavailableIds.slice().sort(), NO_MUSIC_IDS.slice().sort());

assert.strictEqual(lists.apiAvailableIds.length, 20);
assert.strictEqual(lists.apiSharedIds.length, 10);
assert.strictEqual(lists.wavAvailableIds.length, 10);
assert.strictEqual(lists.wavSharedIds.length, 10);

function assertMiniMusic(id, expectedStatus) {
  const card = catalog.byId[id];
  assert.ok(card, id + ' missing from mini catalog');
  const pub = publicDetail(card);
  assert.strictEqual(pub.music.status, expectedStatus, id + ' mini music.status');
  if (expectedStatus === 'unavailable') {
    assert.strictEqual(pub.music.available, false, id + ' should hide music button');
    assert.ok(!pub.music.musicAssetId);
    return pub;
  }
  assert.notStrictEqual(pub.music.status, 'unavailable', id);
  assert.strictEqual(pub.music.available, true, id + ' music button visible');
  assert.ok(pub.music.musicAssetId, id + ' musicAssetId');
  return pub;
}

for (const id of lists.apiAvailableIds) assertMiniMusic(id, 'available');
for (const id of lists.apiSharedIds) {
  const pub = assertMiniMusic(id, 'shared');
  assert.strictEqual(pub.music.note, '使用原卡登场音乐', id);
}
for (const id of NO_MUSIC_IDS) assertMiniMusic(id, 'unavailable');

const leeroy = assertMiniMusic('EX1_116', 'available');
assert.ok(leeroy.entrancePreview.available);

assertMiniMusic('CORE_EX1_116', 'shared');
assertMiniMusic('VAN_EX1_116', 'shared');
assertMiniMusic('VAN_NEW1_010', 'shared');
assertMiniMusic('WON_011', 'shared');

const cardJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.wxml'), 'utf8');
assert.ok(cardJs.includes("card.music.shared ? '🎵 使用原卡登场音乐' : '🎵 登场音乐'"));
assert.ok(cardJs.includes('available="{{card.music.available}}"'));
assert.ok(!/card\.music\.status\s*===\s*['"]available['"]/.test(
  fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.js'), 'utf8'),
));

const tmp = path.join(ROOT, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
function copyWasm(src, destName) {
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, destName));
}
copyWasm(path.join(ROOT, 'node_modules', '@arkntools', 'unity-js-tools-wasm', 'index_bg.wasm'), 'index_bg.wasm');
copyWasm(path.join(ROOT, 'node_modules', '@arkntools', 'fmod', 'fmod_reduced.wasm'), 'fmod_reduced.wasm');

const extractIds = [];
function addId(id) {
  if (id && extractIds.indexOf(id) < 0) extractIds.push(id);
}
for (const id of lists.wavAvailableIds) addId(id);
for (const id of lists.wavSharedIds) addId(id);
[
  'EX1_116',
  'CORE_EX1_116',
  'VAN_EX1_116',
  'VAN_NEW1_010',
  'WON_011',
  'TIME_032',
  'EX1_572',
  'SW_080',
  'BAR_048',
  'BAR_080',
  'CORE_CS3_019',
].forEach(addId);

const specPath = path.join(tmp, 'music-coverage-ids.json');
const outPath = path.join(tmp, 'music-coverage-extract.json');
fs.writeFileSync(specPath, JSON.stringify({ ids: extractIds, outPath }));

const esbuild = spawnSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'test/musicPlaybackCoverage.extract.js',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=tmp/music-coverage-extract.cjs',
  ],
  { encoding: 'utf8', cwd: ROOT },
);
assert.strictEqual(esbuild.status, 0, esbuild.stderr || esbuild.stdout || 'esbuild failed');

const run = spawnSync(
  process.execPath,
  ['tmp/music-coverage-extract.cjs', specPath],
  { encoding: 'utf8', cwd: ROOT },
);
assert.strictEqual(run.status, 0, run.stderr || run.stdout || 'extract harness failed');

const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const byId = Object.create(null);
for (const row of payload.results) byId[row.cardId] = row;

const failures = [];
function assertWav(id) {
  const row = byId[id];
  if (!row || !row.ok || row.statusCode !== 200 || !row.wav || !row.wav.riff || row.wav.audioFormat !== 1 || row.wav.bitsPerSample !== 16) {
    failures.push({
      cardId: id,
      musicAssetId: row && row.musicAssetId,
      audioClipName: row && row.audioClipName,
      bundle: row && row.bundle,
      reason: (row && row.reason) || 'missing extract result',
    });
  }
}

for (const id of lists.wavAvailableIds) assertWav(id);
for (const id of lists.wavSharedIds) assertWav(id);
assertWav('EX1_116');
assertWav('CORE_EX1_116');
assertWav('VAN_EX1_116');
assertWav('VAN_NEW1_010');
assertWav('WON_011');
assertWav('TIME_032');
assertWav('EX1_572');
assertWav('SW_080');
assertWav('BAR_048');
assertWav('BAR_080');
assertWav('CORE_CS3_019');

if (failures.length) {
  console.error('Music WAV extract failures:');
  for (const f of failures) console.error(JSON.stringify(f));
}
assert.strictEqual(failures.length, 0, failures.length + ' music extracts failed');

console.log('ok musicPlaybackCoverage', {
  totalLegendaryMinions: lists.totalLegendaryMinions,
  musicAvailable: lists.musicAvailable,
  musicShared: lists.musicShared,
  musicUnavailable: lists.musicUnavailable,
  wavExtracted: extractIds.length,
});
