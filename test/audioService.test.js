const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AudioCache } = require('../src/services/audioCache.js');
const { AudioService } = require('../src/services/audioService.js');
const { writePcm16Wav, inspectWav } = require('../src/explorer/wavPcm16.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-audio-'));
const cache = new AudioCache({
  audioDir: path.join(dir, 'audio'),
  musicDir: path.join(dir, 'music'),
  previewDir: path.join(dir, 'preview'),
});

const pcm = Buffer.alloc(8);
pcm.writeInt16LE(1000, 0);
pcm.writeInt16LE(-1000, 2);
pcm.writeInt16LE(2000, 4);
pcm.writeInt16LE(-2000, 6);
const wav = writePcm16Wav(pcm, 1, 8000);

const fakeRepo = {
  getCardVoice(cardId, type) {
    if (cardId === 'NONE') return { playable: false, voiceKey: null };
    if (cardId === 'MISS') return { playable: false, voiceKey: 'VO_X', uiStatus: 'Voice asset not indexed' };
    if (type === 'play') return { playable: true, voiceKey: 'VO_OK' };
    return { playable: false, voiceKey: null };
  },
  getMusicMeta(cardId) {
    if (cardId === 'EX1_116') return { audioClip: 'Pegasus_Stinger_Leeroy_Jenkins' };
    return null;
  },
};

const extractor = {
  async extractVoice(key) {
    const p = path.join(dir, 'audio', key + '.wav');
    fs.writeFileSync(p, wav);
    return { path: p, cached: false, ms: 1, wav: inspectWav(wav) };
  },
};

const svc = new AudioService({ repo: fakeRepo, extractor, cache });

(async () => {
  const first = await svc.getVoiceAudio('EX1_116', 'play');
  assert.ok(first.path);
  assert.strictEqual(inspectWav(fs.readFileSync(first.path)).bitsPerSample, 16);

  cache.write('music', 'EX1_116_MusicStinger', wav);
  const musicHit = await svc.getMusicAudio('EX1_116');
  assert.strictEqual(musicHit.cached, true);

  let missingVoice = false;
  try { await svc.getVoiceAudio('NONE', 'play'); } catch (e) {
    missingVoice = e.code === 'NO_VOICE';
    assert.strictEqual(e.userMessage, '暂无可用音频');
  }
  assert.ok(missingVoice);

  let missingMusic = false;
  try { await svc.getMusicAudio('VAN_NEW1_010'); } catch (e) {
    missingMusic = e.code === 'NO_MUSIC';
  }
  assert.ok(missingMusic);

  console.log('ok audioService');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
