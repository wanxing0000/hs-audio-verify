function readChunkMap(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  const chunks = {};
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    chunks[id] = { pos: pos + 8, size, bytes: buf.subarray(pos + 8, pos + 8 + size) };
    pos += 8 + size + (size % 2);
  }
  return chunks;
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

/**
 * Convert a WAV buffer to 16-bit PCM WAV for browser playback.
 * Reuses FSB→WAV output (often 32-bit float) without rewriting the FSB decoder.
 */
function wavToPcm16(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const chunks = readChunkMap(buf);
  const fmt = chunks['fmt '] || chunks.fmt;
  if (!fmt || fmt.size < 16) throw new Error('WAV missing fmt');
  const audioFormat = fmt.bytes.readUInt16LE(0);
  const channels = fmt.bytes.readUInt16LE(2);
  const sampleRate = fmt.bytes.readUInt32LE(4);
  const bits = fmt.bytes.readUInt16LE(14);
  const data = chunks.data;
  if (!data) throw new Error('WAV missing data');

  if (audioFormat === 1 && bits === 16) return buf;

  if (audioFormat === 3 && bits === 32) {
    const copy = Buffer.from(data.bytes);
    const floats = new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
    const pcm = Buffer.alloc(floats.length * 2);
    for (let i = 0; i < floats.length; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]));
      pcm.writeInt16LE(s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), i * 2);
    }
    return writePcm16Wav(pcm, channels, sampleRate);
  }

  if (audioFormat === 1 && bits === 32) {
    const copy = Buffer.from(data.bytes);
    const samples = new Int32Array(copy.buffer, copy.byteOffset, copy.length / 4);
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      pcm.writeInt16LE(samples[i] >> 16, i * 2);
    }
    return writePcm16Wav(pcm, channels, sampleRate);
  }

  throw new Error('unsupported WAV format ' + audioFormat + '/' + bits);
}

function inspectWav(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return {
    audioFormat: b.readUInt16LE(20),
    channels: b.readUInt16LE(22),
    sampleRate: b.readUInt32LE(24),
    bitsPerSample: b.readUInt16LE(34),
    bytes: b.length,
  };
}

module.exports = { wavToPcm16, writePcm16Wav, inspectWav };
