const fs = require('fs');
const path = require('path');
const { loadAssetBundle, AssetType } = require('@arkntools/unity-js');
const { convertFsb, FsbConvertFormat } = require('@arkntools/unity-js/audio');
const { wavToPcm16, inspectWav } = require('./wavPcm16.js');
const resolver = require('./audioBundleResolver.js');

const DEFAULT_HS_WIN = 'C:\\Hearthstone\\Data\\Win';
const DEFAULT_RESOLUTION_CACHE = path.join(
  process.cwd(),
  'data',
  'audio-verification',
  'audio-bundle-resolution-cache.json',
);

function safeVoiceFileName(voiceKey) {
  const name = String(voiceKey).replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!name) throw new Error('invalid voiceKey');
  return name + '.wav';
}

function sniffMagic(buf) {
  if (!buf || buf.length < 4) return 'empty';
  const s = Buffer.from(buf.subarray(0, 4)).toString('ascii');
  if (s === 'FSB5' || s === 'FSB4' || s === 'RIFF' || s === 'OggS') return s;
  return 'bin';
}

class HearthstoneAudioExtractor {
  constructor({
    hsWin = DEFAULT_HS_WIN,
    cacheDir,
    getVoiceAsset,
    resolutionCachePath = DEFAULT_RESOLUTION_CACHE,
  }) {
    this.hsWin = hsWin;
    this.cacheDir = cacheDir;
    this.getVoiceAsset = getVoiceAsset;
    this.resolutionCachePath = resolutionCachePath;
    this._winNames = null;
    this._unityFail = new Set();
    this._resolutionCache = null;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  cachePath(voiceKey) {
    return path.join(this.cacheDir, safeVoiceFileName(voiceKey));
  }

  winNames() {
    if (!this._winNames) this._winNames = fs.readdirSync(this.hsWin);
    return this._winNames;
  }

  musicCatalogNames() {
    if (!this._musicCatalog) {
      this._musicCatalog = this.winNames().filter((n) => {
        const l = String(n).toLowerCase();
        if (!l.endsWith('.unity3d')) return false;
        return l.includes('soundlegend') || l.includes('heromusic') || l.includes('musicexpansion');
      });
    }
    return this._musicCatalog;
  }

  debugEnabled(opts) {
    return !!(opts && opts.debug);
  }

  debugLog(opts, payload) {
    if (!this.debugEnabled(opts)) return;
    console.log('[AudioBundleResolver]', JSON.stringify(payload));
  }

  loadResolutionCache() {
    if (this._resolutionCache) return this._resolutionCache;
    const empty = {
      schemaVersion: '1.3.6-resolver-cache',
      note: 'Diagnostic/runtime resolution cache. Not an index. Safe to delete.',
      clips: {},
    };
    const p = this.resolutionCachePath;
    if (!p || !fs.existsSync(p)) {
      this._resolutionCache = empty;
      return this._resolutionCache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      this._resolutionCache = parsed && typeof parsed === 'object' ? parsed : empty;
      if (!this._resolutionCache.clips) this._resolutionCache.clips = {};
    } catch {
      this._resolutionCache = empty;
    }
    return this._resolutionCache;
  }

  rememberResolution(clipName, rec) {
    if (!this.resolutionCachePath || !clipName || !rec) return;
    const cache = this.loadResolutionCache();
    cache.clips[clipName] = {
      bundleName: rec.bundleName,
      reason: rec.reason,
      offset: rec.offset,
      size: rec.size,
      updatedAt: new Date().toISOString(),
    };
    try {
      fs.mkdirSync(path.dirname(this.resolutionCachePath), { recursive: true });
      fs.writeFileSync(this.resolutionCachePath, JSON.stringify(cache, null, 2));
    } catch {
      // cache is optional
    }
  }

  resolveCandidates(asset, clipName) {
    const cache = this.loadResolutionCache();
    const cached = cache.clips && cache.clips[clipName];
    return resolver.listCandidates(asset, {
      clipName,
      isMusic: resolver.isMusicClipName(clipName),
      winNames: this.winNames(),
      hsWin: this.hsWin,
      musicCatalogNames: resolver.isMusicClipName(clipName) ? this.musicCatalogNames() : [],
      cachedBundle: cached && cached.bundleName,
    });
  }

  resolveBundles(asset) {
    const clipName = (asset && asset.voiceKey) || '';
    return this.resolveCandidates(asset, clipName).map((c) => c.bundlePath);
  }

  isMusicClipName(name) {
    return resolver.isMusicClipName(name);
  }

  clipObjectName(clip) {
    try {
      return String((clip && clip.name) || '').replace(/\.wav$/i, '');
    } catch {
      return '';
    }
  }

  emptyInspection(candidate, extra) {
    extra = extra || {};
    return Object.assign({
      bundle: candidate && candidate.bundleName,
      reason: candidate && candidate.reason,
      kind: candidate && candidate.kind,
      clipFound: false,
      fsbFound: false,
      offset: null,
      size: null,
      offsetValid: false,
      decode: extra.decode || null,
      error: extra.error || null,
      valid: false,
      bundleExists: extra.bundleExists != null ? extra.bundleExists : true,
    }, extra);
  }

  readClipData(bundle, clip, bundlePath) {
    let data = null;
    let channels = 1;
    let offset = null;
    let size = null;
    let sourceName = null;
    let resourceLen = null;
    try {
      const tree = typeof clip.getTypeTree === 'function' ? clip.getTypeTree() : null;
      const res = tree && (tree.m_Resource || {});
      sourceName = String(res.m_Source || '').split('/').pop();
      offset = Number(res.m_Offset || 0);
      size = Number(res.m_Size || 0);
      if (sourceName && size > 0 && bundle.nodes) {
        const nodeIndex = bundle.nodes.findIndex((n) => n.path === sourceName);
        if (nodeIndex >= 0) {
          const file = Buffer.from(bundle.files[nodeIndex]);
          resourceLen = file.length;
          if (offset >= 0 && size > 0 && offset + size <= file.length) {
            data = new Uint8Array(file.subarray(offset, offset + size));
          }
        }
      }
      if (tree && tree.m_Channels) channels = tree.m_Channels;
    } catch {
      data = null;
    }
    if (!data || !data.length) {
      try {
        const audio = typeof clip.getAudio === 'function' ? clip.getAudio() : null;
        if (audio && audio.data) {
          data = audio.data instanceof Uint8Array ? audio.data : new Uint8Array(audio.data);
          channels = audio.channels || channels;
          if (offset == null) offset = 0;
          if (size == null) size = data.length;
        }
      } catch {
        data = null;
      }
    }
    return {
      name: this.clipObjectName(clip),
      bundle: path.basename(bundlePath),
      channels,
      size: data ? data.length : size,
      data: data || null,
      offset,
      resourceSize: size,
      sourceName,
      resourceLen,
      offsetValid: !!(data && data.length),
      magic: data ? sniffMagic(data) : null,
    };
  }

  findUnityClipObject(bundle, voiceKey) {
    for (const o of bundle.objects) {
      let type;
      try { type = o.type; } catch { continue; }
      if (type !== AssetType.AudioClip) continue;
      let name;
      try { name = o.name; } catch { continue; }
      if (resolver.clipNameMatches(name, voiceKey)) return o;
    }
    return null;
  }

  async inspectViaUnity(bundlePath, voiceKey) {
    if (this._unityFail.has(bundlePath)) {
      const err = new Error('unity-js previously failed to load this bundle');
      err.code = 'UNITY_SKIP';
      throw err;
    }
    let bundle;
    try {
      bundle = await loadAssetBundle(fs.readFileSync(bundlePath));
    } catch (e) {
      this._unityFail.add(bundlePath);
      throw e;
    }
    const clip = this.findUnityClipObject(bundle, voiceKey);
    if (!clip) return { clipFound: false };
    const read = this.readClipData(bundle, clip, bundlePath);
    return {
      clipFound: true,
      found: read.data ? read : null,
      offset: read.offset,
      size: read.resourceSize != null ? read.resourceSize : read.size,
      fsbFound: !!(read.data && read.data.length) || read.sourceName != null,
      offsetValid: !!read.offsetValid,
      magic: read.magic,
      sourceName: read.sourceName,
      error: read.offsetValid ? null : 'FSB offset invalid or resource missing',
    };
  }

  async inspectViaUnpack(bundlePath, voiceKey, opts) {
    opts = opts || {};
    const {
      unpackUnityFS,
      parseSerializedFile,
      parseAssetBundleContainer,
      readObjectTypeTree,
    } = await this.loadUnpackers();
    const unpacked = unpackUnityFS(bundlePath);
    const cab = unpacked.files && unpacked.files[0] && unpacked.files[0].data;
    if (!cab) return { clipFound: false, error: 'empty bundle' };
    const parsed = parseSerializedFile(cab, { typeTrees: true });
    const audioClipGuid = resolver.normalizeGuid(opts.audioClipGuid);
    let guidPathId = null;
    if (audioClipGuid) {
      const abObj = parsed.objects.find((o) => o.classId === 142);
      if (abObj) {
        const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
        const rec = (ab.container || []).find((c) => resolver.normalizeGuid(c.key) === audioClipGuid);
        if (rec) guidPathId = String(rec.pathId);
      }
    }
    for (const obj of parsed.objects) {
      if (obj.classId !== 83) continue;
      const nodes = parsed.types[obj.typeId] && parsed.types[obj.typeId].nodes;
      const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
      const tree = readObjectTypeTree(body, nodes);
      if (tree && tree.error) continue;
      const name = tree && (tree.m_Name || tree.name);
      if (!resolver.clipObjectMatches(name, voiceKey, obj.pathId, guidPathId)) continue;
      const res = (tree && tree.m_Resource) || {};
      const sourceName = String(res.m_Source || '').split('/').pop();
      const offset = Number(res.m_Offset || 0);
      const size = Number(res.m_Size || 0);
      const node = (unpacked.files || []).find((f) => f.path === sourceName);
      const resourceLen = node ? node.data.length : 0;
      const offsetValid = !!(node && size > 0 && offset >= 0 && offset + size <= resourceLen);
      let data = null;
      if (offsetValid) data = new Uint8Array(node.data.subarray(offset, offset + size));
      return {
        clipFound: true,
        found: data ? {
          name: String(name).replace(/\.wav$/i, ''),
          bundle: path.basename(bundlePath),
          channels: (tree && tree.m_Channels) || 1,
          size: data.length,
          data,
        } : null,
        offset,
        size,
        fsbFound: !!node,
        offsetValid,
        magic: data ? sniffMagic(data) : null,
        sourceName,
        resourceLen,
        via: 'unpack',
        error: offsetValid ? null : (
          !node
            ? 'FSB resource node not in bundle'
            : 'End position (' + (offset + size) + ') out of boundary (' + resourceLen + ')'
        ),
      };
    }
    return { clipFound: false };
  }

  async inspectCandidate(candidate, voiceKey, opts) {
    opts = opts || {};
    const bundlePath = candidate.bundlePath || path.join(this.hsWin, candidate.bundleName);
    if (!fs.existsSync(bundlePath)) {
      return this.emptyInspection(candidate, { bundleExists: false, error: 'bundle file missing' });
    }

    let unity = null;
    let unityErr = null;
    try {
      unity = await this.inspectViaUnity(bundlePath, voiceKey);
    } catch (e) {
      unityErr = e;
    }

    const unityLoaded = !unityErr;
    const shouldUnpack = !unityLoaded
      || (unity && unity.clipFound && !unity.offsetValid)
      || (opts.audioClipGuid && (!unity || !unity.clipFound));
    let result = unity;
    if (shouldUnpack) {
      try {
        const unpacked = await this.inspectViaUnpack(bundlePath, voiceKey, {
          audioClipGuid: opts.audioClipGuid,
        });
        const preferUnpack = unpacked.clipFound && (unpacked.offsetValid || !result || !result.clipFound);
        if (preferUnpack) result = unpacked;
      } catch (e) {
        if (!result) {
          return this.emptyInspection(candidate, {
            error: (unityErr && unityErr.message) || e.message,
          });
        }
      }
    }

    if (!result) {
      return this.emptyInspection(candidate, {
        error: unityErr ? unityErr.message : 'inspect failed',
      });
    }

    const inspection = this.emptyInspection(candidate, {
      clipFound: !!result.clipFound,
      fsbFound: !!result.fsbFound,
      offset: result.offset != null ? result.offset : null,
      size: result.size != null ? result.size : null,
      offsetValid: !!result.offsetValid,
      error: result.error || (unityErr && !result.clipFound ? unityErr.message : null),
      magic: result.magic || null,
      sourceName: result.sourceName || null,
      via: result.via || (unityErr ? 'unpack' : 'unity-js'),
      found: result.found || null,
    });

    if (opts.decode && inspection.offsetValid && inspection.found) {
      try {
        const wav = await this.clipToWav(inspection.found);
        inspectWav(wav);
        inspection.decode = 'success';
        inspection.wav = wav;
      } catch (e) {
        inspection.decode = 'failed';
        inspection.error = e.message;
      }
    }

    inspection.valid = !!(
      inspection.clipFound
      && inspection.fsbFound
      && inspection.offsetValid
      && (opts.decode ? inspection.decode === 'success' : true)
    );
    return inspection;
  }

  async findClip(bundlePath, voiceKey) {
    const candidate = {
      bundleName: path.basename(bundlePath),
      bundlePath,
      reason: 'direct',
      kind: resolver.bundleKind(bundlePath),
    };
    const inspection = await this.inspectCandidate(candidate, voiceKey);
    if (inspection.found && inspection.offsetValid) return inspection.found;
    if (inspection.error && resolver.isBoundaryError({ message: inspection.error })) {
      throw new Error(inspection.error);
    }
    return null;
  }

  async clipToWav(found) {
    const buf = Buffer.from(found.data);
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') {
      return wavToPcm16(buf);
    }
    const converted = await convertFsb(
      { data: found.data, size: found.size, channels: found.channels },
      FsbConvertFormat.WAV,
    );
    return wavToPcm16(Buffer.from(converted));
  }

  async extractVoice(voiceKey, opts) {
    opts = opts || {};
    const t0 = Date.now();
    if (!voiceKey) {
      const err = new Error('No voice available');
      err.code = 'NO_VOICE';
      err.failureClass = resolver.FAILURE.NO_DATA;
      throw err;
    }
    const outPath = this.cachePath(voiceKey);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 44) {
      return {
        path: outPath,
        cached: true,
        ms: Date.now() - t0,
        wav: inspectWav(fs.readFileSync(outPath)),
      };
    }

    if (typeof this.getVoiceAsset !== 'function') {
      const err = new Error('Voice asset not indexed');
      err.code = 'NOT_INDEXED';
      err.failureClass = resolver.FAILURE.INDEX_MISSING;
      throw err;
    }
    const asset = this.getVoiceAsset(voiceKey);
    if (!asset || !asset.indexed) {
      const err = new Error('Voice asset not indexed');
      err.code = 'NOT_INDEXED';
      err.failureClass = resolver.FAILURE.INDEX_MISSING;
      throw err;
    }

    let audioClipGuid = resolver.normalizeGuid(opts.audioClipGuid);
    if (!audioClipGuid && opts.prefabGuid && opts.prefabBundle) {
      audioClipGuid = await this.recoverSoundDefClipGuid(opts.prefabBundle, opts.prefabGuid, voiceKey);
    }

    const candidates = this.resolveCandidates(asset, voiceKey);
    if (!candidates.length) {
      const err = new Error('Voice asset not indexed');
      err.code = 'NOT_INDEXED';
      err.failureClass = resolver.FAILURE.BUNDLE_NOT_FOUND;
      throw err;
    }

    const inspections = [];
    let lastErr = null;
    for (const candidate of candidates) {
      let inspection;
      try {
        inspection = await this.inspectCandidate(candidate, voiceKey, {
          decode: false,
          audioClipGuid,
        });
      } catch (e) {
        lastErr = e;
        inspection = this.emptyInspection(candidate, { error: e.message });
      }
      this.debugLog(opts, {
        cardId: opts.cardId || null,
        asset: voiceKey,
        candidate: candidate.bundleName,
        reason: candidate.reason,
        clipFound: inspection.clipFound,
        fsbFound: inspection.fsbFound,
        offset: inspection.offset,
        size: inspection.size,
        offsetValid: inspection.offsetValid,
        decodeResult: inspection.decode,
        error: inspection.error || null,
      });

      if (!inspection.clipFound || !inspection.fsbFound || !inspection.offsetValid || !inspection.found) {
        inspections.push(inspection);
        continue;
      }

      try {
        const wav = await this.clipToWav(inspection.found);
        inspectWav(wav);
        const tmp = outPath + '.part';
        fs.writeFileSync(tmp, wav);
        fs.renameSync(tmp, outPath);
        inspection.decode = 'success';
        inspections.push(inspection);
        this.rememberResolution(voiceKey, {
          bundleName: candidate.bundleName,
          reason: candidate.reason,
          offset: inspection.offset,
          size: inspection.size,
        });
        this.debugLog(opts, {
          cardId: opts.cardId || null,
          asset: voiceKey,
          candidate: candidate.bundleName,
          reason: candidate.reason,
          clipFound: true,
          fsbFound: true,
          offset: inspection.offset,
          size: inspection.size,
          offsetValid: true,
          decodeResult: 'success',
        });
        return {
          path: outPath,
          cached: false,
          ms: Date.now() - t0,
          bundle: candidate.bundleName,
          reason: candidate.reason,
          wav: inspectWav(wav),
        };
      } catch (e) {
        lastErr = e;
        inspection.decode = 'failed';
        inspection.error = e.message;
        inspections.push(inspection);
      }
    }

    const failureClass = resolver.classifyFromInspections(inspections);
    const tried = candidates.map((c) => c.bundleName).join(', ');
    const err = new Error(
      'Failed to extract audio'
      + (lastErr ? ': ' + lastErr.message : '')
      + (tried ? ' (tried ' + tried + ')' : ''),
    );
    err.code = 'EXTRACT_FAILED';
    err.failureClass = failureClass;
    err.inspections = inspections;
    throw err;
  }

  async loadUnpackers() {
    if (!this._unpackers) {
      const unpack = await import('../../unpack-search.mjs');
      const serialized = await import('../../unity-serialized.mjs');
      this._unpackers = {
        unpackUnityFS: unpack.unpackUnityFS,
        parseSerializedFile: serialized.parseSerializedFile,
        parseAssetBundleContainer: serialized.parseAssetBundleContainer,
        readObjectTypeTree: serialized.readObjectTypeTree,
      };
    }
    return this._unpackers;
  }

  printableAscii(buf) {
    let out = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      out += b >= 32 && b <= 126 ? String.fromCharCode(b) : ' ';
    }
    return out;
  }

  async recoverSoundDefClipGuid(bundleFileName, prefabGuid, wantedName) {
    const guid = String(prefabGuid || '').toLowerCase();
    const cacheKey = guid + '|' + String(wantedName || '');
    if (!this._soundDefGuidCache) this._soundDefGuidCache = Object.create(null);
    if (Object.prototype.hasOwnProperty.call(this._soundDefGuidCache, cacheKey)) {
      return this._soundDefGuidCache[cacheKey];
    }
    const bundlePath = path.join(this.hsWin, path.basename(String(bundleFileName || '')));
    if (!guid || !fs.existsSync(bundlePath)) {
      this._soundDefGuidCache[cacheKey] = '';
      return '';
    }
    const { unpackUnityFS, parseSerializedFile, parseAssetBundleContainer } = await this.loadUnpackers();
    const unpacked = unpackUnityFS(bundlePath);
    const cab = unpacked.files && unpacked.files[0] && unpacked.files[0].data;
    if (!cab) {
      this._soundDefGuidCache[cacheKey] = '';
      return '';
    }
    const parsed = parseSerializedFile(cab, { typeTrees: false });
    const abObj = parsed.objects.find((o) => o.classId === 142);
    if (!abObj) {
      this._soundDefGuidCache[cacheKey] = '';
      return '';
    }
    const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
    const rec = (ab.container || []).find((c) => String(c.key || '').toLowerCase() === guid);
    if (!rec || !ab.preload) {
      this._soundDefGuidCache[cacheKey] = '';
      return '';
    }
    const byPath = new Map(parsed.objects.map((o) => [String(o.pathId), o]));
    const refs = [];
    const end = Math.min(ab.preload.length, rec.preloadIndex + rec.preloadSize);
    for (let i = rec.preloadIndex; i < end; i++) {
      const p = ab.preload[i];
      if (!p) continue;
      const obj = byPath.get(String(p.pathId));
      if (!obj) continue;
      const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
      refs.push(...resolver.parseSoundDefWavRefs(this.printableAscii(body)));
    }
    const picked = resolver.pickSoundDefClipGuid(refs, wantedName);
    this._soundDefGuidCache[cacheKey] = picked;
    return picked;
  }

  async recoverClipNamesFromPrefab(bundleFileName, prefabGuid) {
    const guid = String(prefabGuid || '').toLowerCase();
    const bundlePath = path.join(this.hsWin, path.basename(String(bundleFileName || '')));
    if (!guid || !fs.existsSync(bundlePath)) return [];
    const { unpackUnityFS, parseSerializedFile, parseAssetBundleContainer } = await this.loadUnpackers();
    const unpacked = unpackUnityFS(bundlePath);
    const cab = unpacked.files && unpacked.files[0] && unpacked.files[0].data;
    if (!cab) return [];
    const parsed = parseSerializedFile(cab, { typeTrees: false });
    const abObj = parsed.objects.find((o) => o.classId === 142);
    if (!abObj) return [];
    const ab = parseAssetBundleContainer(cab.subarray(abObj.absStart, abObj.absStart + abObj.byteSize));
    const rec = (ab.container || []).find((c) => String(c.key || '').toLowerCase() === guid);
    if (!rec || !ab.preload) return [];
    const byPath = new Map(parsed.objects.map((o) => [String(o.pathId), o]));
    const names = [];
    const add = (raw) => {
      const name = String(raw || '').replace(/\.wav$/i, '');
      if (!this.isMusicClipName(name)) return;
      if (names.indexOf(name) < 0) names.push(name);
    };
    const end = Math.min(ab.preload.length, rec.preloadIndex + rec.preloadSize);
    for (let i = rec.preloadIndex; i < end; i++) {
      const p = ab.preload[i];
      if (!p) continue;
      const obj = byPath.get(String(p.pathId));
      if (!obj) continue;
      const body = cab.subarray(obj.absStart, obj.absStart + obj.byteSize);
      const printable = this.printableAscii(body);
      const re = /([A-Za-z0-9_']+)\.wav/g;
      let m;
      while ((m = re.exec(printable))) add(m[1]);
    }
    return names;
  }

  async extractFirstMusicClipInBundle(bundleFileName, cacheKey, prefabGuid) {
    const t0 = Date.now();
    const key = cacheKey || ('bundle_' + path.basename(String(bundleFileName || 'music')));
    const outPath = this.cachePath(key);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 44) {
      return {
        path: outPath,
        cached: true,
        ms: Date.now() - t0,
        wav: inspectWav(fs.readFileSync(outPath)),
      };
    }
    const bundlePath = path.join(this.hsWin, path.basename(String(bundleFileName || '')));
    if (!bundleFileName || !fs.existsSync(bundlePath)) {
      const err = new Error('暂无可用音频');
      err.code = 'NO_MUSIC';
      err.failureClass = resolver.FAILURE.NO_DATA;
      throw err;
    }
    let lastErr = null;
    try {
      const bundle = await loadAssetBundle(fs.readFileSync(bundlePath));
      const clips = [];
      for (const o of bundle.objects) {
        let type;
        try { type = o.type; } catch { continue; }
        if (type !== AssetType.AudioClip) continue;
        const name = this.clipObjectName(o);
        if (/^VO_/i.test(name)) continue;
        clips.push(o);
      }
      clips.sort((a, b) => (
        Number(this.isMusicClipName(this.clipObjectName(b)))
        - Number(this.isMusicClipName(this.clipObjectName(a)))
      ));
      for (const clip of clips) {
        const found = this.readClipData(bundle, clip, bundlePath);
        if (!found || !found.data) continue;
        try {
          const wav = await this.clipToWav(found);
          const tmp = outPath + '.part';
          fs.writeFileSync(tmp, wav);
          fs.renameSync(tmp, outPath);
          return {
            path: outPath,
            cached: false,
            ms: Date.now() - t0,
            bundle: found.bundle,
            clipName: found.name || null,
            wav: inspectWav(wav),
          };
        } catch (e) {
          lastErr = e;
        }
      }
    } catch (e) {
      lastErr = e;
    }

    const recovered = await this.recoverClipNamesFromPrefab(bundleFileName, prefabGuid);
    const aliases = [];
    for (const name of recovered) {
      aliases.push(name);
      const stripped = name.replace(/'/g, '');
      if (stripped !== name) aliases.push(stripped);
    }
    for (const name of aliases) {
      try {
        const out = await this.extractVoice(name);
        const wav = fs.readFileSync(out.path);
        if (path.resolve(out.path) !== path.resolve(outPath)) {
          fs.writeFileSync(outPath + '.part', wav);
          fs.renameSync(outPath + '.part', outPath);
        }
        return {
          path: outPath,
          cached: !!out.cached,
          ms: Date.now() - t0,
          bundle: out.bundle || null,
          clipName: name,
          wav: out.wav || inspectWav(wav),
        };
      } catch (e) {
        lastErr = e;
      }
    }
    const err = new Error(
      'Failed to extract audio'
      + (lastErr ? ': ' + lastErr.message : '')
      + ' (bundle ' + path.basename(bundlePath)
      + ', recovered ' + (recovered.join(', ') || 'none') + ')',
    );
    err.code = 'EXTRACT_FAILED';
    err.failureClass = lastErr && lastErr.failureClass ? lastErr.failureClass : resolver.FAILURE.FSB_OFFSET_INVALID;
    err.ms = Date.now() - t0;
    throw err;
  }
}

module.exports = { HearthstoneAudioExtractor, safeVoiceFileName };
