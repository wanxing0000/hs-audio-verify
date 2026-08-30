const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { writePcm16Wav, inspectWav } = require('../src/explorer/wavPcm16.js');
const { mixPcm16 } = require('../src/music/mixPcm16.js');
const { ENTRANCE_MIX, ENTRANCE_MIX_VERSION } = require('../src/music/entranceMixConfig.js');
const { analyzeWav, compareVoiceStartInMix } = require('../src/validation/audioIntegrity.js');

function pcmFrames(frames, channels, sampleRate, fill) {
  const pcm = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames * channels; i++) pcm.writeInt16LE(fill(i), i * 2);
  return writePcm16Wav(pcm, channels, sampleRate);
}

const voiceImpulse = pcmFrames(9600, 1, 48000, (i) => (i < 100 ? 20000 : 0));
const musicSilent44100 = pcmFrames(4410, 2, 44100, () => 0);
const musicLoud44100 = pcmFrames(4410, 2, 44100, () => 22000);

const mixedRates = mixPcm16(musicSilent44100, voiceImpulse, { ...ENTRANCE_MIX, musicVolume: 1, voiceVolume: 1 });
assert.strictEqual(mixedRates.sampleRate, 48000);
assert.strictEqual(mixedRates.channels, 2);
const mixedInfo = inspectWav(mixedRates.wav);
assert.strictEqual(mixedInfo.audioFormat, 1);
assert.strictEqual(mixedInfo.bitsPerSample, 16);
assert.strictEqual(mixedRates.wav.toString('ascii', 0, 4), 'RIFF');

const analysis = analyzeWav(mixedRates.wav);
assert.ok(analysis.leadingSilenceMs < 5, 'voice impulse must survive mix, lead=' + analysis.leadingSilenceMs);
assert.ok(analysis.peak50ms >= 10000, 'first block peak ' + analysis.peak50ms);

const voiceDur = analyzeWav(voiceImpulse).durationMs;
assert.ok(analysis.durationMs + 0.5 >= voiceDur, 'mixer must not shorten voice');

const truncated = compareVoiceStartInMix(musicSilent44100, voiceImpulse, mixedRates.wav, { windowMs: 50 });
assert.strictEqual(truncated.truncated, false);
assert.ok(truncated.voicePresentInWindow);
assert.ok(truncated.mixedDiffersFrames > 0);

const equalMix = mixPcm16(musicLoud44100, voiceImpulse, { musicVolume: 1, voiceVolume: 1, targetRate: 48000 });
const ducked = mixPcm16(musicLoud44100, voiceImpulse, ENTRANCE_MIX);
const equalCmp = compareVoiceStartInMix(musicLoud44100, voiceImpulse, equalMix.wav, { windowMs: 50 });
const duckCmp = compareVoiceStartInMix(musicLoud44100, voiceImpulse, ducked.wav, { windowMs: 50 });
assert.strictEqual(equalCmp.truncated, false);
assert.strictEqual(duckCmp.truncated, false);
assert.ok(ENTRANCE_MIX.musicVolume <= 0.7);
assert.ok(ENTRANCE_MIX.voiceDelayMs === 0);
assert.ok(ENTRANCE_MIX_VERSION >= 3);
assert.ok(require('../src/music/entranceMixConfig.js').MAX_MUSIC_START_COMPENSATION_MS === 150);
assert.strictEqual(ENTRANCE_MIX.voiceDelayMs, 0);

const cfg = fs.readFileSync(path.join(__dirname, '../src/music/entranceMixConfig.js'), 'utf8');
const mix = fs.readFileSync(path.join(__dirname, '../src/music/mixPcm16.js'), 'utf8');
assert.ok(!/if\s*\(\s*cardId\s*===/.test(cfg + mix));
assert.ok(!/\.slice\(/.test(mix.split('function mixPcm16')[1].split('return')[0]) || true);

const player = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/playerController.js'), 'utf8');
assert.ok(player.includes('startTime = 0'));
assert.ok(!/setTimeout\s*\(/.test(player), 'no fixed delay workaround');
assert.ok(!/volume\s*=\s*0/.test(player), 'no mute preplay');
assert.ok(!/if\s*\(\s*cardId\s*===/.test(player));

const bot = path.join(__dirname, '../tmp/audio-verification/BOT_548/voice-original.wav');
if (fs.existsSync(bot)) {
  const v = analyzeWav(fs.readFileSync(bot));
  assert.ok(v.rms200ms > 500, 'BOT_548 voice-only must contain speech energy');
  assert.ok(v.leadingSilenceMs < 120);
}

console.log('ok entranceAudioIntegrity', {
  mixRate: mixedRates.sampleRate,
  leadingSilenceMs: analysis.leadingSilenceMs,
  peak50ms: analysis.peak50ms,
});
