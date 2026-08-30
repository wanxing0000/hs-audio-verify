const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

function read(rel) {
  return fs.readFileSync(path.join(MP, rel), 'utf8');
}

const appJson = JSON.parse(read('app.json'));

assert.ok(appJson.pages.indexOf('pages/latest/latest') >= 0, 'TEST 1: latest registered');
assert.ok(appJson.pages.indexOf('pages/index/index') >= 0, 'TEST 2: index registered');
assert.ok(appJson.pages.indexOf('pages/more/more') >= 0, 'TEST 3: more registered');
assert.strictEqual(appJson.pages[0], 'pages/latest/latest', 'launch page is latest');

const tabBar = appJson.tabBar;
assert.ok(tabBar, 'tabBar exists');
assert.strictEqual(tabBar.position, 'bottom');
assert.strictEqual(tabBar.list.length, 3);
assert.strictEqual(tabBar.list[0].pagePath, 'pages/latest/latest');
assert.strictEqual(tabBar.list[0].text, '最新卡牌');
assert.strictEqual(tabBar.list[1].pagePath, 'pages/index/index');
assert.strictEqual(tabBar.list[1].text, '牌库');
assert.strictEqual(tabBar.list[2].pagePath, 'pages/more/more');
assert.strictEqual(tabBar.list[2].text, '更多');

const tabPaths = tabBar.list.map((item) => item.pagePath);
assert.ok(tabPaths.indexOf('pages/audio-test/audio-test') < 0, 'TEST 5: audio-test not in tabBar');
assert.ok(tabPaths.indexOf('pages/card/card') < 0, 'TEST 6: card not in tabBar');
assert.ok(appJson.pages.indexOf('pages/audio-test/audio-test') >= 0, 'audio-test still registered');
assert.ok(appJson.pages.indexOf('pages/card/card') >= 0, 'card still registered');

['latest.js', 'latest.wxml', 'latest.wxss', 'latest.json'].forEach((name) => {
  assert.ok(fs.existsSync(path.join(MP, 'pages', 'latest', name)), 'TEST 7: ' + name);
});
['more.js', 'more.wxml', 'more.wxss', 'more.json'].forEach((name) => {
  assert.ok(fs.existsSync(path.join(MP, 'pages', 'more', name)), 'TEST 8: ' + name);
});

const icons = [
  'latest.png',
  'latest-active.png',
  'library.png',
  'library-active.png',
  'more.png',
  'more-active.png',
];
icons.forEach((name) => {
  const p = path.join(MP, 'assets', 'tabbar', name);
  assert.ok(fs.existsSync(p), 'TEST 9: missing icon ' + name);
  assert.ok(fs.statSync(p).size > 50, 'icon too small ' + name);
});
tabBar.list.forEach((item) => {
  assert.ok(item.iconPath, item.text + ' iconPath');
  assert.ok(item.selectedIconPath, item.text + ' selectedIconPath');
  assert.ok(fs.existsSync(path.join(MP, item.iconPath)), item.iconPath);
  assert.ok(fs.existsSync(path.join(MP, item.selectedIconPath)), item.selectedIconPath);
});

assert.ok(fs.existsSync(path.join(MP, 'pages', 'index', 'index.js')), 'TEST 10: index path kept');
assert.ok(fs.existsSync(path.join(MP, 'pages', 'index', 'index.wxml')));
assert.ok(appJson.pages.indexOf('pages/library/library') < 0);

const latestJs = read('pages/latest/latest.js');
assert.ok(!/TIME_TRAVEL|featured|loadCatalog|\/api\/mini\/catalog/.test(latestJs));
assert.ok(latestJs.includes('hasData'));
assert.ok(latestJs.includes('/pages/card/card?id='));
assert.ok(read('pages/latest/latest.wxml').includes('card-item'));
assert.ok(read('pages/latest/latest.json').includes('card-item'));

const indexJs = read('pages/index/index.js');
assert.ok(indexJs.includes('loadCatalogPage'));
assert.ok(indexJs.includes('searchRemote'));
assert.ok(!indexJs.includes('onShow'));
assert.ok(indexJs.includes("wx.navigateTo({ url: '/pages/card/card?id='"));

console.log('ok tabBar');
