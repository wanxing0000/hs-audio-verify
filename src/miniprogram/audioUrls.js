const DEFAULT_API_BASE = 'http://127.0.0.1:8767';

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function createAudioUrls(apiBase) {
  const base = trimSlash(apiBase || DEFAULT_API_BASE);
  return {
    apiBase: base,
    getVoiceUrl(card, type) {
      const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
      return base + '/api/audio/voice/' + encodeURIComponent(id) + '/' + encodeURIComponent(type);
    },
    getMusicUrl(card) {
      const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
      return base + '/api/audio/music/' + encodeURIComponent(id);
    },
    getEntranceUrl(card) {
      const id = typeof card === 'string' ? card : (card && (card.id || card.cardId));
      return base + '/api/audio/entrance/' + encodeURIComponent(id);
    },
    getQuickPlayUrl(card) {
      const type = card && card.quickPlay && card.quickPlay.type;
      if (type === 'entrance') return this.getEntranceUrl(card);
      if (type === 'music') return this.getMusicUrl(card);
      if (type === 'voice') return this.getVoiceUrl(card, 'play');
      return '';
    },
  };
}

module.exports = { DEFAULT_API_BASE, createAudioUrls };
