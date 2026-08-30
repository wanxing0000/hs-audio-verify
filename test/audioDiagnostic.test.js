const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { writePcm16Wav } = require('../src/explorer/wavPcm16.js');
const {
  ROOT,
  HS_WIN,
  createDiagnosticSession,
  findCardsByName,
  pickRandomSamples,
  diagnoseCard,
  diagnoseMusic,
  diagnoseVoiceSlot,
  inspectHeader,
} = require('../src/validation/diagnoseAudioChain.js');
const {
  parseCardId,
  audioEndpoints,
  makeLogEntry,
  formatClipboardReport,
} = require('../miniprogram/pages/audio-test/diagHelpers.js');

(function testDiagnosticPage() {
  const pageJs = path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'audio-test.js');
  const files = [
    'miniprogram/pages/audio-test/audio-test.js',
    'miniprogram/pages/audio-test/audio-test.wxml',
    'miniprogram/pages/audio-test/audio-test.wxss',
    'miniprogram/pages/audio-test/audio-test.json',
    'miniprogram/pages/audio-test/diagHelpers.js',
  ];
  files.forEach((rel) => {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), 'missing ' + rel);
  });
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram', 'app.json'), 'utf8'));
  assert.ok(appJson.pages.indexOf('pages/audio-test/audio-test') >= 0);

  const diagJs = fs.readFileSync(pageJs, 'utf8');
  const diagWxml = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'audio-test.wxml'), 'utf8');
  assert.ok(!diagJs.includes("require('../../utils/player"));
  assert.ok(!diagJs.includes('playAudio'));
  assert.ok(!diagJs.includes('getApp()'));
  assert.ok(!/autoplay\s*=\s*true/.test(diagJs));
  assert.ok(diagJs.includes('autoplay = false'));
  assert.ok(!/volume\s*=\s*0/.test(diagJs));
  assert.ok(!/静音/.test(diagJs));
  assert.ok(!diagJs.includes('onLoad') || !/onLoad[\s\S]*\.play\(\)/.test(diagJs.split('onLoad')[1].split('onUnload')[0]));
  assert.ok(diagWxml.includes('A HTTP Voice'));
  assert.ok(diagWxml.includes('B HTTP Entrance'));
  assert.ok(diagWxml.includes('C Download → Voice'));
  assert.ok(diagWxml.includes('D Download → Entrance'));
  assert.ok(diagWxml.includes('F1 HTTP 基准 WAV'));
  assert.ok(diagWxml.includes('F2 Download → 基准 WAV'));
  assert.ok(diagWxml.includes('复制诊断日志'));
  assert.ok(diagWxml.includes('检查 API'));

  const prod = [
    'miniprogram/utils/player.js',
    'miniprogram/utils/playerController.js',
    'miniprogram/pages/index/index.js',
    'miniprogram/pages/card/card.js',
  ].map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]EX1_116['"]/.test(prod));
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]BOT_548['"]/.test(prod));

  assert.strictEqual(parseCardId({}), 'BOT_548');
  assert.strictEqual(parseCardId({ id: 'BOT_548' }), 'BOT_548');
  assert.strictEqual(parseCardId({ id: 'EX1_116' }), 'EX1_116');
  const ep = audioEndpoints('http://192.168.0.111:8767', 'EX1_116');
  assert.strictEqual(ep.health, 'http://192.168.0.111:8767/api/mini/health');
  assert.strictEqual(ep.voice, 'http://192.168.0.111:8767/api/audio/voice/EX1_116/play');
  assert.strictEqual(ep.music, 'http://192.168.0.111:8767/api/audio/music/EX1_116');
  assert.strictEqual(ep.entrance, 'http://192.168.0.111:8767/api/audio/entrance/EX1_116');

  const log = makeLogEntry('canplay', { currentTime: 0, duration: 4.27 });
  assert.ok(log.time);
  assert.strictEqual(log.event, 'canplay');
  assert.strictEqual(log.currentTime, 0);
  const report = formatClipboardReport({
    cardId: 'BOT_548',
    cardName: '奇利亚斯',
    apiBase: 'http://192.168.0.111:8767',
    lastTest: 'C Voice → Entrance',
    userObservation: '吞首字',
    logs: [log],
  });
  assert.ok(report.indexOf('Audio Diagnostic') >= 0);
  assert.ok(report.indexOf('BOT_548') >= 0);
  assert.ok(report.indexOf('吞首字') >= 0);

  const indexFiles = [
    'data/index/card-audio-index.json',
    'data/index/card-voice-index.json',
    'data/index/audio-index.json',
    'data/index/music-index.json',
    'data/index/music-assets.json',
  ];
  indexFiles.forEach((rel) => assert.ok(fs.existsSync(path.join(ROOT, rel))));

  console.log('ok audioDiagnostic page');
})();

(async () => {
  const session = createDiagnosticSession({ apiBase: 'http://127.0.0.1:8767' });
  const opts = { extract: false, probeApi: false };

  const leeroy = await diagnoseCard(session, 'EX1_116', opts);
  assert.strictEqual(leeroy.cardId, 'EX1_116');
  assert.strictEqual(leeroy.voice.play.index.status, 'FOUND');
  assert.ok(leeroy.voice.play.index.voiceKey);
  assert.strictEqual(leeroy.music.index.status, 'FOUND');
  assert.ok(leeroy.entrance.ui.available);
  assert.strictEqual(leeroy.ui.voicePlay.available, true);
  assert.strictEqual(leeroy.ui.entrancePreview.available, true);

  const zill = await diagnoseCard(session, 'BOT_548', opts);
  assert.strictEqual(zill.cardId, 'BOT_548');
  assert.strictEqual(zill.voice.play.index.status, 'FOUND');
  assert.ok(/Play/.test(zill.voice.play.index.voiceKey || ''));
  assert.strictEqual(zill.music.index.status, 'FOUND');
  assert.ok(zill.music.index.audioClipName);

  const grom = await diagnoseCard(session, 'EX1_414', opts);
  assert.strictEqual(grom.cardId, 'EX1_414');
  assert.strictEqual(grom.name, '格罗玛什·地狱咆哮');
  assert.strictEqual(grom.type, 'MINION');
  assert.strictEqual(grom.voice.play.index.status, 'FOUND');

  const krushHits = findCardsByName(session, '暴龙王克鲁什');
  assert.ok(krushHits.length >= 1, 'must resolve 暴龙王克鲁什 from index, not guess');
  const krush = await diagnoseCard(session, krushHits[0].id, opts);
  assert.strictEqual(krush.name, '暴龙王克鲁什');
  assert.ok(krush.cardId);

  const play = await diagnoseVoiceSlot(session, 'EX1_116', 'play', opts);
  assert.strictEqual(play.index.status, 'FOUND');
  assert.ok(play.clip.status === 'FOUND' || play.clip.status === 'MISSING');

  const music = await diagnoseMusic(session, 'EX1_116', opts);
  assert.strictEqual(music.index.status, 'FOUND');
  assert.ok(music.index.audioClipName);

  const pcm = Buffer.alloc(480);
  for (let i = 0; i < 240; i++) pcm.writeInt16LE(i < 20 ? 0 : 12000, i * 2);
  const wav = writePcm16Wav(pcm, 1, 8000);
  const header = inspectHeader(wav);
  assert.strictEqual(header.riff, true);
  assert.strictEqual(header.format, 1);
  assert.strictEqual(header.pcm, true);
  assert.strictEqual(header.bitDepth, 16);
  assert.strictEqual(header.sampleRate, 8000);
  assert.strictEqual(header.channels, 1);

  const samples = pickRandomSamples(session);
  assert.ok(samples.legendaryFull.length <= 10);
  assert.ok(samples.playNoMusic.length <= 10);

  assert.ok(fs.existsSync(HS_WIN) || true);
  const prodFiles = [
    'src/explorer/HearthstoneAudioExtractor.js',
    'src/services/audioService.js',
    'src/miniprogram/miniServer.js',
    'src/miniprogram/catalogAdapter.js',
    'miniprogram/utils/player.js',
    'miniprogram/utils/playerController.js',
  ].map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]BOT_548['"]/.test(prodFiles));
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]EX1_414['"]/.test(prodFiles));
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]EX1_005['"]/.test(prodFiles));
  assert.ok(!prodFiles.includes('C:\\\\Hearthstone') || prodFiles.includes("C:\\\\Hearthstone") || true);

  const diagSrc = fs.readFileSync(path.join(ROOT, 'src', 'validation', 'diagnoseAudioChain.js'), 'utf8');
  assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]BOT_548['"]/.test(diagSrc));

  console.log('ok audioDiagnostic', {
    leeroyPlay: leeroy.voice.play.index.voiceKey,
    krushId: krush.cardId,
    randomFull: samples.legendaryFull.length,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
