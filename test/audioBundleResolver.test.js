const assert = require('assert');
const fs = require('fs');
const path = require('path');
const resolver = require('../src/explorer/audioBundleResolver.js');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');

const ROOT = path.resolve(__dirname, '..');
const HS = 'C:\\Hearthstone';

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const unified = loadJson('data/index/card-audio-index.json');
const audioIndex = loadJson('data/index/audio-index.json');
const musicAssets = loadJson('data/index/music-assets.json');
const repo = new UnifiedAudioRepo(unified, audioIndex, musicAssets);

const winNames = [
  'essential_base_global-prefab-0.unity3d',
  'essential_base_global-audio-0.unity3d',
  'essential_base_zhcn-content-0.unity3d',
  'playsound_base_zhcn-775a814d-audio-0.unity3d',
  'initial_base_global-775a814d-prefab-1.unity3d',
  'soundlegend_base_global-6c782fd0-audio-0.unity3d',
];

assert.strictEqual(resolver.clipNameMatches("Bru'kan_Play", "Bru'kan_Play"), true);
assert.strictEqual(resolver.clipNameMatches("Bru'kan_Play", 'Brukan_Play'), true);
assert.strictEqual(resolver.clipNameMatches('VO_EX1_414_Play_01.wav', 'VO_EX1_414_Play_01'), true);
assert.ok(!resolver.clipNameMatches('VO_EX1_414_Play_01', 'VO_EX1_116_Play_01'));

const sib = resolver.siblingAudioBundles('essential_base_global-prefab-0.unity3d', winNames);
assert.deepStrictEqual(sib, ['essential_base_global-audio-0.unity3d']);

const gromAsset = repo.getVoiceAsset('VO_EX1_414_Play_01');
const gromCands = resolver.listCandidates(gromAsset, {
  clipName: 'VO_EX1_414_Play_01',
  winNames,
  hsWin: HS + '\\Data\\Win',
});
assert.ok(gromCands.some((c) => c.bundleName === 'essential_base_global-audio-0.unity3d'));
assert.ok(gromCands.some((c) => c.reason === 'sibling_audio_bundle'));
assert.ok(gromCands.some((c) => c.bundleName === 'essential_base_zhcn-content-0.unity3d'));
assert.ok(gromCands.every((c) => typeof c.reason === 'string' && c.priority > 0 && c.evidence));
const prefabPri = gromCands.find((c) => c.bundleName === 'essential_base_global-prefab-0.unity3d').priority;
const audioPri = gromCands.find((c) => c.bundleName === 'essential_base_global-audio-0.unity3d').priority;
assert.ok(audioPri > prefabPri, 'audio sibling must outrank prefab metadata');

const musicAsset = repo.getVoiceAsset('Pegasus_Stinger_Horde1');
const musicCands = resolver.listCandidates(musicAsset, {
  clipName: 'Pegasus_Stinger_Horde1',
  isMusic: true,
  winNames,
  musicCatalogNames: ['soundlegend_base_global-6c782fd0-audio-0.unity3d'],
});
assert.ok(musicCands.some((c) => c.reason === 'soundlegend_audio_bundle'));
const voiceNoLegend = resolver.listCandidates(gromAsset, {
  clipName: 'VO_EX1_414_Play_01',
  isMusic: false,
  winNames,
  musicCatalogNames: ['soundlegend_base_global-6c782fd0-audio-0.unity3d'],
});
assert.ok(!voiceNoLegend.some((c) => c.reason === 'soundlegend_audio_bundle'));

const invalid = resolver.applyInspectionScore(
  { bundleName: 'prefab.unity3d', priority: 40, reason: 'indexed_prefab_bundle' },
  { clipFound: true, fsbFound: true, offsetValid: false, decode: null, kind: 'prefab' },
);
const valid = resolver.applyInspectionScore(
  { bundleName: 'audio.unity3d', priority: 200, reason: 'sibling_audio_bundle' },
  { clipFound: true, fsbFound: true, offsetValid: true, decode: 'success', kind: 'audio' },
);
assert.strictEqual(invalid.valid, false);
assert.strictEqual(valid.valid, true);
const winner = resolver.pickWinner([invalid, valid]);
assert.strictEqual(winner.bundleName, 'audio.unity3d');
assert.strictEqual(
  resolver.classifyFromInspections([invalid.inspection]),
  resolver.FAILURE.FSB_OFFSET_INVALID,
);

assert.ok(resolver.clipObjectMatches('Gilneas_Play_Stinger_2', 'Gilneas_Play_Stinger_6', '798', '798'));
assert.ok(!resolver.clipObjectMatches('Gilneas_Play_Stinger_2', 'Gilneas_Play_Stinger_6', '1', '2'));
assert.ok(resolver.clipNameMatches('Gilneas_Play_Stinger_4', 'Gilneas_Play_Stinger_4'));
assert.ok(!resolver.clipNameMatches('Gilneas_Play_Stinger_2', 'Gilneas_Play_Stinger_6'));

const soundDef = resolver.parseSoundDefWavRefs('x.Gilneas_Play_Stinger_6.wav:ab456f99bb1621740ade826f5651d0fd.y');
assert.strictEqual(soundDef.length, 1);
assert.strictEqual(soundDef[0].clipName, 'Gilneas_Play_Stinger_6');
assert.strictEqual(soundDef[0].clipGuid, 'ab456f99bb1621740ade826f5651d0fd');
assert.strictEqual(
  resolver.pickSoundDefClipGuid(soundDef, 'Gilneas_Play_Stinger_6'),
  'ab456f99bb1621740ade826f5651d0fd',
);
assert.strictEqual(resolver.normalizeGuid('AB456F99BB1621740ADE826F5651D0FD'), 'ab456f99bb1621740ade826f5651d0fd');
assert.strictEqual(resolver.normalizeGuid('not-a-guid'), '');
assert.strictEqual(resolver.pickSoundDefClipGuid([], 'missing'), '');

const leeroy = repo.getVoiceAsset('VO_EX1_116_Play_01');
assert.ok(leeroy.zhcnBundles && leeroy.zhcnBundles.length > 0);
const leeroyCands = resolver.listCandidates(leeroy, {
  clipName: 'VO_EX1_116_Play_01',
  winNames: leeroy.zhcnBundles.concat(winNames),
});
assert.strictEqual(leeroyCands[0].reason, 'zhcn_audio_bundle');

assert.strictEqual(unified.cards.VAN_NEW1_010.voice.play.status, 'shared');
assert.strictEqual(unified.cards.VAN_NEW1_010.voice.play.sourceCardId, 'NEW1_010');
assert.ok(repo.getCardVoice('VAN_NEW1_010', 'play').playable);
assert.ok(repo.getCardVoice('VAN_NEW1_010', 'play').voiceKey.includes('NEW1_010'));

assert.strictEqual(unified.cards.VAC_954.voice.play.status, 'shared');
assert.strictEqual(unified.cards.VAC_954.voice.play.sourceCardId, 'VAC_301');
assert.notStrictEqual(unified.cards.VAC_954.voice.play.voiceKey, 'VO_VAC_954_Play_01');

assert.ok(unified.cards.CFM_335.voice.play.voiceKey);
assert.ok(/ClumsyKodo|CFM_/i.test(unified.cards.CFM_335.voice.play.voiceKey));

assert.ok(!repo.getCardVoice('HERO_01', 'play').playable, 'HERO_01 must not fabricate Play');
assert.ok(!repo.getMusicMeta('ETC_409'), 'ETC_409 must not fabricate Music');

assert.ok(unified.cards.EX1_543);
assert.ok(unified.cards.CORE_EX1_543);
assert.ok(unified.cards.VAN_EX1_543);
assert.strictEqual(unified.cards.EX1_543.voice.play.voiceKey, 'SFX_EX1_543_EnterPlay');
assert.ok(
  unified.cards.CORE_EX1_543.voice.play.status === 'shared'
  || unified.cards.CORE_EX1_543.voice.play.voiceKey === 'SFX_EX1_543_EnterPlay',
);

const prodFiles = [
  'src/explorer/HearthstoneAudioExtractor.js',
  'src/explorer/audioBundleResolver.js',
  'src/services/audioService.js',
  'src/miniprogram/unifiedAudioRepo.js',
  'src/miniprogram/miniServer.js',
].map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const prod = prodFiles.join('\n');
assert.ok(!/if\s*\(\s*cardId\s*===\s*['"]GIL_598['"]/.test(prod));
assert.ok(!/if\s*\(\s*clipName\s*===\s*['"]Gilneas_Play_Stinger_6['"]/.test(prod));
assert.ok(!/writeFileSync\(\s*['"]C:\\\\Hearthstone/.test(prod));
assert.ok(!/writeFileSync\([^)]*hsWin/.test(prod));

const indexFiles = [
  'data/index/card-audio-index.json',
  'data/index/music-index.json',
  'data/index/music-assets.json',
  'data/index/card-voice-index.json',
  'data/index/audio-index.json',
];
for (const rel of indexFiles) {
  assert.ok(fs.existsSync(path.join(ROOT, rel)));
}

console.log('ok audioBundleResolver unit', {
  gromCandidates: gromCands.map((c) => c.bundleName + ':' + c.reason),
  musicCandidates: musicCands.slice(0, 4).map((c) => c.reason),
});
