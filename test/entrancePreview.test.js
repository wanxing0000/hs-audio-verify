const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePcm16Wav, inspectWav } = require('../src/explorer/wavPcm16.js');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService } = require('../src/services/audioService.js');
const { EntrancePreviewService } = require('../src/services/entrancePreviewService.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-preview-'));
const cache = new AudioCache({
  audioDir: path.join(dir, 'audio'),
  musicDir: path.join(dir, 'music'),
  previewDir: path.join(dir, 'preview'),
});

function tone(frames, ch, rate) {
  const pcm = Buffer.alloc(frames * ch * 2);
  for (let i = 0; i < frames * ch; i++) pcm.writeInt16LE(i % 2 ? 800 : -800, i * 2);
  return writePcm16Wav(pcm, ch, rate);
}

const voiceWav = tone(8000, 1, 48000);
const musicWav = tone(4410, 2, 44100);

const repo = {
  getCard(id) {
    if (id === 'NONE') return { tracks: { play: { available: false }, music: { available: false } } };
    if (id === 'VOICE') return { tracks: { play: { available: true }, music: { available: false } } };
    if (id === 'EX1_116') return { tracks: { play: { available: true }, music: { available: true } } };
    return null;
  },
  getCardVoice() { return { playable: true, voiceKey: 'VO_OK' }; },
  getMusicMeta(id) { return id === 'EX1_116' ? { audioClip: 'STINGER' } : null; },
};

const extractor = {
  async extractVoice(key) {
    const p = path.join(dir, key + '.wav');
    fs.writeFileSync(p, key === 'STINGER' ? musicWav : voiceWav);
    return { path: p, cached: false, ms: 1, wav: inspectWav(fs.readFileSync(p)) };
  },
};

const audioService = new AudioService({ repo, extractor, cache });
const entrance = new EntrancePreviewService({ repo, audioService, cache });

(async () => {
  const mixed = await entrance.getEntrancePreview('EX1_116');
  assert.strictEqual(mixed.source, 'mix');
  assert.strictEqual(inspectWav(fs.readFileSync(mixed.path)).sampleRate, 48000);
  assert.ok(mixed.path.includes('preview'));

  const hit = await entrance.getEntrancePreview('EX1_116');
  assert.strictEqual(hit.cached, true);

  const voiceOnly = await entrance.getEntrancePreview('VOICE');
  assert.strictEqual(voiceOnly.source, 'play');

  let missing = false;
  try { await entrance.getEntrancePreview('NONE'); } catch (e) {
    missing = e.code === 'UNAVAILABLE';
    assert.ok(e.userMessage.includes('登场') || e.userMessage.includes('音频'));
  }
  assert.ok(missing);

  console.log('ok entrancePreview');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
