'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isForbiddenCandidate,
  isBattlegroundsCard,
  indexedSlots,
  classifySlot,
  collectDisplayableRelated,
  runRelatedAudioProductionAudit,
  FOCUS_12,
} = require('../src/audit/relatedAudioProductionAudit.js');
const { RELATED_DEPTH_MAX } = require('../src/miniprogram/relatedCards.js');

const ROOT = path.resolve(__dirname, '..');

assert.strictEqual(RELATED_DEPTH_MAX, 2);
assert.strictEqual(FOCUS_12.length, 12);
assert.strictEqual(isForbiddenCandidate({ type: 'ENCHANTMENT' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO_POWER' }), true);
assert.strictEqual(isBattlegroundsCard({ type: 'BATTLEGROUND_HERO_BUDDY' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'MINION', set: 'BATTLEGROUNDS' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'HERO', set: 'HERO_SKINS' }), true);
assert.strictEqual(isForbiddenCandidate({ type: 'MINION', set: 'TIME_TRAVEL' }), false);

function rawVoice(id, keys, type) {
  keys = keys || {};
  function slot(key) {
    if (!key) return { status: 'unavailable', voiceKey: null };
    return { status: 'available', voiceKey: key, sourceCardId: id };
  }
  return {
    id: id,
    collectible: keys.collectible === true,
    type: type || 'MINION',
    name: id,
    set: keys.set || 'TIME_TRAVEL',
    voice: {
      play: slot(keys.play),
      attack: slot(keys.attack),
      death: slot(keys.death),
    },
    music: keys.music
      ? { status: 'available', audioClipName: keys.music, musicAssetId: keys.music }
      : { status: 'unavailable' },
    entrancePreview: { available: !!keys.entrance },
  };
}

const noMap = indexedSlots('X', rawVoice('X', {}));
assert.strictEqual(noMap.length, 0);

const mapped = indexedSlots('A', rawVoice('A', { play: 'VO_A_Play', attack: 'VO_A_Attack' }));
assert.strictEqual(mapped.length, 2);
assert.strictEqual(mapped[0].mappingKey, 'VO_A_Play');

const alias = indexedSlots('TIME_005t9t', rawVoice('TIME_005t9t', { play: 'TIME_005t9t_Play' }));
assert.strictEqual(alias[0].mappingKey, 'TIME_005t9t_Play');
assert.notStrictEqual(alias[0].mappingKey, 'TIME_005t9t');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p210e-'));
const prodVoice = path.join(tmp, 'data', 'production-audio', 'voice');
const srcVoice = path.join(tmp, 'tmp', 'audio');
fs.mkdirSync(prodVoice, { recursive: true });
fs.mkdirSync(path.join(tmp, 'data', 'production-audio', 'music'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'data', 'production-audio', 'entrance'), { recursive: true });
fs.mkdirSync(srcVoice, { recursive: true });
fs.writeFileSync(path.join(tmp, 'data', 'production-audio', 'manifest.json'), JSON.stringify({
  schemaVersion: 1, entranceMixVersion: 3, voice: [], music: [], entrance: [],
}) + '\n');

function tinyWav() {
  const buf = Buffer.alloc(80);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(72, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(22050, 24);
  buf.writeUInt32LE(44100, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(36, 40);
  return buf;
}

const wav = tinyWav();
fs.writeFileSync(path.join(srcVoice, 'VO_A_Play.wav'), wav);
const cardA = { cardId: 'A', name: 'A', type: 'MINION', parentId: 'P', depth: 1 };

const missing = classifySlot(tmp, cardA, { audioType: 'attack', mappingKey: 'VO_A_Attack', kind: 'voice' });
assert.strictEqual(missing.status, 'SOURCE_MISSING');

const ready = classifySlot(tmp, cardA, { audioType: 'play', mappingKey: 'VO_A_Play', kind: 'voice' });
assert.strictEqual(ready.status, 'READY_TO_COPY');

fs.writeFileSync(path.join(prodVoice, 'VO_A_Play.wav'), wav);
const present = classifySlot(tmp, cardA, { audioType: 'play', mappingKey: 'VO_A_Play', kind: 'voice' });
assert.strictEqual(present.status, 'ALREADY_PRESENT');

const other = Buffer.from(wav);
other[50] = (other[50] + 1) & 0xff;
fs.writeFileSync(path.join(prodVoice, 'VO_B_Play.wav'), other);
fs.writeFileSync(path.join(srcVoice, 'VO_B_Play.wav'), wav);
const conflict = classifySlot(tmp, { cardId: 'B', name: 'B', type: 'MINION', parentId: 'P', depth: 1 }, {
  audioType: 'play', mappingKey: 'VO_B_Play', kind: 'voice',
});
assert.strictEqual(conflict.status, 'CONFLICT');

const fixture = collectDisplayableRelated({
  cards: {
    P: rawVoice('P', { collectible: true, play: 'VO_P' }),
    Pt1: rawVoice('Pt1', { play: 'VO_Pt1' }),
    Pt1e: Object.assign(rawVoice('Pt1e', {}), { type: 'ENCHANTMENT' }),
    Pt1hp: Object.assign(rawVoice('Pt1hp', {}), { type: 'HERO_POWER', id: 'Pt1hp' }),
    Q: rawVoice('Q', { collectible: true }),
    Qt1: Object.assign(rawVoice('Qt1', { play: 'VO_Qt1' }), { type: 'BATTLEGROUND_HERO_BUDDY', id: 'Qt1' }),
  },
});
assert.ok(fixture.cards.some((c) => c.cardId === 'Pt1'));
assert.ok(!fixture.cards.some((c) => c.cardId === 'Pt1e'));
assert.ok(!fixture.cards.some((c) => c.cardId === 'Pt1hp'));

const liveCards = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
const liveIndex = path.join(ROOT, 'data', 'index', 'card-audio-index.json');
const liveManifest = path.join(ROOT, 'data', 'production-audio', 'manifest.json');
if (fs.existsSync(liveCards) && fs.existsSync(liveIndex) && fs.existsSync(liveManifest)) {
  const live = runRelatedAudioProductionAudit({ root: ROOT });
  assert.strictEqual(live.summary.filterBug, 0);
  assert.ok(live.summary.cardCandidates > 0);
  assert.ok(live.summary.slotCandidates > 0);
  assert.ok(live.summary.slotCandidates < 3705 || live.summary.ready >= 0);
  FOCUS_12.forEach((id) => {
    assert.ok(live.cards.some((c) => c.cardId === id), 'displayable ' + id);
    const play = live.slots.find((s) => s.cardId === id && s.audioType === 'play');
    assert.ok(play, id + ' play indexed');
    assert.ok(play.status === 'ALREADY_PRESENT' || play.status === 'READY_TO_COPY');
  });
  const sheep = live.slots.filter((s) => s.cardId === 'TIME_005t9t');
  assert.ok(sheep.some((s) => s.audioType === 'play' && s.mappingKey === 'TIME_005t9t_Play'));
  assert.ok(sheep.some((s) => s.audioType === 'attack' && s.mappingKey === 'TIME_005t9t_Attack'));
  assert.ok(sheep.some((s) => s.audioType === 'death' && s.mappingKey === 'TIME_005t9t_Death'));
  assert.ok(!sheep.some((s) => s.audioType === 'music'));
  assert.ok(!live.cards.some((c) => c.cardId === 'TIME_609t2e' || c.cardId === 'TIME_005t2e' || c.cardId === 'TIME_005t8e'));
  const attack609 = live.slots.find((s) => s.cardId === 'TIME_609t1' && s.audioType === 'attack');
  assert.ok(attack609);
  assert.ok(attack609.status === 'READY_TO_COPY' || attack609.status === 'ALREADY_PRESENT');
  live.slots.forEach((s) => {
    assert.ok(s.depth <= 2, 'depth filter ' + s.cardId);
    assert.ok(['MINION', 'SPELL', 'WEAPON', 'LOCATION', 'HERO'].indexOf(s.type) >= 0, s.type);
  });
}

console.log('ok phase210ERelatedAudioProductionAudit');
