const fs = require('fs');
const { mixPcm16 } = require('../music/mixPcm16.js');
const { ENTRANCE_MIX, ENTRANCE_MIX_VERSION, MAX_MUSIC_START_COMPENSATION_MS } = require('../music/entranceMixConfig.js');
const { applyMusicStartCompensation } = require('../music/findMusicStartCompensation.js');
const { inspectWav } = require('../explorer/wavPcm16.js');
const { userError } = require('./audioService.js');
const { resolveAudioSourceMode, isProductionAudioSource, audioNotAvailableError } = require('./audioSourceMode.js');

class EntrancePreviewService {
  constructor({ repo, audioService, cache, sourceMode }) {
    this.repo = repo;
    this.audioService = audioService;
    this.cache = cache;
    this.sourceMode = resolveAudioSourceMode(sourceMode);
  }

  previewCacheKey(cardId) {
    return cardId + '_entrance_v' + ENTRANCE_MIX_VERSION;
  }

  async getEntrancePreview(cardId) {
    const t0 = Date.now();
    const cacheKey = this.previewCacheKey(cardId);
    if (this.cache.has('preview', cacheKey)) {
      const buf = this.cache.read('preview', cacheKey);
      return {
        path: this.cache.path('preview', cacheKey),
        cached: true,
        ms: Date.now() - t0,
        wav: inspectWav(buf),
        source: 'cache',
      };
    }
    if (isProductionAudioSource(this.sourceMode)) {
      throw audioNotAvailableError();
    }

    const card = this.repo.getCard(cardId);
    if (!card) {
      const err = new Error('暂无可用音频');
      err.code = 'UNAVAILABLE';
      err.userMessage = '暂无可用音频';
      throw err;
    }

    let voice = null;
    let music = null;
    if (card.tracks.play.available) {
      try { voice = await this.audioService.getVoiceAudio(cardId, 'play'); } catch { voice = null; }
    }
    if (card.tracks.music.available) {
      try { music = await this.audioService.getMusicAudio(cardId); } catch { music = null; }
    }

    if (voice && music) {
      const musicBuf = fs.readFileSync(music.path);
      const voiceBuf = fs.readFileSync(voice.path);
      let mixMusic = musicBuf;
      let compensation = {
        compensationMs: 0,
        fallback: true,
        reason: 'skipped',
        sampleRate: 0,
        channels: 0,
      };
      try {
        compensation = applyMusicStartCompensation(musicBuf);
        mixMusic = compensation.wav || musicBuf;
      } catch (e) {
        mixMusic = musicBuf;
        compensation = {
          compensationMs: 0,
          fallback: true,
          reason: (e && e.message) || 'compensation-threw',
          sampleRate: 0,
          channels: 0,
        };
      }
      const mixed = mixPcm16(mixMusic, voiceBuf, ENTRANCE_MIX);
      const dest = this.cache.write('preview', cacheKey, mixed.wav);
      return {
        path: dest,
        cached: false,
        ms: Date.now() - t0,
        wav: inspectWav(mixed.wav),
        source: 'mix',
        musicStartCompensation: {
          stage: 'entrance-music-start-compensation',
          compensationMs: compensation.compensationMs || 0,
          maxCompensationMs: MAX_MUSIC_START_COMPENSATION_MS,
          sampleRate: compensation.sampleRate || 0,
          channels: compensation.channels || 0,
          fallback: !!compensation.fallback,
          reason: compensation.reason || '',
        },
      };
    }
    if (voice) {
      return {
        path: voice.path,
        cached: voice.cached,
        ms: Date.now() - t0,
        wav: voice.wav,
        source: 'play',
      };
    }
    if (music) {
      return {
        path: music.path,
        cached: music.cached,
        ms: Date.now() - t0,
        wav: music.wav,
        source: 'music',
      };
    }
    const err = new Error('暂无完整登场音频');
    err.code = 'UNAVAILABLE';
    err.userMessage = '暂无完整登场音频';
    throw err;
  }
}

module.exports = { EntrancePreviewService, userError };
