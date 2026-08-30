/**
 * WeChat InnerAudioContext state machine.
 * One live context at a time. Each new src gets a new session token.
 * Stale onCanplay / onPlay / onEnded / onError never mutate the new session.
 * Play only after canplay (and seek-to-zero when currentTime > 0). No autoplay.
 * No CardID branches, no fixed delay, no mute preplay.
 */
function createPlayerController(ctxOrOpts, maybeOpts) {
  const parsed = parseArgs(ctxOrOpts, maybeOpts);
  const createContext = parsed.createContext;
  const reuseContext = parsed.reuseContext;
  const initialDebug = parsed.debug;
  const log = parsed.log;
  const getPlatform = parsed.getPlatform;
  const downloadAudio = parsed.downloadAudio;

  const listeners = [];
  const eventLog = [];
  const state = {
    key: '',
    title: '',
    status: 'idle',
    error: '',
    src: '',
    type: '',
    cardId: '',
    debug: false,
    sourceType: '',
    lastError: null,
  };

  let liveSession = 0;
  let seq = 0;
  let ctx = parsed.reuseContext ? parsed.ctx : null;
  let pendingPlay = false;
  let playArmed = false;
  let waitingSeeked = false;
  let gotCanplay = false;
  let debugAll = initialDebug;
  let lastMeta = null;
  let liveCount = ctx ? 1 : 0;
  let resolvedSrc = '';
  let downloadTask = null;
  let loggedTimeUpdate = false;

  function parseArgs(a, b) {
    const opts = (a && typeof a.play !== 'function') ? (a || {}) : (b || {});
    const reused = a && typeof a.play === 'function' ? a : (opts.ctx || null);
    return {
      ctx: reused,
      reuseContext: reused ? (opts.reuseContext !== false) : !!opts.reuseContext,
      createContext: opts.createContext || (reused ? function () { return reused; } : null),
      debug: !!(opts && opts.debug),
      log: (opts && opts.log) || function () {},
      getPlatform: opts.getPlatform,
      downloadAudio: opts.downloadAudio,
    };
  }

  function snapshot() {
    return {
      key: state.key,
      title: state.title,
      status: state.status,
      error: state.error,
      src: state.src,
      type: state.type,
      cardId: state.cardId,
      sessionId: liveSession,
      sourceType: state.sourceType,
      lastError: state.lastError,
    };
  }

  function emit() {
    const snap = snapshot();
    for (let i = 0; i < listeners.length; i++) listeners[i](snap);
  }

  function isDebug() {
    return debugAll || !!state.debug;
  }

  function pushEvent(name, extra) {
    const bits = ['[AudioPlayer]', 'session=' + liveSession, name];
    if (state.type) bits.push('type=' + state.type);
    if (state.cardId) bits.push('card=' + state.cardId);
    if (extra) bits.push(extra);
    const line = bits.join(' ');
    eventLog.push(line);
    while (eventLog.length > 20) eventLog.shift();
    if (isDebug()) {
      try { log(line); } catch (e) {}
    }
  }

  function currentPlatform() {
    if (typeof getPlatform !== 'function') return '';
    try {
      return String(getPlatform() || '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function isRemoteHttpUrl(src) {
    const s = String(src || '');
    return s.slice(0, 7) === 'http://' || s.slice(0, 8) === 'https://';
  }

  function shouldDownload(url) {
    return currentPlatform() === 'ios' && isRemoteHttpUrl(url) && typeof downloadAudio === 'function';
  }

  function prodLog(name, extra) {
    const bits = ['[AudioPlayer]', name, 'session=' + liveSession];
    if (state.cardId) bits.push('card=' + state.cardId);
    if (state.type) bits.push('type=' + state.type);
    if (extra) bits.push(extra);
    try { log(bits.join(' ')); } catch (e) {}
  }

  function isLive(session) {
    return session > 0 && session === liveSession;
  }

  function inferType(meta, key) {
    if (meta && meta.type) return meta.type;
    const k = String(key || '');
    if (k.slice(-9) === ':entrance') return 'entrance';
    if (k.slice(-6) === ':music') return 'music';
    return 'voice';
  }

  function inferCardId(meta, key) {
    if (meta && meta.cardId) return String(meta.cardId);
    const k = String(key || '');
    const i = k.lastIndexOf(':');
    return i > 0 ? k.slice(0, i) : '';
  }

  function sameKey(key) {
    return key && state.key === key;
  }

  function safeCall(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function detach(target, handlers) {
    if (!target || !handlers) return;
    safeCall(function () { target.offCanplay && target.offCanplay(handlers.canplay); });
    safeCall(function () { target.offPlay && target.offPlay(handlers.play); });
    safeCall(function () { target.offPause && target.offPause(handlers.pause); });
    safeCall(function () { target.offStop && target.offStop(handlers.stop); });
    safeCall(function () { target.offEnded && target.offEnded(handlers.ended); });
    safeCall(function () { target.offError && target.offError(handlers.error); });
    safeCall(function () { target.offWaiting && target.offWaiting(handlers.waiting); });
    safeCall(function () { target.offSeeked && target.offSeeked(handlers.seeked); });
    safeCall(function () { target.offTimeUpdate && target.offTimeUpdate(handlers.timeUpdate); });
  }

  function abortDownload() {
    const t = downloadTask;
    downloadTask = null;
    if (t && typeof t.abort === 'function') {
      safeCall(function () { t.abort(); });
    }
  }

  function teardown(reason) {
    abortDownload();
    resolvedSrc = '';
    loggedTimeUpdate = false;
    const old = ctx;
    const oldHandlers = old && old._hsHandlers;
    liveSession = 0;
    pendingPlay = false;
    playArmed = false;
    waitingSeeked = false;
    gotCanplay = false;
    detach(old, oldHandlers);
    if (!old) return;
    safeCall(function () { old.stop && old.stop(); });
    if (!reuseContext) {
      safeCall(function () { old.destroy && old.destroy(); });
      if (old === ctx) ctx = null;
      liveCount = 0;
    }
    if (isDebug()) pushEvent('teardown', 'reason=' + (reason || ''));
  }

  function beginSession() {
    seq += 1;
    liveSession = seq;
    pendingPlay = false;
    playArmed = false;
    waitingSeeked = false;
    gotCanplay = false;
    return liveSession;
  }

  function srcMatches(target) {
    if (!resolvedSrc) return false;
    if (!target || !target.src) return true;
    return target.src === resolvedSrc;
  }

  function actuallyPlay(session) {
    if (!isLive(session) || !ctx || playArmed) return;
    playArmed = true;
    pendingPlay = false;
    waitingSeeked = false;
    if (typeof ctx.startTime === 'number') ctx.startTime = 0;
    pushEvent('play()');
    try {
      ctx.play();
    } catch (e) {
      if (!isLive(session)) return;
      state.status = 'error';
      state.error = '暂时无法播放';
      state.lastError = {
        stage: 'play',
        url: state.src,
        statusCode: 0,
        errMsg: e && e.message ? String(e.message) : 'play exception',
        playSessionId: session,
      };
      prodLog('audioError', 'stage=play errMsg=' + state.lastError.errMsg);
      pushEvent('play() exception', e && e.message ? e.message : '');
      emit();
    }
  }

  function tryBeginPlay(session) {
    if (!isLive(session) || !ctx || playArmed) return;
    if (typeof ctx.startTime === 'number') ctx.startTime = 0;
    const t = Number(ctx.currentTime);
    if (typeof ctx.seek === 'function' && t > 0) {
      waitingSeeked = true;
      pushEvent('seek(0)', 'currentTime=' + t);
      try {
        ctx.seek(0);
      } catch (e) {
        waitingSeeked = false;
        actuallyPlay(session);
      }
      return;
    }
    actuallyPlay(session);
  }

  function onCanplay(session) {
    return function () {
      if (!isLive(session) || !ctx) return;
      if (!srcMatches(ctx)) {
        pushEvent('onCanplay ignored src mismatch');
        return;
      }
      gotCanplay = true;
      const duration = ctx.duration;
      const currentTime = ctx.currentTime;
      const paused = ctx.paused;
      pushEvent('onCanplay', 'duration=' + duration + ' currentTime=' + currentTime + ' paused=' + paused);
      if (typeof ctx.startTime === 'number') ctx.startTime = 0;
      if (state.status === 'playing' || state.status === 'paused') return;
      if (pendingPlay) {
        if (state.status !== 'ready') {
          state.status = 'ready';
          emit();
        }
        tryBeginPlay(session);
        return;
      }
      if (state.status === 'loading' || state.status === 'ready') {
        state.status = 'ready';
        emit();
      }
    };
  }

  function onSeeked(session) {
    return function () {
      if (!isLive(session) || !ctx) return;
      pushEvent('onSeeked', 'currentTime=' + ctx.currentTime);
      if (!waitingSeeked) return;
      waitingSeeked = false;
      if (pendingPlay || state.status === 'ready' || state.status === 'loading') {
        actuallyPlay(session);
      }
    };
  }

  function onPlay(session) {
    return function () {
      if (!isLive(session) || !ctx) return;
      state.status = 'playing';
      state.error = '';
      state.lastError = null;
      pushEvent('onPlay', 'currentTime=' + ctx.currentTime + ' duration=' + ctx.duration);
      emit();
    };
  }

  function onPause(session) {
    return function () {
      if (!isLive(session)) return;
      if (state.status === 'playing' || state.status === 'paused') {
        state.status = 'paused';
        pushEvent('onPause');
        emit();
      }
    };
  }

  function onStop(session) {
    return function () {
      if (!isLive(session)) return;
      if (state.status === 'stopping') {
        state.status = 'idle';
        pushEvent('onStop');
        emit();
      }
    };
  }

  function onEnded(session) {
    return function () {
      if (!isLive(session)) return;
      pendingPlay = false;
      playArmed = false;
      waitingSeeked = false;
      state.status = 'ended';
      state.error = '';
      pushEvent('onEnded');
      prodLog('audioEnded', 'currentTime=' + (ctx && ctx.currentTime) + ' duration=' + (ctx && ctx.duration));
      emit();
      teardown('ended');
    };
  }

  function onError(session) {
    return function (res) {
      if (!isLive(session)) {
        return;
      }
      if (state.status === 'stopping') return;
      pendingPlay = false;
      playArmed = false;
      waitingSeeked = false;
      const code = res && (res.errCode || res.errMsg) ? String(res.errCode || '') : '';
      const message = res && res.errMsg ? String(res.errMsg) : '';
      state.status = 'error';
      state.error = '暂时无法播放';
      state.lastError = {
        stage: 'play',
        url: state.src,
        statusCode: res && res.errCode,
        errMsg: message,
        playSessionId: session,
      };
      pushEvent('onError', 'code=' + code + (message ? ' message=' + message : ''));
      prodLog('audioError', 'stage=play code=' + code + (message ? ' errMsg=' + message : ''));
      emit();
    };
  }

  function onWaiting(session) {
    return function () {
      if (!isLive(session)) return;
      /* Buffering during playback is not a new load session. */
    };
  }

  function onTimeUpdate(session) {
    return function () {
      if (!isLive(session) || !ctx || loggedTimeUpdate) return;
      const t = Number(ctx.currentTime);
      const d = Number(ctx.duration);
      if (!(t > 0 || d > 0)) return;
      loggedTimeUpdate = true;
      prodLog('audioTimeUpdate', 'currentTime=' + t + ' duration=' + d);
    };
  }

  function bind(target, session) {
    const handlers = {
      canplay: onCanplay(session),
      play: onPlay(session),
      pause: onPause(session),
      stop: onStop(session),
      ended: onEnded(session),
      error: onError(session),
      waiting: onWaiting(session),
      seeked: onSeeked(session),
      timeUpdate: onTimeUpdate(session),
    };
    target._hsHandlers = handlers;
    if (typeof target.autoplay === 'boolean' || target.autoplay === undefined) target.autoplay = false;
    if ('obeyMuteSwitch' in target || target.obeyMuteSwitch === undefined) {
      try { target.obeyMuteSwitch = false; } catch (e) {}
    }
    if (typeof target.volume === 'number') target.volume = 1;
    target.onCanplay && target.onCanplay(handlers.canplay);
    target.onPlay && target.onPlay(handlers.play);
    target.onPause && target.onPause(handlers.pause);
    target.onStop && target.onStop(handlers.stop);
    target.onEnded && target.onEnded(handlers.ended);
    target.onError && target.onError(handlers.error);
    target.onWaiting && target.onWaiting(handlers.waiting);
    target.onSeeked && target.onSeeked(handlers.seeked);
    target.onTimeUpdate && target.onTimeUpdate(handlers.timeUpdate);
  }

  function acquireContext(session) {
    if (reuseContext && ctx) {
      bind(ctx, session);
      return ctx;
    }
    if (!createContext) return null;
    const next = createContext();
    if (!next) return null;
    ctx = next;
    liveCount = 1;
    bind(ctx, session);
    return ctx;
  }

  function applyMeta(url, meta) {
    const key = (meta && meta.key) || url;
    state.key = key;
    state.title = (meta && meta.title) || '';
    state.src = url || '';
    state.debug = !!(meta && meta.debug);
    state.type = inferType(meta, key);
    state.cardId = inferCardId(meta, key);
    state.error = '';
    state.lastError = null;
    state.sourceType = '';
    lastMeta = meta || null;
  }

  function failDownload(session, err) {
    if (!isLive(session)) return;
    abortDownload();
    pendingPlay = false;
    playArmed = false;
    const statusCode = err && err.statusCode;
    const errMsg = err && err.errMsg ? String(err.errMsg) : 'downloadFile fail';
    state.status = 'error';
    state.error = '暂时无法播放';
    state.lastError = {
      stage: 'download',
      url: state.src,
      statusCode: statusCode,
      errMsg: errMsg,
      playSessionId: session,
    };
    pushEvent('onError', 'stage=download url=' + state.src + ' statusCode=' + (statusCode || '') + ' errMsg=' + errMsg);
    prodLog(
      'audioDownloadFail',
      'stage=download url=' + state.src + ' statusCode=' + (statusCode || '') + ' errMsg=' + errMsg + ' playSessionId=' + session
    );
    prodLog('audioError', 'stage=download playSessionId=' + session + ' errMsg=' + errMsg);
    emit();
  }

  function assignSrc(target, session, playSrc, originalUrl, sourceType) {
    if (!isLive(session) || !target) return;
    resolvedSrc = playSrc;
    state.sourceType = sourceType;
    if (typeof target.startTime === 'number') target.startTime = 0;
    pushEvent('set src', playSrc);
    target.src = playSrc;
  }

  function loadSrc(url, meta, autoplay) {
    teardown('replace');
    const session = beginSession();
    applyMeta(url, meta);
    pendingPlay = !!autoplay;
    resolvedSrc = '';
    loggedTimeUpdate = false;
    state.status = 'loading';
    emit();
    const next = acquireContext(session);
    if (!next) {
      state.status = 'error';
      state.error = '暂时无法播放';
      pushEvent('no InnerAudioContext');
      emit();
      return;
    }
    if (typeof next.startTime === 'number') next.startTime = 0;

    const platform = currentPlatform();
    if (shouldDownload(url)) {
      state.sourceType = 'download';
      prodLog(
        'audioPlayStart',
        'platform=' + platform + ' sourceType=download originalUrl=' + url
      );
      prodLog('audioDownloadStart', 'url=' + url);
      pushEvent('download start', url);
      let task = null;
      try {
        task = downloadAudio(url, {
          success: function (result) {
            if (!isLive(session) || ctx !== next) {
              pushEvent('download ignored stale');
              return;
            }
            downloadTask = null;
            const temp = result && result.tempFilePath;
            if (!temp) {
              failDownload(session, {
                statusCode: result && result.statusCode,
                errMsg: 'missing tempFilePath',
              });
              return;
            }
            prodLog(
              'audioDownloadSuccess',
              'tempFilePath=' + temp + ' statusCode=' + ((result && result.statusCode) || 200)
            );
            assignSrc(next, session, temp, url, 'wxfile');
          },
          fail: function (err) {
            if (!isLive(session) || ctx !== next) {
              pushEvent('download ignored stale');
              return;
            }
            downloadTask = null;
            failDownload(session, err || {});
          },
        });
      } catch (e) {
        failDownload(session, {
          errMsg: (e && e.message) || 'downloadFile exception',
        });
        return;
      }
      downloadTask = task;
      return;
    }

    const sourceType = isRemoteHttpUrl(url) ? 'http' : 'local';
    state.sourceType = sourceType;
    prodLog(
      'audioPlayStart',
      'platform=' + (platform || 'unknown') + ' sourceType=' + sourceType + ' originalUrl=' + url
    );
    assignSrc(next, session, url, url, sourceType);
  }

  function noContextApi() {
    return {
      getState: snapshot,
      getDebugLog: function () { return eventLog.slice(); },
      getLiveInstanceCount: function () { return 0; },
      subscribe: function (fn) {
        listeners.push(fn);
        fn(snapshot());
        return function () {};
      },
      play: function () {
        state.status = 'error';
        state.error = '暂时无法播放';
        emit();
      },
      playAudio: function () {
        state.status = 'error';
        state.error = '暂时无法播放';
        emit();
      },
      preload: function () {},
      pause: function () {},
      stop: function () {},
      destroy: function () {},
      setDebug: function (v) { debugAll = !!v; },
    };
  }

  if (!createContext && !ctx) return noContextApi();

  return {
    getState: snapshot,
    getDebugLog: function () { return eventLog.slice(); },
    getLiveInstanceCount: function () { return liveCount; },
    setDebug: function (v) { debugAll = !!v; },
    subscribe: function (fn) {
      listeners.push(fn);
      fn(snapshot());
      return function () {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    playAudio: function (opts) {
      opts = opts || {};
      const url = opts.url;
      return this.play(url, {
        key: opts.key || ((opts.cardId || '') + ':' + (opts.type || 'voice')),
        title: opts.title || '',
        type: opts.type,
        cardId: opts.cardId,
        debug: opts.debug,
      });
    },
    play: function (url, meta) {
      const key = (meta && meta.key) || url || state.key;
      const resolved = url || state.src;
      if (sameKey(key) && state.status === 'playing' && ctx) {
        ctx.pause();
        return;
      }
      if (sameKey(key) && state.status === 'paused' && ctx) {
        pushEvent('resume');
        try { ctx.play(); } catch (e) {
          state.status = 'error';
          state.error = '暂时无法播放';
          emit();
        }
        return;
      }
      if (sameKey(key) && state.status === 'ready' && ctx && isLive(liveSession)) {
        pendingPlay = true;
        tryBeginPlay(liveSession);
        return;
      }
      if (sameKey(key) && state.status === 'loading' && ctx && isLive(liveSession)) {
        pendingPlay = true;
        return;
      }
      if (!resolved) return;
      loadSrc(resolved, meta || lastMeta || { key: key }, true);
    },
    preload: function (url, meta) {
      if (!url) return;
      const key = (meta && meta.key) || url;
      if (sameKey(key) && (state.status === 'loading' || state.status === 'ready' || state.status === 'playing' || state.status === 'paused')) {
        return;
      }
      loadSrc(url, meta, false);
    },
    pause: function () {
      if (!ctx) return;
      safeCall(function () { ctx.pause(); });
    },
    stop: function () {
      if (state.status === 'idle' && !ctx) return;
      state.status = 'stopping';
      emit();
      teardown('stop');
      state.status = 'idle';
      pendingPlay = false;
      emit();
    },
    destroy: function () {
      teardown('destroy');
      liveSession = 0;
      state.status = 'idle';
      state.error = '';
      emit();
    },
  };
}

module.exports = { createPlayerController };
