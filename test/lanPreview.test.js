const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  resolveMiniListen,
  listLanIpv4,
  healthPayload,
  preferredLanUrl,
  writeLanApiBaseFile,
  formatMiniBanner,
} = require('../src/miniprogram/lanListen.js');
const { DEFAULT_API_BASE, resolveApiBase, getApiBase } = require('../miniprogram/utils/config.js');

const ROOT = path.resolve(__dirname, '..');

assert.strictEqual(DEFAULT_HOST, '0.0.0.0');
assert.strictEqual(DEFAULT_PORT, 8767);

const defaults = resolveMiniListen({});
assert.strictEqual(defaults.host, '0.0.0.0');
assert.strictEqual(defaults.port, 8767);

const emptyEnv = resolveMiniListen({ MINI_HOST: '', MINI_PORT: '' });
assert.strictEqual(emptyEnv.host, '0.0.0.0');
assert.strictEqual(emptyEnv.port, 8767);

const overridden = resolveMiniListen({ MINI_HOST: '127.0.0.1', MINI_PORT: '9001' });
assert.strictEqual(overridden.host, '127.0.0.1');
assert.strictEqual(overridden.port, 9001);

const health = healthPayload('0.0.0.0', 8767);
assert.strictEqual(health.ok, true);
assert.strictEqual(health.service, 'mini-api');
assert.strictEqual(health.host, '0.0.0.0');
assert.strictEqual(health.port, 8767);
const healthText = JSON.stringify(health).toLowerCase();
assert.ok(!/guid|bundle|fsb|casc|hearthstone|carddef/.test(healthText));

const nics = {
  'Loopback Pseudo-Interface': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.50', internal: false }],
  'VMware Network Adapter VMnet8': [{ family: 'IPv4', address: '192.168.80.1', internal: false }],
  Ethernet: [{ family: 'IPv4', address: '10.0.0.5', internal: false }],
  Tailscale: [{ family: 'IPv4', address: '100.64.1.2', internal: false }],
};
const lan = listLanIpv4(nics);
assert.ok(lan.preferred.includes('192.168.1.50'));
assert.ok(lan.preferred.includes('10.0.0.5'));
assert.ok(!lan.preferred.includes('127.0.0.1'));
assert.ok(!lan.preferred.includes('192.168.80.1'), 'virtual NIC must not be the preferred LAN set when Wi-Fi exists');
assert.strictEqual(preferredLanUrl(8767, nics, {}), 'http://192.168.1.50:8767');
assert.strictEqual(
  preferredLanUrl(8767, nics, { MINI_API_BASE: 'http://10.0.0.5:8767' }),
  'http://10.0.0.5:8767',
);

const onlyVpn = listLanIpv4({
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.22.0.1', internal: false }],
});
assert.ok(onlyVpn.preferred.includes('172.22.0.1'), 'if no physical LAN, still print RFC1918 candidates');

assert.strictEqual(DEFAULT_API_BASE, 'http://127.0.0.1:8767');
assert.strictEqual(getApiBase(), 'http://127.0.0.1:8767');
assert.strictEqual(resolveApiBase({ platform: 'devtools', lan: 'http://192.168.1.50:8767' }), 'http://127.0.0.1:8767');
assert.strictEqual(resolveApiBase({ platform: 'android', lan: 'http://192.168.1.50:8767' }), 'http://192.168.1.50:8767');
assert.strictEqual(resolveApiBase({ override: 'http://10.0.0.8:8767/', platform: 'devtools' }), 'http://10.0.0.8:8767');

const configSrc = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'config.js'), 'utf8');
assert.ok(configSrc.includes('http://127.0.0.1:8767'));
assert.ok(!/https?:\/\/192\.168\./.test(configSrc), 'config.js must not hardcode a LAN IP');
assert.ok(!/https?:\/\/10\.\d/.test(configSrc));
assert.ok(!/https?:\/\/172\.(1[6-9]|2\d|3[0-1])\./.test(configSrc));

const overrideSrc = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'apiBase.override.js'), 'utf8');
assert.ok(/apiBase:\s*null/.test(overrideSrc));

const pageSrc = [
  'miniprogram/pages/index/index.js',
  'miniprogram/pages/card/card.js',
  'miniprogram/utils/audio.js',
].map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');
assert.ok(pageSrc.includes('getApiBase'));
assert.ok(!/https?:\/\/192\.168\./.test(pageSrc));
assert.ok(!/https?:\/\/\d+\.\d+\.\d+\.\d+:8767/.test(pageSrc));

const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'miniprogram', 'miniServer.js'), 'utf8');
assert.ok(serverSrc.includes("server.listen(PORT, HOST"));
assert.ok(!serverSrc.includes("server.listen(PORT, '127.0.0.1'"));
assert.ok(serverSrc.includes('/api/mini/health'));
assert.ok(serverSrc.includes("Access-Control-Allow-Origin"));

const tmpLan = path.join(os.tmpdir(), 'hs-mini-apiBase.lan.js');
writeLanApiBaseFile(tmpLan, 'http://192.168.1.50:8767/');
const written = fs.readFileSync(tmpLan, 'utf8');
assert.ok(written.includes('http://192.168.1.50:8767'));
assert.ok(!written.includes('C:\\Hearthstone'));

const banner = formatMiniBanner({
  host: '0.0.0.0',
  port: 8767,
  lan: { preferred: ['192.168.1.50', '10.0.0.5'] },
  primaryLan: 'http://192.168.1.50:8767',
});
assert.ok(banner.includes('http://127.0.0.1:8767'));
assert.ok(banner.includes('http://192.168.1.50:8767'));
assert.ok(banner.includes('/api/mini/health'));
assert.ok(banner.includes('微信开发者工具'));
assert.ok(banner.includes('手机预览'));

function listenHealthOnce() {
  return new Promise((resolve, reject) => {
    const { host, port } = resolveMiniListen({ MINI_HOST: '127.0.0.1', MINI_PORT: '0' });
    assert.strictEqual(host, '127.0.0.1');
    const server = http.createServer((req, res) => {
      if (req.url === '/api/mini/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(healthPayload(host, boundPort)));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    let boundPort = port;
    server.listen(0, host, () => {
      boundPort = server.address().port;
      http.get('http://127.0.0.1:' + boundPort + '/api/mini/health', (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          server.close();
          try {
            assert.strictEqual(res.statusCode, 200);
            const json = JSON.parse(body);
            assert.strictEqual(json.ok, true);
            assert.strictEqual(json.service, 'mini-api');
            assert.strictEqual(json.host, '127.0.0.1');
            assert.strictEqual(json.port, boundPort);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  });
}

listenHealthOnce().then(() => {
  console.log('ok lanPreview');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
