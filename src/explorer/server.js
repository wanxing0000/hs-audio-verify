const http = require('http');
const fs = require('fs');
const path = require('path');
const { CardRepository, extrasFromCollectible } = require('../repository/cardRepository.js');
const { HearthstoneAudioExtractor } = require('./HearthstoneAudioExtractor.js');
const { AudioCache } = require('../services/audioCache.js');
const { AudioService } = require('../services/audioService.js');
const { EntrancePreviewService } = require('../services/entrancePreviewService.js');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8766);

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function send(res, status, body, headers) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, headers || { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function sendWav(res, result) {
  const data = fs.readFileSync(result.path);
  return send(res, 200, data, {
    'Content-Type': 'audio/wav',
    'Content-Length': String(data.length),
    'X-Cache': result.cached ? 'hit' : 'miss',
    'X-Extract-Ms': String(result.ms || 0),
    'Cache-Control': 'private, max-age=86400',
  });
}

function sendAudioError(res, e, debug) {
  const code = e.code === 'NO_VOICE' || e.code === 'NO_MUSIC' || e.code === 'UNAVAILABLE' || e.code === 'NOT_INDEXED' ? 404 : 500;
  const body = {
    error: e.userMessage || '暂时无法播放',
    code: e.code || 'EXTRACT_FAILED',
  };
  if (debug && e.causeMessage) body.detail = e.causeMessage;
  return send(res, code, body);
}

function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function loadEnglishNames() {
  const p = path.join(ROOT, 'data', 'explorer', 'en-names.json');
  if (fs.existsSync(p)) return loadJson(p);
  return {};
}

function loadAliases() {
  const p = path.join(ROOT, 'data', 'explorer', 'search-aliases.json');
  if (fs.existsSync(p)) return loadJson(p);
  return { leeroy: ['EX1_116'], 'leeroy jenkins': ['EX1_116'] };
}

function loadMusicIndex() {
  const p = path.join(ROOT, 'data', 'music-verification', 'music-sample-index.json');
  if (!fs.existsSync(p)) return [];
  const raw = loadJson(p);
  return Array.isArray(raw) ? raw : [raw];
}

function loadExtras() {
  const p = path.join(ROOT, 'data', 'hearthstonejson', 'zhCN', 'cards.collectible.json');
  if (!fs.existsSync(p)) return {};
  return extrasFromCollectible(loadJson(p));
}

function isDebug(url) {
  return url.searchParams.get('debug') === '1';
}

function publicTrack(t) {
  if (!t) return t;
  return {
    type: t.type,
    available: t.available,
    playable: t.playable,
    userStatus: t.userStatus,
    sourceNote: t.sourceNote || null,
  };
}

function publicCard(card) {
  return {
    ...card,
    tracks: {
      entrance: publicTrack(card.tracks.entrance),
      play: publicTrack(card.tracks.play),
      attack: publicTrack(card.tracks.attack),
      death: publicTrack(card.tracks.death),
      music: publicTrack(card.tracks.music),
    },
  };
}

console.log('[codex] loading indexes (no Hearthstone scan)...');
const tLoad = Date.now();
const voiceIndex = loadJson(path.join(ROOT, 'data', 'index', 'card-voice-index.json'));
const audioIndex = loadJson(path.join(ROOT, 'data', 'index', 'audio-index.json'));
const repo = new CardRepository({
  voiceIndex,
  audioIndex,
  englishNames: loadEnglishNames(),
  aliases: loadAliases(),
  extras: loadExtras(),
  musicIndex: loadMusicIndex(),
});
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
const entrance = new EntrancePreviewService({ repo, audioService, cache });
console.log('[codex] ready', Date.now() - tLoad, 'ms', repo.getManifest());

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const debug = isDebug(url);

    if (req.method === 'GET' && url.pathname === '/api/manifest') {
      return send(res, 200, repo.getManifest());
    }
    if (req.method === 'GET' && url.pathname === '/api/featured') {
      return send(res, 200, { results: repo.featuredCards() });
    }
    if (req.method === 'GET' && (url.pathname === '/api/cards' || url.pathname === '/api/search')) {
      const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
      if (!q.trim()) return send(res, 200, { total: 0, page: 1, pageSize: 30, results: repo.featuredCards() });
      return send(res, 200, repo.searchCards(q, {
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize') || 30,
      }));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/cards/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/cards/'.length));
      const card = repo.getCard(id);
      if (!card) return send(res, 404, { error: '没有找到相关卡牌' });
      return send(res, 200, debug ? card : publicCard(card));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/card/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/card/'.length));
      const card = repo.getCard(id);
      if (!card) return send(res, 404, { error: '没有找到相关卡牌' });
      return send(res, 200, debug ? card : publicCard(card));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/voice/')) {
      const rest = decodeURIComponent(url.pathname.slice('/api/voice/'.length));
      const [cardId, type] = rest.split('/');
      try {
        return sendWav(res, await audioService.getVoiceAudio(cardId, type));
      } catch (e) {
        return sendAudioError(res, e, debug);
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/entrance/')) {
      const cardId = decodeURIComponent(url.pathname.slice('/api/entrance/'.length));
      try {
        return sendWav(res, await entrance.getEntrancePreview(cardId));
      } catch (e) {
        return sendAudioError(res, e, debug);
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/music/')) {
      const cardId = decodeURIComponent(url.pathname.slice('/api/music/'.length));
      if (cardId.endsWith('.wav')) {
        return send(res, 404, { error: '暂时无法播放' });
      }
      try {
        return sendWav(res, await audioService.getMusicAudio(cardId));
      } catch (e) {
        return sendAudioError(res, e, debug);
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
      const voiceKey = decodeURIComponent(url.pathname.slice('/api/audio/'.length));
      try {
        const out = await extractor.extractVoice(voiceKey);
        return sendWav(res, out);
      } catch (e) {
        e.userMessage = '暂时无法播放';
        return sendAudioError(res, e, debug);
      }
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    let filePath = path.join(PUBLIC, rel);
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (url.pathname === '/' || !url.pathname.includes('.')) {
        filePath = path.join(PUBLIC, 'index.html');
      } else {
        return send(res, 404, 'not found');
      }
    }
    return send(res, 200, fs.readFileSync(filePath), { 'Content-Type': mime(filePath) });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: '暂时无法播放' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[codex] http://127.0.0.1:' + PORT);
  console.log('[codex] 炉石传说 · 卡牌语音图鉴 — Hearthstone is read-only');
});
