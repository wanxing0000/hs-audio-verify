const ART_BASE = 'https://art.hearthstonejson.com/v1/render/latest/zhCN/256x';

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

class CardVoiceRepository {
  constructor({ voiceIndex, audioIndex, englishNames, aliases }) {
    this.voiceIndex = voiceIndex;
    this.audioIndex = audioIndex;
    this.englishNames = englishNames || {};
    this.aliases = aliases || {};
    this.cards = voiceIndex.cards || {};
    this.clips = (audioIndex && audioIndex.clips) || {};
    this.list = Object.entries(this.cards).map(([cardId, rec]) => ({
      cardId,
      name: rec.name || cardId,
      nameEn: this.englishNames[cardId] || '',
      type: rec.type || 'UNKNOWN',
      collectible: rec.collectible === true,
    }));
  }

  getManifest() {
    const src = this.voiceIndex.source || {};
    return {
      game: src.game || 'Hearthstone',
      build: src.build || null,
      productVersion: src.productVersion || null,
      locale: src.locale || 'zhCN',
      cardCount: this.list.length,
      clipCount: Object.keys(this.clips).length,
      version: this.voiceIndex.version || null,
    };
  }

  searchCards(query, { limit = 40 } = {}) {
    const q = normalize(query);
    if (!q) return [];
    const aliasIds = new Set();
    for (const [key, ids] of Object.entries(this.aliases)) {
      if (normalize(key).includes(q) || q.includes(normalize(key))) {
        for (const id of ids) aliasIds.add(id);
      }
    }
    const scored = [];
    for (const row of this.list) {
      const id = row.cardId.toLowerCase();
      const zh = row.name.toLowerCase();
      const en = (row.nameEn || '').toLowerCase();
      let score = 0;
      if (aliasIds.has(row.cardId)) score = 90;
      if (id === q) score = Math.max(score, 100);
      else if (id.startsWith(q)) score = Math.max(score, 80);
      else if (id.includes(q)) score = Math.max(score, 60);
      if (zh === q) score = Math.max(score, 95);
      else if (zh.startsWith(q)) score = Math.max(score, 88);
      else if (zh.includes(q)) score = Math.max(score, 70);
      if (en) {
        if (en === q) score = Math.max(score, 93);
        else if (en.startsWith(q)) score = Math.max(score, 82);
        else if (en.includes(q)) score = Math.max(score, 75);
      }
      if (score > 0) scored.push({ score, row });
    }
    scored.sort((a, b) => b.score - a.score || a.row.cardId.length - b.row.cardId.length || a.row.cardId.localeCompare(b.row.cardId));
    return scored.slice(0, limit).map(({ row }) => ({
      cardId: row.cardId,
      name: row.name,
      nameEn: row.nameEn || null,
      type: row.type,
      collectible: row.collectible,
      imageUrl: `${ART_BASE}/${row.cardId}.png`,
    }));
  }

  getCard(cardId) {
    const rec = this.cards[cardId];
    if (!rec) return null;
    return {
      cardId,
      name: rec.name || cardId,
      nameEn: this.englishNames[cardId] || null,
      type: rec.type || 'UNKNOWN',
      collectible: rec.collectible === true,
      set: rec.set || null,
      dbfId: rec.dbfId ?? null,
      imageUrl: `${ART_BASE}/${cardId}.png`,
      voice: {
        play: this.getVoice(cardId, 'play'),
        attack: this.getVoice(cardId, 'attack'),
        death: this.getVoice(cardId, 'death'),
      },
    };
  }

  getVoice(cardId, type) {
    const rec = this.cards[cardId];
    if (!rec) return null;
    const slot = rec.voice && rec.voice[type];
    if (!slot) {
      return {
        type,
        status: 'no_voice',
        mappingType: 'no_voice',
        voiceKey: null,
        voiceSourceCardId: null,
        playable: false,
        uiStatus: 'No voice available',
      };
    }
    const voiceKey = slot.voiceKey || null;
    const asset = voiceKey ? this.getVoiceAsset(voiceKey) : null;
    let uiStatus = 'No voice available';
    let playable = false;
    if (slot.status === 'unresolved' || slot.mappingType === 'unresolved') {
      uiStatus = 'Voice mapping unresolved';
    } else if (slot.status === 'no_voice' || slot.mappingType === 'no_voice' || !voiceKey) {
      uiStatus = 'No voice available';
    } else if (voiceKey && (!asset || !asset.indexed)) {
      uiStatus = 'Voice asset not indexed';
    } else {
      uiStatus = 'Available';
      playable = true;
    }
    return {
      type,
      status: slot.status,
      mappingType: slot.mappingType,
      voiceKey,
      voiceSourceCardId: slot.voiceSourceCardId || null,
      reason: slot.reason || null,
      evidence: slot.evidence || rec.evidence || null,
      asset,
      playable,
      uiStatus,
    };
  }

  getVoiceAsset(voiceKey) {
    if (!voiceKey) return { indexed: false, voiceKey: null, zhcnBundles: [], prefabBundles: [] };
    const rec = this.clips[voiceKey];
    if (!rec) return { indexed: false, voiceKey, zhcnBundles: [], prefabBundles: [] };
    const zhcnBundles = rec.zhcnBundles || [];
    const prefabBundles = rec.prefabBundles || [];
    return {
      indexed: zhcnBundles.length > 0 || prefabBundles.length > 0,
      voiceKey,
      zhcnBundles,
      prefabBundles,
    };
  }
}

module.exports = { CardVoiceRepository, ART_BASE };
