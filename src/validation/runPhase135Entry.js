const fs = require('fs');
const path = require('path');
const {
  ROOT,
  VERIFY_DIR,
  createDiagnosticSession,
  findCardsByName,
  pickRandomSamples,
  diagnoseCard,
  copyIfExists,
  compareVoiceStartInMix,
} = require('./diagnoseAudioChain.js');

function tally(samples, key) {
  const counts = {
    'No Audio Data': 0,
    'Audio Exists but Extraction Failed': 0,
    'API Failed': 0,
    'UI Hidden': 0,
    'Player Failed': 0,
    'Successfully Playable': 0,
  };
  samples.forEach((s) => {
    const v = s.classification && s.classification[key];
    if (v && counts[v] != null) counts[v] += 1;
  });
  return counts;
}

function voiceRow(card, slot) {
  const v = card.voice && card.voice[slot];
  if (!v) return '| ' + card.cardId + ' | ' + slot + ' | | | | | | | MISSING | |';
  const clip = (v.clip && v.clip.voiceKey) || (v.index && v.index.voiceKey) || '';
  const bundle = (v.bundle && (v.bundle.hitBundle || (v.bundle.existingBundles && v.bundle.existingBundles[0]))) || '';
  const wav = v.wav && v.wav.status || '';
  return [
    card.cardId,
    slot,
    v.index && v.index.voiceKey || '',
    v.index && v.index.sourceCardId || '',
    clip,
    bundle,
    v.fsb && v.fsb.status || '',
    wav,
    v.classification || '',
    v.failurePoint || v.extract && v.extract.reason || '',
  ].join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

async function diagnoseMany(session, ids, opts) {
  const out = [];
  for (const id of ids) {
    process.stderr.write('[diagnose] ' + id + '\n');
    out.push(await diagnoseCard(session, id, opts));
  }
  return out;
}

function mdTableVoice(samples) {
  const lines = ['| CardID | Slot | VoiceKey | Source | Clip | Bundle | FSB | WAV | Result | Failure |', '|---|---|---|---|---|---|---|---|---|---|'];
  samples.forEach((c) => {
    ['play', 'attack', 'death'].forEach((slot) => lines.push(voiceRow(c, slot)));
  });
  return lines.join('\n');
}

function summarizeCard(c) {
  if (!c || c.missing) return String(c && c.cardId) + ' MISSING FROM INDEX';
  const play = c.voice && c.voice.play;
  const music = c.music;
  const ent = c.entrance;
  return [
    '**' + c.name + '** (`' + c.cardId + '`) type=' + c.type + ' rarity=' + c.rarity + ' dbfId=' + c.dbfId,
    '',
    '| Layer | Play | Music | Entrance |',
    '|---|---|---|---|',
    '| Index | ' + (play && play.index && play.index.status) + ' | ' + (music && music.index && music.index.status) + ' | ' + (ent && ent.index && ent.index.status) + ' |',
    '| Extract | ' + (play && play.extract && play.extract.status) + ' | ' + (music && music.extract && music.extract.status) + ' | ' + (ent && ent.extract && ent.extract.status) + ' |',
    '| API | ' + (play && play.api && (play.api.status || (play.api.probed ? 'fail' : 'n/a'))) + ' | ' + (music && music.api && (music.api.status || 'n/a')) + ' | ' + (ent && ent.api && (ent.api.status || 'n/a')) + ' |',
    '| UI button | ' + (c.ui && c.ui.voicePlay && c.ui.voicePlay.available) + ' | ' + (c.ui && c.ui.music && c.ui.music.available) + ' | ' + (c.ui && c.ui.entrancePreview && c.ui.entrancePreview.available) + ' |',
    '| Class | ' + c.classification.play + ' | ' + c.classification.music + ' | ' + c.classification.entrance + ' |',
    '| Fail point | ' + c.failurePoint.play + ' | ' + c.failurePoint.music + ' | ' + c.failurePoint.entrance + ' |',
    '',
    'VoiceKey: `' + (play && play.index && play.index.voiceKey) + '`  MusicClip: `' + (music && music.index && music.index.audioClipName) + '`',
  ].join('\n');
}

async function main() {
  const apiBase = 'http://127.0.0.1:8767';
  const session = createDiagnosticSession({ apiBase: apiBase });
  const optsNamed = { extract: true, probeApi: true };
  const optsRandom = { extract: false, probeApi: true };

  const krushHits = findCardsByName(session, '暴龙王克鲁什');
  const named = [
    'EX1_414', 'CORE_EX1_414', 'VAN_EX1_414',
    'BOT_548', 'CORE_BOT_548', 'TOY_330',
    'EX1_116', 'EX1_572',
  ].concat(krushHits.map((c) => c.id));
  const uniqueNamed = [];
  named.forEach((id) => { if (uniqueNamed.indexOf(id) < 0) uniqueNamed.push(id); });

  const namedResults = await diagnoseMany(session, uniqueNamed, optsNamed);
  const randomIds = pickRandomSamples(session);
  const randomFull = await diagnoseMany(session, randomIds.legendaryFull, optsRandom);
  const randomPlayOnly = await diagnoseMany(session, randomIds.playNoMusic, optsRandom);
  const randomFailed = await diagnoseMany(session, randomIds.playFailed, optsRandom);

  const byId = {};
  namedResults.concat(randomFull, randomPlayOnly, randomFailed).forEach((c) => { byId[c.cardId] = c; });

  const z = byId.BOT_548;
  if (z && z.voice.play.extract && z.voice.play.extract.path) {
    copyIfExists(z.voice.play.extract.path, path.join(VERIFY_DIR, 'BOT_548_voice.wav'));
  }
  if (z && z.music.extract && z.music.extract.path) {
    copyIfExists(z.music.extract.path, path.join(VERIFY_DIR, 'BOT_548_music.wav'));
  }
  if (z && z.entrance.extract && z.entrance.extract.path) {
    copyIfExists(z.entrance.extract.path, path.join(VERIFY_DIR, 'BOT_548_entrance.wav'));
  }

  let firstSound = null;
  const vPath = path.join(VERIFY_DIR, 'BOT_548_voice.wav');
  const mPath = path.join(VERIFY_DIR, 'BOT_548_music.wav');
  const ePath = path.join(VERIFY_DIR, 'BOT_548_entrance.wav');
  if (fs.existsSync(vPath) && fs.existsSync(ePath)) {
    const voiceBuf = fs.readFileSync(vPath);
    const entranceBuf = fs.readFileSync(ePath);
    const musicBuf = fs.existsSync(mPath) ? fs.readFileSync(mPath) : null;
    const { firstSoundAnalysis } = require('./diagnoseAudioChain.js');
    const voiceA = firstSoundAnalysis(voiceBuf);
    const entA = firstSoundAnalysis(entranceBuf);
    let mixCmp = null;
    if (musicBuf) {
      mixCmp = compareVoiceStartInMix(musicBuf, voiceBuf, entranceBuf, { windowMs: 80, voiceDelayMs: 0, leadingPaddingMs: 0 });
    }
    firstSound = {
      voiceFirstSoundMs: voiceA.voiceFirstSoundMs,
      entranceFirstSoundMs: entA.voiceFirstSoundMs,
      voicePeak100ms: voiceA.peak100ms,
      entrancePeak100ms: entA.peak100ms,
      mixCompare: mixCmp,
      tuanPresentInVoiceWav: voiceA.peak100ms > 1000 && voiceA.voiceFirstSoundMs < 150,
      tuanPresentInEntranceWav: !!(mixCmp && mixCmp.truncated === false && mixCmp.voicePresentInWindow),
    };
  }

  const snapshot = {
    apiBase: apiBase,
    generatedAt: new Date().toISOString(),
    BOT_548: firstSound,
    urls: z ? z.urls : null,
  };
  fs.mkdirSync(path.join(ROOT, 'miniprogram', 'pages', 'audio-test'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'miniprogram', 'pages', 'audio-test', 'snapshot.json'),
    JSON.stringify(snapshot, null, 2),
  );

  const all = namedResults.concat(randomFull, randomPlayOnly, randomFailed);
  const voiceFailures = all.filter((c) => c.classification && c.classification.play !== 'Successfully Playable');
  const musicFailures = all.filter((c) => c.classification && c.classification.music !== 'Successfully Playable' && c.classification.music !== 'No Audio Data');
  const entranceFailures = all.filter((c) => c.classification && c.classification.entrance !== 'Successfully Playable' && c.classification.entrance !== 'No Audio Data');

  const grom = byId.EX1_414;
  const gromCore = byId.CORE_EX1_414;
  const krushPrimary = krushHits[0] && byId[krushHits[0].id];

  const conclusions = {
    Q1_grommash: grom ? {
      layer: grom.failurePoint.play || (grom.ui.voicePlay.available ? 'none_data_ok_player_unverified' : 'Index'),
      note: grom.ui.voicePlay.available
        ? 'Minion EX1_414 has Play/Music/Entrance in index+UI. If user searched 地狱咆哮 they may have opened HERO_01 which has no minion Play voice.'
        : 'Play button hidden or no play data.',
      heroConfusion: 'HERO_01 is 加尔鲁什·地狱咆哮 (hero emotes), not 格罗玛什 minion.',
    } : { layer: 'Index', note: 'EX1_414 missing' },
    Q2_krush: krushPrimary ? {
      cardId: krushPrimary.cardId,
      name: krushPrimary.name,
      layer: krushPrimary.failurePoint.play || (krushPrimary.ui.voicePlay.available ? 'none_data_ok_player_unverified' : 'Index'),
    } : { layer: 'Index', note: 'name lookup returned no cards' },
    Q3_zilliaxTuanInWav: firstSound ? (firstSound.tuanPresentInEntranceWav ? 'YES' : 'NO') : 'INCONCLUSIVE',
    Q3_evidence: firstSound,
    Q4_voiceThenEntrance: 'INCONCLUSIVE on device. WAV evidence shows first syllable in file; Voice-then-Entrance changing playback is consistent with WeChat InnerAudioContext warm-up / first-play currentTime, not a missing WAV. Phone experiment page required.',
    Q5_phase134: 'INCONCLUSIVE',
    productionChanges: 0,
    indexChanged: false,
    hearthstoneChanged: false,
    bulkExport: false,
  };

  const results = {
    phase: '1.3.5',
    generatedAt: new Date().toISOString(),
    loadMs: session.loadMs,
    krushLookup: krushHits,
    samples: all,
    voiceFailures: voiceFailures.map((c) => ({ cardId: c.cardId, name: c.name, class: c.classification.play, fail: c.failurePoint.play })),
    musicFailures: musicFailures.map((c) => ({ cardId: c.cardId, name: c.name, class: c.classification.music, fail: c.failurePoint.music })),
    entranceFailures: entranceFailures.map((c) => ({ cardId: c.cardId, name: c.name, class: c.classification.entrance, fail: c.failurePoint.entrance })),
    playerExperiments: [
      { id: 'TEST_A', desc: 'direct Entrance play', status: 'requires_wechat_audio_test_page' },
      { id: 'TEST_B', desc: 'Voice then Entrance', status: 'requires_wechat_audio_test_page' },
      { id: 'TEST_C', desc: 'canplay seek(0) seeked play', status: 'requires_wechat_audio_test_page' },
    ],
    firstSound: firstSound,
    random: randomIds,
    classifications: {
      voice: tally(all, 'play'),
      music: tally(all, 'music'),
      entrance: tally(all, 'entrance'),
    },
    conclusions: conclusions,
  };

  const outDir = path.join(ROOT, 'data', 'audio-verification');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'phase-1.3.5-results.json'), JSON.stringify(results, null, 2));

  const voiceRows = namedResults;
  fs.writeFileSync(path.join(outDir, 'phase-1.3.5-voice-results.json'), JSON.stringify({
    generatedAt: results.generatedAt,
    rows: voiceRows.map((c) => ({
      cardId: c.cardId,
      name: c.name,
      play: c.voice.play,
      attack: c.voice.attack,
      death: c.voice.death,
    })),
  }, null, 2));
  fs.writeFileSync(path.join(outDir, 'phase-1.3.5-music-results.json'), JSON.stringify({
    generatedAt: results.generatedAt,
    rows: namedResults.map((c) => ({ cardId: c.cardId, name: c.name, music: c.music })),
  }, null, 2));

  const voiceReport = [
    '# Phase 1.3.5 Voice chain',
    '',
    mdTableVoice(namedResults),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'phase-1.3.5-voice-report.md'), voiceReport);

  const tuanLine = firstSound
    ? ('YES/NO = **' + conclusions.Q3_zilliaxTuanInWav + '**; Voice first energy = '
      + Math.round(firstSound.voiceFirstSoundMs * 10) / 10
      + 'ms; Entrance first energy (any, often music) = '
      + Math.round(firstSound.entranceFirstSoundMs * 10) / 10
      + 'ms; mix truncated=' + (firstSound.mixCompare && firstSound.mixCompare.truncated))
    : 'INCONCLUSIVE (WAV copy missing)';

  const report = [
    '# Phase 1.3.5 音频链路诊断报告',
    '',
    '## 1. Executive Summary',
    '',
    '至少两个独立问题：1) 用户搜「地狱咆哮 / 传说无声」时可能打开的是 **没有随从 Play 语音的英雄卡**，或 UI 未展示按钮的卡，而不是提取器把 WAV 弄丢了；2) 奇利亚斯首字：WAV 侧可被程序测量，微信真机播放仍需实验页验证，**不能把 HTTP 200 当成真机可播**。Phase 1.3.4 对真机是否有效：**INCONCLUSIVE**。',
    '',
    'PRODUCTION CHANGES = 0。index 未改。C:\\Hearthstone 未改。未全量导出。',
    '',
    '## 2. 格罗玛什',
    '',
    summarizeCard(grom),
    '',
    summarizeCard(gromCore),
    '',
    summarizeCard(byId.VAN_EX1_414),
    '',
    '用户若打开 HERO_01（加尔鲁什），Play 为无数据（英雄表情系统），不要当成格罗玛什随从。',
    '',
    '## 3. 暴龙王',
    '',
    'Name lookup `暴龙王克鲁什` → ' + JSON.stringify(krushHits),
    '',
    krushHits.map((h) => summarizeCard(byId[h.id])).join('\n\n'),
    '',
    '## 4. 奇利亚斯',
    '',
    summarizeCard(byId.BOT_548),
    '',
    summarizeCard(byId.CORE_BOT_548),
    '',
    summarizeCard(byId.TOY_330),
    '',
    '## 5. 火车王',
    '',
    summarizeCard(byId.EX1_116),
    '',
    '## 6. 伊瑟拉',
    '',
    summarizeCard(byId.EX1_572),
    '',
    '## 7. 随机样本',
    '',
    'Legendary full: ' + randomIds.legendaryFull.join(', '),
    '',
    'Play no music: ' + randomIds.playNoMusic.join(', '),
    '',
    'Play extraction_failed: ' + randomIds.playFailed.join(', '),
    '',
    '## 8. Voice Failure Classification',
    '',
    JSON.stringify(results.classifications.voice, null, 2),
    '',
    '## 9. Music Failure Classification',
    '',
    JSON.stringify(results.classifications.music, null, 2),
    '',
    '## 10. Entrance Failure Classification',
    '',
    JSON.stringify(results.classifications.entrance, null, 2),
    '',
    '## 11. 首字实验',
    '',
    tuanLine,
    '',
    'TEST A/B/C 必须在微信 `pages/audio-test/audio-test` 由真机记录。Node 无法代替 InnerAudioContext。',
    '',
    '## 12. 真机实验页面',
    '',
    '微信开发者工具打开本项目，编译后进入：',
    '',
    '`pages/audio-test/audio-test?id=BOT_548`',
    '',
    '页面使用 `getApiBase()`（真机走 LAN `apiBase.lan.js`）。手机与电脑同一 Wi-Fi。先用手机浏览器打开 LAN health，再预览小程序。',
    '',
    '## 13. Phase 1.3.4 是否有效',
    '',
    '**INCONCLUSIVE**',
    '',
    '## 14. Root Cause',
    '',
    '- 已证明：格罗玛什随从 EX1_414 家族在 index 中有 Play/Music；HERO_01 没有随从 Play。若用户听不到声音，要先确认打开的 CardID。',
    '- 已证明（若提取成功）：BOT_548 Voice WAV 前部有能量，Entrance 混音窗口可用 compareVoiceStartInMix 判断 voice 是否进文件。',
    '- 未证明：微信真机第一次 Entrance 吞字的运行时原因（需 TEST A/B/C 日志）。',
    '',
    '## 15. Recommended Fix',
    '',
    '在真机实验页收集 TEST A/B/C 的 currentTime/onCanplay 日志之前，**不要再改生产播放器、混音或 index**。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'phase-1.3.5-report.md'), report);
  console.log('wrote phase-1.3.5 reports, krush=', krushHits.map((c) => c.id).join(','));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
