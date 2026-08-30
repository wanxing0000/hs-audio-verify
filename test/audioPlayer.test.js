const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPlayerController } = require('../miniprogram/utils/playerController.js');

const ROOT = path.resolve(__dirname, '..');

function fakeCtx() {
  const handlers = {};
  const ctx = {
    src: '',
    startTime: 0,
    duration: 4.7,
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

function statuses(player) {
  const seen = [];
  player.subscribe(function (s) { seen.push(s.status); });
  return seen;
}

const ctx = fakeCtx();
const player = createPlayerController(ctx);
const seen = statuses(player);

assert.strictEqual(player.getState().status, 'idle');
player.play('http://127.0.0.1:8767/api/audio/entrance/EX1_116', {
  key: 'EX1_116:entrance',
  type: 'entrance',
  cardId: 'EX1_116',
});
assert.strictEqual(player.getState().status, 'loading');
assert.strictEqual(ctx.playCount, 0);
assert.strictEqual(ctx.autoplay, false);
assert.strictEqual(ctx.volume, 1);

ctx.emit('canplay');
assert.ok(seen.indexOf('ready') >= 0);
assert.strictEqual(player.getState().status, 'playing');
assert.ok(ctx.playCount >= 1);
assert.strictEqual(ctx.startTime, 0);

ctx.emit('ended');
assert.strictEqual(player.getState().status, 'ended');

player.play('http://127.0.0.1:8767/api/audio/entrance/EX1_116', {
  key: 'EX1_116:entrance',
  type: 'entrance',
  cardId: 'EX1_116',
});
assert.strictEqual(player.getState().status, 'loading');
ctx.emit('canplay');
assert.strictEqual(player.getState().status, 'playing');

player.stop();
assert.strictEqual(player.getState().status, 'idle');
player.play('http://127.0.0.1:8767/api/audio/voice/EX1_116/play', {
  key: 'EX1_116:play',
  type: 'voice',
  cardId: 'EX1_116',
});
assert.strictEqual(player.getState().status, 'loading');
ctx.emit('canplay');
assert.strictEqual(player.getState().status, 'playing');

ctx.emit('error', { errCode: 10001, errMsg: 'fail' });
assert.strictEqual(player.getState().status, 'error');
assert.strictEqual(player.getState().error, '暂时无法播放');
player.play('http://127.0.0.1:8767/api/audio/voice/EX1_116/play', {
  key: 'EX1_116:play',
  type: 'voice',
  cardId: 'EX1_116',
});
assert.strictEqual(player.getState().status, 'loading');
ctx.emit('canplay');
assert.strictEqual(player.getState().status, 'playing');

const p2 = createPlayerController(fakeCtx());
p2.playAudio({
  type: 'music',
  cardId: 'EX1_572',
  url: 'http://127.0.0.1:8767/api/audio/music/EX1_572',
  key: 'EX1_572:music',
});
assert.strictEqual(p2.getState().type, 'music');
assert.strictEqual(p2.getState().cardId, 'EX1_572');
assert.strictEqual(p2.getState().status, 'loading');
assert.ok(p2.getState().sessionId > 0);

const src = [
  fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'playerController.js'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'player.js'), 'utf8'),
].join('\n');
assert.ok(!/192\.168\.0\.111/.test(src));
assert.ok(!/127\.0\.0\.1/.test(src));
assert.ok(!/localhost/.test(src));
assert.ok(!/setTimeout\s*\(/.test(src));
assert.ok(!/if\s*\(\s*card\.id\s*===/.test(src));
assert.ok(!/if\s*\(\s*cardId\s*===/.test(src));
assert.ok(!/BOT_548/.test(src));
assert.ok(!/EX1_116/.test(src));
assert.ok(!/volume\s*=\s*0/.test(src));
assert.ok(src.includes('autoplay = false'));
assert.ok(src.includes('createInnerAudioContext') || fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'player.js'), 'utf8').includes('createInnerAudioContext'));

console.log('ok audioPlayer');
