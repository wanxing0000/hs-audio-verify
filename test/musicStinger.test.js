const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { inspectWav, writePcm16Wav } = require('../src/explorer/wavPcm16.js');
const { mixPcm16 } = require('../src/music/mixPcm16.js');

const ROOT = path.resolve(__dirname, '..');
const HS = 'C:\\Hearthstone';
const GUID = 'c6aaf3440b38a664db44d8870f3864d1';
const CLIP = 'Pegasus_Stinger_Leeroy_Jenkins';

const resultsPath = path.join(ROOT, 'data', 'music-verification', 'phase-0.10-results.json');
const samplePath = path.join(ROOT, 'data', 'music-verification', 'music-sample-index.json');
assert.ok(fs.existsSync(resultsPath), 'run npm run verify:music first');
assert.ok(fs.existsSync(samplePath), 'music-sample-index.json missing');

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

assert.strictEqual(results.cardId, 'EX1_116');
assert.strictEqual(results.musicStinger.guid, GUID);
assert.strictEqual(sample.musicStinger.guid, GUID);
assert.ok(results.cardDef.musicStinger && results.cardDef.musicStinger.guid === GUID, 'CardDef → MusicStinger GUID');

assert.strictEqual(results.audioClip.name, CLIP);
assert.strictEqual(sample.musicStinger.audioClip, CLIP);
assert.ok(results.audioClip.resource, 'AudioClip → resource');
assert.ok(results.audioClip.bundle, 'AudioClip bundle');
assert.ok(results.audioClip.format === 'FSB5' || results.conversion.fsbPath, 'FSB resource');

assert.strictEqual(results.conversion.result, 'ok');
const wavPath = results.conversion.wavPath;
assert.ok(wavPath && wavPath.startsWith(ROOT), 'WAV written under repo');
assert.ok(fs.existsSync(wavPath), 'WAV missing');
const wav = inspectWav(fs.readFileSync(wavPath));
assert.strictEqual(wav.audioFormat, 1);
assert.strictEqual(wav.bitsPerSample, 16);
assert.ok(wav.sampleRate === 48000 || wav.sampleRate > 0);
assert.ok(fs.existsSync(results.conversion.fsbPath), 'FSB extract missing');
assert.strictEqual(fs.readFileSync(results.conversion.fsbPath).slice(0, 4).toString(), 'FSB5');

assert.ok(results.playVoice.wavPath && fs.existsSync(results.playVoice.wavPath));
assert.ok(results.combinedPreview && results.combinedPreview.length >= 1);
for (const p of results.combinedPreview) {
  assert.ok(p.path.startsWith(ROOT));
  assert.ok(fs.existsSync(p.path));
  const info = inspectWav(fs.readFileSync(p.path));
  assert.strictEqual(info.audioFormat, 1);
  assert.strictEqual(info.bitsPerSample, 16);
}

assert.strictEqual(results.hearthstoneModified, false);
assert.strictEqual(results.batchExport, false);
for (const p of [wavPath, results.conversion.fsbPath, resultsPath, samplePath]) {
  assert.ok(!p.startsWith(HS + path.sep) && !p.startsWith(HS + '/'), 'must not write into Hearthstone: ' + p);
}

const mono = writePcm16Wav((() => {
  const b = Buffer.alloc(8);
  b.writeInt16LE(1000, 0);
  b.writeInt16LE(1000, 2);
  b.writeInt16LE(1000, 4);
  b.writeInt16LE(1000, 6);
  return b;
})(), 1, 8000);
const stereo = writePcm16Wav((() => {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) b.writeInt16LE(200, i * 2);
  return b;
})(), 2, 8000);
const mixed = mixPcm16(stereo, mono, 0);
assert.strictEqual(mixed.channels, 2);
assert.ok(mixed.wav.length > 44);

const { soundsFromCardDefBody } = require('../src/extractCardDefSounds.js');
const sampleBody = Buffer.from('Play.prefab:abd4cfd794032624785f78a5de7da354 MusicStinger.prefab:c6aaf3440b38a664db44d8870f3864d1');
const sounds = soundsFromCardDefBody(sampleBody);
assert.ok(sounds.musicStinger);
assert.strictEqual(sounds.musicStinger.name, 'MusicStinger');
assert.strictEqual(sounds.musicStinger.guid, GUID);

console.log('musicStinger.test.js ok');
