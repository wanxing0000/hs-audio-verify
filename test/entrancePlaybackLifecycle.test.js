const assert = require('assert');
const { createPlayerController } = require('../miniprogram/utils/playerController.js');

function fakeCtx() {
  const handlers = {};
  const ctx = {
    src: '',
    startTime: 0,
    duration: 4.7,
    currentTime: 0,
    playCount: 0,
    stopCount: 0,
    pauseCount: 0,
    play() { ctx.playCount += 1; if (handlers.play) handlers.play(); },
    stop() { ctx.stopCount += 1; if (handlers.stop) handlers.stop(); },
    pause() { ctx.pauseCount += 1; if (handlers.pause) handlers.pause(); },
    destroy() {},
    onPlay(fn) { handlers.play = fn; },
    onPause(fn) { handlers.pause = fn; },
    onStop(fn) { handlers.stop = fn; },
    onEnded(fn) { handlers.ended = fn; },
    onWaiting(fn) { handlers.waiting = fn; },
    onCanplay(fn) { handlers.canplay = fn; },
    onError(fn) { handlers.error = fn; },
    emit(name) { if (handlers[name]) handlers[name](); },
  };
  return ctx;
}

function statuses(player) {
  const seen = [];
  player.subscribe(function (s) { seen.push(s.status); });
  return seen;
}

// Immediate src+play is the old race. Controller must NOT play until canplay.
const ctx = fakeCtx();
const player = createPlayerController(ctx);
const seen = statuses(player);
player.play('http://127.0.0.1:8767/api/audio/entrance/BOT_548', { key: 'BOT_548:entrance' });
assert.strictEqual(player.getState().status, 'loading');
assert.strictEqual(ctx.src, 'http://127.0.0.1:8767/api/audio/entrance/BOT_548');
assert.strictEqual(ctx.startTime, 0);
assert.strictEqual(ctx.playCount, 0, 'must not play before canplay');
ctx.emit('canplay');
assert.ok(ctx.playCount >= 1);
assert.strictEqual(player.getState().status, 'playing');
assert.ok(seen.indexOf('loading') >= 0);

// Extra canplay must not call play again.
const plays = ctx.playCount;
ctx.emit('canplay');
assert.strictEqual(ctx.playCount, plays);

// Preload without autoplay.
const ctx2 = fakeCtx();
const p2 = createPlayerController(ctx2);
p2.preload('http://example/entrance.wav', { key: 'EX1_116:entrance' });
assert.strictEqual(p2.getState().status, 'loading');
assert.strictEqual(ctx2.playCount, 0);
ctx2.emit('canplay');
assert.strictEqual(p2.getState().status, 'ready');
assert.strictEqual(ctx2.playCount, 0, 'preload must not play');
p2.play('http://example/entrance.wav', { key: 'EX1_116:entrance' });
assert.ok(ctx2.playCount >= 1);
assert.strictEqual(ctx2.startTime, 0);

// Click while loading: still one play after canplay.
const ctx3 = fakeCtx();
const p3 = createPlayerController(ctx3);
p3.preload('u', { key: 'k' });
p3.play('u', { key: 'k' });
assert.strictEqual(ctx3.playCount, 0);
ctx3.emit('canplay');
assert.strictEqual(ctx3.playCount, 1);

// Switching src ignores old canplay via src match.
const ctx4 = fakeCtx();
const p4 = createPlayerController(ctx4);
p4.play('url-a', { key: 'a' });
ctx4.src = 'url-b-stale';
ctx4.emit('canplay');
assert.strictEqual(ctx4.playCount, 0);

// Five cold-start simulations: src then canplay then play, never inverted.
let ok = 0;
for (let i = 0; i < 5; i++) {
  const c = fakeCtx();
  const p = createPlayerController(c);
  p.play('http://127.0.0.1:8767/api/audio/entrance/BOT_548', { key: 'BOT_548:entrance' });
  if (c.playCount !== 0) continue;
  c.emit('canplay');
  if (c.playCount === 1 && c.startTime === 0 && p.getState().status === 'playing') ok += 1;
}
assert.strictEqual(ok, 5, 'lifecycle cold-start 5/5');

const src = require('fs').readFileSync(require('path').join(__dirname, '../miniprogram/utils/playerController.js'), 'utf8');
assert.ok(!/if\s*\(\s*cardId\s*===/.test(src));
assert.ok(!/BOT_548/.test(src));

console.log('ok entrancePlaybackLifecycle', { coldStartSim: ok + '/5' });
