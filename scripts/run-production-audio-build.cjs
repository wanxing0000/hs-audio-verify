const path = require('path');
const { buildProductionAudioPackage } = require('../src/services/productionAudioPackage.js');

const root = path.resolve(__dirname, '..');
const result = buildProductionAudioPackage({ root });
console.log('[production-audio] built', {
  dest: path.relative(root, result.dest),
  voice: result.counts.voice,
  music: result.counts.music,
  entrance: result.counts.entrance,
  bytes: result.bytes,
});
