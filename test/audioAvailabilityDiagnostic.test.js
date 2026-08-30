const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getCardAudioAvailability } = require('../src/miniprogram/audioAvailability.js');
const { adaptCard, publicDetail, buildCatalog } = require('../src/miniprogram/catalogAdapter.js');
const { shuffle } = require('./musicCoverageSample.js');

const ROOT = path.resolve(__dirname, '..');
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
const clips = audioIndex.clips;
const catalog = buildCatalog(unified);

function diag(id) {
  return getCardAudioAvailability(unified.cards[id], clips);
}

const leeroy = diag('EX1_116');
assert.strictEqual(leeroy.play.status, 'available');
assert.strictEqual(leeroy.attack.status, 'available');
assert.strictEqual(leeroy.death.status, 'available');
assert.strictEqual(leeroy.music.status, 'available');
assert.strictEqual(leeroy.cardAudioStatus, 'full');
assert.strictEqual(leeroy.special, false);

const zilliax = diag('BOT_548');
assert.strictEqual(zilliax.play.status, 'available');
assert.strictEqual(zilliax.music.status, 'available');
assert.strictEqual(zilliax.cardAudioStatus, 'full');
assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]BOT_548['"]/.test(
  fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'audioAvailability.js'), 'utf8'),
));

const hero = diag('HERO_01');
assert.strictEqual(hero.play.status, 'unavailable');
assert.notStrictEqual(hero.play.status, 'available');
assert.strictEqual(hero.cardAudioStatus, 'special_audio_system');
assert.strictEqual(hero.special, true);
assert.ok(hero.attack.status === 'available' || hero.attack.status === 'extraction_failed');
const heroPub = publicDetail(adaptCard(unified.cards.HERO_01), hero);
assert.strictEqual(heroPub.voice.play.available, false);
assert.ok(heroPub.audio.special);
assert.ok(heroPub.audio.message.includes('特殊语音系统'));
assert.strictEqual(heroPub.entrancePreview.available, false);
assert.ok(heroPub.voice.attack.available || heroPub.voice.attack.emptyLabel);

const cap = diag('CAP_107');
assert.ok(cap.play.status === 'available' || cap.play.status === 'extraction_failed');
assert.ok(cap.play.status !== 'unavailable' || cap.play.reason);
const capCard = catalog.byId.CAP_107;
assert.ok(capCard);
assert.strictEqual(capCard.entrancePreview.available, false);

const etc = diag('ETC_409');
assert.strictEqual(etc.play.status, 'available');
assert.strictEqual(etc.music.status, 'unavailable');
assert.strictEqual(etc.cardAudioStatus, 'partial');
assert.strictEqual(adaptCard(unified.cards.ETC_409).entrancePreview.available, false);

const legend = [];
const common = [];
const special = [];
for (const id of Object.keys(unified.cards)) {
  const c = unified.cards[id];
  if (!c || c.collectible !== true) continue;
  if (c.type === 'MINION' && c.rarity === 'LEGENDARY') legend.push(c);
  else if (c.type === 'MINION' && (c.rarity === 'COMMON' || c.rarity === 'RARE' || c.rarity === 'EPIC')) common.push(c);
  else if (c.type === 'HERO' || c.type === 'HERO_POWER' || c.type === 'ENCHANTMENT' || c.type === 'LOCATION') special.push(c);
}

const SEED = 20260828;
const legendSample = shuffle(legend, SEED).slice(0, 10);
const commonSample = shuffle(common, SEED).slice(0, 5);
const specialSample = shuffle(special, SEED).slice(0, 5);
assert.strictEqual(legendSample.length, 10);
assert.strictEqual(commonSample.length, 5);
assert.strictEqual(specialSample.length, 5);

for (const c of legendSample.concat(commonSample).concat(specialSample)) {
  const d = diag(c.id);
  assert.ok(d.play && d.attack && d.death && d.music, c.id);
  assert.ok(['full', 'partial', 'none', 'special_audio_system'].indexOf(d.cardAudioStatus) >= 0, c.id + ' ' + d.cardAudioStatus);
  if (c.type === 'HERO' && d.play.status !== 'available') {
    assert.strictEqual(d.cardAudioStatus, 'special_audio_system', c.id);
  }
}

const pub = publicDetail(adaptCard(unified.cards.EX1_116), leeroy);
const leak = JSON.stringify(pub).toLowerCase();
assert.ok(!/guid|bundle|fsb|casc|carddef|unity|preload|soundspell/.test(leak));

console.log('ok audioAvailabilityDiagnostic', {
  EX1_116: leeroy.cardAudioStatus,
  BOT_548: zilliax.cardAudioStatus,
  HERO_01: hero.cardAudioStatus,
  ETC_409: etc.cardAudioStatus,
  sampled: legendSample.length + commonSample.length + specialSample.length,
});
