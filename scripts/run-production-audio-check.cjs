const path = require('path');
const { productionAudioPaths, verifyProductionPackage } = require('../src/services/productionAudioPackage.js');

const root = path.resolve(__dirname, '..');
const dest = productionAudioPaths(root).dest;
const manifest = verifyProductionPackage(dest);
const bytes = [...manifest.voice, ...manifest.music, ...manifest.entrance].reduce((s, r) => s + r.bytes, 0);
console.log('[production-audio] check ok', {
  voice: manifest.voice.length,
  music: manifest.music.length,
  entrance: manifest.entrance.length,
  bytes,
  schemaVersion: manifest.schemaVersion,
});
