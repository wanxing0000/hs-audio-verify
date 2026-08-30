'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_CARD_IDS = [
  'TIME_609t1',
  'TIME_609t2',
  'TIME_005t1',
  'TIME_005t2',
  'TIME_005t3',
  'TIME_005t4',
  'TIME_005t5',
  'TIME_005t6',
  'TIME_005t7',
  'TIME_005t8',
  'TIME_005t9',
  'TIME_005t9t',
];
const EXPECTED_PLAY_VOICE_KEYS = {
  TIME_609t1: 'VO_TIME_609t1_Female_HighElf_Play_01',
  TIME_609t2: 'VO_TIME_609t2_Female_HighElf_Play_01',
  TIME_005t1: 'VO_TIME_005t1_Male_Ethereal_Play_01',
  TIME_005t2: 'VO_TIME_005t2_Male_Ethereal_Play_01',
  TIME_005t3: 'VO_TIME_005t3_Male_Ethereal_Play_01',
  TIME_005t4: 'VO_TIME_005t4_Male_Ethereal_Play_01',
  TIME_005t5: 'VO_TIME_005t5_Male_EtherealFaceless_Play_01',
  TIME_005t6: 'VO_TIME_005t6_Male_EtherealDemon_Play_01',
  TIME_005t7: 'VO_TIME_005t7_Male_Ethereal_Play_01',
  TIME_005t8: 'VO_TIME_005t8_Male_EtherealMurloc_Play_01',
  TIME_005t9: 'VO_TIME_005t9_Female_Ethereal_Play_01',
  TIME_005t9t: 'TIME_005t9t_Play',
};

const candidates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'card-verification', 'phase-2.10-B-candidates.json'), 'utf8'));
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));

function candidatePlayKey(row) {
  if (!row) return null;
  if (Array.isArray(row.slots)) {
    const play = row.slots.find((s) => s && s.type === 'play');
    if (play && play.voiceKey) return play.voiceKey;
  }
  return row.playVoiceKey || null;
}

const byId = Object.create(null);
(candidates.candidates || []).forEach((row) => {
  if (row && row.cardId) byId[row.cardId] = row;
});

TARGET_CARD_IDS.forEach((cardId) => {
  const expected = EXPECTED_PLAY_VOICE_KEYS[cardId];
  const cand = byId[cardId];
  const raw = unified.cards[cardId];
  const play = raw && raw.voice && raw.voice.play;
  assert.ok(cand, 'candidate missing ' + cardId);
  assert.ok(raw, 'audio index missing ' + cardId);
  assert.strictEqual(candidatePlayKey(cand), expected, cardId + ' candidate voiceKey');
  assert.ok(play && play.voiceKey, cardId + ' index play voiceKey');
  assert.strictEqual(play.voiceKey, expected, cardId + ' index voiceKey');
});

assert.strictEqual(unified.cards.TIME_005t9t.voice.play.voiceKey, 'TIME_005t9t_Play');

console.log('relatedAudioTargetedExtractor.test.js ok');
