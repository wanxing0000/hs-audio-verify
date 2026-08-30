function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function parseCardId(query) {
  const raw = query && (query.id || query.cardId);
  const id = String(raw || '').trim();
  return id || 'BOT_548';
}

function cardDisplayName(cardId) {
  if (cardId === 'EX1_116') return '火车王里诺艾';
  if (cardId === 'BOT_548') return '奇利亚斯';
  return cardId;
}

function audioEndpoints(apiBase, cardId) {
  const base = trimSlash(apiBase);
  const id = encodeURIComponent(cardId);
  return {
    health: base + '/api/mini/health',
    voice: base + '/api/audio/voice/' + id + '/play',
    music: base + '/api/audio/music/' + id,
    entrance: base + '/api/audio/entrance/' + id,
    tone: base + '/api/audio-test/tone.wav',
  };
}

function makeSessionId(testId) {
  return '1.3.8-' + testId + '-' + Date.now().toString(36);
}

function ctxSnapshot(ctx) {
  if (!ctx) return {};
  const out = {};
  try { out.currentTime = ctx.currentTime; } catch (e) {}
  try { out.duration = ctx.duration; } catch (e) {}
  try { out.paused = ctx.paused; } catch (e) {}
  try { out.src = ctx.src; } catch (e) {}
  try { out.buffered = ctx.buffered; } catch (e) {}
  try { out.volume = ctx.volume; } catch (e) {}
  return out;
}

function makeLogEntry(event, extra) {
  return Object.assign({
    time: new Date().toISOString(),
    event: event,
  }, extra || {});
}

function classifyPlayVerdict(events) {
  const list = events || [];
  const hasPlay = list.some((e) => e.event === 'play');
  const hasProgress = list.some((e) => (
    e.event === 'timeUpdate'
    && (Number(e.currentTime) > 0 || Number(e.duration) > 0)
  ));
  const hasError = list.some((e) => e.event === 'error');
  if (hasPlay && hasProgress) return 'PLAYING_CONFIRMED';
  if (hasPlay) return 'PLAY_STARTED';
  if (hasError && !hasPlay) return 'PLAY_NEVER_STARTED';
  if (hasError) return 'ERROR';
  return 'INCOMPLETE';
}

function classifyDownload(rec) {
  if (!rec) return 'DOWNLOAD_HTTP_FAILED';
  if (rec.ok && Number(rec.statusCode) === 200 && rec.tempFilePath) return 'DOWNLOAD_OK';
  return 'DOWNLOAD_HTTP_FAILED';
}

function formatClipboardReport(state) {
  state = state || {};
  const env = state.env || {};
  const tests = state.tests || {};
  const order = ['A', 'B', 'C', 'D', 'E', 'F1', 'F2'];
  const lines = [
    '================================',
    'Audio Diagnostic 1.3.8',
    '================================',
    '',
    'Card:',
    state.cardId || '',
    '',
    'Name:',
    state.cardName || '',
    '',
    'API:',
    state.apiBase || '',
    '',
    'Environment:',
    'platform: ' + (env.platform || ''),
    'system: ' + (env.system || ''),
    'version: ' + (env.version || ''),
    'SDKVersion: ' + (env.SDKVersion || ''),
    'model: ' + (env.model || ''),
    'networkType: ' + (env.networkType || ''),
  ];
  order.forEach(function (id) {
    const t = tests[id];
    if (!t) return;
    lines.push('');
    lines.push('--------------------------------');
    lines.push('TEST ' + id);
    lines.push('--------------------------------');
    lines.push('Mode:');
    lines.push(t.mode || '');
    if (t.url) {
      lines.push('URL:');
      lines.push(t.url);
    }
    if (t.download) {
      lines.push('Download:');
      lines.push('statusCode: ' + t.download.statusCode);
      lines.push('tempFilePath: ' + (t.download.tempFilePath || ''));
      lines.push('fileSize: ' + (t.download.fileSize == null ? '' : t.download.fileSize));
      lines.push('downloadResult: ' + (t.download.result || ''));
    }
    if (t.fileInfo) {
      lines.push('FileInfo:');
      lines.push(JSON.stringify(t.fileInfo));
    }
    lines.push('Result:');
    lines.push(t.result || '');
    lines.push('Events:');
    lines.push(JSON.stringify(t.events || [], null, 2));
  });
  lines.push('');
  lines.push('================================');
  lines.push('Conclusion');
  lines.push('================================');
  lines.push('');
  lines.push('Observed facts:');
  order.forEach(function (id) {
    if (tests[id] && tests[id].result) lines.push('TEST ' + id + ' = ' + tests[id].result);
  });
  lines.push('');
  lines.push('Possible interpretation:');
  lines.push('(manual — do not auto-guess)');
  lines.push('');
  lines.push('Not proven:');
  lines.push('(manual)');
  lines.push('');
  lines.push('User observation:');
  lines.push(state.userObservation || '');
  return lines.join('\n');
}

module.exports = {
  trimSlash,
  parseCardId,
  cardDisplayName,
  audioEndpoints,
  makeSessionId,
  ctxSnapshot,
  makeLogEntry,
  classifyPlayVerdict,
  classifyDownload,
  formatClipboardReport,
};
