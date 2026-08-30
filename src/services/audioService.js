const fs = require('fs');
const path = require('path');
const { inspectWav } = require('../explorer/wavPcm16.js');
const {
  resolveAudioSourceMode,
  isProductionAudioSource,
  audioNotAvailableError,
} = require('./audioSourceMode.js');

const GRACEFUL_AUDIO_CODES = {
  NO_VOICE: true,
  NO_MUSIC: true,
  UNAVAILABLE: true,
  NOT_INDEXED: true,
  EXTRACT_FAILED: true,
  AUDIO_NOT_AVAILABLE: true,
};

function userError(code) {
  if (code === 'NO_VOICE' || code === 'NO_MUSIC' || code === 'UNAVAILABLE') return '暂无可用音频';
  if (code === 'NOT_INDEXED' || code === 'AUDIO_NOT_AVAILABLE') return '暂时无法播放';
  return '暂时无法播放';
}

function audioErrorHttpStatus(code) {
  return GRACEFUL_AUDIO_CODES[code] ? 404 : 500;
}

function audioErrorBody(e) {
  return {
    error: (e && e.userMessage) || '暂时无法播放',
    code: (e && e.code) || 'EXTRACT_FAILED',
  };
}

class AudioService {
  constructor({ repo, extractor, cache, musicAliases, sourceMode }) {
    this.repo = repo;
    this.extractor = extractor;
    this.cache = cache;
    this.musicAliases = musicAliases || {};
    this.sourceMode = resolveAudioSourceMode(sourceMode);
  }

  cachedVoiceResult(voiceKey, t0) {
    const p = this.cache.path('voice', voiceKey);
    return {
      path: p,
      cached: true,
      ms: Date.now() - t0,
      wav: inspectWav(this.cache.read('voice', voiceKey)),
      voiceKey,
    };
  }

  async getVoiceAudio(cardId, type, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const slot = this.repo.getCardVoice(cardId, type);
    if (!slot || !slot.voiceKey) {
      const err = new Error('暂无可用音频');
      err.code = 'NO_VOICE';
      err.userMessage = '暂无可用音频';
      throw err;
    }
    if (!slot.playable) {
      const err = new Error('暂时无法播放');
      err.code = slot.uiStatus === 'Voice asset not indexed' ? 'NOT_INDEXED' : 'NO_VOICE';
      err.userMessage = userError(err.code);
      throw err;
    }
    if (this.cache.has('voice', slot.voiceKey)) {
      return this.cachedVoiceResult(slot.voiceKey, t0);
    }
    if (isProductionAudioSource(this.sourceMode)) {
      throw audioNotAvailableError();
    }
    try {
      const out = await this.extractor.extractVoice(slot.voiceKey, {
        debug: !!opts.debug,
        cardId,
      });
      return {
        path: out.path,
        cached: !!out.cached,
        ms: Date.now() - t0,
        wav: out.wav || inspectWav(fs.readFileSync(out.path)),
        voiceKey: slot.voiceKey,
      };
    } catch (e) {
      if (e && e.code === 'AUDIO_NOT_AVAILABLE') {
        e.userMessage = e.userMessage || userError('AUDIO_NOT_AVAILABLE');
        throw e;
      }
      const err = new Error(userError(e.code));
      err.code = e.code || 'EXTRACT_FAILED';
      err.userMessage = userError(e.code);
      err.causeMessage = e.message;
      throw err;
    }
  }

  musicCacheKeys(cardId) {
    const meta = this.repo.getMusicMeta(cardId);
    const keys = [];
    if (this.musicAliases[cardId]) keys.push(this.musicAliases[cardId]);
    keys.push(cardId + '_MusicStinger');
    if (meta && meta.audioClip) keys.push(meta.audioClip);
    return [...new Set(keys)];
  }

  finishMusic(cardId, meta, out, t0, cached) {
    const destKey = cardId + '_MusicStinger';
    if (path.resolve(out.path) !== path.resolve(this.cache.path('music', destKey))) {
      this.cache.write('music', destKey, fs.readFileSync(out.path));
    }
    return {
      path: this.cache.path('music', destKey),
      cached: cached != null ? cached : !!out.cached,
      ms: Date.now() - t0,
      wav: out.wav || inspectWav(fs.readFileSync(this.cache.path('music', destKey))),
      audioClip: (meta && meta.audioClip) || out.clipName || null,
    };
  }

  wrapAudioError(e, fallbackCode) {
    const code = (e && e.code) || fallbackCode || 'EXTRACT_FAILED';
    const err = new Error(userError(code));
    err.code = code;
    err.userMessage = userError(code);
    err.causeMessage = e && e.message;
    return err;
  }

  async getMusicAudio(cardId, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const meta = this.repo.getMusicMeta(cardId);
    if (!meta || (!meta.audioClip && !meta.bundle)) {
      const err = new Error('暂无可用音频');
      err.code = 'NO_MUSIC';
      err.userMessage = '暂无可用音频';
      throw err;
    }
    for (const key of this.musicCacheKeys(cardId)) {
      if (this.cache.has('music', key)) {
        const p = this.cache.path('music', key);
        return {
          path: p,
          cached: true,
          ms: Date.now() - t0,
          wav: inspectWav(this.cache.read('music', key)),
          audioClip: meta.audioClip,
        };
      }
    }
    if (isProductionAudioSource(this.sourceMode)) {
      throw audioNotAvailableError();
    }
    let lastErr = null;
    if (meta.audioClip) {
      try {
        const out = await this.extractor.extractVoice(meta.audioClip, {
          debug: !!opts.debug,
          cardId,
          prefabGuid: meta.prefabGuid || null,
          prefabBundle: meta.bundle || null,
        });
        return this.finishMusic(cardId, meta, out, t0, !!out.cached);
      } catch (e) {
        lastErr = e;
      }
    }
    if (meta.bundle && typeof this.extractor.extractFirstMusicClipInBundle === 'function') {
      try {
        const out = await this.extractor.extractFirstMusicClipInBundle(
          meta.bundle,
          cardId + '_MusicStinger',
          meta.prefabGuid,
        );
        return this.finishMusic(cardId, meta, out, t0, !!out.cached);
      } catch (e) {
        lastErr = e;
      }
    }
    throw this.wrapAudioError(lastErr, lastErr ? lastErr.code : 'NO_MUSIC');
  }
}

module.exports = { AudioService, userError, audioErrorHttpStatus, audioErrorBody };
