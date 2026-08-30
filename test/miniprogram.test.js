const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  adaptCard,
  publicDetail,
  buildCatalog,
  searchCards,
  featuredCards,
  getCardImageUrl,
  VERIFY_IDS,
} = require('../src/miniprogram/catalogAdapter.js');
const { createAudioUrls } = require('../src/miniprogram/audioUrls.js');
const { UnifiedAudioRepo } = require('../src/miniprogram/unifiedAudioRepo.js');

const ROOT = path.resolve(__dirname, '..');
const unified = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index', 'card-audio-index.json'), 'utf8'));
const catalog = buildCatalog(unified);
const urls = createAudioUrls('http://127.0.0.1:8767');

function raw(id) {
  return unified.cards[id];
}

function hasDevLeak(obj) {
  const s = JSON.stringify(obj).toLowerCase();
  return /guid|bundle|fsb|casc|carddef|unity|preload|soundspell/.test(s);
}

const leeroy = adaptCard(raw('EX1_116'));
assert.strictEqual(leeroy.name, '火车王里诺艾');
assert.strictEqual(leeroy.type, 'MINION');
assert.strictEqual(leeroy.rarity, 'LEGENDARY');
assert.strictEqual(leeroy.voice.play.available, true);
assert.strictEqual(leeroy.voice.attack.available, true);
assert.strictEqual(leeroy.voice.death.available, true);
assert.strictEqual(leeroy.music.available, true);
assert.strictEqual(leeroy.entrancePreview.available, true);
assert.ok(getCardImageUrl(leeroy).includes('EX1_116.png'));
assert.ok(getCardImageUrl('EX1_116').includes('EX1_116.png'));

const pub = publicDetail(leeroy);
assert.strictEqual(pub.voice.play.available, true);
assert.strictEqual(pub.music.available, true);
assert.strictEqual(pub.music.status, 'available');
assert.ok(pub.music.musicAssetId);
assert.ok(pub.music.audioClipName);
assert.ok(!pub.voice.play.voiceKey);
assert.ok(!hasDevLeak(pub));

const van = adaptCard(raw('VAN_NEW1_010'));
assert.strictEqual(van.voice.play.shared, true);
assert.strictEqual(van.voice.play.sourceCardId, 'NEW1_010');
assert.strictEqual(publicDetail(van).voice.play.note, '使用原卡语音');
assert.ok(van.music.available);
assert.strictEqual(publicDetail(van).music.status, 'shared');
assert.strictEqual(publicDetail(van).music.note, '使用原卡登场音乐');
assert.ok(publicDetail(van).music.musicAssetId);

const core = adaptCard(raw('CORE_DMF_067'));
assert.strictEqual(core.voice.play.shared, true);
assert.strictEqual(core.voice.play.sourceCardId, 'DMF_067');
assert.strictEqual(core.music.available, false);
assert.strictEqual(core.entrancePreview.available, false);

const won = adaptCard(raw('WON_302'));
assert.strictEqual(won.voice.play.shared, true);
assert.strictEqual(won.voice.play.sourceCardId, 'OG_202');
assert.ok(won.voice.play.voiceKey);
assert.ok(!String(won.voice.play.voiceKey).includes('WON_302') || won.voice.play.sourceCardId === 'OG_202');

const vac = adaptCard(raw('VAC_954'));
assert.strictEqual(vac.voice.play.shared, true);
assert.strictEqual(vac.voice.play.sourceCardId, 'VAC_301');
assert.notStrictEqual(vac.voice.play.voiceKey, 'VO_VAC_954_Play_01');

const cfm = adaptCard(raw('CFM_335'));
assert.strictEqual(cfm.voice.play.available, true);
assert.strictEqual(cfm.voice.play.shared, false);
assert.strictEqual(cfm.voice.play.voiceKey, 'CFM_ClumsyKodo_Play');

const cap = adaptCard(raw('CAP_107'));
assert.ok(cap);
assert.strictEqual(cap.voice.play.shared, true);
assert.ok(cap.voice.play.voiceKey.includes('CAP_106t'));
assert.ok(!cap.voice.play.voiceKey.includes('VO_CAP_107'));

const etc = adaptCard(raw('ETC_409'));
assert.strictEqual(etc.voice.play.available, true);
assert.strictEqual(etc.music.available, false);
assert.strictEqual(etc.entrancePreview.available, false);
assert.strictEqual(publicDetail(etc).music.available, false);
assert.strictEqual(publicDetail(etc).music.status, 'unavailable');

const bru = adaptCard(raw('BAR_048'));
assert.strictEqual(bru.music.available, true);
assert.ok(bru.music.musicAssetId);

const hits = searchCards(catalog.cards, '火车王', { limit: 20 });
assert.ok(hits.some((c) => c.id === 'EX1_116'));
const byId = searchCards(catalog.cards, 'EX1_116', { limit: 5 });
assert.strictEqual(byId[0].id, 'EX1_116');
const none = searchCards(catalog.cards, 'definitely-not-a-hearthstone-card-zzz', { limit: 5 });
assert.strictEqual(none.length, 0);

const featured = featuredCards(catalog.cards, { limit: 12 });
assert.ok(featured.length > 0 && featured.length <= 12);
assert.ok(featured.every((c) => c.hasEntrance && c.rarity === 'LEGENDARY'));
assert.ok(featured.every((c) => c.quickPlay && c.quickPlay.type === 'entrance'));
assert.ok(!featured.some((c) => hasDevLeak(c) && JSON.stringify(c).includes('prefabGuid')));

for (const id of VERIFY_IDS) {
  assert.ok(catalog.byId[id], id + ' missing from miniprogram catalog');
}

assert.ok(!JSON.stringify(featured[0]).includes('voiceKey'));

const repo = new UnifiedAudioRepo(unified, { clips: { VO_EX1_116_Play_01: { zhcnBundles: ['a'], prefabBundles: [] } } });
assert.strictEqual(repo.getCardVoice('EX1_116', 'play').playable, true);
assert.strictEqual(repo.getMusicMeta('EX1_116').audioClip, 'Pegasus_Stinger_Leeroy_Jenkins');
assert.strictEqual(repo.getMusicMeta('ETC_409'), null);
assert.strictEqual(repo.getCard('ETC_409').entrancePreview.available, false);
assert.ok(repo.getCard('WON_302').tracks.play.available);

assert.strictEqual(urls.getVoiceUrl({ id: 'EX1_116' }, 'play'), 'http://127.0.0.1:8767/api/audio/voice/EX1_116/play');
assert.strictEqual(urls.getMusicUrl('VAN_NEW1_010'), 'http://127.0.0.1:8767/api/audio/music/VAN_NEW1_010');
assert.strictEqual(urls.getEntranceUrl('EX1_116'), 'http://127.0.0.1:8767/api/audio/entrance/EX1_116');

const miniJs = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.js'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.js'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'audio.js'), 'utf8');
assert.ok(!/if\s*\(\s*card\.id\s*===\s*['"]EX1_116['"]/.test(miniJs));
assert.ok(!miniJs.includes('C:\\\\Hearthstone'));
assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'config.js'), 'utf8').includes('https://api.hsvoiceguide.online'));
assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'app.js'), 'utf8').indexOf('loadCatalog') < 0);
assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.js'), 'utf8').includes('loadCatalogPage'));
assert.ok(fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'mini-player', 'mini-player.wxml'), 'utf8').includes('<view class="wrap">'));
assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram', 'app.json')));
assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.wxml')));
assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.wxml')));

const cardItemWxml = fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.wxml'), 'utf8');
const cardItemWxss = fs.readFileSync(path.join(ROOT, 'miniprogram', 'components', 'card-item', 'card-item.wxss'), 'utf8');
const cardPageWxml = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'card', 'card.wxml'), 'utf8');
assert.ok(cardItemWxml.includes('mode="widthFix"'));
assert.ok(!cardItemWxml.includes('aspectFill'));
assert.ok(cardItemWxss.includes('aspect-ratio: 256 / 388'));
assert.ok(!/height:\s*168px/.test(cardItemWxss));
assert.ok(cardPageWxml.includes('mode="widthFix"'));

console.log('ok miniprogram');
