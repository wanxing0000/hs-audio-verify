const path = require('path');

const FAILURE = {
  NO_DATA: 'NO_DATA',
  INDEX_MISSING: 'INDEX_MISSING',
  BUNDLE_NOT_FOUND: 'BUNDLE_NOT_FOUND',
  CLIP_NOT_FOUND: 'CLIP_NOT_FOUND',
  FSB_NOT_FOUND: 'FSB_NOT_FOUND',
  FSB_OFFSET_INVALID: 'FSB_OFFSET_INVALID',
  FSB_DECODE_FAILED: 'FSB_DECODE_FAILED',
  WAV_INVALID: 'WAV_INVALID',
  API_FAILED: 'API_FAILED',
  UNKNOWN: 'UNKNOWN',
};

const BUNDLE_TAIL = /-(prefab|content|audio|texture|material|mesh|shader|assets)-(\d+)\.unity3d$/i;

function clipNameMatches(actual, wanted) {
  const a = String(actual || '').replace(/\.wav$/i, '');
  const b = String(wanted || '').replace(/\.wav$/i, '');
  if (!a || !b) return false;
  if (a === b) return true;
  return a.replace(/'/g, '') === b.replace(/'/g, '');
}

function normalizeGuid(value) {
  const g = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(g)) return '';
  return g;
}

function parseSoundDefWavRefs(text) {
  const re = /([A-Za-z0-9_']+)\.wav:([0-9a-f]{32})/gi;
  const out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push({
      clipName: m[1],
      clipGuid: m[2].toLowerCase(),
    });
  }
  return out;
}

function pickSoundDefClipGuid(refs, wantedName) {
  const list = Array.isArray(refs) ? refs : [];
  const music = list.filter((r) => r && isMusicClipName(r.clipName) && normalizeGuid(r.clipGuid));
  if (!music.length) return '';
  const named = music.find((r) => clipNameMatches(r.clipName, wantedName));
  return (named || music[0]).clipGuid;
}

function clipObjectMatches(actualName, wantedName, actualPathId, wantedPathId) {
  if (clipNameMatches(actualName, wantedName)) return true;
  if (wantedPathId && actualPathId && String(actualPathId) === String(wantedPathId)) return true;
  return false;
}

function isMusicClipName(name) {
  const k = String(name || '').replace(/\.wav$/i, '');
  if (!k || /^VO_/i.test(k)) return false;
  return /stinger/i.test(k) || /_music($|_)/i.test(k) || /^pegasus_stinger/i.test(k);
}

function bundleKind(name) {
  const l = String(name || '').toLowerCase();
  if (l.includes('-audio-')) return 'audio';
  if (l.includes('-content-')) return 'content';
  if (l.includes('-prefab-')) return 'prefab';
  if (l.includes('soundlegend')) return 'soundlegend';
  if (l.includes('heromusic') || l.includes('musicexpansion')) return 'music_catalog';
  return 'other';
}

function familyPrefix(bundleName) {
  const base = path.basename(String(bundleName || ''));
  const m = base.match(BUNDLE_TAIL);
  if (!m) return null;
  return base.slice(0, m.index);
}

function siblingAudioBundles(bundleName, winNames) {
  const prefix = familyPrefix(bundleName);
  if (!prefix) return [];
  const needle = prefix.toLowerCase() + '-audio-';
  return (winNames || []).filter((n) => {
    const l = String(n).toLowerCase();
    return l.startsWith(needle) && l.endsWith('.unity3d');
  });
}

function hashFromBundleName(bundleName) {
  const m = String(bundleName || '').match(/-([0-9a-f]{8})-/i);
  return m ? m[1] : null;
}

function hashRelatedAudioBundles(bundleName, winNames) {
  const hash = hashFromBundleName(bundleName);
  if (!hash) return [];
  const h = hash.toLowerCase();
  return (winNames || []).filter((n) => {
    const l = String(n).toLowerCase();
    return l.includes(h) && l.includes('audio') && l.endsWith('.unity3d');
  });
}

function basePriority(reason, bundleName) {
  const kind = bundleKind(bundleName);
  if (reason === 'resolution_cache') return 300;
  if (reason === 'zhcn_audio_bundle') return 220;
  if (reason === 'sibling_audio_bundle') return 200;
  if (reason === 'hash_related_audio') return 170;
  if (reason === 'soundlegend_audio_bundle') return 150;
  if (reason === 'music_catalog_bundle') return 140;
  if (reason === 'indexed_content_bundle' || kind === 'content') return 120;
  if (reason === 'indexed_audio_bundle' || kind === 'audio') return 180;
  if (reason === 'indexed_prefab_bundle' || kind === 'prefab') return 40;
  return 80;
}

function scoreInspection(inspection) {
  let score = 0;
  if (!inspection) return -50;
  if (inspection.clipFound) score += 100;
  else score -= 40;
  if (inspection.guidMatch) score += 50;
  if (inspection.soundDefRef) score += 30;
  if (inspection.fsbFound) score += 40;
  else if (inspection.clipFound) score -= 20;
  if (inspection.offsetValid) score += 80;
  else if (inspection.clipFound) score -= 100;
  if (inspection.decode === 'success') score += 60;
  else if (inspection.decode === 'failed') score -= 80;
  if (inspection.kind === 'prefab' && !inspection.offsetValid) score -= 50;
  if (inspection.kind === 'soundlegend' || inspection.reason === 'soundlegend_audio_bundle') score += 20;
  return score;
}

function classifyFromInspections(inspections, opts) {
  opts = opts || {};
  if (opts.noData) return FAILURE.NO_DATA;
  if (opts.indexMissing) return FAILURE.INDEX_MISSING;
  const list = inspections || [];
  if (!list.length) return FAILURE.BUNDLE_NOT_FOUND;
  const anyFile = list.some((i) => i && i.bundleExists !== false);
  if (!anyFile) return FAILURE.BUNDLE_NOT_FOUND;
  const anyClip = list.some((i) => i && i.clipFound);
  if (!anyClip) return FAILURE.CLIP_NOT_FOUND;
  const anyFsb = list.some((i) => i && i.fsbFound);
  if (!anyFsb) return FAILURE.FSB_NOT_FOUND;
  const anyOffset = list.some((i) => i && i.offsetValid);
  if (!anyOffset) return FAILURE.FSB_OFFSET_INVALID;
  const anyDecode = list.some((i) => i && i.decode === 'success');
  if (!anyDecode) {
    if (list.some((i) => i && i.decode === 'failed')) return FAILURE.FSB_DECODE_FAILED;
    return FAILURE.FSB_DECODE_FAILED;
  }
  if (list.some((i) => i && i.wavInvalid)) return FAILURE.WAV_INVALID;
  return FAILURE.UNKNOWN;
}

function candidateRecord(bundleName, reason, extra) {
  extra = extra || {};
  return {
    bundleName: path.basename(String(bundleName)),
    bundlePath: extra.bundlePath || null,
    reason,
    priority: extra.priority != null ? extra.priority : basePriority(reason, bundleName),
    evidence: extra.evidence || reason,
    kind: bundleKind(bundleName),
  };
}

function listCandidates(asset, ctx) {
  ctx = ctx || {};
  const winNames = ctx.winNames || [];
  const hsWin = ctx.hsWin || '';
  const clipName = ctx.clipName || (asset && asset.voiceKey) || '';
  const music = ctx.isMusic != null ? ctx.isMusic : isMusicClipName(clipName);
  const seen = new Set();
  const out = [];

  const add = (name, reason, evidence) => {
    const base = path.basename(String(name || ''));
    if (!base || seen.has(base.toLowerCase())) return;
    seen.add(base.toLowerCase());
    out.push(candidateRecord(base, reason, {
      bundlePath: hsWin ? path.join(hsWin, base) : base,
      evidence: evidence || reason,
    }));
  };

  if (ctx.cachedBundle) add(ctx.cachedBundle, 'resolution_cache', 'previous successful resolve');

  for (const n of (asset && asset.zhcnBundles) || []) {
    add(n, 'zhcn_audio_bundle', 'audio-index zhcnBundles');
  }

  const indexed = [
    ...((asset && asset.zhcnBundles) || []),
    ...((asset && asset.prefabBundles) || []),
  ];
  for (const n of indexed) {
    for (const sib of siblingAudioBundles(n, winNames)) {
      add(sib, 'sibling_audio_bundle', 'same family as ' + path.basename(n));
    }
  }

  for (const n of (asset && asset.prefabBundles) || []) {
    const kind = bundleKind(n);
    if (kind === 'audio') add(n, 'indexed_audio_bundle', 'audio-index prefabBundles (audio)');
    else if (kind === 'content') add(n, 'indexed_content_bundle', 'audio-index prefabBundles (content)');
    else add(n, 'indexed_prefab_bundle', 'audio-index prefabBundles');
  }

  for (const n of indexed) {
    for (const rel of hashRelatedAudioBundles(n, winNames)) {
      add(rel, 'hash_related_audio', 'hash ' + hashFromBundleName(n));
    }
  }

  if (music) {
    for (const n of ctx.musicCatalogNames || []) {
      const l = String(n).toLowerCase();
      if (l.includes('soundlegend')) add(n, 'soundlegend_audio_bundle', 'soundlegend catalog');
      else add(n, 'music_catalog_bundle', 'heromusic/musicexpansion catalog');
    }
  }

  out.sort((a, b) => b.priority - a.priority || a.bundleName.localeCompare(b.bundleName));
  return out;
}

function applyInspectionScore(candidate, inspection) {
  const scored = Object.assign({}, candidate);
  scored.inspection = inspection || null;
  scored.score = (candidate.priority || 0) + scoreInspection(inspection);
  scored.valid = !!(
    inspection
    && inspection.clipFound
    && inspection.fsbFound
    && inspection.offsetValid
    && inspection.decode === 'success'
  );
  return scored;
}

function pickWinner(scored) {
  const ok = (scored || []).filter((c) => c.valid);
  ok.sort((a, b) => b.score - a.score || b.priority - a.priority);
  return ok[0] || null;
}

function isBoundaryError(err) {
  const msg = err && err.message ? String(err.message) : String(err || '');
  return /out of boundary|invalid source|cannot find resource/i.test(msg);
}

module.exports = {
  FAILURE,
  clipNameMatches,
  normalizeGuid,
  parseSoundDefWavRefs,
  pickSoundDefClipGuid,
  clipObjectMatches,
  isMusicClipName,
  bundleKind,
  familyPrefix,
  siblingAudioBundles,
  hashRelatedAudioBundles,
  basePriority,
  scoreInspection,
  classifyFromInspections,
  listCandidates,
  applyInspectionScore,
  pickWinner,
  isBoundaryError,
  candidateRecord,
};
