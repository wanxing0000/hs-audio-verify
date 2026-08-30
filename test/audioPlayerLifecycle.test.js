const assert = require('assert');
const { createPlayerController } = require('../miniprogram/utils/playerController.js');

function fakeCtx(label) {
  const handlers = {};
  const ctx = {
    label: label || '',
    src: '',
    startTime: 0,
    duration: 5,
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
    live: function () {
      return created.filter(function (c) { return !c.destroyed; }).length;
    },
  };
}

function makePlayer() {
  const f = factory();
  const player = createPlayerController({ createContext: f.createContext, reuseContext: false });
  return { f: f, player: player };
}

function coldPlay(player, f, url, meta) {
  player.play(url, meta);
  const ctx = f.created[f.created.length - 1];
  assert.strictEqual(player.getState().status, 'loading');
  assert.strictEqual(ctx.playCount, 0, 'must not play before canplay');
  assert.strictEqual(ctx.autoplay, false);
  ctx.emit('canplay');
  assert.ok(ctx.playCount >= 1);
  assert.strictEqual(ctx.startTime, 0);
  assert.strictEqual(player.getState().status, 'playing');
  return ctx;
}

const voiceUrl = 'http://127.0.0.1:8767/api/audio/voice/EX1_116/play';
const entranceUrl = 'http://127.0.0.1:8767/api/audio/entrance/EX1_116';
const musicUrl = 'http://127.0.0.1:8767/api/audio/music/EX1_116';
const entranceB = 'http://127.0.0.1:8767/api/audio/entrance/EX1_572';

// Scene A: cold start → Entrance
{
  const x = makePlayer();
  coldPlay(x.player, x.f, entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
}

// Scene B: cold start → Voice
{
  const x = makePlayer();
  coldPlay(x.player, x.f, voiceUrl, { key: 'EX1_116:play', type: 'voice', cardId: 'EX1_116' });
}

// Scene C: cold start → Music
{
  const x = makePlayer();
  coldPlay(x.player, x.f, musicUrl, { key: 'EX1_116:music', type: 'music', cardId: 'EX1_116' });
}

// Scene D: Entrance → ended → Entrance
{
  const x = makePlayer();
  const first = coldPlay(x.player, x.f, entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  first.emit('ended');
  assert.strictEqual(x.player.getState().status, 'ended');
  assert.ok(first.destroyed);
  coldPlay(x.player, x.f, entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
}

// Scene E: Entrance A → immediate Entrance B
{
  const x = makePlayer();
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  const a = x.f.created[0];
  x.player.play(entranceB, { key: 'EX1_572:entrance', type: 'entrance', cardId: 'EX1_572' });
  const b = x.f.created[1];
  assert.ok(a.destroyed);
  assert.strictEqual(x.player.getLiveInstanceCount(), 1);
  a.emit('canplay');
  a.emit('play');
  a.emit('ended');
  a.emit('error', { errCode: 1, errMsg: 'stale' });
  assert.strictEqual(b.playCount, 0);
  assert.notStrictEqual(x.player.getState().status, 'error');
  assert.strictEqual(x.player.getState().key, 'EX1_572:entrance');
  b.emit('canplay');
  assert.strictEqual(b.playCount, 1);
  assert.strictEqual(x.player.getState().status, 'playing');
  assert.strictEqual(x.player.getState().cardId, 'EX1_572');
}

// Scene F: Voice A → immediate Entrance A
{
  const x = makePlayer();
  x.player.play(voiceUrl, { key: 'EX1_116:play', type: 'voice', cardId: 'EX1_116' });
  const voice = x.f.created[0];
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  const entrance = x.f.created[1];
  voice.emit('canplay');
  voice.emit('ended');
  voice.emit('error', { errCode: 2 });
  assert.strictEqual(entrance.playCount, 0);
  entrance.emit('canplay');
  assert.strictEqual(entrance.playCount, 1);
  assert.strictEqual(x.player.getState().type, 'entrance');
}

// Scene G: Entrance A → immediate Voice A
{
  const x = makePlayer();
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  const entrance = x.f.created[0];
  x.player.play(voiceUrl, { key: 'EX1_116:play', type: 'voice', cardId: 'EX1_116' });
  const voice = x.f.created[1];
  entrance.emit('canplay');
  assert.strictEqual(voice.playCount, 0);
  voice.emit('canplay');
  assert.strictEqual(voice.playCount, 1);
  assert.strictEqual(x.player.getState().type, 'voice');
}

// playing → loading (switch)
{
  const x = makePlayer();
  const first = coldPlay(x.player, x.f, voiceUrl, { key: 'EX1_116:play', type: 'voice', cardId: 'EX1_116' });
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  assert.strictEqual(x.player.getState().status, 'loading');
  assert.ok(first.destroyed);
}

// seek(0) when canplay reports currentTime > 0, then play
{
  const x = makePlayer();
  x.player.play(entranceUrl, { key: 'BOT_548:entrance', type: 'entrance', cardId: 'BOT_548' });
  const ctx = x.f.created[0];
  ctx.currentTime = 0.12;
  ctx.emit('canplay');
  assert.ok(ctx.seekCount >= 1);
  assert.strictEqual(ctx.currentTime, 0);
  assert.ok(ctx.playCount >= 1);
  assert.strictEqual(x.player.getState().status, 'playing');
}

// extra canplay must not play twice
{
  const x = makePlayer();
  const ctx = coldPlay(x.player, x.f, entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  const plays = ctx.playCount;
  ctx.emit('canplay');
  assert.strictEqual(ctx.playCount, plays);
}

// destroy must not leak into a later session
{
  const x = makePlayer();
  x.player.play(voiceUrl, { key: 'EX1_116:play', type: 'voice', cardId: 'EX1_116' });
  const first = x.f.created[0];
  x.player.destroy();
  first.emit('error', { errCode: 99, errMsg: 'after destroy' });
  first.emit('ended');
  assert.notStrictEqual(x.player.getState().status, 'error');
  assert.strictEqual(x.player.getState().status, 'idle');
  coldPlay(x.player, x.f, entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
}

// user stop is not an error
{
  const x = makePlayer();
  x.player.play(voiceUrl, { key: 'EX1_116:play', type: 'voice', cardId: 'EX1_116' });
  const ctx = x.f.created[0];
  x.player.stop();
  ctx.emit('error', { errCode: 1, errMsg: 'interrupted' });
  assert.strictEqual(x.player.getState().status, 'idle');
  assert.strictEqual(x.player.getState().error, '');
}

// rapid same-key clicks while loading: one play
{
  const x = makePlayer();
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  x.player.play(entranceUrl, { key: 'EX1_116:entrance', type: 'entrance', cardId: 'EX1_116' });
  assert.strictEqual(x.f.created.length, 1);
  x.f.created[0].emit('canplay');
  assert.strictEqual(x.f.created[0].playCount, 1);
}

assert.strictEqual(makePlayer().player.getLiveInstanceCount(), 0);

console.log('ok audioPlayerLifecycle');
