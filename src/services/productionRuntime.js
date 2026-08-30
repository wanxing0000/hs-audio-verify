const fs = require('fs');
const path = require('path');
const { resolveAudioSourceMode } = require('./audioSourceMode.js');

function requiredProductionRelativePaths() {
  return [
    'package.json',
    'package-lock.json',
    'src/miniprogram/miniServer.js',
    'src/miniprogram/catalogAdapter.js',
    'src/miniprogram/unifiedAudioRepo.js',
    'src/miniprogram/adminStatic.js',
    'src/miniprogram/lanListen.js',
    'src/miniprogram/audioAvailability.js',
    'src/services/audioCache.js',
    'src/services/audioService.js',
    'src/services/audioSourceMode.js',
    'src/services/entrancePreviewService.js',
    'src/services/supabaseClient.js',
    'src/services/adminAuth.js',
    'src/explorer/wavPcm16.js',
    'src/music/entranceMixConfig.js',
    'admin/index.html',
    'admin/login.html',
    'admin/data.html',
    'admin/feedback.html',
    'data/index/card-audio-index.json',
    'data/index/audio-index.json',
    'data/index/music-assets.json',
    'data/index/latest-set.json',
    'data/production-audio/manifest.json',
  ];
}

function prepareProductionMiniEnv(env) {
  const next = Object.assign({}, env || {});
  if (!String(next.NODE_ENV || '').trim()) next.NODE_ENV = 'production';
  if (!String(next.HS_AUDIO_SOURCE || '').trim()) next.HS_AUDIO_SOURCE = 'production';
  const mode = resolveAudioSourceMode(next.HS_AUDIO_SOURCE);
  if (mode !== 'production') {
    const err = new Error('start:production requires HS_AUDIO_SOURCE=production');
    err.code = 'HS_AUDIO_SOURCE_INVALID';
    throw err;
  }
  if (!String(next.MINI_SKIP_LAN_WRITE || '').trim()) next.MINI_SKIP_LAN_WRITE = '1';
  return next;
}

function assertProductionRuntimeReady(root) {
  const missing = [];
  requiredProductionRelativePaths().forEach((rel) => {
    if (!fs.existsSync(path.join(root, rel))) missing.push(rel);
  });
  const audioDirs = ['voice', 'music', 'entrance'];
  audioDirs.forEach((name) => {
    const rel = path.join('data', 'production-audio', name);
    if (!fs.existsSync(path.join(root, rel))) missing.push(rel.replace(/\\/g, '/'));
  });
  if (missing.length) {
    const err = new Error('missing production files: ' + missing.join(', '));
    err.code = 'PRODUCTION_RUNTIME_INCOMPLETE';
    err.missing = missing;
    throw err;
  }
}

module.exports = {
  requiredProductionRelativePaths,
  prepareProductionMiniEnv,
  assertProductionRuntimeReady,
};
