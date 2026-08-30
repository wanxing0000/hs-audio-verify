const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateFromDisk } = require('../src/validation/validateCardVoiceIndex.js');

const ROOT = path.resolve(__dirname, '..');
const indexPath = path.join(ROOT, 'data', 'index', 'card-voice-index.json');

assert.ok(fs.existsSync(indexPath), 'card-voice-index.json missing — run Phase 0.8 build first');

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
assert.strictEqual(index.version, '0.8');
assert.ok(index.cards, 'cards object missing');

function slot(cardId, name) {
  const rec = index.cards[cardId];
  assert.ok(rec, 'missing card ' + cardId);
  return rec.voice[name];
}

function play(cardId) {
  return slot(cardId, 'play');
}

// Required Phase 0.7 cases against the full index
const ex1 = play('EX1_116');
assert.strictEqual(ex1.status, 'matched');
assert.strictEqual(ex1.mappingType, 'direct');
assert.strictEqual(ex1.voiceSourceCardId, 'EX1_116');
assert.ok(ex1.voiceKey && ex1.voiceKey.includes('EX1_116'));

const van = play('VAN_NEW1_010');
assert.strictEqual(van.status, 'matched');
assert.strictEqual(van.mappingType, 'shared_resource');
assert.strictEqual(van.voiceSourceCardId, 'NEW1_010');

const core = play('CORE_DMF_067');
assert.strictEqual(core.status, 'matched');
assert.strictEqual(core.mappingType, 'shared_resource');
assert.strictEqual(core.voiceSourceCardId, 'DMF_067');

const won = play('WON_302');
assert.strictEqual(won.status, 'matched');
assert.strictEqual(won.mappingType, 'shared_resource');
assert.strictEqual(won.voiceSourceCardId, 'OG_202');

const vac = play('VAC_954');
assert.strictEqual(vac.status, 'matched');
assert.strictEqual(vac.mappingType, 'shared_audio');
assert.strictEqual(vac.voiceSourceCardId, 'VAC_301');

const cap = play('CAP_107');
assert.strictEqual(cap.status, 'matched');
assert.strictEqual(cap.mappingType, 'token_clip');
assert.strictEqual(cap.voiceSourceCardId, 'CAP_106t');

const cfm = play('CFM_335');
assert.strictEqual(cfm.status, 'matched');
assert.strictEqual(cfm.mappingType, 'named_sfx');
assert.ok(cfm.voiceKey && cfm.voiceKey.includes('ClumsyKodo'));

const edr = play('EDR_526');
assert.strictEqual(edr.status, 'matched');
assert.strictEqual(edr.mappingType, 'direct');
assert.strictEqual(edr.voiceSourceCardId, 'EDR_526');

// 10 live samples from the full index
const live = [
  ['EX1_116', 'direct', 'EX1_116'],
  ['VAN_NEW1_010', 'shared_resource', 'NEW1_010'],
  ['CORE_DMF_067', 'shared_resource', 'DMF_067'],
  ['WON_302', 'shared_resource', 'OG_202'],
  ['VAC_954', 'shared_audio', 'VAC_301'],
  ['CAP_107', 'token_clip', 'CAP_106t'],
  ['CFM_335', 'named_sfx', 'CFM_335'],
  ['EDR_526', 'direct', 'EDR_526'],
  ['NEW1_018', 'direct', 'NEW1_018'],
  ['UNG_027', 'direct', 'UNG_027'],
];
assert.strictEqual(live.length, 10);
for (const [id, mapping, source] of live) {
  const p = play(id);
  assert.strictEqual(p.mappingType, mapping, id + ' mapping');
  assert.strictEqual(p.voiceSourceCardId, source, id + ' source');
  assert.strictEqual(p.status, 'matched', id + ' status');
  assert.ok(p.voiceKey, id + ' voiceKey');
}

const v = validateFromDisk(ROOT);
assert.ok(v.ok, 'validation failed: ' + (v.errors || []).slice(0, 8).join('; '));

console.log('ok phase-0.8 index', {
  cardCount: Object.keys(index.cards).length,
  EX1_116: ex1.mappingType,
  VAN_NEW1_010: van.voiceSourceCardId,
  WON_302: won.voiceSourceCardId,
});
