const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HS_WIN = path.join('C:\\Hearthstone', 'Data', 'Win');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadIndexes(root = ROOT) {
  const cards = loadJson(path.join(root, 'data', 'hearthstonejson', 'zhCN', 'cards.json'));
  const unified = loadJson(path.join(root, 'data', 'index', 'card-audio-index.json'));
  const voiceIndex = loadJson(path.join(root, 'data', 'index', 'card-voice-index.json'));
  const musicAssets = loadJson(path.join(root, 'data', 'index', 'music-assets.json'));
  let cardDefSounds = { byCard: {} };
  const defPath = path.join(root, 'data', 'index', 'cache', 'carddef-sounds.json');
  if (fs.existsSync(defPath)) cardDefSounds = loadJson(defPath);
  let enNames = {};
  const enPath = path.join(root, 'data', 'explorer', 'en-names.json');
  if (fs.existsSync(enPath)) enNames = loadJson(enPath);
  return { cards, unified, voiceIndex, musicAssets, cardDefSounds, enNames };
}

function cardSummary(c, enNames) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name || c.id,
    nameEn: (enNames && enNames[c.id]) || null,
    type: c.type || null,
    class: c.cardClass || c.class || null,
    rarity: c.rarity || null,
    collectible: c.collectible === true,
    set: c.set || null,
    dbfId: c.dbfId == null ? null : c.dbfId,
  };
}

function findCardsByQuery(cards, query, enNames) {
  const q = String(query || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const out = [];
  const seen = new Set();
  for (const c of cards) {
    if (!c || !c.id || seen.has(c.id)) continue;
    const name = String(c.name || '');
    const en = (enNames && enNames[c.id]) || '';
    if (
      c.id === q
      || name.includes(q)
      || String(c.id).toLowerCase().includes(lower)
      || String(en).toLowerCase().includes(lower)
    ) {
      seen.add(c.id);
      out.push(cardSummary(c, enNames));
    }
  }
  return out;
}

function slotView(slot) {
  if (!slot) return { status: null, voiceKey: null, sourceCardId: null, reason: null };
  return {
    status: slot.status || null,
    voiceKey: slot.voiceKey || null,
    sourceCardId: slot.sourceCardId || null,
    reason: slot.reason || null,
    mappingType: slot.mappingType || null,
  };
}

function currentIndexLayer(unified, cardId) {
  const rec = unified.cards && unified.cards[cardId];
  if (!rec) return { missing: true, cardId };
  return {
    cardId,
    name: rec.name,
    type: rec.type,
    rarity: rec.rarity,
    collectible: rec.collectible,
    set: rec.set,
    dbfId: rec.dbfId,
    voice: {
      play: slotView(rec.voice && rec.voice.play),
      attack: slotView(rec.voice && rec.voice.attack),
      death: slotView(rec.voice && rec.voice.death),
    },
    music: rec.music || null,
    entrancePreview: rec.entrancePreview || null,
  };
}

function cachedCardDefLayer(cardDefSounds, cardId) {
  const by = (cardDefSounds && (cardDefSounds.byCard || cardDefSounds.cards)) || {};
  return by[cardId] || null;
}

function sameNameVariants(cards, target, enNames) {
  if (!target) return [];
  const name = String(target.name || '');
  const en = (enNames && enNames[target.id]) || '';
  return cards
    .filter((c) => c && c.id && c.id !== target.id && (
      (name && c.name === name)
      || (en && enNames && enNames[c.id] === en)
    ))
    .map((c) => cardSummary(c, enNames));
}

function prefixCandidates(cards, cardId, enNames) {
  const prefixes = ['CORE_', 'VAN_', 'LEG_', 'WON_', 'TUTR_'];
  const out = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id) || id === cardId) return;
    seen.add(id);
    const c = cards.find((x) => x && x.id === id);
    if (c) out.push(cardSummary(c, enNames));
  };
  for (const p of prefixes) {
    if (cardId.startsWith(p)) add(cardId.slice(p.length));
    else add(p + cardId);
  }
  return out;
}

function playable(slot) {
  return !!(slot && (slot.status === 'available' || slot.status === 'shared') && slot.voiceKey);
}

function concludeFromLayers({ card, index, cardDef, soundReferences, audioReferences }) {
  const play = index && index.voice && index.voice.play;
  const attack = index && index.voice && index.voice.attack;
  const death = index && index.voice && index.voice.death;
  const music = index && index.music;
  const defPlay = !!(cardDef && cardDef.play);
  const extraVoicePrefabs = (soundReferences || []).filter((p) => {
    const n = String(p.prefabName || p.name || '').toLowerCase();
    return n && n !== 'play' && n !== 'attack' && n !== 'death' && (
      /play|enterplay|vo_|voice|emote|start|greet/i.test(n)
    );
  });
  const heroEmotes = (soundReferences || []).filter((p) => /^Emote_/i.test(String(p.prefabName || p.name || '')));
  const hasClip = (audioReferences || []).some((a) => a && a.audioClipName);

  if (playable(play)) {
    return {
      conclusion: 'unified_index_has_play_voice',
      recommendedFix: 'none',
      leakLayer: null,
    };
  }

  if (!defPlay && (card && card.type === 'HERO')) {
    return {
      conclusion: 'game_client_has_no_minion_play_voice_hero_emote_system',
      recommendedFix: 'do_not_fabricate_voice',
      leakLayer: null,
      note: 'CardDef has no Play.prefab and no MusicStinger. Attack/Death exist. Hero emotes (Start/Greetings/Picked/etc.) are a different audio system and must not be mapped as minion Play voice. Do not rebuild the voice index for this card.',
      heroEmoteCount: heroEmotes.length,
    };
  }

  if (!defPlay && extraVoicePrefabs.length === 0 && !hasClip) {
    const heroNote = card && card.type === 'HERO'
      ? ' Hero cards typically have Attack/Death and emotes, not minion Play/Music Stinger.'
      : '';
    return {
      conclusion: 'game_client_has_no_play_voice'
        + (playable(attack) || playable(death) ? '_but_has_other_slots' : '')
        + (music && (music.status === 'available' || music.status === 'shared') ? '_has_music' : '_no_music'),
      recommendedFix: 'do_not_fabricate_voice',
      leakLayer: null,
      note: 'CardDef Play SoundSpell is absent. Checked CardDef MonoBehaviours, prefab GUIDs, and indexed AudioClips.' + heroNote,
    };
  }

  if (defPlay && !playable(play)) {
    return {
      conclusion: 'parser_or_index_leak',
      recommendedFix: 'extend_generic_parser_then_rebuild_needed_index',
      leakLayer: 'Index',
    };
  }

  if (extraVoicePrefabs.length && !playable(play)) {
    return {
      conclusion: 'special_prefab_chain_not_mapped_as_play',
      recommendedFix: 'document_only_unless_field_is_generic_Play_SoundSpell',
      leakLayer: 'Prefab',
    };
  }

  return {
    conclusion: 'no_play_voice_after_resource_walk',
    recommendedFix: 'do_not_fabricate_voice',
    leakLayer: null,
  };
}

function buildIndexInvestigation(cardId, indexes) {
  const { cards, unified, voiceIndex, musicAssets, cardDefSounds, enNames } = indexes;
  const raw = cards.find((c) => c && c.id === cardId) || null;
  const card = cardSummary(raw, enNames);
  const index = currentIndexLayer(unified, cardId);
  const cardDef = cachedCardDefLayer(cardDefSounds, cardId);
  const variants = raw ? sameNameVariants(cards, raw, enNames) : [];
  const prefix = prefixCandidates(cards, cardId, enNames);
  const voiceRec = voiceIndex.cards && voiceIndex.cards[cardId];
  const musicBag = (musicAssets && musicAssets.assets) || musicAssets || {};
  const musicAsset = index.music && index.music.musicAssetId ? musicBag[index.music.musicAssetId] : null;
  return {
    card,
    index,
    cardDefCache: cardDef,
    variants,
    prefixCandidates: prefix,
    voiceIndexEvidence: voiceRec ? voiceRec.evidence : null,
    musicAsset: musicAsset || null,
    timing: {
      voice: { delaySec: 0, volume: 1, loop: false },
      music: musicAsset
        ? {
          delaySec: musicAsset.delaySec,
          volume: musicAsset.volume,
          loop: !!musicAsset.loop,
        }
        : { delaySec: 0, volume: 1, loop: false },
      timingVerified: !!(musicAsset && musicAsset.timingVerified),
    },
  };
}

function parseArgv(argv) {
  const args = argv.slice(2);
  let cardId = null;
  let query = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cardId' && args[i + 1]) {
      cardId = args[++i];
    } else if (args[i] === '--query' && args[i + 1]) {
      query = args[++i];
    } else if (!args[i].startsWith('-') && !cardId) {
      cardId = args[i];
    }
  }
  return { cardId, query };
}

function printInvestigation(report) {
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  ROOT,
  HS_WIN,
  loadIndexes,
  findCardsByQuery,
  cardSummary,
  currentIndexLayer,
  cachedCardDefLayer,
  sameNameVariants,
  prefixCandidates,
  concludeFromLayers,
  buildIndexInvestigation,
  parseArgv,
  printInvestigation,
  playable,
};
