const fs = require('fs');
const path = require('path');

function safeName(key) {
  const name = String(key || '').replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!name) throw new Error('invalid cache key');
  return name;
}

class AudioCache {
  constructor({ audioDir, musicDir, previewDir }) {
    this.dirs = {
      voice: audioDir,
      music: musicDir,
      preview: previewDir,
    };
    for (const dir of Object.values(this.dirs)) {
      if (dir) fs.mkdirSync(dir, { recursive: true });
    }
  }

  filePath(kind, key) {
    const dir = this.dirs[kind];
    if (!dir) throw new Error('unknown cache kind');
    return path.join(dir, safeName(key) + '.wav');
  }

  has(kind, key) {
    const p = this.filePath(kind, key);
    return fs.existsSync(p) && fs.statSync(p).size > 44;
  }

  path(kind, key) {
    return this.filePath(kind, key);
  }

  read(kind, key) {
    if (!this.has(kind, key)) return null;
    return fs.readFileSync(this.filePath(kind, key));
  }

  write(kind, key, buf) {
    const p = this.filePath(kind, key);
    const tmp = p + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, p);
    return p;
  }
}

module.exports = { AudioCache, safeName };
