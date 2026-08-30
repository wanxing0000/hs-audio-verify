const { readFmt, writePcm16Wav } = require('./mixPcm16.js');
const {
  MAX_MUSIC_START_COMPENSATION_MS,
  MUSIC_START_WINDOW_MS,
  MUSIC_START_PEAK_THRESHOLD,
  MUSIC_START_RMS_THRESHOLD,
  MUSIC_START_CONSECUTIVE_WINDOWS,
} = require('./entranceMixConfig.js');

function compensationConfig(overrides) {
  const o = overrides || {};
  return {
    maxMs: o.maxMs != null ? Number(o.maxMs) : MAX_MUSIC_START_COMPENSATION_MS,
    windowMs: o.windowMs != null ? Number(o.windowMs) : MUSIC_START_WINDOW_MS,
    peakThreshold: o.peakThreshold != null ? Number(o.peakThreshold) : MUSIC_START_PEAK_THRESHOLD,
    rmsThreshold: o.rmsThreshold != null ? Number(o.rmsThreshold) : MUSIC_START_RMS_THRESHOLD,
    consecutive: o.consecutive != null ? Number(o.consecutive) : MUSIC_START_CONSECUTIVE_WINDOWS,
  };
}

function windowStats(pcm, channels, startFrame, frameCount) {
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (let f = 0; f < frameCount; f++) {
    for (let c = 0; c < channels; c++) {
      const i = ((startFrame + f) * channels + c) * 2;
      if (i + 2 > pcm.length) break;
      const v = pcm.readInt16LE(i);
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      n++;
    }
  }
  return { rms: n ? Math.sqrt(sum / n) : 0, peak };
}

function windowIsAudible(stats, cfg) {
  return stats.peak >= cfg.peakThreshold || stats.rms >= cfg.rmsThreshold;
}

/**
 * Pure function: find how many milliseconds of Music start to skip for Entrance Combo.
 * Scans only [0, maxMs]. No CardID. No IO.
 */
function findMusicStartCompensation(wavBuf, overrides) {
  const empty = {
    compensationMs: 0,
    compensationFrames: 0,
    compensationBytes: 0,
    sampleRate: 0,
    channels: 0,
    fallback: true,
    reason: 'unparsed',
  };
  if (!wavBuf || !Buffer.isBuffer(wavBuf) || wavBuf.length < 44) {
    return Object.assign({}, empty, { reason: 'buffer-too-short' });
  }
  let fmt;
  try {
    fmt = readFmt(wavBuf);
  } catch (e) {
    return Object.assign({}, empty, { reason: 'not-wav' });
  }
  if (fmt.audioFormat !== 1 || fmt.bits !== 16) {
    return Object.assign({}, empty, {
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      reason: 'not-pcm16',
    });
  }
  const sampleRate = fmt.sampleRate;
  const channels = fmt.channels;
  if (!sampleRate || sampleRate < 8000 || sampleRate > 192000 || channels < 1 || channels > 8) {
    return Object.assign({}, empty, { sampleRate, channels, reason: 'bad-format' });
  }
  const cfg = compensationConfig(overrides);
  if (!(cfg.maxMs > 0) || !(cfg.windowMs > 0) || !(cfg.consecutive >= 1)) {
    return Object.assign({}, empty, { sampleRate, channels, fallback: false, reason: 'bad-config' });
  }
  const frameBytes = channels * 2;
  const totalFrames = Math.floor(fmt.data.length / frameBytes);
  if (totalFrames < 1) {
    return Object.assign({}, empty, { sampleRate, channels, reason: 'no-frames' });
  }
  const maxFrames = Math.min(totalFrames, Math.floor((cfg.maxMs / 1000) * sampleRate));
  const windowFrames = Math.max(1, Math.round((cfg.windowMs / 1000) * sampleRate));
  if (maxFrames < 1) {
    return {
      compensationMs: 0,
      compensationFrames: 0,
      compensationBytes: 0,
      sampleRate,
      channels,
      fallback: false,
      reason: 'ok',
    };
  }

  let run = 0;
  let runStartFrame = 0;
  let start = 0;
  while (start < maxFrames) {
    const count = Math.min(windowFrames, maxFrames - start);
    if (count < 1) break;
    const stats = windowStats(fmt.data, channels, start, count);
    if (windowIsAudible(stats, cfg)) {
      if (run === 0) runStartFrame = start;
      run += 1;
      if (run >= cfg.consecutive) {
        const frames = Math.min(runStartFrame, maxFrames);
        const bytes = frames * frameBytes;
        const ms = (frames / sampleRate) * 1000;
        return {
          compensationMs: ms,
          compensationFrames: frames,
          compensationBytes: bytes,
          sampleRate,
          channels,
          fallback: false,
          reason: 'ok',
        };
      }
    } else {
      run = 0;
    }
    start += windowFrames;
  }

  return {
    compensationMs: 0,
    compensationFrames: 0,
    compensationBytes: 0,
    sampleRate,
    channels,
    fallback: false,
    reason: 'ok',
  };
}

function applyMusicStartCompensation(wavBuf, overrides) {
  const found = findMusicStartCompensation(wavBuf, overrides);
  const base = { wav: wavBuf, ...found };
  if (found.fallback || found.compensationFrames <= 0) return base;
  let fmt;
  try {
    fmt = readFmt(wavBuf);
  } catch (e) {
    return { wav: wavBuf, ...found, fallback: true, reason: 'slice-parse', compensationMs: 0, compensationFrames: 0, compensationBytes: 0 };
  }
  const frameBytes = fmt.channels * 2;
  const skip = found.compensationFrames * frameBytes;
  if (skip <= 0 || skip >= fmt.data.length || skip % frameBytes !== 0) {
    return { wav: wavBuf, ...found, fallback: true, reason: 'slice-align', compensationMs: 0, compensationFrames: 0, compensationBytes: 0 };
  }
  const sliced = fmt.data.subarray(skip);
  if (sliced.length < frameBytes) {
    return { wav: wavBuf, ...found, fallback: true, reason: 'slice-empty', compensationMs: 0, compensationFrames: 0, compensationBytes: 0 };
  }
  return {
    wav: writePcm16Wav(Buffer.from(sliced), fmt.channels, fmt.sampleRate),
    ...found,
  };
}

module.exports = {
  findMusicStartCompensation,
  applyMusicStartCompensation,
  compensationConfig,
  windowIsAudible,
};
