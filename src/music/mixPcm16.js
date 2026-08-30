function readFmt(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not wav');
  }
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const bytes = buf.subarray(pos + 8, pos + 8 + size);
    if (id === 'fmt ') fmt = bytes;
    if (id === 'data') data = bytes;
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('bad wav');
  return {
    audioFormat: fmt.readUInt16LE(0),
    channels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4),
    bits: fmt.readUInt16LE(14),
    data,
  };
}

function writePcm16Wav(pcm, channels, sampleRate) {
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

function upmixMonoToStereo(pcm) {
  const out = Buffer.alloc(pcm.length * 2);
  for (let i = 0, j = 0; i < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i);
    out.writeInt16LE(s, j);
    out.writeInt16LE(s, j + 2);
    j += 4;
  }
  return out;
}

function resamplePcm16(pcm, channels, fromRate, toRate) {
  if (fromRate === toRate) return pcm;
  const framesIn = pcm.length / 2 / channels;
  const framesOut = Math.max(1, Math.round(framesIn * toRate / fromRate));
  const out = Buffer.alloc(framesOut * channels * 2);
  for (let i = 0; i < framesOut; i++) {
    const src = i * fromRate / toRate;
    const i0 = Math.min(Math.floor(src), framesIn - 1);
    const i1 = Math.min(i0 + 1, framesIn - 1);
    const t = src - i0;
    for (let c = 0; c < channels; c++) {
      const a = pcm.readInt16LE((i0 * channels + c) * 2);
      const b = pcm.readInt16LE((i1 * channels + c) * 2);
      out.writeInt16LE(Math.round(a + (b - a) * t), (i * channels + c) * 2);
    }
  }
  return out;
}

function parseMixOptions(delayOrOpts, targetRate) {
  if (delayOrOpts && typeof delayOrOpts === 'object') {
    const o = delayOrOpts;
    return {
      delayMs: Number(o.voiceDelayMs != null ? o.voiceDelayMs : o.delayMs) || 0,
      targetRate: Number(o.targetRate) || 48000,
      musicVolume: o.musicVolume == null ? 1 : Number(o.musicVolume),
      voiceVolume: o.voiceVolume == null ? 1 : Number(o.voiceVolume),
      leadingPaddingMs: Number(o.leadingPaddingMs) || 0,
    };
  }
  return {
    delayMs: Number(delayOrOpts) || 0,
    targetRate: Number(targetRate) || 48000,
    musicVolume: 1,
    voiceVolume: 1,
    leadingPaddingMs: 0,
  };
}

function scalePcm16(pcm, volume) {
  if (volume === 1) return pcm;
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i += 2) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * volume))), i);
  }
  return out;
}

function mixPcm16(musicBuf, voiceBuf, delayMs, targetRate = 48000) {
  const opts = parseMixOptions(delayMs, targetRate);
  const m = readFmt(musicBuf);
  const v = readFmt(voiceBuf);
  if (m.audioFormat !== 1 || m.bits !== 16) throw new Error('music not pcm16');
  if (v.audioFormat !== 1 || v.bits !== 16) throw new Error('voice not pcm16');
  let musicData = m.data;
  let voiceData = v.data;
  let musicCh = m.channels;
  let voiceCh = v.channels;
  if (m.sampleRate !== opts.targetRate) musicData = resamplePcm16(musicData, musicCh, m.sampleRate, opts.targetRate);
  if (v.sampleRate !== opts.targetRate) voiceData = resamplePcm16(voiceData, voiceCh, v.sampleRate, opts.targetRate);
  let channels = musicCh;
  if (musicCh !== voiceCh) {
    if (musicCh === 2 && voiceCh === 1) {
      voiceData = upmixMonoToStereo(voiceData);
      channels = 2;
    } else if (musicCh === 1 && voiceCh === 2) {
      musicData = upmixMonoToStereo(musicData);
      channels = 2;
    } else {
      throw new Error('channel mismatch ' + musicCh + ' vs ' + voiceCh);
    }
  }
  musicData = scalePcm16(musicData, opts.musicVolume);
  voiceData = scalePcm16(voiceData, opts.voiceVolume);
  const padFrames = Math.round((opts.leadingPaddingMs / 1000) * opts.targetRate);
  const delayFrames = Math.round((opts.delayMs / 1000) * opts.targetRate);
  const frameBytes = channels * 2;
  const padBytes = padFrames * frameBytes;
  const delayBytes = delayFrames * frameBytes;
  const musicOffset = padBytes;
  const voiceOffset = padBytes + delayBytes;
  const outLen = Math.max(musicOffset + musicData.length, voiceOffset + voiceData.length);
  const out = Buffer.alloc(outLen);
  musicData.copy(out, musicOffset);
  for (let i = 0; i < voiceData.length; i += 2) {
    const dest = voiceOffset + i;
    if (dest + 2 > out.length) break;
    const a = out.readInt16LE(dest);
    const b = voiceData.readInt16LE(i);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, a + b)), dest);
  }
  return {
    wav: writePcm16Wav(out, channels, opts.targetRate),
    sampleRate: opts.targetRate,
    channels,
    delayMs: opts.delayMs,
    musicVolume: opts.musicVolume,
    voiceVolume: opts.voiceVolume,
    leadingPaddingMs: opts.leadingPaddingMs,
    durationSec: out.length / 2 / channels / opts.targetRate,
    resampled: m.sampleRate !== opts.targetRate || v.sampleRate !== opts.targetRate,
    sourceRates: { music: m.sampleRate, voice: v.sampleRate },
  };
}

module.exports = {
  mixPcm16,
  parseMixOptions,
  scalePcm16,
  readFmt,
  writePcm16Wav,
  upmixMonoToStereo,
  resamplePcm16,
};
