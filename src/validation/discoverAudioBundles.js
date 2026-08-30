const fs = require('fs');
const path = require('path');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
const resolver = require('../explorer/audioBundleResolver.js');

const ROOT = process.cwd();

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const out = { cardId: null, debug: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cardId' && argv[i + 1]) out.cardId = argv[++i];
    else if (argv[i] === '--debug') out.debug = true;
  }
  return out;
}

function summarizeInspection(inspection) {
  return {
    bundle: inspection.bundle,
    reason: inspection.reason,
    clipFound: !!inspection.clipFound,
    fsbFound: !!inspection.fsbFound,
    offset: inspection.offset,
    size: inspection.size,
    offsetValid: !!inspection.offsetValid,
    decode: inspection.decode || null,
    error: inspection.error || null,
    valid: !!inspection.valid,
    via: inspection.via || null,
    magic: inspection.magic || null,
  };
}

async function discoverCard(cardId, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const unified = loadJson(path.join(ROOT, 'data', 'index', 'card-audio-index.json'));
  const audioIndex = loadJson(path.join(ROOT, 'data', 'index', 'audio-index.json'));
  const musicAssets = loadJson(path.join(ROOT, 'data', 'index', 'music-assets.json'));
  const loadMs = Date.now() - t0;
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
  const raw = unified.cards[cardId];
  if (!raw) {
    return { cardId, error: 'card not in index', failureClass: resolver.FAILURE.NO_DATA };
  }
  const extractor = new HearthstoneAudioExtractor({
    cacheDir: path.join(ROOT, 'tmp', 'audio'),
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
  });

  async function discoverSlot(label, clipName, isMusic, slotOpts) {
    slotOpts = slotOpts || {};
    const tResolve = Date.now();
    if (!clipName) {
      return {
        slot: label,
        clipName: null,
        failureClass: resolver.FAILURE.NO_DATA,
        candidateBundles: [],
      };
    }
    const asset = repo.getVoiceAsset(clipName);
    const candidates = extractor.resolveCandidates(asset, clipName);
    const resolveMs = Date.now() - tResolve;
    const tInspect = Date.now();
    const inspected = [];
    let audioClipGuid = null;
    if (isMusic && slotOpts.prefabGuid && slotOpts.prefabBundle) {
      audioClipGuid = await extractor.recoverSoundDefClipGuid(slotOpts.prefabBundle, slotOpts.prefabGuid, clipName);
    }
    for (const candidate of candidates) {
      const inspection = await extractor.inspectCandidate(candidate, clipName, {
        decode: true,
        audioClipGuid,
      });
      extractor.debugLog({ debug: opts.debug }, {
        cardId,
        asset: clipName,
        candidate: candidate.bundleName,
        reason: candidate.reason,
        clipFound: inspection.clipFound,
        fsbFound: inspection.fsbFound,
        offset: inspection.offset,
        size: inspection.size,
        offsetValid: inspection.offsetValid,
        decodeResult: inspection.decode,
      });
      inspected.push(resolver.applyInspectionScore(candidate, inspection));
      if (inspection.valid && inspection.decode === 'success') break;
    }
    const inspectMs = Date.now() - tInspect;
    const winner = resolver.pickWinner(inspected);
    return {
      slot: label,
      clipName,
      indexed: !!(asset && asset.indexed),
      zhcnBundles: (asset && asset.zhcnBundles) || [],
      prefabBundles: (asset && asset.prefabBundles) || [],
      candidateBundles: inspected.map((c) => summarizeInspection(c.inspection)),
      winner: winner ? {
        bundle: winner.bundleName,
        reason: winner.reason,
        score: winner.score,
        offset: winner.inspection && winner.inspection.offset,
        size: winner.inspection && winner.inspection.size,
      } : null,
      failureClass: winner ? null : resolver.classifyFromInspections(inspected.map((c) => c.inspection), {
        indexMissing: !(asset && asset.indexed),
      }),
      timings: { resolveMs, inspectMs },
    };
  }

  const play = raw.voice && raw.voice.play;
  const music = repo.getMusicMeta(cardId);
  const tExtract = Date.now();
  const voice = await discoverSlot('Play', play && play.voiceKey, false);
  const musicOut = await discoverSlot('Music', music && music.audioClip, true, {
    prefabGuid: music && music.prefabGuid,
    prefabBundle: music && music.bundle,
  });
  return {
    cardId,
    name: raw.name,
    type: raw.type,
    loadMs,
    extractMs: Date.now() - tExtract,
    totalMs: Date.now() - t0,
    voice: {
      voiceKey: play && play.voiceKey || null,
      sourceCardId: play && play.sourceCardId || null,
      status: play && play.status || null,
      ...voice,
    },
    music: {
      musicAssetId: raw.music && raw.music.musicAssetId || null,
      audioClip: music && music.audioClip || null,
      status: raw.music && raw.music.status || null,
      sourceCardId: raw.music && raw.music.sourceCardId || null,
      ...musicOut,
    },
  };
}

async function runDiscover(argv) {
  const args = parseArgs(argv);
  if (!args.cardId) {
    console.error('usage: npm run discover:audio-bundles -- --cardId EX1_414');
    process.exit(1);
  }
  const out = await discoverCard(args.cardId, args);
  console.log(JSON.stringify(out, null, 2));
  return out;
}

module.exports = { discoverCard, runDiscover, parseArgs };
