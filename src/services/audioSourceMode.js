const path = require('path');

const AUDIO_SOURCE_DEVELOPMENT = 'development';
const AUDIO_SOURCE_PRODUCTION = 'production';
const ALLOWED_AUDIO_SOURCES = [AUDIO_SOURCE_DEVELOPMENT, AUDIO_SOURCE_PRODUCTION];

function resolveAudioSourceMode(raw) {
  const value = raw == null ? '' : String(raw).trim();
  if (!value) return AUDIO_SOURCE_DEVELOPMENT;
  if (ALLOWED_AUDIO_SOURCES.indexOf(value) < 0) {
    const err = new Error(
      'HS_AUDIO_SOURCE must be "development" or "production" (got ' + JSON.stringify(value) + ')',
    );
    err.code = 'HS_AUDIO_SOURCE_INVALID';
    throw err;
  }
  return value;
}

function isProductionAudioSource(mode) {
  return resolveAudioSourceMode(mode) === AUDIO_SOURCE_PRODUCTION;
}

function resolveAudioDirs(root, mode) {
  const resolved = resolveAudioSourceMode(mode);
  if (resolved === AUDIO_SOURCE_PRODUCTION) {
    const base = path.join(root, 'data', 'production-audio');
    return {
      mode: resolved,
      audioDir: path.join(base, 'voice'),
      musicDir: path.join(base, 'music'),
      previewDir: path.join(base, 'entrance'),
      packageDir: base,
    };
  }
  return {
    mode: resolved,
    audioDir: path.join(root, 'tmp', 'audio'),
    musicDir: path.join(root, 'tmp', 'music'),
    previewDir: path.join(root, 'tmp', 'preview'),
    packageDir: null,
  };
}

function createProductionExtractorGuard() {
  function deny(method) {
    const err = new Error('暂时无法播放');
    err.code = 'AUDIO_NOT_AVAILABLE';
    err.userMessage = '暂时无法播放';
    err.causeMessage = 'production mode blocked ' + method;
    throw err;
  }
  return {
    extractVoice: function extractVoice() {
      deny('extractVoice');
    },
    extractFirstMusicClipInBundle: function extractFirstMusicClipInBundle() {
      deny('extractFirstMusicClipInBundle');
    },
  };
}

function audioNotAvailableError() {
  const err = new Error('暂时无法播放');
  err.code = 'AUDIO_NOT_AVAILABLE';
  err.userMessage = '暂时无法播放';
  return err;
}

module.exports = {
  AUDIO_SOURCE_DEVELOPMENT,
  AUDIO_SOURCE_PRODUCTION,
  ALLOWED_AUDIO_SOURCES,
  resolveAudioSourceMode,
  isProductionAudioSource,
  resolveAudioDirs,
  createProductionExtractorGuard,
  audioNotAvailableError,
};
