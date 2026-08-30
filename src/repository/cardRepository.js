const { CardVoiceRepository, ART_BASE } = require('../explorer/CardVoiceRepository.js');

const CLASS_ZH = {
  NEUTRAL: '中立',
  MAGE: '法师',
  WARRIOR: '战士',
  WARLOCK: '术士',
  PRIEST: '牧师',
  DRUID: '德鲁伊',
  ROGUE: '潜行者',
  HUNTER: '猎人',
  PALADIN: '圣骑士',
  SHAMAN: '萨满祭司',
  DEMONHUNTER: '恶魔猎手',
  DEATHKNIGHT: '死亡骑士',
};

const TYPE_ZH = {
  MINION: '随从',
  SPELL: '法术',
  WEAPON: '武器',
  HERO: '英雄',
  HERO_POWER: '英雄技能',
  ENCHANTMENT: '附魔',
  LOCATION: '地标',
};

const RARITY_ZH = {
  FREE: '免费',
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
};

const FEATURED_SEEDS = [
  'EX1_116',
  'EX1_572',
  'NEW1_030',
  'EX1_012',
  'EX1_016',
  'CS2_222',
  'EX1_298',
  'EX1_323',
];

const SHARED_MAPPINGS = new Set(['shared_resource', 'shared_audio', 'token_clip']);

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

class CardRepository {
  constructor({ voiceIndex, audioIndex, englishNames, aliases, extras, musicIndex }) {
    this.inner = new CardVoiceRepository({ voiceIndex, audioIndex, englishNames, aliases });
    this.extras = extras || {};
    this.musicByCard = new Map();
    const rows = Array.isArray(musicIndex) ? musicIndex : (musicIndex ? [musicIndex] : []);
    for (const row of rows) {
      if (row && row.cardId && row.musicStinger && row.musicStinger.audioClip) {
        this.musicByCard.set(row.cardId, row.musicStinger);
      }
    }
  }

  getManifest() {
    return this.inner.getManifest();
  }

  getVoiceAsset(voiceKey) {
    return this.inner.getVoiceAsset(voiceKey);
  }

  extra(cardId) {
    return this.extras[cardId] || {};
  }

  hasMusic(cardId) {
    return this.musicByCard.has(cardId);
  }

  getMusicMeta(cardId) {
    return this.musicByCard.get(cardId) || null;
  }

  playableSlot(cardId, type) {
    const slot = this.inner.getVoice(cardId, type);
    return !!(slot && slot.playable);
  }

  searchCards(query, { page = 1, pageSize = 30, limit } = {}) {
    const q = normalize(query);
    if (!q) {
      return { total: 0, page: 1, pageSize, results: [] };
    }
    const innerLimit = typeof limit === 'number' ? limit : 500;
    const scored = this.inner.searchCards(q, { limit: innerLimit });
    const total = scored.length;
    const size = Math.max(1, Math.min(60, Number(pageSize) || 30));
    const p = Math.max(1, Number(page) || 1);
    const start = (p - 1) * size;
    const slice = scored.slice(start, start + size).map((row) => this.toListCard(row.cardId, row));
    return { total, page: p, pageSize: size, results: slice };
  }

  toListCard(cardId, row) {
    const rec = this.inner.cards[cardId] || {};
    const extra = this.extra(cardId);
    const play = this.inner.getVoice(cardId, 'play');
    return {
      cardId,
      name: (row && row.name) || rec.name || cardId,
      nameEn: (row && row.nameEn) || this.inner.englishNames[cardId] || null,
      type: rec.type || (row && row.type) || 'UNKNOWN',
      typeLabel: TYPE_ZH[rec.type] || rec.type || '',
      cardClass: extra.cardClass || null,
      classLabel: CLASS_ZH[extra.cardClass] || extra.cardClass || '',
      collectible: rec.collectible === true,
      imageUrl: `${ART_BASE}/${cardId}.png`,
      hasPlayVoice: !!(play && play.playable),
    };
  }

  featuredCards({ limit = 12 } = {}) {
    const seen = new Set();
    const out = [];
    for (const id of FEATURED_SEEDS) {
      if (out.length >= limit) break;
      if (!this.inner.cards[id]) continue;
      if (!this.playableSlot(id, 'play') && !this.hasMusic(id)) continue;
      seen.add(id);
      out.push(this.toListCard(id));
    }
    const rest = this.inner.list
      .filter((row) => row.collectible && !seen.has(row.cardId) && this.playableSlot(row.cardId, 'play'))
      .sort((a, b) => a.cardId.localeCompare(b.cardId));
    for (const row of rest) {
      if (out.length >= limit) break;
      out.push(this.toListCard(row.cardId));
    }
    return out;
  }

  describeSlot(cardId, type) {
    const slot = this.inner.getVoice(cardId, type);
    if (!slot) {
      return {
        type,
        available: false,
        userStatus: '暂无语音',
        playable: false,
      };
    }
    const available = slot.playable === true;
    let userStatus = '暂无语音';
    let sourceNote = null;
    if (available) {
      userStatus = '可播放';
      if (SHARED_MAPPINGS.has(slot.mappingType) && slot.voiceSourceCardId && slot.voiceSourceCardId !== cardId) {
        sourceNote = '使用原卡语音';
      }
    } else if (slot.mappingType === 'unresolved' || slot.status === 'unresolved') {
      userStatus = '暂无语音';
    } else if (slot.uiStatus === 'Voice asset not indexed') {
      userStatus = '暂时无法播放';
    }
    return {
      type,
      available,
      playable: available,
      userStatus,
      sourceNote,
      voiceKey: slot.voiceKey || null,
      voiceSourceCardId: slot.voiceSourceCardId || null,
      mappingType: slot.mappingType || null,
      status: slot.status || null,
      uiStatus: slot.uiStatus || null,
      asset: slot.asset || null,
    };
  }

  getCard(cardId) {
    const rec = this.inner.cards[cardId];
    if (!rec) return null;
    const extra = this.extra(cardId);
    const play = this.describeSlot(cardId, 'play');
    const attack = this.describeSlot(cardId, 'attack');
    const death = this.describeSlot(cardId, 'death');
    const musicMeta = this.getMusicMeta(cardId);
    const music = {
      type: 'music',
      available: !!musicMeta,
      playable: !!musicMeta,
      userStatus: musicMeta ? '可播放' : '暂无语音',
      audioClip: musicMeta ? musicMeta.audioClip : null,
      duration: musicMeta && musicMeta.duration != null ? musicMeta.duration : null,
      prefab: musicMeta ? musicMeta.prefab : null,
      guid: musicMeta ? musicMeta.guid : null,
      bundle: musicMeta ? musicMeta.bundle : null,
    };
    const entranceAvailable = play.available || music.available;
    return {
      cardId,
      name: rec.name || cardId,
      nameEn: this.inner.englishNames[cardId] || null,
      type: rec.type || 'UNKNOWN',
      typeLabel: TYPE_ZH[rec.type] || rec.type || '',
      cardClass: extra.cardClass || null,
      classLabel: CLASS_ZH[extra.cardClass] || extra.cardClass || '',
      rarity: extra.rarity || null,
      rarityLabel: RARITY_ZH[extra.rarity] || extra.rarity || '',
      cost: extra.cost != null ? extra.cost : null,
      collectible: rec.collectible === true,
      set: rec.set || extra.set || null,
      dbfId: rec.dbfId ?? null,
      imageUrl: `${ART_BASE}/${cardId}.png`,
      tracks: {
        entrance: {
          type: 'entrance',
          available: entranceAvailable,
          playable: entranceAvailable,
          userStatus: entranceAvailable ? '可播放' : '暂无完整登场音频',
        },
        play,
        attack,
        death,
        music,
      },
    };
  }

  getCardVoice(cardId, type) {
    return this.describeSlot(cardId, type);
  }
}

function extrasFromCollectible(cards) {
  const map = {};
  if (!Array.isArray(cards)) return map;
  for (const c of cards) {
    if (!c || !c.id) continue;
    map[c.id] = {
      cardClass: c.cardClass || null,
      rarity: c.rarity || null,
      cost: c.cost != null ? c.cost : null,
      set: c.set || null,
    };
  }
  return map;
}

module.exports = {
  CardRepository,
  extrasFromCollectible,
  ART_BASE,
  CLASS_ZH,
  TYPE_ZH,
  RARITY_ZH,
};
