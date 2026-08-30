const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPlayerController } = require('../miniprogram/utils/playerController.js');
const { getWxPlatform, downloadWxAudio } = require('../miniprogram/utils/player.js');

const ROOT = path.resolve(__dirname, '..');
const HTTP_VOICE = 'http://example.test/api/audio/voice/CARD/play';
const HTTP_ENTRANCE = 'http://example.test/api/audio/entrance/CARD';
const WXFILE = 'wxfile://tmp_hs_voice.wav';
const WXFILE_B = 'wxfile://tmp_hs_entrance.wav';

function fakeCtx(label) {
  const handlers = {};
  const ctx = {
    label: label || '',
    src: '',
    startTime: 0,
    duration: 4.76,
    currentTime: 0,
    paused: true,
    autoplay: true,
    volume: 1,
    playCount: 0,
    stopCount: 0,
    pauseCount: 0,
    seekCount: 0,
    destroyed: false,
    play() {
      ctx.playCount += 1;
      ctx.paused = false;
      if (handlers.play) handlers.play();
    },
    stop() {
      ctx.stopCount += 1;
      ctx.paused = true;
      if (handlers.stop) handlers.stop();
    },
    pause() {
      ctx.pauseCount += 1;
      ctx.paused = true;
      if (handlers.pause) handlers.pause();
    },
    seek(pos) {
      ctx.seekCount += 1;
      ctx.currentTime = pos;
      if (handlers.seeked) handlers.seeked();
    },
    destroy() { ctx.destroyed = true; },
    onPlay(fn) { handlers.play = fn; },
    onPause(fn) { handlers.pause = fn; },
    onStop(fn) { handlers.stop = fn; },
    onEnded(fn) { handlers.ended = fn; },
    onCanplay(fn) { handlers.canplay = fn; },
    onError(fn) { handlers.error = fn; },
    onWaiting(fn) { handlers.waiting = fn; },
    onSeeked(fn) { handlers.seeked = fn; },
    onTimeUpdate(fn) { handlers.timeUpdate = fn; },
    emit(name, payload) { if (handlers[name]) handlers[name](payload); },
  };
  return ctx;
}

function factory() {
  const created = [];
  return {
    created: created,
    createContext: function () {
      const ctx = fakeCtx('c' + created.length);
      created.push(ctx);
      return ctx;
    },
  };
}

function makeDownloader() {
  const pending = [];
  return {
    pending: pending,
    calls: 0,
    downloadAudio: function (url, hooks) {
      this.calls += 1;
      const item = { url: url, hooks: hooks, aborted: false };
      pending.push(item);
      return {
        abort: function () { item.aborted = true; },
      };
    },
    succeed: function (index, tempFilePath, statusCode) {
      const item = pending[index];
      item.hooks.success({ tempFilePath: tempFilePath, statusCode: statusCode || 200 });
    },
    fail: function (index, err) {
      pending[index].hooks.fail(err);
    },
  };
}

function makeIosPlayer(logLines) {
  const f = factory();
  const dl = makeDownloader();
  const logs = logLines || [];
  const player = createPlayerController({
    createContext: f.createContext,
    reuseContext: false,
    getPlatform: function () { return 'ios'; },
    downloadAudio: dl.downloadAudio.bind(dl),
    log: function (line) { logs.push(String(line)); },
  });
  return { f: f, dl: dl, player: player, logs: logs };
}

function makeNonIosPlayer(platform) {
  const f = factory();
  const dl = makeDownloader();
  const player = createPlayerController({
    createContext: f.createContext,
    reuseContext: false,
    getPlatform: function () { return platform; },
    downloadAudio: dl.downloadAudio.bind(dl),
  });
  return { f: f, dl: dl, player: player };
}

// TEST 1: iOS + HTTP URL should go through downloadFile
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice', cardId: 'CARD' });
  assert.strictEqual(x.dl.calls, 1);
  assert.strictEqual(x.dl.pending[0].url, HTTP_VOICE);
  assert.strictEqual(x.player.getState().status, 'loading');
  assert.strictEqual(x.player.getState().sourceType, 'download');
  assert.strictEqual(x.player.getState().src, HTTP_VOICE);
  assert.strictEqual(x.f.created[0].src, '', 'must not assign HTTP url on iOS');
  assert.strictEqual(x.f.created[0].playCount, 0);
}

// TEST 2: non-iOS + HTTP URL keeps direct src assignment
['devtools', 'android', '', 'windows'].forEach(function (platform) {
  const x = makeNonIosPlayer(platform);
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice', cardId: 'CARD' });
  assert.strictEqual(x.dl.calls, 0, 'non-iOS must not download: ' + platform);
  assert.strictEqual(x.f.created[0].src, HTTP_VOICE);
  assert.strictEqual(x.player.getState().sourceType, 'http');
  assert.strictEqual(x.f.created[0].playCount, 0);
  x.f.created[0].emit('canplay');
  assert.ok(x.f.created[0].playCount >= 1);
});

// default (no getPlatform) stays on HTTP path
{
  const f = factory();
  const dl = makeDownloader();
  const player = createPlayerController({
    createContext: f.createContext,
    reuseContext: false,
    downloadAudio: dl.downloadAudio.bind(dl),
  });
  player.play(HTTP_VOICE, { key: 'CARD:voice' });
  assert.strictEqual(dl.calls, 0);
  assert.strictEqual(f.created[0].src, HTTP_VOICE);
}

// TEST 3: iOS + download success sets tempFilePath on InnerAudioContext
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice', cardId: 'CARD' });
  const sessionId = x.player.getState().sessionId;
  x.dl.succeed(0, WXFILE, 200);
  assert.strictEqual(x.f.created[0].src, WXFILE);
  assert.strictEqual(x.player.getState().src, HTTP_VOICE);
  assert.strictEqual(x.player.getState().sourceType, 'wxfile');
  assert.strictEqual(x.player.getState().sessionId, sessionId);
  assert.strictEqual(x.f.created[0].playCount, 0, 'still wait for canplay');
  x.f.created[0].emit('canplay');
  assert.ok(x.f.created[0].playCount >= 1);
  assert.strictEqual(x.player.getState().status, 'playing');
}

// TEST 4: iOS + download fail enters player error with download details
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice', cardId: 'CARD' });
  const sessionId = x.player.getState().sessionId;
  x.dl.fail(0, { stage: 'download', url: HTTP_VOICE, statusCode: 404, errMsg: 'HTTP 404' });
  assert.strictEqual(x.player.getState().status, 'error');
  assert.strictEqual(x.player.getState().error, '暂时无法播放');
  const err = x.player.getState().lastError;
  assert.ok(err);
  assert.strictEqual(err.stage, 'download');
  assert.strictEqual(err.url, HTTP_VOICE);
  assert.strictEqual(err.statusCode, 404);
  assert.strictEqual(err.errMsg, 'HTTP 404');
  assert.strictEqual(err.playSessionId, sessionId);
  assert.strictEqual(x.f.created[0].src, '');
  assert.strictEqual(x.f.created[0].playCount, 0);
  assert.ok(x.logs.some(function (line) { return line.indexOf('audioDownloadFail') >= 0; }));
}

{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice' });
  x.dl.succeed(0, '', 500);
  assert.strictEqual(x.player.getState().status, 'error');
  assert.strictEqual(x.player.getState().lastError.stage, 'download');
}

// TEST 5: stale download must not override a newer session
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice' });
  const first = x.f.created[0];
  const firstSession = x.player.getState().sessionId;
  x.player.play(HTTP_ENTRANCE, { key: 'CARD:entrance', type: 'entrance' });
  const second = x.f.created[1];
  const secondSession = x.player.getState().sessionId;
  assert.ok(first.destroyed);
  assert.ok(x.dl.pending[0].aborted);
  assert.notStrictEqual(firstSession, secondSession);
  x.dl.succeed(0, WXFILE);
  assert.strictEqual(second.src, '');
  assert.strictEqual(x.player.getState().sessionId, secondSession);
  assert.strictEqual(x.player.getState().key, 'CARD:entrance');
  assert.notStrictEqual(x.player.getState().status, 'error');
  x.dl.succeed(1, WXFILE_B);
  assert.strictEqual(second.src, WXFILE_B);
  second.emit('canplay');
  assert.strictEqual(second.playCount, 1);
  assert.strictEqual(first.playCount, 0);
  assert.strictEqual(x.player.getState().status, 'playing');
}

// TEST 6: stop during download — completed download must not start playback
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice' });
  const ctx = x.f.created[0];
  x.player.stop();
  assert.strictEqual(x.player.getState().status, 'idle');
  assert.ok(x.dl.pending[0].aborted);
  x.dl.succeed(0, WXFILE);
  assert.strictEqual(ctx.src, '');
  assert.strictEqual(ctx.playCount, 0);
  assert.strictEqual(x.player.getState().status, 'idle');
}

// TEST 7: new play during old download — old result must not override new play
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice' });
  const oldCtx = x.f.created[0];
  x.player.play(HTTP_ENTRANCE, { key: 'CARD:entrance', type: 'entrance' });
  const newCtx = x.f.created[1];
  x.dl.succeed(0, WXFILE);
  assert.strictEqual(oldCtx.src, '');
  assert.strictEqual(newCtx.src, '');
  assert.strictEqual(x.player.getState().key, 'CARD:entrance');
  x.dl.succeed(1, WXFILE_B);
  assert.strictEqual(newCtx.src, WXFILE_B);
  newCtx.emit('canplay');
  assert.strictEqual(newCtx.playCount, 1);
  assert.strictEqual(oldCtx.playCount, 0);
}

// destroy during download
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice' });
  x.player.destroy();
  x.dl.succeed(0, WXFILE);
  assert.strictEqual(x.player.getState().status, 'idle');
  assert.strictEqual(x.f.created[0].playCount, 0);
}

// canplay during download must not play HTTP
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice' });
  x.f.created[0].emit('canplay');
  assert.strictEqual(x.f.created[0].playCount, 0);
  x.dl.succeed(0, WXFILE);
  x.f.created[0].emit('canplay');
  assert.strictEqual(x.f.created[0].playCount, 1);
}

// iOS wxfile:// skips download
{
  const x = makeIosPlayer();
  x.player.play(WXFILE, { key: 'CARD:voice' });
  assert.strictEqual(x.dl.calls, 0);
  assert.strictEqual(x.f.created[0].src, WXFILE);
}

// first timeUpdate logs once
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice', type: 'voice', cardId: 'CARD' });
  x.dl.succeed(0, WXFILE);
  x.f.created[0].emit('canplay');
  x.f.created[0].currentTime = 0.24;
  x.f.created[0].duration = 4.76;
  x.f.created[0].emit('timeUpdate');
  x.f.created[0].emit('timeUpdate');
  const n = x.logs.filter(function (line) { return line.indexOf('audioTimeUpdate') >= 0; }).length;
  assert.strictEqual(n, 1);
}

// ended still works after download path
{
  const x = makeIosPlayer();
  x.player.play(HTTP_VOICE, { key: 'CARD:voice' });
  x.dl.succeed(0, WXFILE);
  x.f.created[0].emit('canplay');
  x.f.created[0].emit('ended');
  assert.strictEqual(x.player.getState().status, 'ended');
  assert.ok(x.logs.some(function (line) { return line.indexOf('audioEnded') >= 0; }));
}

// player.js WeChat adapter
{
  const prev = global.wx;
  try {
    global.wx = {
      getSystemInfoSync: function () { return { platform: 'ios' }; },
      downloadFile: function (opts) {
        global.__dlOpts = opts;
        return { abort: function () { global.__dlAborted = true; } };
      },
    };
    assert.strictEqual(getWxPlatform(), 'ios');
    let got = null;
    const task = downloadWxAudio('http://example.test/a.wav', {
      success: function (res) { got = res; },
      fail: function () { got = 'fail'; },
    });
    global.__dlOpts.success({ statusCode: 200, tempFilePath: WXFILE });
    assert.strictEqual(got.tempFilePath, WXFILE);
    task.abort();
    assert.strictEqual(global.__dlAborted, true);
  } finally {
    global.wx = prev;
  }
}

{
  const prev = global.wx;
  try {
    let fail = null;
    global.wx = {
      downloadFile: function (opts) {
        return { abort: function () {} };
      },
    };
    downloadWxAudio('http://example.test/a.wav', {
      success: function () {},
      fail: function (err) { fail = err; },
    });
    global.wx.downloadFile; // keep reference
    // simulate non-200
    const optsHolder = [];
    global.wx.downloadFile = function (opts) {
      optsHolder.push(opts);
      return { abort: function () {} };
    };
    downloadWxAudio('http://example.test/a.wav', {
      success: function () { fail = 'unexpected success'; },
      fail: function (err) { fail = err; },
    });
    optsHolder[0].success({ statusCode: 500, errMsg: 'fail' });
    assert.strictEqual(fail.stage, 'download');
    assert.strictEqual(fail.statusCode, 500);
  } finally {
    global.wx = prev;
  }
}

{
  const prev = global.wx;
  try {
    let called = false;
    global.wx = {
      downloadFile: function (opts) {
        global.__late = opts;
        return { abort: function () {} };
      },
    };
    const task = downloadWxAudio('http://example.test/a.wav', {
      success: function () { called = true; },
      fail: function () { called = true; },
    });
    task.abort();
    global.__late.success({ statusCode: 200, tempFilePath: WXFILE });
    assert.strictEqual(called, false, 'aborted download must ignore late success');
  } finally {
    global.wx = prev;
  }
}

{
  assert.strictEqual(getWxPlatform(), '');
}

// architecture: downloadFile stays in player.js, not controller / UI
{
  const controller = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'playerController.js'), 'utf8');
  const player = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'player.js'), 'utf8');
  const card = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.js'), 'utf8');
  const audioJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'audio.js'), 'utf8');
  assert.ok(!controller.includes('wx.downloadFile'));
  assert.ok(player.includes('wx.downloadFile'));
  assert.ok(player.includes('getSystemInfoSync'));
  assert.ok(!/setTimeout\s*\(/.test(controller));
  assert.ok(!/setTimeout\s*\(/.test(player));
  assert.ok(!card.includes('wx.downloadFile'));
  assert.ok(!index.includes('wx.downloadFile'));
  assert.ok(!audioJs.includes('wx.downloadFile'));
  assert.ok(!/if\s*\(\s*cardId\s*===/.test(controller));
  assert.ok(!/BOT_548/.test(controller));
  assert.ok(!/EX1_116/.test(controller + player));
}

console.log('ok audioPlayerIosDownload');
