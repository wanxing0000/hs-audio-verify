const { getApiBase } = require('./config.js');

function apiBase() {
  return getApiBase();
}

function getVoiceUrl(card, type) {
  const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
  return apiBase() + '/api/audio/voice/' + encodeURIComponent(id) + '/' + encodeURIComponent(type);
}

function getMusicUrl(card) {
  const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
  return apiBase() + '/api/audio/music/' + encodeURIComponent(id);
}

function getEntranceUrl(card) {
  const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
  return apiBase() + '/api/audio/entrance/' + encodeURIComponent(id);
}

function getTrackUrl(card, track) {
  if (track === 'music') return getMusicUrl(card);
  if (track === 'entrance') return getEntranceUrl(card);
  return getVoiceUrl(card, track);
}

function getQuickPlayUrl(card) {
  const type = card && card.quickPlay && card.quickPlay.type;
  if (type === 'entrance') return getEntranceUrl(card);
  if (type === 'music') return getMusicUrl(card);
  if (type === 'voice') return getVoiceUrl(card, 'play');
  return '';
}

module.exports = {
  getVoiceUrl,
  getMusicUrl,
  getEntranceUrl,
  getTrackUrl,
  getQuickPlayUrl,
};
