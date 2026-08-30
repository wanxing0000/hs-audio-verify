const assert = require('assert');
const { CardRepository } = require('../src/repository/cardRepository.js');

const repo = new CardRepository({
  voiceIndex: {
    version: '0.8',
    source: { game: 'Hearthstone', build: '250339', locale: 'zhCN' },
    cards: {
      EX1_116: {
        name: '火车王里诺艾',
        type: 'MINION',
        collectible: true,
        set: 'EXPERT1',
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
          death: { status: 'no_voice', mappingType: 'no_voice' },
        },
      },
      VAC_954: {
        name: '测试共享音频',
        type: 'MINION',
        collectible: true,
        voice: {
          play: { status: 'matched', mappingType: 'shared_audio', voiceKey: 'VO_VAC_301_Play_01', voiceSourceCardId: 'VAC_301' },
          attack: { status: 'no_voice', mappingType: 'no_voice' },
          death: { status: 'no_voice', mappingType: 'no_voice' },
        },
      },
      CFM_335: {
        name: '笨拙的科多兽',
        type: 'MINION',
        collectible: true,
        voice: {
          play: { status: 'matched', mappingType: 'named_sfx', voiceKey: 'CFM_ClumsyKodo_Play', voiceSourceCardId: 'CFM_335' },
          attack: { status: 'no_voice', mappingType: 'no_voice' },
          death: { status: 'no_voice', mappingType: 'no_voice' },
        },
      },
      CAP_107: {
        name: '异常 token',
        type: 'MINION',
        collectible: true,
        voice: {
          play: { status: 'matched', mappingType: 'token_clip', voiceKey: 'VO_CAP_106t_Play_01', voiceSourceCardId: 'CAP_106t' },
          attack: { status: 'no_voice', mappingType: 'no_voice' },
          death: { status: 'no_voice', mappingType: 'no_voice' },
        },
      },
    },
  },
  audioIndex: {
    clips: {
      VO_EX1_116_Play_01: { zhcnBundles: ['a.unity3d'], prefabBundles: [] },
      VO_EX1_116_Attack_02: { zhcnBundles: ['a.unity3d'], prefabBundles: [] },
      VO_EX1_116_Death_03: { zhcnBundles: ['a.unity3d'], prefabBundles: [] },
      VO_NEW1_010_Play_01: { zhcnBundles: ['b.unity3d'], prefabBundles: [] },
      VO_VAC_301_Play_01: { zhcnBundles: ['c.unity3d'], prefabBundles: [] },
      CFM_ClumsyKodo_Play: { zhcnBundles: ['d.unity3d'], prefabBundles: [] },
    },
  },
  englishNames: { EX1_116: 'Leeroy Jenkins' },
  aliases: { leeroy: ['EX1_116'] },
  extras: { EX1_116: { cardClass: 'NEUTRAL', rarity: 'LEGENDARY', cost: 5 } },
  musicIndex: [{
    cardId: 'EX1_116',
    musicStinger: { audioClip: 'Pegasus_Stinger_Leeroy_Jenkins', duration: 4.27 },
  }],
});

const train = repo.searchCards('火车王');
assert.strictEqual(train.results[0].cardId, 'EX1_116');
assert.strictEqual(repo.searchCards('EX1_116').results[0].cardId, 'EX1_116');
assert.strictEqual(repo.searchCards('Leeroy').results[0].cardId, 'EX1_116');
assert.strictEqual(repo.searchCards('').results.length, 0);

const card = repo.getCard('EX1_116');
assert.ok(card);
assert.strictEqual(card.classLabel, '中立');
assert.strictEqual(card.tracks.play.available, true);
assert.strictEqual(card.tracks.music.available, true);
assert.strictEqual(card.tracks.entrance.available, true);
assert.ok(!JSON.stringify(card.tracks.play).includes('undefined'));

const van = repo.getCard('VAN_NEW1_010');
assert.strictEqual(van.tracks.play.sourceNote, '使用原卡语音');
assert.strictEqual(van.tracks.play.mappingType, 'shared_resource');
assert.strictEqual(van.tracks.attack.available, false);
assert.strictEqual(van.tracks.attack.userStatus, '暂无语音');

assert.strictEqual(repo.getCardVoice('VAC_954', 'play').mappingType, 'shared_audio');
assert.strictEqual(repo.getCardVoice('CFM_335', 'play').mappingType, 'named_sfx');

const cap = repo.getCard('CAP_107');
assert.strictEqual(cap.tracks.play.available, false);
assert.ok(cap.tracks.play.userStatus === '暂时无法播放' || cap.tracks.play.userStatus === '暂无语音');

assert.ok(repo.getMusicMeta('EX1_116'));
assert.strictEqual(repo.getMusicMeta('VAN_NEW1_010'), null);

console.log('ok cardRepository');
