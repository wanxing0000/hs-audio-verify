const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadProjectEnv, tryCreateSupabaseAdmin } = require('../services/supabaseClient.js');

loadProjectEnv(process.cwd());
const { applyAdminCors, dispatchAdminRequest } = require('../services/adminAuth.js');
const { tryHandleAdminStatic } = require('./adminStatic.js');
const {
  createFeedbackService,
  createSupabaseFeedbackStore,
  createIpRateLimiter,
} = require('../services/feedbackService.js');
const {
  applyFeedbackCors,
  createPublicFeedbackHandler,
  createFeedbackHandlers,
} = require('../services/feedbackAdmin.js');
const { loadLatestRuntime, createLatestSetRuntime } = require('../services/latestSetRuntime.js');
const { createLatestSetsHandlers, createSupabaseLatestSetsDeps } = require('../services/latestSetsAdmin.js');
const { createDataUpdateHandlers, createSupabaseDataUpdateDeps } = require('../services/dataUpdateAdmin.js');
const { UnifiedAudioRepo } = require('./unifiedAudioRepo.js');
const {
  buildCatalog,
  searchCardsPage,
  catalogPage,
  featuredCards,
  publicDetail,
  classFilters,
  rarityFilters,
  loadLatestSetConfig,
  latestCardsPage,
  filterLatestCards,
  parseLatestSetConfig,
} = require('./catalogAdapter.js');
const { getCardAudioAvailability } = require('./audioAvailability.js');
const { AudioCache } = require('../services/audioCache.js');
const { AudioService, audioErrorHttpStatus, audioErrorBody } = require('../services/audioService.js');
const { EntrancePreviewService } = require('../services/entrancePreviewService.js');
const {
  resolveAudioSourceMode,
  isProductionAudioSource,
  resolveAudioDirs,
  createProductionExtractorGuard,
} = require('../services/audioSourceMode.js');
const {
  loadProductionAudioInventory,
  applyProductionToCatalog,
  applyProductionToPublicDetail,
} = require('../services/productionAudioAvailability.js');
const {
  resolveMiniListen,
  listLanIpv4,
  preferredLanUrl,
  healthPayload,
  printMiniBanner,
  writeLanApiBaseFile,
  writeLastLanUrl,
  probeThisPcHealth,
  formatFirewallHints,
} = require('./lanListen.js');

const ROOT = process.cwd();
const { host: HOST, port: PORT } = resolveMiniListen(process.env);

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readJsonBody(req, limit) {
  limit = limit || 65536;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('too large');
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        const err = new Error('invalid json');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// In-process only. Server restart clears rate limit state.
const feedbackLimiter = createIpRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

function send(res, status, body, headers, skipCors) {
  if (!skipCors) cors(res);
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, headers || { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function sendWav(res, result) {
  const data = fs.readFileSync(result.path);
  return send(res, 200, data, {
    'Content-Type': 'audio/wav',
    'Content-Length': String(data.length),
    'Cache-Control': 'private, max-age=86400',
  });
}

function sendAudioError(res, e, debug) {
  const body = audioErrorBody(e);
  if (debug && e && e.causeMessage) {
    body.cause = String(e.causeMessage).replace(/[A-Za-z]:\\[^\s"'\\]+/g, '[path]');
  }
  return send(res, audioErrorHttpStatus(e && e.code), body);
}

function isDebug(url) {
  return url.searchParams.get('debug') === '1';
}

let audioSourceMode;
try {
  audioSourceMode = resolveAudioSourceMode(process.env.HS_AUDIO_SOURCE);
} catch (e) {
  console.error('[mini]', e.message);
  process.exit(1);
}
const audioDirs = resolveAudioDirs(ROOT, audioSourceMode);
console.log('[mini] audio source:', audioSourceMode);
console.log('[mini] loading card-audio-index.json (no Hearthstone scan)...');
const t0 = Date.now();
let unified = loadJson(path.join(ROOT, 'data', 'index', 'card-audio-index.json'));
let audioIndex = loadJson(path.join(ROOT, 'data', 'index', 'audio-index.json'));
let musicAssets = loadJson(path.join(ROOT, 'data', 'index', 'music-assets.json'));
let catalog = buildCatalog(unified);
const productionInventory = isProductionAudioSource(audioSourceMode)
  ? loadProductionAudioInventory(audioDirs.packageDir)
  : null;
if (productionInventory) catalog = applyProductionToCatalog(catalog, productionInventory);
function loadLatestSetJsonFallback() {
  return loadLatestSetConfig(path.join(ROOT, 'data', 'index', 'latest-set.json'));
}
let latestRuntime = createLatestSetRuntime();
const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);
const cache = new AudioCache({
  audioDir: audioDirs.audioDir,
  musicDir: audioDirs.musicDir,
  previewDir: audioDirs.previewDir,
});
let extractor;
if (isProductionAudioSource(audioSourceMode)) {
  extractor = createProductionExtractorGuard();
} else {
  const { HearthstoneAudioExtractor } = require('../explorer/HearthstoneAudioExtractor.js');
  extractor = new HearthstoneAudioExtractor({
    cacheDir: audioDirs.audioDir,
    getVoiceAsset: (key) => repo.getVoiceAsset(key),
  });
}
const audioService = new AudioService({ repo, extractor, cache, sourceMode: audioSourceMode });
const entrance = new EntrancePreviewService({ repo, audioService, cache, sourceMode: audioSourceMode });
const supabaseBoot = tryCreateSupabaseAdmin();
if (supabaseBoot.ok) {
  console.log('[mini] supabase client initialized');
} else {
  console.log('[mini] supabase not configured');
}
console.log('[mini] ready', Date.now() - t0, 'ms', catalog.cards.length, 'publishable cards');

function reloadCatalogFromDisk() {
  unified = loadJson(path.join(ROOT, 'data', 'index', 'card-audio-index.json'));
  audioIndex = loadJson(path.join(ROOT, 'data', 'index', 'audio-index.json'));
  musicAssets = loadJson(path.join(ROOT, 'data', 'index', 'music-assets.json'));
  catalog = buildCatalog(unified);
  if (productionInventory) catalog = applyProductionToCatalog(catalog, productionInventory);
  repo.reload(unified, audioIndex, musicAssets);
  return catalog;
}

function getLatestSetCode() {
  const cfg = latestRuntime && typeof latestRuntime.getLatestSetConfig === 'function'
    ? latestRuntime.getLatestSetConfig()
    : null;
  if (cfg && cfg.set) return cfg.set;
  try {
    const fallback = loadLatestSetJsonFallback();
    return fallback && fallback.set ? fallback.set : null;
  } catch (e) {
    return null;
  }
}

function adminStatusSnapshot() {
  let latestSet = null;
  let latestCount = 0;
  const latestSetConfig = latestRuntime.getLatestSetConfig();
  const latestSetLoadError = latestRuntime.getLatestSetError();
  if (latestSetConfig && !latestSetLoadError) {
    try {
      const page = latestCardsPage(catalog.cards, latestSetConfig, { page: 1, pageSize: 1 });
      latestSet = page.set;
      latestCount = page.total;
    } catch (e) {
      latestSet = null;
      latestCount = 0;
    }
  }
  return {
    miniOk: true,
    catalogCount: catalog.cards.length,
    latestSet: latestSet,
    latestCount: latestCount,
    supabaseConnected: !!(supabaseBoot && supabaseBoot.ok),
  };
}

let latestSetsHandle = async function () {
  return {
    handled: true,
    status: 503,
    body: { ok: false, error: '操作失败，请检查服务器状态。', code: 'ADMIN_DB_UNAVAILABLE' },
  };
};

let dataUpdateHandle = async function () {
  return {
    handled: true,
    status: 503,
    body: { ok: false, error: '操作失败，请检查服务器状态。', code: 'ADMIN_DB_UNAVAILABLE' },
  };
};

let feedbackHandle = async function () {
  return {
    handled: true,
    status: 503,
    body: { ok: false, error: '反馈服务暂不可用', code: 'FEEDBACK_UNAVAILABLE' },
  };
};

let publicFeedbackHandle = createPublicFeedbackHandler(null);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const isAdmin = url.pathname.startsWith('/api/admin/');
    const isPublicFeedback = url.pathname === '/api/feedback';
    if (isAdmin) applyAdminCors(res);
    else if (isPublicFeedback) applyFeedbackCors(res);
    else cors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (isPublicFeedback) {
      let body;
      if (req.method === 'POST') {
        try {
          body = await readJsonBody(req);
        } catch (e) {
          if (e && e.code === 'PAYLOAD_TOO_LARGE') {
            return send(res, 413, { ok: false, error: '请求过大', code: 'PAYLOAD_TOO_LARGE' }, null, true);
          }
          return send(res, 400, { ok: false, error: '请求格式不正确', code: 'INVALID_JSON' }, null, true);
        }
      }
      const result = await publicFeedbackHandle(req, url, { body: body });
      if (!result || !result.handled) return send(res, 404, { error: 'not found' }, null, true);
      if (result.status === 204) {
        res.writeHead(204);
        return res.end();
      }
      return send(res, result.status, result.body, null, true);
    }

    if (isAdmin) {
      let body;
      if (req.method === 'POST' || req.method === 'PATCH') {
        try {
          body = await readJsonBody(req);
        } catch (e) {
          if (e && e.code === 'PAYLOAD_TOO_LARGE') {
            return send(res, 413, { ok: false, error: '请求过大', code: 'PAYLOAD_TOO_LARGE' }, null, true);
          }
          return send(res, 400, { ok: false, error: '请求格式不正确', code: 'INVALID_JSON' }, null, true);
        }
      }
      const result = await dispatchAdminRequest(req, url, {
        getStatus: adminStatusSnapshot,
        handleLatestSets: latestSetsHandle,
        handleDataUpdate: dataUpdateHandle,
        handleFeedback: feedbackHandle,
        body: body,
      });
      if (result.status === 204) {
        res.writeHead(204);
        return res.end();
      }
      return send(res, result.status, result.body, null, true);
    }

    if (tryHandleAdminStatic(req, url, res, ROOT, process.env)) return;

    if (req.method === 'GET' && url.pathname === '/api/mini/health') {
      return send(res, 200, Object.assign({}, healthPayload(HOST, PORT), {
        audioSource: audioSourceMode,
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/mini/manifest') {
      const hostHeader = req.headers && req.headers.host;
      return send(res, 200, {
        name: '炉石传说 · 卡牌语音图鉴',
        schemaVersion: catalog.schemaVersion,
        clientVersion: catalog.clientVersion,
        locale: catalog.locale,
        cardCount: catalog.cards.length,
        audioBase: hostHeader ? 'http://' + hostHeader : 'http://127.0.0.1:' + PORT,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/mini/filters') {
      return send(res, 200, {
        classes: classFilters(),
        rarities: rarityFilters(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/mini/featured') {
      return send(res, 200, { results: featuredCards(catalog.cards, { limit: 12 }) });
    }

    if (req.method === 'GET' && url.pathname === '/api/mini/latest') {
      const latestSetConfig = latestRuntime.getLatestSetConfig();
      const latestSetLoadError = latestRuntime.getLatestSetError();
      const latestReason = latestRuntime.getReason();
      if (latestSetLoadError || !latestSetConfig) {
        if (latestReason === 'DB_NO_CURRENT') {
          return send(res, 500, {
            error: '尚未设置最新扩展包',
            code: 'LATEST_SET_NOT_CONFIGURED',
          });
        }
        return send(res, 500, {
          error: '最新扩展包配置无效',
          code: 'LATEST_SET_CONFIG_INVALID',
        });
      }
      try {
        const page = latestCardsPage(catalog.cards, latestSetConfig, {
          page: url.searchParams.get('page'),
          pageSize: url.searchParams.get('pageSize'),
        });
        return send(res, 200, page);
      } catch (e) {
        if (e && e.code === 'LATEST_SET_CONFIG_INVALID') {
          return send(res, 500, {
            error: e.userMessage || '最新扩展包配置无效',
            code: 'LATEST_SET_CONFIG_INVALID',
          });
        }
        throw e;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/mini/catalog') {
      const page = catalogPage(catalog.cards, {
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
        classFilter: url.searchParams.get('class') || 'ALL',
        rarityFilter: url.searchParams.get('rarity') || 'ALL',
        legendaryMusic: url.searchParams.get('legendaryMusic') === '1',
      });
      return send(res, 200, {
        schemaVersion: catalog.schemaVersion,
        clientVersion: catalog.clientVersion,
        items: page.items,
        results: page.items,
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        hasMore: page.hasMore,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/mini/search') {
      const page = searchCardsPage(catalog.cards, url.searchParams.get('q') || '', {
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize') || url.searchParams.get('limit'),
        classFilter: url.searchParams.get('class') || 'ALL',
        rarityFilter: url.searchParams.get('rarity') || 'ALL',
        legendaryMusic: url.searchParams.get('legendaryMusic') === '1',
      });
      return send(res, 200, {
        items: page.items,
        results: page.items,
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        hasMore: page.hasMore,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/mini/card/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/mini/card/'.length));
      const card = catalog.byId[id];
      if (!card) return send(res, 404, { error: '没有找到相关卡牌' });
      const raw = unified.cards[id];
      const diag = getCardAudioAvailability(raw, audioIndex.clips);
      let body = publicDetail(card, diag);
      if (productionInventory) body = applyProductionToPublicDetail(body, productionInventory);
      if (isDebug(url)) body.debug = card;
      return send(res, 200, body);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/audio/voice/')) {
      const rest = decodeURIComponent(url.pathname.slice('/api/audio/voice/'.length));
      const [cardId, type] = rest.split('/');
      try {
        return sendWav(res, await audioService.getVoiceAudio(cardId, type, { debug: isDebug(url) }));
      } catch (e) {
        return sendAudioError(res, e, isDebug(url));
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/audio/music/')) {
      const cardId = decodeURIComponent(url.pathname.slice('/api/audio/music/'.length));
      try {
        return sendWav(res, await audioService.getMusicAudio(cardId, { debug: isDebug(url) }));
      } catch (e) {
        return sendAudioError(res, e, isDebug(url));
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/audio/entrance/')) {
      const cardId = decodeURIComponent(url.pathname.slice('/api/audio/entrance/'.length));
      const card = repo.getCard(cardId);
      if (!card || !card.entrancePreview || !card.entrancePreview.available) {
        const err = new Error('暂无完整登场音频');
        err.code = 'UNAVAILABLE';
        err.userMessage = '暂无完整登场音频';
        return sendAudioError(res, err);
      }
      try {
        return sendWav(res, await entrance.getEntrancePreview(cardId));
      } catch (e) {
        return sendAudioError(res, e, isDebug(url));
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/audio-test/tone.wav') {
      const tonePath = path.join(ROOT, 'test', 'assets', 'test-tone-44100-mono.wav');
      if (!fs.existsSync(tonePath)) return send(res, 404, { error: 'test tone missing' });
      return sendWav(res, { path: tonePath });
    }

    if (req.method === 'GET' && url.pathname === '/api/audio/health') {
      return send(res, 200, { ok: true, hearthstoneReadOnly: true, bulkExport: false });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: '暂时无法播放' });
  }
});

async function bootAndListen() {
  latestRuntime = await loadLatestRuntime({
    parseLatestSetConfig: parseLatestSetConfig,
    loadLatestSetConfig: function () {
      return loadLatestSetJsonFallback();
    },
    jsonPath: path.join(ROOT, 'data', 'index', 'latest-set.json'),
    client: supabaseBoot.client,
  });
  const src = latestRuntime.getSource();
  const reason = latestRuntime.getReason();
  const cfg = latestRuntime.getLatestSetConfig();
  if (cfg) {
    console.log('[mini] latest source=' + src + (reason ? ' reason=' + reason : '') + ' set=' + cfg.set);
  } else {
    console.log('[mini] latest unavailable source=' + src + (reason ? ' reason=' + reason : ''));
  }
  if (supabaseBoot.client) {
    const deps = createSupabaseLatestSetsDeps({
      client: supabaseBoot.client,
      getCatalogCards: function () { return catalog.cards; },
      runtime: latestRuntime,
      parseLatestSetConfig: parseLatestSetConfig,
      filterLatestCards: filterLatestCards,
    });
    latestSetsHandle = createLatestSetsHandlers(deps).handle;
    const dataDeps = createSupabaseDataUpdateDeps({
      client: supabaseBoot.client,
      rootDir: ROOT,
      reloadCatalog: reloadCatalogFromDisk,
      getLatestSetCode: getLatestSetCode,
      miniPort: PORT,
    });
    dataUpdateHandle = createDataUpdateHandlers(dataDeps).handle;
    const feedbackService = createFeedbackService(
      createSupabaseFeedbackStore(supabaseBoot.client),
      { limiter: feedbackLimiter },
    );
    async function writeFeedbackLog(entry) {
      const r = await supabaseBoot.client.from('admin_logs').insert(entry);
      if (r.error) throw r.error;
    }
    feedbackHandle = createFeedbackHandlers({
      service: feedbackService,
      writeLog: writeFeedbackLog,
    }).handle;
    publicFeedbackHandle = createPublicFeedbackHandler(feedbackService);
  }
  server.listen(PORT, HOST, () => {
    const lan = listLanIpv4();
    const primaryLan = preferredLanUrl(PORT);
    printMiniBanner({ host: HOST, port: PORT, lan: lan, primaryLan: primaryLan });
    if (process.env.MINI_SKIP_LAN_WRITE !== '1' && !isProductionAudioSource(audioSourceMode)) {
      writeLanApiBaseFile(path.join(ROOT, 'miniprogram', 'utils', 'apiBase.lan.js'), primaryLan);
      writeLastLanUrl(path.join(ROOT, 'data', 'mini-preview', 'last-lan-url.txt'), primaryLan);
    }
    probeThisPcHealth(PORT, lan.preferred[0]).then((probe) => {
      console.log(formatFirewallHints(PORT, lan.preferred[0], probe));
    });
  });
}
bootAndListen().catch((e) => {
  console.error(e);
  process.exit(1);
});
