const fs = require('fs');
const path = require('path');

function fail(errors, msg) {
  errors.push(msg);
}

function validateCardVoiceIndex({ index, cards, audioIndex }) {
  const errors = [];
  if (!index || typeof index !== 'object') {
    return { ok: false, errors: ['index is not an object'] };
  }
  if (!index.cards || typeof index.cards !== 'object') {
    return { ok: false, errors: ['index.cards missing'] };
  }

  const cardIds = Object.keys(index.cards);
  const seen = new Set();
  const cardIdSet = cards instanceof Set
    ? cards
    : new Set((cards || []).map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean));

  const clipSet = new Set();
  if (audioIndex?.clips) {
    for (const k of Object.keys(audioIndex.clips)) clipSet.add(k);
  } else if (audioIndex?.zhcnAudioClips) {
    for (const k of Object.keys(audioIndex.zhcnAudioClips)) clipSet.add(k);
  } else if (audioIndex?.guidToVoice) {
    for (const rec of Object.values(audioIndex.guidToVoice)) {
      for (const k of rec.voiceKeys || []) clipSet.add(k);
    }
  }

  for (const cardId of cardIds) {
    if (seen.has(cardId)) fail(errors, 'duplicate CardID ' + cardId);
    seen.add(cardId);
    if (cardIdSet.size && !cardIdSet.has(cardId)) {
      fail(errors, 'CardID not in cards data: ' + cardId);
    }
    const rec = index.cards[cardId];
    if (!rec || typeof rec !== 'object') {
      fail(errors, cardId + ': record is not an object');
      continue;
    }
    const voice = rec.voice || {};
    for (const slotName of ['play', 'attack', 'death']) {
      const slot = voice[slotName];
      if (!slot) {
        fail(errors, cardId + '.' + slotName + ': missing slot');
        continue;
      }
      const st = slot.status;
      if (st === 'matched') {
        if (!slot.voiceKey) fail(errors, cardId + '.' + slotName + ': matched but VoiceKey empty');
        if (!slot.voiceSourceCardId) fail(errors, cardId + '.' + slotName + ': matched but VoiceSourceCardID missing');
        if (clipSet.size && slot.voiceKey && !clipSet.has(slot.voiceKey)) {
          fail(errors, cardId + '.' + slotName + ': VoiceKey not in audio-index: ' + slot.voiceKey);
        }
      }
      if (st === 'matched' && (slot.mappingType === 'shared_resource' || slot.mappingType === 'shared_audio' || slot.mappingType === 'token_clip' || slot.mappingType === 'named_sfx')) {
        const ev = slot.evidence || rec.evidence || {};
        if (!ev.prefabGuid && !ev.playPrefabGuid && !ev.attackPrefabGuid && !ev.deathPrefabGuid && !ev.audioClipName) {
          fail(errors, cardId + '.' + slotName + ': indirect mapping missing evidence');
        }
      }
      if (slot.mappingType === 'shared_resource') {
        const ev = slot.evidence || rec.evidence || {};
        const guid = ev.prefabGuid || ev.playPrefabGuid || ev.attackPrefabGuid || ev.deathPrefabGuid;
        if (!guid) fail(errors, cardId + '.' + slotName + ': shared_resource missing GUID evidence');
      }
      if (st === 'unresolved' || slot.mappingType === 'unresolved') {
        if (!slot.reason && !slot.possibleReason) {
          fail(errors, cardId + '.' + slotName + ': unresolved missing reason');
        }
      }
      if (st === 'no_voice') {
        const ev = slot.evidence || {};
        if (ev.prefabGuid || ev.soundSpellGuid) {
          fail(errors, cardId + '.' + slotName + ': no_voice but Sound Reference GUID present');
        }
        if (slot.voiceKey) fail(errors, cardId + '.' + slotName + ': no_voice but VoiceKey set');
      }
    }
  }

  return { ok: errors.length === 0, errors, cardCount: cardIds.length };
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validateFromDisk(root) {
  const base = root || path.resolve(__dirname, '..', '..');
  const indexPath = path.join(base, 'data', 'index', 'card-voice-index.json');
  const audioPath = path.join(base, 'data', 'index', 'audio-index.json');
  const cardsPath = path.join(base, 'data', 'hearthstonejson', 'zhCN', 'cards.json');
  let index;
  try {
    index = loadJson(indexPath);
  } catch (e) {
    return { ok: false, errors: ['JSON parse failed: ' + indexPath + ' ' + e.message] };
  }
  let audioIndex = {};
  try {
    audioIndex = loadJson(audioPath);
  } catch (e) {
    return { ok: false, errors: ['JSON parse failed: ' + audioPath + ' ' + e.message] };
  }
  const cards = loadJson(cardsPath);
  return validateCardVoiceIndex({
    index,
    cards,
    audioIndex,
  });
}

module.exports = {
  validateCardVoiceIndex,
  validateFromDisk,
};

if (require.main === module) {
  const result = validateFromDisk(path.resolve(__dirname, '..', '..'));
  if (!result.ok) {
    console.error('validation failed', result.errors.slice(0, 40));
    console.error('error count', result.errors.length);
    process.exit(1);
  }
  console.log('validation ok', result.cardCount, 'cards');
}
