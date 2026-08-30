const path = require('path');
const { adaptCard, voicePlayable, musicPlayable } = require('./catalogAdapter.js');

function musicAssetBag(musicAssets) {
  if (!musicAssets) return {};
  if (musicAssets.assets && typeof musicAssets.assets === 'object') return musicAssets.assets;
  return musicAssets;
}

class UnifiedAudioRepo {
  constructor(unified, audioIndex, musicAssets) {
    this.cards = (unified && unified.cards) || {};
    this.clips = (audioIndex && audioIndex.clips) || {};
    this.musicAssets = musicAssetBag(musicAssets);
    this.clipBundles = Object.create(null);
    for (const asset of Object.values(this.musicAssets)) {
      if (!asset || !asset.audioClipName || !asset.bundle) continue;
      const clip = asset.audioClipName;
      if (!this.clipBundles[clip]) this.clipBundles[clip] = path.basename(asset.bundle);
    }
  }

  reload(unified, audioIndex, musicAssets) {
    this.cards = (unified && unified.cards) || {};
    this.clips = (audioIndex && audioIndex.clips) || {};
    this.musicAssets = musicAssetBag(musicAssets);
    this.clipBundles = Object.create(null);
    for (const asset of Object.values(this.musicAssets)) {
      if (!asset || !asset.audioClipName || !asset.bundle) continue;
      const clip = asset.audioClipName;
      if (!this.clipBundles[clip]) this.clipBundles[clip] = path.basename(asset.bundle);
    }
  }

  getCard(cardId) {
    const raw = this.cards[cardId];
    if (!raw) return null;
    const card = adaptCard(raw);
    return {
      ...card,
      tracks: {
        play: { available: !!(card.voice.play && card.voice.play.available) },
        music: { available: !!(card.music && card.music.available) },
      },
    };
  }

  getCardVoice(cardId, type) {
    const raw = this.cards[cardId];
    const slot = raw && raw.voice && raw.voice[type];
    const available = voicePlayable(slot);
    return {
      playable: available,
      voiceKey: available ? slot.voiceKey : null,
      uiStatus: available ? '可播放' : '暂无语音',
    };
  }

  getMusicMeta(cardId) {
    const raw = this.cards[cardId];
    if (!musicPlayable(raw && raw.music)) return null;
    const guid = raw.music.musicAssetId || null;
    const asset = guid ? this.musicAssets[guid] : null;
    const audioClip = raw.music.audioClipName || (asset && asset.audioClipName) || null;
    const bundle = (asset && asset.bundle)
      || (audioClip && this.clipBundles[audioClip])
      || null;
    return {
      audioClip,
      bundle: bundle ? path.basename(bundle) : null,
      prefabGuid: guid,
    };
  }

  getVoiceAsset(voiceKey) {
    if (!voiceKey) return { indexed: false, voiceKey: null, zhcnBundles: [], prefabBundles: [] };
    const rec = this.clips[voiceKey];
    const zhcnBundles = rec && rec.zhcnBundles ? rec.zhcnBundles.slice() : [];
    const prefabBundles = rec && rec.prefabBundles ? rec.prefabBundles.slice() : [];
    const musicBundle = this.clipBundles[voiceKey];
    if (musicBundle && prefabBundles[0] !== musicBundle) prefabBundles.unshift(musicBundle);
    const looksMusic = /stinger/i.test(voiceKey) && !/^VO_/i.test(voiceKey);
    return {
      indexed: zhcnBundles.length > 0 || prefabBundles.length > 0 || looksMusic,
      voiceKey,
      zhcnBundles,
      prefabBundles,
    };
  }
}

module.exports = { UnifiedAudioRepo };
