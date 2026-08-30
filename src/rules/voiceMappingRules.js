function isCardIdShape(s) {
  return /^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)*_\d+[A-Za-z0-9]*$/.test(s);
}

/**
 * Collect CardIDs that actually appear inside an AudioClip / VO key.
 * Walks underscore segments (O(parts), not O(known size)) and keeps known
 * IDs or CardID-shaped tokens (e.g. CAP_106t even if missing from cards.json).
 * Does not strip VAN_/CORE_ from the *current* CardID.
 */
function cardIdsInVoiceKey(key, knownCardIds) {
  if (!key) return [];
  const known = knownCardIds instanceof Set ? knownCardIds : new Set(knownCardIds || []);
  const raw = String(key).replace(/^(VO_|SFX_)/, '');
  const parts = raw.split('_');
  const hits = [];
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    acc = i === 0 ? parts[0] : acc + '_' + parts[i];
    if (known.has(acc) || isCardIdShape(acc)) hits.push(acc);
  }
  const knownHits = hits.filter((id) => known.has(id));
  const pool = knownHits.length ? knownHits : hits.filter(isCardIdShape);
  return pool.filter((id) => !pool.some((other) => other !== id && other.includes(id) && other.length > id.length));
}

function pickVoiceKey(cardId, slot, keys) {
  if (!keys || !keys.length) return null;
  const slotRe = {
    play: /Play|EnterPlay/i,
    attack: /Attack/i,
    death: /Death/i,
  }[slot] || /Play/i;
  const vo = keys.filter((k) => /^VO_/i.test(k));
  const pool = vo.length ? vo : keys;
  const withId = pool.filter((k) => k.includes(cardId));
  const fromId = withId.find((k) => slotRe.test(k));
  if (fromId) return fromId;
  if (withId.length) return withId[0];
  const slotOnly = pool.find((k) => slotRe.test(k));
  return slotOnly || pool[0];
}

function allSlotKeys(slots) {
  return ['play', 'attack', 'death'].map((s) => slots?.[s]?.voiceKey).filter(Boolean);
}

function guidTriple(slots) {
  return {
    play: slots?.play?.prefabGuid || null,
    attack: slots?.attack?.prefabGuid || null,
    death: slots?.death?.prefabGuid || null,
  };
}

function sameGuidTriple(a, b) {
  if (!a || !b) return false;
  if (!a.play || !a.attack || !a.death) return false;
  return a.play === b.play && a.attack === b.attack && a.death === b.death;
}

/**
 * Per-slot classification for the full Card Voice Index.
 * shared_resource requires the clip name to name another GUID owner —
 * sharing a GUID with a token while the clip is a flavor SFX is named_sfx.
 */
function classifySlot({
  cardId,
  voiceKey,
  prefabGuid,
  guidOwners,
  cardDefIds,
  knownCardIds,
}) {
  if (!prefabGuid) {
    return {
      status: 'no_voice',
      mappingType: 'no_voice',
      voiceKey: null,
      voiceSourceCardId: null,
      reason: null,
    };
  }
  if (!voiceKey) {
    return {
      status: 'unresolved',
      mappingType: 'unresolved',
      voiceKey: null,
      voiceSourceCardId: null,
      reason: 'guid_not_resolved_to_clip',
    };
  }

  const ids = cardIdsInVoiceKey(voiceKey, knownCardIds);
  const ownerSet = guidOwners instanceof Map ? guidOwners.get(prefabGuid) : guidOwners?.[prefabGuid];
  const owners = ownerSet ? [...ownerSet] : [];
  const otherOwners = owners.filter((id) => id !== cardId);
  const ownInKey = voiceKey.includes(cardId) || ids.includes(cardId);

  if (ownInKey) {
    return {
      status: 'matched',
      mappingType: 'direct',
      voiceKey,
      voiceSourceCardId: cardId,
      reason: null,
    };
  }

  const sourceFromGuid = ids.find((id) => otherOwners.includes(id));
  if (sourceFromGuid) {
    return {
      status: 'matched',
      mappingType: 'shared_resource',
      voiceKey,
      voiceSourceCardId: sourceFromGuid,
      reason: null,
    };
  }

  if (ids.length && ids[0] !== cardId) {
    const source = ids[0];
    const hasDef = cardDefIds instanceof Set ? cardDefIds.has(source) : !!(cardDefIds && cardDefIds[source]);
    return {
      status: 'matched',
      mappingType: hasDef ? 'shared_audio' : 'token_clip',
      voiceKey,
      voiceSourceCardId: source,
      reason: null,
    };
  }

  return {
    status: 'matched',
    mappingType: 'named_sfx',
    voiceKey,
    voiceSourceCardId: cardId,
    reason: null,
  };
}

/**
 * Classify CardID → VoiceSource using resource relationships only:
 *  - AudioClip / VO key strings (from SoundSpell prefabs)
 *  - Play/Attack/Death prefab GUIDs on CardDef
 *  - Other cards' CardDef GUID triples (shared_resource)
 *
 * Does not strip CORE_/VAN_/LEG_ prefixes from CardID.
 * mappingType `own_clip` is kept for Phase 0.7 tests; the index layer maps it to `direct`.
 */
function classifyVoiceMapping({
  cardId,
  slots,
  cardDefGuidsById,
  knownCardIds,
}) {
  const keys = allSlotKeys(slots);
  const ownGuids = guidTriple(slots);
  const known = knownCardIds instanceof Set ? knownCardIds : new Set(knownCardIds || []);
  const idsInKeys = [...new Set(keys.flatMap((k) => cardIdsInVoiceKey(k, known)))];
  const foreignIds = idsInKeys.filter((id) => id !== cardId);
  const ownIdInEveryKey = keys.length > 0 && keys.every((k) => k.includes(cardId));
  const ownIdInAnyKey = keys.some((k) => k.includes(cardId));

  const sharedWith = [];
  if (cardDefGuidsById && ownGuids.play) {
    for (const [id, g] of Object.entries(cardDefGuidsById)) {
      if (id === cardId) continue;
      if (sameGuidTriple(ownGuids, g)) sharedWith.push(id);
    }
  }

  const evidence = {
    playPrefabGuid: ownGuids.play,
    attackPrefabGuid: ownGuids.attack,
    deathPrefabGuid: ownGuids.death,
    idsInVoiceKeys: idsInKeys,
    sharedGuidCardIds: sharedWith,
  };

  if (!ownGuids.play && !ownGuids.attack && !ownGuids.death && keys.length === 0) {
    return {
      cardId,
      status: 'unresolved',
      mappingType: 'no_soundspell',
      voiceSourceCardId: null,
      confidence: 'verified',
      evidence,
    };
  }

  if (ownIdInEveryKey && sharedWith.length === 0) {
    return {
      cardId,
      status: 'direct',
      mappingType: 'own_clip',
      voiceSourceCardId: cardId,
      confidence: 'verified',
      evidence,
    };
  }

  // Shared Play/Attack/Death prefab GUIDs with another CardDef, and the clip
  // names the other card. Do not treat flavor-SFX + token GUID overlap as reprint.
  if (sharedWith.length) {
    const source = foreignIds.find((id) => sharedWith.includes(id))
      || sharedWith.find((id) => idsInKeys.includes(id));
    if (source) {
      return {
        cardId,
        status: 'indirect_verified',
        mappingType: 'shared_resource',
        voiceSourceCardId: source,
        confidence: 'verified',
        evidence,
      };
    }
  }

  if (ownIdInAnyKey) {
    return {
      cardId,
      status: 'direct',
      mappingType: 'own_clip',
      voiceSourceCardId: cardId,
      confidence: 'verified',
      evidence,
    };
  }

  // Different SoundSpell GUIDs, but clip names contain another live/known CardID.
  if (foreignIds.length) {
    const source = foreignIds[0];
    const sourceHasCardDef = !!(cardDefGuidsById && cardDefGuidsById[source]);
    return {
      cardId,
      status: 'indirect_verified',
      mappingType: sourceHasCardDef ? 'shared_audio' : 'token_clip',
      voiceSourceCardId: source,
      confidence: 'verified',
      evidence,
    };
  }

  // Dedicated clips whose names do not contain this CardID (flavor / SFX names).
  if (keys.length && !ownIdInAnyKey) {
    return {
      cardId,
      status: 'indirect_verified',
      mappingType: 'named_sfx',
      voiceSourceCardId: cardId,
      confidence: 'verified',
      evidence,
    };
  }

  return {
    cardId,
    status: 'unresolved',
    mappingType: 'unknown',
    voiceSourceCardId: null,
    confidence: 'unresolved',
    evidence,
  };
}

module.exports = {
  isCardIdShape,
  cardIdsInVoiceKey,
  classifyVoiceMapping,
  classifySlot,
  pickVoiceKey,
  sameGuidTriple,
  guidTriple,
};
