const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractSoundsFromComponents, soundsFromCardDefBody } = require('../src/extractCardDefSounds.js');
const {
  classifyPrefabName,
  isMusicClipName,
  mappingFromPrefab,
  rollupStatus,
  guessClipFromCardId,
  countStatuses,
} = require('../src/music/musicStingerRules.js');

const ROOT = path.resolve(__dirname, '..');
const GUID = 'c6aaf3440b38a664db44d8870f3864d1';
const CLIP = 'Pegasus_Stinger_Leeroy_Jenkins';

assert.strictEqual(classifyPrefabName('MusicStinger'), 'music_stinger');
assert.strictEqual(classifyPrefabName('Play'), 'play');
assert.ok(isMusicClipName(CLIP));
assert.ok(!isMusicClipName('VO_EX1_116_Play_01'));

const leeroyBody = Buffer.from('Play.prefab:abd4cfd794032624785f78a5de7da354 MusicStinger.prefab:' + GUID);
const emptyBody = Buffer.from('m_Enabled');
const merged = extractSoundsFromComponents([emptyBody, leeroyBody]);
assert.ok(merged.musicStinger && merged.musicStinger.guid === GUID, 'empty trailing MonoBehaviour must not wipe CardDef');
assert.strictEqual(merged.play, 'abd4cfd794032624785f78a5de7da354');

const own = mappingFromPrefab({ name: 'MusicStinger', guid: GUID }, { file: 'prefab.unity3d', voiceKeys: [CLIP] }, 1);
assert.strictEqual(own.mappingType, 'own_music');
assert.strictEqual(own.audioClipName, CLIP);
assert.strictEqual(own.musicType, 'music_stinger');

const shared = mappingFromPrefab({ name: 'MusicStinger', guid: GUID }, { file: 'prefab.unity3d', voiceKeys: [CLIP] }, 4);
assert.strictEqual(shared.mappingType, 'shared_music');
assert.notStrictEqual(shared.mappingType, 'own_music');

assert.strictEqual(rollupStatus(false, [own]), 'music_stinger_found');
assert.strictEqual(rollupStatus(false, [shared]), 'shared_music_found');
assert.strictEqual(rollupStatus(false, []), 'no_music_reference');

const dangling = mappingFromPrefab(
  { name: 'MusicStinger', guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  null,
  1,
);
assert.ok(dangling.unresolved);
assert.strictEqual(rollupStatus(false, [dangling]), 'unresolved');
assert.notStrictEqual(rollupStatus(false, []), 'unresolved');

assert.throws(() => guessClipFromCardId('EX1_116'), /CardID/);

const guidIndexPath = path.join(ROOT, 'data', 'index', 'cache', 'guid-voice-index.json');
assert.ok(fs.existsSync(guidIndexPath));
const guidIndex = JSON.parse(fs.readFileSync(guidIndexPath, 'utf8')).guidIndex;
assert.ok(guidIndex[GUID], 'MusicStinger GUID must resolve in guid-voice-index');
assert.ok((guidIndex[GUID].voiceKeys || []).includes(CLIP), 'AudioClip must locate from GUID preload');

const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'audio-index.json'), 'utf8'));
assert.ok(audioIndex.clips[CLIP], 'AudioClip indexed');

const resultsPath = path.join(ROOT, 'data', 'music-verification', 'phase-1.0.1-results.json');
if (fs.existsSync(resultsPath)) {
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const leeroy = results.cards.find((c) => c.cardId === 'EX1_116');
  assert.ok(leeroy, 'EX1_116 in coverage results');
  assert.ok(
    leeroy.musicStatus === 'music_stinger_found' || leeroy.musicStatus === 'shared_music_found',
    'EX1_116 must be identified as Music Stinger, got ' + leeroy.musicStatus,
  );
  const m = (leeroy.musicMappings || []).find((x) => x.prefabGuid === GUID);
  assert.ok(m, 'EX1_116 mapping includes known MusicStinger GUID');
  assert.strictEqual(m.audioClipName, CLIP);
  const summed = countStatuses(results.cards);
  assert.strictEqual(summed.total, results.legendaryCollectibleMinions.total);
}

console.log('ok musicVerification');
