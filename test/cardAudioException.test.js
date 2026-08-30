const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  loadIndexes,
  findCardsByQuery,
  buildIndexInvestigation,
  concludeFromLayers,
  playable,
} = require('../src/validation/investigateCardAudio.js');

const ROOT = path.resolve(__dirname, '..');
const indexes = loadIndexes(ROOT);
const { cards, unified } = indexes;

const hellscream = findCardsByQuery(cards, '地狱咆哮', indexes.enNames);
assert.ok(hellscream.some((c) => c.id === 'HERO_01'), 'search 地狱咆哮 includes HERO_01');
assert.ok(hellscream.some((c) => c.id === 'EX1_414'));
assert.ok(hellscream.some((c) => c.id === 'CORE_EX1_414'));
assert.ok(hellscream.some((c) => c.id === 'VAN_EX1_414'));

const hero = buildIndexInvestigation('HERO_01', indexes);
assert.strictEqual(hero.card.type, 'HERO');
assert.ok(!playable(hero.index.voice.play), 'HERO_01 has no Play voice');
assert.ok(playable(hero.index.voice.attack), 'HERO_01 Attack exists');
assert.ok(playable(hero.index.voice.death), 'HERO_01 Death exists');
assert.notStrictEqual(hero.index.music && hero.index.music.status, 'available');
assert.ok(!hero.index.entrancePreview || hero.index.entrancePreview.available === false);

const grom = buildIndexInvestigation('EX1_414', indexes);
assert.ok(playable(grom.index.voice.play), 'EX1_414 Play exists');
assert.ok(grom.index.music && (grom.index.music.status === 'available' || grom.index.music.status === 'shared'));
assert.ok(grom.index.entrancePreview && grom.index.entrancePreview.available);

const heroConclusion = concludeFromLayers({
  card: hero.card,
  index: hero.index,
  cardDef: { play: null, attack: 'x', death: 'y' },
  soundReferences: [
    { prefabName: 'Attack', guid: 'a' },
    { prefabName: 'Emote_Start', guid: 'b' },
  ],
  audioReferences: [{ audioClipName: 'VO_HERO_01_Start_09' }],
});
assert.ok(heroConclusion.conclusion.includes('hero_emote'), heroConclusion.conclusion);
assert.strictEqual(heroConclusion.recommendedFix, 'do_not_fabricate_voice');

function playSlot(id) {
  return unified.cards[id].voice.play;
}

assert.strictEqual(playSlot('EX1_116').status, 'available');
assert.ok(playSlot('EX1_116').voiceKey.includes('EX1_116'));

assert.strictEqual(playSlot('VAN_NEW1_010').status, 'shared');
assert.strictEqual(playSlot('VAN_NEW1_010').sourceCardId, 'NEW1_010');

assert.strictEqual(playSlot('VAC_954').status, 'shared');
assert.strictEqual(playSlot('VAC_954').sourceCardId, 'VAC_301');
assert.notStrictEqual(playSlot('VAC_954').voiceKey, 'VO_VAC_954_Play_01');

const cap = playSlot('CAP_107');
assert.ok(cap.status === 'available' || cap.status === 'shared' || cap.status === 'unavailable' || cap.status === 'unresolved');
assert.ok(!cap.voiceKey || !String(cap.voiceKey).includes('VO_CAP_107'));

assert.ok(playSlot('CFM_335').voiceKey);
assert.ok(/ClumsyKodo|CFM_/i.test(playSlot('CFM_335').voiceKey));

const zilliax = findCardsByQuery(cards, '奇利亚斯', indexes.enNames);
assert.ok(zilliax.some((c) => c.id === 'BOT_548'));
assert.ok(playable(buildIndexInvestigation('BOT_548', indexes).index.voice.play));

const mixSrc = fs.readFileSync(path.join(ROOT, 'src', 'music', 'mixPcm16.js'), 'utf8');
const cfgSrc = fs.readFileSync(path.join(ROOT, 'src', 'music', 'entranceMixConfig.js'), 'utf8');
const compSrc = fs.readFileSync(path.join(ROOT, 'src', 'music', 'findMusicStartCompensation.js'), 'utf8');
assert.ok(!/if\s*\(\s*cardId\s*===/.test(mixSrc));
assert.ok(!/if\s*\(\s*cardId\s*===/.test(cfgSrc + compSrc));
assert.ok(!/BOT_548|HERO_01|EX1_414/.test(cfgSrc));
assert.ok(!/GIL_598/.test(cfgSrc + compSrc));

console.log('ok cardAudioException', {
  hellscreamHits: hellscream.filter((c) => c.collectible).map((c) => c.id),
  heroPlay: hero.index.voice.play.status,
  gromPlay: grom.index.voice.play.status,
});
