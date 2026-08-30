'use strict';

const fs = require('fs');
const path = require('path');

function addVoice(index, cardId, type) {
  const id = String(cardId || '');
  const kind = String(type || '');
  if (!id || !kind) return;
  if (!index[id]) index[id] = Object.create(null);
  index[id][kind] = true;
}

function addId(index, cardId) {
  const id = String(cardId || '');
  if (!id) return;
  index[id] = true;
}

function createProductionAudioInventory(manifest) {
  const voice = Object.create(null);
  const music = Object.create(null);
  const entrance = Object.create(null);
  const rows = (manifest && typeof manifest === 'object') ? manifest : {};

  (rows.voice || []).forEach(function (row) {
    if (!row) return;
    const types = Array.isArray(row.types) ? row.types : [];
    const ids = Array.isArray(row.cardIds) ? row.cardIds : [];
    ids.forEach(function (id) {
      types.forEach(function (type) {
        addVoice(voice, id, type);
      });
    });
  });

  (rows.music || []).forEach(function (row) {
    if (!row) return;
    if (row.cardId) addId(music, row.cardId);
    (row.cardIds || []).forEach(function (id) {
      addId(music, id);
    });
  });

  (rows.entrance || []).forEach(function (row) {
    if (!row) return;
    if (row.cardId) addId(entrance, row.cardId);
    (row.cardIds || []).forEach(function (id) {
      addId(entrance, id);
    });
  });

  return {
    hasVoice: function hasVoice(cardId, type) {
      const rec = voice[String(cardId || '')];
      return !!(rec && rec[String(type || '')]);
    },
    hasMusic: function hasMusic(cardId) {
      return !!music[String(cardId || '')];
    },
    hasEntrance: function hasEntrance(cardId) {
      return !!entrance[String(cardId || '')];
    },
  };
}

function loadProductionAudioInventory(packageDir) {
  if (!packageDir) return null;
  const manifestPath = path.join(packageDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return createProductionAudioInventory(manifest);
}

function overlayVoiceSlot(slot, present) {
  if (!slot) return slot;
  if (!slot.available || present) return slot;
  return Object.assign({}, slot, { available: false });
}

function overlayMusic(music, present) {
  if (!music) return music;
  if (!music.available || present) return music;
  return Object.assign({}, music, { available: false });
}

function applyProductionToAdaptedCard(card, inventory) {
  if (!card || !inventory) return card;
  const id = card.id;
  const voice = card.voice || {};
  return Object.assign({}, card, {
    voice: {
      play: overlayVoiceSlot(voice.play, inventory.hasVoice(id, 'play')),
      attack: overlayVoiceSlot(voice.attack, inventory.hasVoice(id, 'attack')),
      death: overlayVoiceSlot(voice.death, inventory.hasVoice(id, 'death')),
    },
    music: overlayMusic(card.music, inventory.hasMusic(id)),
    entrancePreview: {
      available: !!(card.entrancePreview && card.entrancePreview.available && inventory.hasEntrance(id)),
    },
  });
}

function applyProductionToCatalog(catalog, inventory) {
  if (!catalog || !inventory) return catalog;
  const cards = (catalog.cards || []).map(function (card) {
    return applyProductionToAdaptedCard(card, inventory);
  });
  const byId = Object.create(null);
  const src = catalog.byId || {};
  Object.keys(src).forEach(function (id) {
    byId[id] = applyProductionToAdaptedCard(src[id], inventory);
  });
  return Object.assign({}, catalog, { cards: cards, byId: byId });
}

function applyProductionToPublicDetail(detail, inventory) {
  if (!detail || !inventory) return detail;
  const id = detail.id;
  const next = Object.assign({}, detail);
  const voice = detail.voice || {};
  next.voice = {
    play: overlayPublicSlot(voice.play, inventory.hasVoice(id, 'play')),
    attack: overlayPublicSlot(voice.attack, inventory.hasVoice(id, 'attack')),
    death: overlayPublicSlot(voice.death, inventory.hasVoice(id, 'death')),
  };
  next.music = overlayPublicMusic(detail.music, inventory.hasMusic(id));
  const entranceOn = !!(detail.entrancePreview && detail.entrancePreview.available && inventory.hasEntrance(id));
  next.entrancePreview = Object.assign({}, detail.entrancePreview || {}, { available: entranceOn });
  const audio = Object.assign({}, detail.audio || {});
  if (!audio.special) {
    const playOn = !!(next.voice.play && next.voice.play.available);
    const attackOn = !!(next.voice.attack && next.voice.attack.available);
    const deathOn = !!(next.voice.death && next.voice.death.available);
    const musicOn = !!(next.music && next.music.available);
    if (playOn && attackOn && deathOn && musicOn && entranceOn) audio.cardAudioStatus = 'full';
    else if (playOn || attackOn || deathOn || musicOn || entranceOn) audio.cardAudioStatus = 'partial';
    else audio.cardAudioStatus = 'none';
  }
  next.audio = audio;
  return next;
}

function overlayPublicSlot(slot, present) {
  if (!slot) return slot;
  if (!slot.available || present) return slot;
  return Object.assign({}, slot, {
    available: false,
    disabled: true,
    status: 'unavailable',
    emptyLabel: slot.emptyLabel || '暂时无法播放',
  });
}

function overlayPublicMusic(music, present) {
  if (!music) return music;
  if (!music.available || present) return music;
  return Object.assign({}, music, {
    available: false,
    disabled: true,
    status: 'unavailable',
    emptyLabel: music.emptyLabel || '暂时无法播放',
  });
}

module.exports = {
  createProductionAudioInventory,
  loadProductionAudioInventory,
  applyProductionToAdaptedCard,
  applyProductionToCatalog,
  applyProductionToPublicDetail,
};
