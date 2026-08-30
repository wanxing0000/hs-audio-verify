const assert = require('assert');
const { wavToPcm16, inspectWav, writePcm16Wav } = require('../src/explorer/wavPcm16.js');
const { CardVoiceRepository } = require('../src/explorer/CardVoiceRepository.js');

const pcm = Buffer.alloc(8);
pcm.writeInt16LE(1000, 0);
pcm.writeInt16LE(-1000, 2);
pcm.writeInt16LE(2000, 4);
pcm.writeInt16LE(-2000, 6);
const already = writePcm16Wav(pcm, 1, 8000);
const back = wavToPcm16(already);
assert.strictEqual(inspectWav(back).audioFormat, 1);
assert.strictEqual(inspectWav(back).bitsPerSample, 16);

const samples = 4;
const data = Buffer.alloc(samples * 4);
new Float32Array(data.buffer, data.byteOffset, samples).set([0, 0.5, -0.5, 1]);
const floatWav = Buffer.alloc(44 + data.length);
floatWav.write('RIFF', 0);
floatWav.writeUInt32LE(36 + data.length, 4);
floatWav.write('WAVE', 8);
floatWav.write('fmt ', 12);
floatWav.writeUInt32LE(16, 16);
floatWav.writeUInt16LE(3, 20);
floatWav.writeUInt16LE(1, 22);
floatWav.writeUInt32LE(8000, 24);
floatWav.writeUInt32LE(8000 * 4, 28);
floatWav.writeUInt16LE(4, 32);
floatWav.writeUInt16LE(32, 34);
floatWav.write('data', 36);
floatWav.writeUInt32LE(data.length, 40);
data.copy(floatWav, 44);
const pcm16 = wavToPcm16(floatWav);
assert.strictEqual(inspectWav(pcm16).audioFormat, 1);
assert.strictEqual(inspectWav(pcm16).bitsPerSample, 16);

const repo = new CardVoiceRepository({
  voiceIndex: {
    version: '0.8',
    source: { game: 'Hearthstone', build: '250339', locale: 'zhCN' },
    cards: {
      EX1_116: {
        name: '火车王里诺艾',
        type: 'MINION',
        collectible: true,
        voice: {
          play: { status: 'matched', mappingType: 'direct', voiceKey: 'VO_EX1_116_Play_01', voiceSourceCardId: 'EX1_116' },
          attack: { status: 'matched', mappingType: 'direct', voiceKey: 'VO_EX1_116_Attack_02', voiceSourceCardId: 'EX1_116' },
          death: { status: 'matched', mappingType: 'direct', voiceKey: 'VO_EX1_116_Death_03', voiceSourceCardId: 'EX1_116' },
        },
      },
      VAN_NEW1_010: {
        name: '风领主奥拉基尔',
        type: 'MINION',
        collectible: true,
        voice: {
          play: { status: 'matched', mappingType: 'shared_resource', voiceKey: 'VO_NEW1_010_Play_01', voiceSourceCardId: 'NEW1_010' },
          attack: { status: 'no_voice', mappingType: 'no_voice' },
          death: { status: 'unresolved', mappingType: 'unresolved', reason: 'test' },
        },
      },
      BG23_318: {
        name: '莽神火车王',
        type: 'MINION',
        collectible: true,
        voice: { play: { status: 'no_voice', mappingType: 'no_voice' }, attack: { status: 'no_voice', mappingType: 'no_voice' }, death: { status: 'no_voice', mappingType: 'no_voice' } },
      },
    },
  },
  audioIndex: {
    clips: {
      VO_EX1_116_Play_01: { zhcnBundles: ['a.unity3d'], prefabBundles: [] },
      VO_NEW1_010_Play_01: { zhcnBundles: ['b.unity3d'], prefabBundles: [] },
    },
  },
  englishNames: { EX1_116: 'Leeroy Jenkins' },
  aliases: { leeroy: ['EX1_116'] },
});

assert.strictEqual(repo.searchCards('火车王')[0].cardId, 'EX1_116');
assert.strictEqual(repo.searchCards('Leeroy')[0].cardId, 'EX1_116');
assert.strictEqual(repo.getVoice('VAN_NEW1_010', 'play').voiceSourceCardId, 'NEW1_010');
assert.strictEqual(repo.getVoice('VAN_NEW1_010', 'play').mappingType, 'shared_resource');
assert.strictEqual(repo.getVoice('VAN_NEW1_010', 'attack').uiStatus, 'No voice available');
assert.strictEqual(repo.getVoice('VAN_NEW1_010', 'death').uiStatus, 'Voice mapping unresolved');
assert.ok(repo.getVoiceAsset('VO_EX1_116_Play_01').indexed);
assert.strictEqual(repo.getVoiceAsset('missing').indexed, false);

console.log('ok explorer repository');
