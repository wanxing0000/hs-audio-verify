const fs = require('fs');
const path = require('path');
const { mixPcm16 } = require('../music/mixPcm16.js');
const { analyzeWav, compareVoiceStartInMix, classifyEntranceLayer } = require('./audioIntegrity.js');
const { UnifiedAudioRepo } = require('../miniprogram/unifiedAudioRepo.js');
const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
const { AudioCache } = require('../services/audioCache.js');
const { AudioService } = require('../services/audioService.js');

const ROOT = process.cwd();

const VARIANTS = [
  { file: 'entrance-current.wav', opts: { musicVolume: 1, voiceVolume: 1, voiceDelayMs: 0, leadingPaddingMs: 0, targetRate: 48000 } },
  { file: 'entrance-music70.wav', opts: { musicVolume: 0.7, voiceVolume: 1, voiceDelayMs: 0, leadingPaddingMs: 0, targetRate: 48000 } },
  { file: 'entrance-music55.wav', opts: { musicVolume: 0.55, voiceVolume: 1, voiceDelayMs: 0, leadingPaddingMs: 0, targetRate: 48000 } },
  { file: 'entrance-voice50.wav', opts: { musicVolume: 1, voiceVolume: 1, voiceDelayMs: 50, leadingPaddingMs: 0, targetRate: 48000 } },
  { file: 'entrance-voice100.wav', opts: { musicVolume: 1, voiceVolume: 1, voiceDelayMs: 100, leadingPaddingMs: 0, targetRate: 48000 } },
  { file: 'entrance-padding50.wav', opts: { musicVolume: 1, voiceVolume: 1, voiceDelayMs: 0, leadingPaddingMs: 50, targetRate: 48000 } },
];

function loadServices() {
  const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
  const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
  const musicAssets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'music-assets.json'), 'utf8'));
  const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
  const cache = new AudioCache({
    audioDir: path.join(ROOT, 'tmp', 'audio'),
    musicDir: path.join(ROOT, 'tmp', 'music'),
    previewDir: path.join(ROOT, 'tmp', 'preview'),
  });
  const extractor = new HearthstoneAudioExtractor({
    cacheDir: path.join(ROOT, 'tmp', 'audio'),
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
  });
  const audioService = new AudioService({ repo, extractor, cache });
  return { unified, repo, audioService };
}

function copyOut(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

async function generateForCard(cardId, services) {
  const dir = path.join(ROOT, 'tmp', 'audio-verification', cardId);
  fs.mkdirSync(dir, { recursive: true });
  const { repo, audioService } = services;
  const card = repo.getCard(cardId);
  const result = {
    cardId,
    name: card && card.name,
    voicePath: null,
    musicPath: null,
    voiceAnalysis: null,
    musicAnalysis: null,
    currentMixAnalysis: null,
    compare: null,
    layer: 'Unresolved',
    variants: [],
    error: null,
  };
  if (!card) {
    result.error = 'not_in_catalog';
    return result;
  }

  let voiceBuf = null;
  let musicBuf = null;
  if (card.tracks.play.available) {
    const voice = await audioService.getVoiceAudio(cardId, 'play');
    const dest = path.join(dir, 'voice-original.wav');
    copyOut(voice.path, dest);
    result.voicePath = dest;
    voiceBuf = fs.readFileSync(dest);
    result.voiceAnalysis = analyzeWav(voiceBuf);
  }
  if (card.tracks.music.available) {
    const music = await audioService.getMusicAudio(cardId);
    const dest = path.join(dir, 'music-original.wav');
    copyOut(music.path, dest);
    result.musicPath = dest;
    musicBuf = fs.readFileSync(dest);
    result.musicAnalysis = analyzeWav(musicBuf);
  }

  if (voiceBuf && musicBuf) {
    for (const variant of VARIANTS) {
      const mixed = mixPcm16(musicBuf, voiceBuf, variant.opts);
      const dest = path.join(dir, variant.file);
      fs.writeFileSync(dest, mixed.wav);
      const analysis = analyzeWav(mixed.wav);
      const compare = compareVoiceStartInMix(musicBuf, voiceBuf, mixed.wav, {
        voiceDelayMs: variant.opts.voiceDelayMs,
        leadingPaddingMs: variant.opts.leadingPaddingMs,
      });
      result.variants.push({
        file: variant.file,
        opts: variant.opts,
        analysis,
        compare,
        disclaimer: 'preview optimization experiment, not official Hearthstone mix timing',
      });
      if (variant.file === 'entrance-current.wav') {
        result.currentMixAnalysis = analysis;
        result.compare = compareVoiceStartInMix(musicBuf, voiceBuf, mixed.wav, {
          voiceDelayMs: variant.opts.voiceDelayMs,
          leadingPaddingMs: variant.opts.leadingPaddingMs,
          windowMs: 200,
        });
        result.layer = classifyEntranceLayer(result.voiceAnalysis, result.compare);
      }
    }
  } else {
    result.layer = voiceBuf ? 'voice_only' : (musicBuf ? 'music_only' : 'no_audio');
  }
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(result, null, 2));
  return result;
}

function pickThirdLegendary(unified) {
  const skip = new Set(['EX1_116', 'BOT_548']);
  const ids = Object.keys(unified.cards).filter((id) => {
    const c = unified.cards[id];
    return c
      && c.collectible === true
      && c.type === 'MINION'
      && c.rarity === 'LEGENDARY'
      && c.voice && c.voice.play && (c.voice.play.status === 'available' || c.voice.play.status === 'shared')
      && c.music && (c.music.status === 'available' || c.music.status === 'shared')
      && !skip.has(id);
  }).sort();
  return ids.includes('EX1_572') ? 'EX1_572' : ids[0];
}

async function main() {
  const idsArg = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const services = loadServices();
  const third = pickThirdLegendary(services.unified);
  const ids = idsArg.length ? idsArg : ['EX1_116', 'BOT_548', third];
  const out = { generatedAt: new Date().toISOString(), cards: [] };
  for (const id of ids) {
    console.log('[verify] extract', id);
    out.cards.push(await generateForCard(id, services));
  }
  const dest = path.join(ROOT, 'tmp', 'audio-verification', 'summary.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    ok: true,
    ids,
    layers: out.cards.map((c) => ({ cardId: c.cardId, layer: c.layer, leadingSilenceMs: c.voiceAnalysis && c.voiceAnalysis.leadingSilenceMs })),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
