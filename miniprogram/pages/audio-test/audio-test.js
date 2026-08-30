const {
  parseCardId,
  cardDisplayName,
  audioEndpoints,
  makeSessionId,
  ctxSnapshot,
  makeLogEntry,
  classifyPlayVerdict,
  classifyDownload,
  formatClipboardReport,
} = require('./diagHelpers.js');
const { getApiBase } = require('../../utils/config.js');

function snapshotEnv() {
  let info = {};
  try {
    info = wx.getSystemInfoSync() || {};
  } catch (e) {
    info = {};
  }
  return {
    platform: info.platform || '',
    system: info.system || '',
    version: info.version || '',
    SDKVersion: info.SDKVersion || '',
    model: info.model || '',
    brand: info.brand || '',
    wifi: info.wifiEnabled != null ? info.wifiEnabled : '',
    environment: info.platform === 'devtools' ? 'devtools' : 'miniprogram',
    networkType: '',
  };
}

Page({
  data: {
    phase: '1.3.8',
    cardId: 'BOT_548',
    cardName: '奇利亚斯',
    apiBase: '',
    endpoints: { health: '', voice: '', music: '', entrance: '', tone: '' },
    env: {},
    isDebug: true,
    logs: [],
    httpChecks: [],
    busy: false,
    sessionId: '',
    lastTest: '',
    lastVerdict: '',
    tests: {},
    lastTempPath: '',
    listenHint: '',
  },

  onLoad(query) {
    const cardId = parseCardId(query);
    const apiBase = getApiBase();
    const env = snapshotEnv();
    this._token = 0;
    this._diagCtx = null;
    this._sessionEvents = [];
    this._tempFiles = [];
    this._timeUpdateCount = 0;
    this._lastTimeLog = 0;
    const self = this;
    this.setData({
      cardId: cardId,
      cardName: cardDisplayName(cardId),
      apiBase: apiBase,
      endpoints: audioEndpoints(apiBase, cardId),
      env: env,
      listenHint: 'Audio Diagnostic 1.3.8 · 一次只跑一个测试 · 不要自动播放',
      tests: {},
    });
    this.pushLog('pageLoad', { cardId: cardId, apiBase: apiBase, phase: '1.3.8' });
    try {
      wx.getNetworkType({
        success: function (res) {
          self.setData({ env: Object.assign({}, self.data.env, { networkType: res.networkType || '' }) });
        },
      });
    } catch (e) {}
  },

  onUnload() {
    this.destroyCtx('unload');
  },

  pushLog(event, extra) {
    const row = makeLogEntry(event, extra);
    if (this.data.sessionId) row.sessionId = this.data.sessionId;
    this._sessionEvents = (this._sessionEvents || []).concat([row]);
    const logs = (this.data.logs || []).concat([row]);
    this.setData({ logs: logs.slice(-120) });
    try { console.log('[audio-test-1.3.8]', row); } catch (e) {}
    return row;
  },

  toastBusy() {
    try {
      wx.showToast({ title: '当前实验正在播放，请先停止', icon: 'none' });
    } catch (e) {}
  },

  beginTest(testId, mode, url) {
    if (this.data.busy) {
      this.toastBusy();
      return false;
    }
    this.destroyCtx('new-test');
    this._token += 1;
    this._sessionEvents = [];
    this._timeUpdateCount = 0;
    this._lastTimeLog = 0;
    this._currentDownload = null;
    this._currentMode = mode;
    this._currentUrl = url;
    const sessionId = makeSessionId(testId);
    this.setData({
      busy: true,
      sessionId: sessionId,
      lastTest: testId,
      lastVerdict: '',
    });
    this.pushLog('testStart', { testId: testId, mode: mode, url: url, sessionId: sessionId });
    return { sessionId: sessionId, token: this._token, testId: testId, mode: mode, url: url };
  },

  finishTest(testId, patch) {
    patch = patch || {};
    const events = (this._sessionEvents || []).slice();
    const result = patch.result || classifyPlayVerdict(events);
    const tests = Object.assign({}, this.data.tests);
    tests[testId] = Object.assign({
      testId: testId,
      sessionId: this.data.sessionId,
      mode: patch.mode || this._currentMode,
      url: patch.url || this._currentUrl,
      events: events,
      result: result,
      download: patch.download || this._currentDownload || undefined,
    }, patch);
    this.setData({
      tests: tests,
      lastVerdict: result,
      busy: false,
    });
    this.pushLog('testEnd', { testId: testId, result: result });
  },

  destroyCtx(reason) {
    const ctx = this._diagCtx;
    if (!ctx) return;
    try { ctx.stop(); } catch (e) {}
    try { ctx.destroy(); } catch (e) {}
    this.pushLog('destroy', { reason: reason || 'replace' });
    this._diagCtx = null;
  },

  bindCtx(ctx, label, token, sessionId) {
    const self = this;
    ctx.autoplay = false;
    try { ctx.obeyMuteSwitch = false; } catch (e) {}
    function alive() {
      return token === self._token && sessionId === self.data.sessionId;
    }
    function snapExtra() {
      return Object.assign({ label: label, sessionId: sessionId }, ctxSnapshot(ctx));
    }
    if (ctx.onCanplay) {
      ctx.onCanplay(function () {
        if (!alive()) return;
        self.pushLog('canplay', snapExtra());
      });
    }
    if (ctx.onPlay) {
      ctx.onPlay(function () {
        if (!alive()) return;
        self.pushLog('play', snapExtra());
      });
    }
    if (ctx.onTimeUpdate) {
      ctx.onTimeUpdate(function () {
        if (!alive()) return;
        const now = Date.now();
        self._timeUpdateCount += 1;
        const extra = snapExtra();
        extra.n = self._timeUpdateCount;
        const early = Number(extra.currentTime) > 0 && Number(extra.currentTime) < 0.25;
        if (self._timeUpdateCount <= 5 || early || now - self._lastTimeLog > 500) {
          self._lastTimeLog = now;
          self.pushLog('timeUpdate', extra);
        }
      });
    }
    if (ctx.onEnded) {
      ctx.onEnded(function () {
        if (!alive()) return;
        self.pushLog('ended', snapExtra());
        self.finishTest(self.data.lastTest, { mode: self._currentMode, url: self._currentUrl });
      });
    }
    if (ctx.onStop) {
      ctx.onStop(function () {
        if (!alive()) return;
        self.pushLog('stop', snapExtra());
      });
    }
    if (ctx.onError) {
      ctx.onError(function (res) {
        if (!alive()) return;
        self.pushLog('error', Object.assign(snapExtra(), {
          errCode: res && res.errCode,
          errMsg: res && (res.errMsg || res.errMessage),
        }));
        self.finishTest(self.data.lastTest, { mode: self._currentMode, url: self._currentUrl });
      });
    }
    return ctx;
  },

  playSrc(label, src, session) {
    this._currentMode = session.mode;
    this._currentUrl = session.url;
    this.pushLog('create', { label: label, sessionId: session.sessionId });
    const ctx = wx.createInnerAudioContext();
    this._diagCtx = this.bindCtx(ctx, label, session.token, session.sessionId);
    this.pushLog('src', { label: label, src: src, sessionId: session.sessionId });
    ctx.src = src;
    this.pushLog('playCall', { label: label, src: src, sessionId: session.sessionId });
    ctx.play();
  },

  playHttp(testId, label, url, mode) {
    const session = this.beginTest(testId, mode, url);
    if (!session) return;
    this.playSrc(label, url, session);
  },

  downloadThenPlay(testId, label, url, mode) {
    const session = this.beginTest(testId, mode, url);
    if (!session) return;
    const self = this;
    this.pushLog('downloadStart', { url: url, sessionId: session.sessionId });
    wx.downloadFile({
      url: url,
      success: function (res) {
        if (session.token !== self._token) return;
        const rec = {
          statusCode: res.statusCode,
          tempFilePath: res.tempFilePath || '',
          errMsg: res.errMsg || '',
          ok: Number(res.statusCode) === 200,
        };
        rec.result = classifyDownload(rec);
        self.pushLog('download', rec);
        if (rec.result !== 'DOWNLOAD_OK') {
          self.finishTest(testId, {
            mode: mode,
            url: url,
            download: rec,
            result: 'DOWNLOAD_HTTP_FAILED',
          });
          return;
        }
        self._tempFiles.push(rec.tempFilePath);
        self.setData({ lastTempPath: rec.tempFilePath });
        self._currentDownload = rec;
        self.playSrc(label, rec.tempFilePath, session);
      },
      fail: function (err) {
        if (session.token !== self._token) return;
        const rec = {
          statusCode: 0,
          tempFilePath: '',
          errMsg: err && err.errMsg,
          ok: false,
          result: 'DOWNLOAD_HTTP_FAILED',
        };
        self.pushLog('downloadFail', rec);
        self.finishTest(testId, {
          mode: mode,
          url: url,
          download: rec,
          result: 'DOWNLOAD_HTTP_FAILED',
        });
      },
    });
  },

  onTestA() {
    this.playHttp('A', 'voice', this.data.endpoints.voice, 'HTTP → InnerAudioContext');
  },

  onTestB() {
    this.playHttp('B', 'entrance', this.data.endpoints.entrance, 'HTTP → InnerAudioContext');
  },

  onTestC() {
    this.downloadThenPlay('C', 'voice', this.data.endpoints.voice, 'downloadFile → tempFilePath → InnerAudioContext');
  },

  onTestD() {
    this.downloadThenPlay('D', 'entrance', this.data.endpoints.entrance, 'downloadFile → tempFilePath → InnerAudioContext');
  },

  onTestE() {
    if (this.data.busy) {
      this.toastBusy();
      return;
    }
    const path = this.data.lastTempPath;
    const session = this.beginTest('E', 'stat tempFilePath', path);
    if (!session) return;
    if (!path) {
      this.pushLog('fileInfo', { result: 'NO_TEMP_FILE' });
      this.finishTest('E', { mode: 'stat tempFilePath', fileInfo: { result: 'NO_TEMP_FILE' }, result: 'NO_TEMP_FILE' });
      return;
    }
    let fsm;
    try {
      fsm = wx.getFileSystemManager();
    } catch (e) {
      this.pushLog('fileInfo', { result: 'NOT_SUPPORTED', errMsg: e && e.message });
      this.finishTest('E', { mode: 'stat tempFilePath', fileInfo: { result: 'NOT_SUPPORTED' }, result: 'NOT_SUPPORTED' });
      return;
    }
    if (!fsm || typeof fsm.stat !== 'function') {
      this.pushLog('fileInfo', { result: 'NOT_SUPPORTED' });
      this.finishTest('E', { mode: 'stat tempFilePath', fileInfo: { result: 'NOT_SUPPORTED' }, result: 'NOT_SUPPORTED' });
      return;
    }
    const self = this;
    fsm.stat({
      path: path,
      success: function (res) {
        const stats = res.stats || res;
        const info = {
          result: 'STAT_OK',
          path: path,
          size: stats.size,
          lastModifiedTime: stats.lastModifiedTime,
        };
        self.pushLog('fileInfo', info);
        self.finishTest('E', { mode: 'stat tempFilePath', fileInfo: info, result: 'STAT_OK' });
      },
      fail: function (err) {
        const info = { result: 'NOT_SUPPORTED', errMsg: err && err.errMsg, path: path };
        self.pushLog('fileInfo', info);
        self.finishTest('E', { mode: 'stat tempFilePath', fileInfo: info, result: 'NOT_SUPPORTED' });
      },
    });
  },

  onTestF1() {
    this.playHttp('F1', 'tone', this.data.endpoints.tone, 'HTTP → test-tone.wav');
  },

  onTestF2() {
    this.downloadThenPlay('F2', 'tone', this.data.endpoints.tone, 'downloadFile → tempFilePath → test-tone.wav');
  },

  onStop() {
    this.destroyCtx('user-stop');
    if (this.data.busy && this.data.lastTest) {
      this.finishTest(this.data.lastTest, {
        mode: this._currentMode,
        url: this._currentUrl,
        download: this._currentDownload,
        result: classifyPlayVerdict(this._sessionEvents),
      });
    }
    this.setData({ busy: false });
  },

  onClearLogs() {
    this._sessionEvents = [];
    this.setData({ logs: [], tests: {}, lastVerdict: '', lastTest: '' });
  },

  onCleanupTemp() {
    const fsm = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    const files = this._tempFiles.slice();
    const self = this;
    if (!fsm || typeof fsm.unlink !== 'function') {
      this.pushLog('cleanup', { result: 'NOT_SUPPORTED', count: files.length });
      return;
    }
    files.forEach(function (p) {
      try {
        fsm.unlink({
          filePath: p,
          success: function () { self.pushLog('cleanup', { path: p, ok: true }); },
          fail: function (err) { self.pushLog('cleanup', { path: p, ok: false, errMsg: err && err.errMsg }); },
        });
      } catch (e) {
        self.pushLog('cleanup', { path: p, result: 'NOT_SUPPORTED' });
      }
    });
    this._tempFiles = [];
    this.setData({ lastTempPath: '' });
  },

  checkOne(name, url) {
    const self = this;
    return new Promise(function (resolve) {
      wx.request({
        url: url,
        method: 'GET',
        timeout: 20000,
        dataType: '其他',
        responseType: 'arraybuffer',
        success: function (res) {
          const headers = res.header || res.headers || {};
          const rec = {
            name: name,
            url: url,
            status: res.statusCode,
            contentType: headers['Content-Type'] || headers['content-type'] || '',
            contentLength: headers['Content-Length'] || headers['content-length'] || '',
            ok: res.statusCode >= 200 && res.statusCode < 300,
          };
          self.pushLog('http', rec);
          resolve(rec);
        },
        fail: function (err) {
          const rec = {
            name: name,
            url: url,
            status: 0,
            contentType: '',
            contentLength: '',
            ok: false,
            errMsg: err && err.errMsg,
          };
          self.pushLog('httpError', rec);
          resolve(rec);
        },
      });
    });
  },

  onCheckApi() {
    const self = this;
    const ep = this.data.endpoints;
    this.checkOne('health', ep.health)
      .then(function () { return self.checkOne('voice', ep.voice); })
      .then(function () { return self.checkOne('music', ep.music); })
      .then(function () { return self.checkOne('entrance', ep.entrance); })
      .then(function () { return self.checkOne('tone', ep.tone); })
      .then(function () {
        const http = (self.data.logs || []).filter(function (r) { return r.event === 'http' || r.event === 'httpError'; }).slice(-5);
        self.setData({ httpChecks: http });
      });
  },

  onCopy() {
    const text = formatClipboardReport({
      cardId: this.data.cardId,
      cardName: this.data.cardName,
      apiBase: this.data.apiBase,
      env: this.data.env,
      tests: this.data.tests,
      userObservation: this.data.userObservation,
    });
    const self = this;
    wx.setClipboardData({
      data: text,
      success: function () {
        self.pushLog('clipboard', { bytes: text.length });
      },
    });
  },
});
