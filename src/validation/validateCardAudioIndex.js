const fs = require('fs');
const path = require('path');

function fail(errors, msg) {
  errors.push(msg);
}

function validateCardAudioIndex({ unified, musicIndex, musicAssets, cards, clientVersion }) {
  const errors = [];
  if (!unified || typeof unified !== 'object') return { ok: false, errors: ['unified missing'] };
  if (!unified.schemaVersion) fail(errors, 'schemaVersion missing');
  if (!unified.clientVersion) fail(errors, 'clientVersion missing');
  if (clientVersion && unified.clientVersion !== clientVersion) {
    fail(errors, 'clientVersion mismatch: ' + unified.clientVersion + ' != ' + clientVersion);
  }
  if (!unified.cards || typeof unified.cards !== 'object') fail(errors, 'unified.cards missing');

  const cardIdSet = cards instanceof Set
    ? cards
    : new Set((cards || []).map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean));

  const assetMap = musicAssets?.assets || {};
  const seen = new Set();
  const assetTargets = new Map();

  for (const cardId of Object.keys(unified.cards || {})) {
    if (seen.has(cardId)) fail(errors, 'duplicate CardID ' + cardId);
    seen.add(cardId);
    if (cardIdSet.size && !cardIdSet.has(cardId)) fail(errors, 'CardID not in cards.json: ' + cardId);

    const rec = unified.cards[cardId];
    if (!rec || rec.id !== cardId) fail(errors, cardId + ': id mismatch');

    for (const slotName of ['play', 'attack', 'death']) {
      const slot = rec.voice && rec.voice[slotName];
      if (!slot) {
        fail(errors, cardId + '.' + slotName + ' missing');
        continue;
      }
      if (slot.status === 'shared' || slot.status === 'available') {
        if (!slot.sourceCardId) fail(errors, cardId + '.' + slotName + ': missing sourceCardId');
      }
      if (slot.status === 'unresolved' && !slot.reason) {
        fail(errors, cardId + '.' + slotName + ': unresolved missing reason');
      }
    }

    const music = rec.music;
    if (!music) {
      fail(errors, cardId + ': music missing');
      continue;
    }
    if (music.status === 'available' || music.status === 'shared') {
      if (!music.musicAssetId) fail(errors, cardId + ': music available/shared missing musicAssetId');
      if (!assetMap[music.musicAssetId]) fail(errors, cardId + ': musicAssetId not in registry: ' + music.musicAssetId);
      if (!music.sourceCardId) fail(errors, cardId + ': music missing sourceCardId');
      if (music.status === 'shared' && music.sourceCardId === cardId) {
        fail(errors, cardId + ': shared music sourceCardId must not be self');
      }
      if (cardIdSet.size && music.sourceCardId && !unified.cards[music.sourceCardId] && !cardIdSet.has(music.sourceCardId)) {
        fail(errors, cardId + ': Music sourceCardId missing: ' + music.sourceCardId);
      }
      const asset = assetMap[music.musicAssetId];
      if (asset) {
        const key = asset.prefabGuid + '|' + asset.audioClipName;
        if (assetTargets.has(music.musicAssetId) && assetTargets.get(music.musicAssetId) !== key) {
          fail(errors, 'musicAssetId conflict ' + music.musicAssetId);
        }
        assetTargets.set(music.musicAssetId, key);
      }
    }
    if (music.status === 'unavailable' && music.musicAssetId) {
      fail(errors, cardId + ': unavailable must not have musicAssetId');
    }
    if (music.status === 'unresolved' && !music.reason) {
      fail(errors, cardId + ': unresolved music missing reason');
    }

    const ep = rec.entrancePreview;
    if (!ep) fail(errors, cardId + ': entrancePreview missing');
    else if (ep.available === true) {
      const playOk = rec.voice.play.status === 'available' || rec.voice.play.status === 'shared';
      const musicOk = music.status === 'available' || music.status === 'shared';
      if (!playOk || !rec.voice.play.voiceKey) fail(errors, cardId + ': entrancePreview true without Play Voice');
      if (!musicOk || !music.musicAssetId) fail(errors, cardId + ': entrancePreview true without Music');
    }
  }

  if (musicIndex?.cards) {
    for (const id of Object.keys(musicIndex.cards)) {
      if (!unified.cards[id]) fail(errors, 'music-index CardID missing from unified: ' + id);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const ROOT = process.cwd();
  const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
  const musicIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-index.json'), 'utf8'));
  const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
  const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.json'), 'utf8'));
  const result = validateCardAudioIndex({
    unified,
    musicIndex,
    musicAssets,
    cards,
    clientVersion: '36.4.0.250339',
  });
  if (!result.ok) {
    console.error('card-audio-index validation failed:');
    for (const e of result.errors.slice(0, 40)) console.error(' -', e);
    console.error('total errors', result.errors.length);
    process.exit(1);
  }
  console.log('ok card-audio-index validation', Object.keys(unified.cards).length, 'cards');
}

if (require.main === module) main();

module.exports = { validateCardAudioIndex };
