const SPECIAL_TYPES = {
  HERO: true,
  HERO_POWER: true,
  ENCHANTMENT: true,
  LOCATION: true,
};

function isSpecialAudioType(type) {
  return !!SPECIAL_TYPES[String(type || '').toUpperCase()];
}

function clipIndexed(clips, voiceKey) {
  if (!voiceKey || !clips) return false;
  const rec = clips[voiceKey];
  if (!rec) return false;
  const zh = rec.zhcnBundles && rec.zhcnBundles.length;
  const pb = rec.prefabBundles && rec.prefabBundles.length;
  return !!(zh || pb);
}

function voiceSlotStatus(slot, clips) {
  const hasKey = !!(slot && (slot.status === 'available' || slot.status === 'shared') && slot.voiceKey);
  if (!hasKey) {
    return { status: 'unavailable', reason: 'index_missing' };
  }
  if (clips && !clipIndexed(clips, slot.voiceKey)) {
    return { status: 'extraction_failed', reason: 'clip_not_indexed' };
  }
  return { status: 'available', reason: null };
}

function musicSlotStatus(music) {
  const on = !!(
    music
    && (music.status === 'available' || music.status === 'shared')
    && (music.audioClipName || music.musicAssetId)
  );
  if (!on) return { status: 'unavailable', reason: 'index_missing' };
  return { status: 'available', reason: null };
}

function rollupCardAudioStatus(type, play, attack, death, music) {
  const special = isSpecialAudioType(type) && play.status !== 'available';
  if (special) return 'special_audio_system';
  const slots = [play, attack, death, music];
  const nAvail = slots.filter((s) => s.status === 'available').length;
  if (nAvail === 0) return 'none';
  if (play.status === 'available' && attack.status === 'available' && death.status === 'available' && music.status === 'available') {
    return 'full';
  }
  return 'partial';
}

function getCardAudioAvailability(raw, clips) {
  const play = voiceSlotStatus(raw && raw.voice && raw.voice.play, clips);
  const attack = voiceSlotStatus(raw && raw.voice && raw.voice.attack, clips);
  const death = voiceSlotStatus(raw && raw.voice && raw.voice.death, clips);
  const music = musicSlotStatus(raw && raw.music);
  const type = raw && raw.type;
  const cardAudioStatus = rollupCardAudioStatus(type, play, attack, death, music);
  return {
    cardId: raw && raw.id,
    play,
    attack,
    death,
    music,
    cardAudioStatus,
    special: cardAudioStatus === 'special_audio_system',
  };
}

function slotUi(status) {
  if (status === 'available') {
    return { available: true, disabled: false, emptyLabel: null };
  }
  if (status === 'extraction_failed') {
    return { available: false, disabled: true, emptyLabel: '暂时无法播放' };
  }
  return { available: false, disabled: true, emptyLabel: '无登场语音' };
}

module.exports = {
  SPECIAL_TYPES,
  isSpecialAudioType,
  getCardAudioAvailability,
  voiceSlotStatus,
  musicSlotStatus,
  rollupCardAudioStatus,
  slotUi,
};
