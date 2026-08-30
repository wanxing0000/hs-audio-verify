const fs = require('fs');
const path = require('path');
const { writePcm16Wav, inspectWav } = require('../src/explorer/wavPcm16.js');

const out = path.join(__dirname, 'assets', 'test-tone-44100-mono.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });

const sampleRate = 44100;
const seconds = 1.5;
const freq = 440;
const n = Math.round(sampleRate * seconds);
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
  const s = Math.sin(2 * Math.PI * freq * (i / sampleRate));
  pcm.writeInt16LE(Math.round(s * 12000), i * 2);
}
fs.writeFileSync(out, writePcm16Wav(pcm, 1, sampleRate));
const wav = inspectWav(fs.readFileSync(out));
console.log('wrote', out, wav);
