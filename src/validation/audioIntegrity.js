const { readFmt, resamplePcm16, upmixMonoToStereo } = require('../music/mixPcm16.js');

const DEFAULT_SILENCE = 512;

function wavPcmMeta(buf) {
  const fmt = readFmt(buf);
  const frameCount = fmt.data.length / 2 / fmt.channels;
  return {
    audioFormat: fmt.audioFormat,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bits,
    frameCount,
    durationMs: (frameCount / fmt.sampleRate) * 1000,
    durationSec: frameCount / fmt.sampleRate,
    dataBytes: fmt.data.length,
    pcm: fmt.data,
  };
}

function rmsOf(pcm, startByte, endByte) {
  const end = Math.min(endByte, pcm.length);
  let start = Math.max(0, startByte);
  start -= start % 2;
  if (end <= start) return 0;
  let sum = 0;
  let n = 0;
  for (let i = start; i + 2 <= end; i += 2) {
    const s = pcm.readInt16LE(i);
    sum += s * s;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

function peakOf(pcm, startByte, endByte) {
  const end = Math.min(endByte, pcm.length);
  let start = Math.max(0, startByte);
  start -= start % 2;
  let peak = 0;
  for (let i = start; i + 2 <= end; i += 2) {
    const a = Math.abs(pcm.readInt16LE(i));
    if (a > peak) peak = a;
  }
  return peak;
}

function firstNonSilentByte(pcm, threshold) {
  const thr = threshold == null ? DEFAULT_SILENCE : threshold;
  for (let i = 0; i + 2 <= pcm.length; i += 2) {
    if (Math.abs(pcm.readInt16LE(i)) >= thr) return i;
  }
  return pcm.length;
}

function windowBytes(meta, ms) {
  return Math.min(meta.pcm.length, Math.round((ms / 1000) * meta.sampleRate) * meta.channels * 2);
}

function analyzeWav(buf, opts) {
  const threshold = (opts && opts.silenceThreshold) || DEFAULT_SILENCE;
  const meta = wavPcmMeta(buf);
  const firstByte = firstNonSilentByte(meta.pcm, threshold);
  const leadingSilenceMs = (firstByte / 2 / meta.channels / meta.sampleRate) * 1000;
  const w200 = windowBytes(meta, 200);
  const w50 = windowBytes(meta, 50);
  return {
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    bitsPerSample: meta.bitsPerSample,
    audioFormat: meta.audioFormat,
    frameCount: meta.frameCount,
    durationMs: meta.durationMs,
    durationSec: meta.durationSec,
    leadingSilenceMs,
    peak200ms: peakOf(meta.pcm, 0, w200),
    rms200ms: rmsOf(meta.pcm, 0, w200),
    peak50ms: peakOf(meta.pcm, 0, w50),
    rms50ms: rmsOf(meta.pcm, 0, w50),
    peak20ms: peakOf(meta.pcm, 0, windowBytes(meta, 20)),
    rms20ms: rmsOf(meta.pcm, 0, windowBytes(meta, 20)),
    peak100ms: peakOf(meta.pcm, 0, windowBytes(meta, 100)),
    rms100ms: rmsOf(meta.pcm, 0, windowBytes(meta, 100)),
    firstNonSilentSample: firstByte / 2,
    riff: buf.toString('ascii', 0, 4) === 'RIFF',
    pcm16: meta.audioFormat === 1 && meta.bitsPerSample === 16,
  };
}

function sampleAt(pcm, channels, frame, ch) {
  const i = (frame * channels + ch) * 2;
  if (i < 0 || i + 2 > pcm.length) return 0;
  return pcm.readInt16LE(i);
}

/**
 * Compare music-only vs mixed at the start of the voice timeline.
 * If voice has energy but mixed equals music, voice was dropped (truncation).
 * If mixed differs (or clips) while voice has energy, voice is present (masking/clipping).
 */
function alignToMix(src, mixed) {
  let pcm = src.pcm;
  let ch = src.channels;
  if (src.sampleRate !== mixed.sampleRate) {
    pcm = resamplePcm16(pcm, ch, src.sampleRate, mixed.sampleRate);
  }
  if (ch === 1 && mixed.channels === 2) {
    pcm = upmixMonoToStereo(pcm);
    ch = 2;
  }
  return { pcm, channels: ch, sampleRate: mixed.sampleRate, durationMs: (pcm.length / 2 / ch / mixed.sampleRate) * 1000 };
}

function compareVoiceStartInMix(musicBuf, voiceBuf, mixedBuf, opts) {
  const windowMs = (opts && opts.windowMs) || 50;
  const threshold = (opts && opts.silenceThreshold) || DEFAULT_SILENCE;
  const mixed = wavPcmMeta(mixedBuf);
  const music = alignToMix(wavPcmMeta(musicBuf), mixed);
  const voice = alignToMix(wavPcmMeta(voiceBuf), mixed);
  const delayMs = (opts && opts.voiceDelayMs) || 0;
  const padMs = (opts && opts.leadingPaddingMs) || 0;
  const voiceStartMs = padMs + delayMs;
  const frames = Math.max(1, Math.round((windowMs / 1000) * mixed.sampleRate));
  const startFrame = Math.round((voiceStartMs / 1000) * mixed.sampleRate);
  const musicStartFrame = Math.round((padMs / 1000) * mixed.sampleRate);

  let voiceEnergyFrames = 0;
  let mixedDiffersFrames = 0;
  let clippedFrames = 0;
  let maxVoiceAbs = 0;
  let maxMixedAbs = 0;
  let maxMusicAbs = 0;

  const ch = mixed.channels || 1;
  for (let f = 0; f < frames; f++) {
    const mf = startFrame + f;
    const vf = f;
    for (let c = 0; c < ch; c++) {
      const vs = sampleAt(voice.pcm, voice.channels, vf, Math.min(c, voice.channels - 1));
      const ms = sampleAt(music.pcm, music.channels, mf - musicStartFrame, Math.min(c, music.channels - 1));
      const xs = sampleAt(mixed.pcm, mixed.channels, mf, c);
      const va = Math.abs(vs);
      if (va > maxVoiceAbs) maxVoiceAbs = va;
      if (Math.abs(xs) > maxMixedAbs) maxMixedAbs = Math.abs(xs);
      if (Math.abs(ms) > maxMusicAbs) maxMusicAbs = Math.abs(ms);
      if (va >= threshold) {
        voiceEnergyFrames++;
        if (Math.abs(xs - ms) >= Math.max(80, threshold / 8) || Math.abs(xs) >= 32767) mixedDiffersFrames++;
      }
      if (xs >= 32767 || xs <= -32768) clippedFrames++;
    }
  }

  const voicePresentInFile = firstNonSilentByte(voice.pcm, threshold) < Math.round((windowMs / 1000) * voice.sampleRate) * voice.channels * 2;
  const truncated = voiceEnergyFrames > 0 && mixedDiffersFrames === 0 && maxVoiceAbs >= threshold;
  const maskedLikely = !truncated && voicePresentInFile && maxMusicAbs >= maxVoiceAbs && maxVoiceAbs >= threshold;

  return {
    windowMs,
    voiceStartMs,
    voiceEnergyFrames,
    mixedDiffersFrames,
    clippedFrames,
    maxVoiceAbs,
    maxMixedAbs,
    maxMusicAbs,
    voicePresentInWindow: voiceEnergyFrames > 0 || voicePresentInFile,
    truncated,
    maskedLikely,
    mixedDurationMs: mixed.durationMs,
    voiceDurationMs: voice.durationMs,
    durationShortened: mixed.durationMs + 1 < voice.durationMs + voiceStartMs,
  };
}

function classifyEntranceLayer(voiceAnalysis, mixCompare) {
  const voiceOk = !!(voiceAnalysis && voiceAnalysis.rms200ms >= 200 && voiceAnalysis.leadingSilenceMs < 200);
  if (voiceAnalysis && !voiceOk) return 'FSB Extraction';
  if (mixCompare && mixCompare.truncated) return 'Mixer';
  if (mixCompare && mixCompare.durationShortened) return 'Mixer';
  if (mixCompare && mixCompare.maxVoiceAbs >= DEFAULT_SILENCE && mixCompare.maxMusicAbs >= mixCompare.maxVoiceAbs) {
    return 'Music Masking';
  }
  if (mixCompare && mixCompare.maskedLikely) return 'Music Masking';
  return 'Unresolved';
}

module.exports = {
  wavPcmMeta,
  analyzeWav,
  rmsOf,
  peakOf,
  firstNonSilentByte,
  compareVoiceStartInMix,
  classifyEntranceLayer,
  DEFAULT_SILENCE,
};
