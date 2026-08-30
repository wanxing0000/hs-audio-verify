const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseCardId,
  audioEndpoints,
  makeSessionId,
  classifyPlayVerdict,
  classifyDownload,
  formatClipboardReport,
} = require('../miniprogram/pages/audio-test/diagHelpers.js');

const ROOT = path.resolve(__dirname, '..');

const pageJsPath = path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'audio-test.js');
const pageWxmlPath = path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'audio-test.wxml');
assert.ok(fs.existsSync(pageJsPath));
assert.ok(fs.existsSync(pageWxmlPath));
assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'audio-test.wxss')));
assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'audio-test.json')));
assert.ok(fs.existsSync(path.join(ROOT, 'test', 'assets', 'test-tone-44100-mono.wav')));

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram', 'app.json'), 'utf8'));
assert.ok(appJson.pages.indexOf('pages/audio-test/audio-test') >= 0);

const js = fs.readFileSync(pageJsPath, 'utf8');
const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');

assert.ok(wxml.includes('A HTTP Voice'));
assert.ok(wxml.includes('B HTTP Entrance'));
assert.ok(wxml.includes('C Download → Voice'));
assert.ok(wxml.includes('D Download → Entrance'));
assert.ok(wxml.includes('F1 HTTP 基准 WAV'));
assert.ok(wxml.includes('F2 Download → 基准 WAV'));
assert.ok(wxml.includes('E 检查本地文件'));
assert.ok(wxml.includes('Audio Diagnostic 1.3.8'));

assert.ok(js.includes('getApiBase()'));
assert.ok(js.includes('wx.downloadFile'));
assert.ok(js.includes('statusCode'));
assert.ok(js.includes('tempFilePath'));
assert.ok(js.includes('DOWNLOAD_OK') || js.includes('classifyDownload'));
assert.ok(!js.includes("require('../../utils/player"));
assert.ok(!js.includes('playAudio'));
assert.ok(!/autoplay\s*=\s*true/.test(js));
assert.ok(!/\.seek\(/.test(js));
assert.ok(!/startTime/.test(js));

const player = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'player.js'), 'utf8');
const controller = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'playerController.js'), 'utf8');
assert.ok(!player.includes('1.3.8'));
assert.ok(!controller.includes('wx.downloadFile'));

assert.ok(server.includes('/api/audio-test/tone.wav'));
assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]BOT_548['"]/.test(js.split('cardDisplayName')[0]));

assert.strictEqual(parseCardId({}), 'BOT_548');
assert.strictEqual(parseCardId({ id: 'EX1_116' }), 'EX1_116');
const ep = audioEndpoints('http://192.168.0.111:8767', 'BOT_548');
assert.strictEqual(ep.voice, 'http://192.168.0.111:8767/api/audio/voice/BOT_548/play');
assert.strictEqual(ep.entrance, 'http://192.168.0.111:8767/api/audio/entrance/BOT_548');
assert.strictEqual(ep.tone, 'http://192.168.0.111:8767/api/audio-test/tone.wav');
assert.ok(makeSessionId('A').indexOf('1.3.8-A-') === 0);

assert.strictEqual(classifyPlayVerdict([
  { event: 'canplay', currentTime: 0, duration: 0 },
  { event: 'error', errCode: 10002 },
]), 'PLAY_NEVER_STARTED');
assert.strictEqual(classifyPlayVerdict([{ event: 'play' }]), 'PLAY_STARTED');
assert.strictEqual(classifyPlayVerdict([
  { event: 'play' },
  { event: 'timeUpdate', currentTime: 0.12, duration: 4.7 },
]), 'PLAYING_CONFIRMED');
assert.strictEqual(classifyDownload({ ok: true, statusCode: 200, tempFilePath: 'wxfile://tmp' }), 'DOWNLOAD_OK');
assert.strictEqual(classifyDownload({ ok: false, statusCode: 404 }), 'DOWNLOAD_HTTP_FAILED');

const report = formatClipboardReport({
  cardId: 'BOT_548',
  cardName: '奇利亚斯',
  apiBase: 'http://192.168.0.111:8767',
  tests: { A: { mode: 'HTTP → InnerAudioContext', result: 'PLAY_NEVER_STARTED', events: [] } },
});
assert.ok(report.indexOf('Audio Diagnostic 1.3.8') >= 0);
assert.ok(report.indexOf('TEST A') >= 0);

console.log('ok audioDiagnostic138');
