const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const {
  createMemoryFeedbackStore,
  createIpRateLimiter,
  createFeedbackService,
} = require('../src/services/feedbackService.js');
const {
  applyFeedbackCors,
  createPublicFeedbackHandler,
} = require('../src/services/feedbackAdmin.js');

function jsonReq(port, options) {
  options = options || {};
  const payload = options.body != null ? JSON.stringify(options.body) : null;
  return new Promise(function (resolve, reject) {
    const headers = Object.assign({}, options.headers || {});
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: options.path || '/api/feedback',
      method: options.method || 'POST',
      headers: headers,
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
        resolve({ status: res.statusCode, raw: raw, body: body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function withServer(service, fn) {
  const handlePublic = createPublicFeedbackHandler(service);
  return new Promise(function (resolve, reject) {
    const server = http.createServer(async function (req, res) {
      applyFeedbackCors(res);
      const url = new URL(req.url, 'http://127.0.0.1');
      let body = {};
      if (req.method === 'POST') {
        body = await new Promise(function (ok, fail) {
          const chunks = [];
          req.on('data', function (c) { chunks.push(c); });
          req.on('end', function () {
            if (!chunks.length) return ok({});
            try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { fail(e); }
          });
          req.on('error', fail);
        });
      }
      const result = await handlePublic(req, url, { body: body });
      if (!result || !result.handled) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(result.body == null ? '' : JSON.stringify(result.body));
    });
    server.listen(0, '127.0.0.1', async function () {
      try {
        await fn(server.address().port);
        server.close(function () { resolve(); });
      } catch (e) {
        server.close(function () { reject(e); });
      }
    });
  });
}

function assertNoSecret(text) {
  const blob = String(text || '');
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) assert.ok(!blob.includes(service), 'service role leaked');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(blob));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(blob));
}

(async function () {
  const limiter = createIpRateLimiter({ max: 5, windowMs: 10 * 60 * 1000 });
  const service = createFeedbackService(createMemoryFeedbackStore(), {
    limiter: limiter,
    newId: function () { return crypto.randomUUID(); },
    nowIso: function () { return '2026-08-29T12:00:00.000Z'; },
  });

  await withServer(service, async function (port) {
    const ok = await jsonReq(port, {
      body: { type: 'BUG', message: '卡牌详情页打不开了' },
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.ok, true);
    assert.ok(ok.body.feedback && ok.body.feedback.id);
    assert.strictEqual(ok.body.feedback.status, 'OPEN');
    assert.ok(ok.body.feedback.createdAt);
    assert.ok(!ok.body.feedback.message);
    assertNoSecret(ok.raw);
    console.log('ok TEST 1 public create');

    const empty = await jsonReq(port, { body: { type: 'BUG', message: '  ' } });
    assert.strictEqual(empty.status, 400);
    assert.strictEqual(empty.body.code, 'FEEDBACK_MESSAGE_TOO_SHORT');
    console.log('ok TEST 2 empty message');

    const long = await jsonReq(port, { body: { type: 'BUG', message: 'x'.repeat(2001) } });
    assert.strictEqual(long.status, 400);
    assert.strictEqual(long.body.code, 'FEEDBACK_MESSAGE_TOO_LONG');
    console.log('ok TEST 3 message too long');

    const badType = await jsonReq(port, { body: { type: 'bug', message: 'this is a valid length' } });
    assert.strictEqual(badType.status, 400);
    assert.strictEqual(badType.body.code, 'FEEDBACK_TYPE_INVALID');
    console.log('ok TEST 4 invalid type');

    const anon = await jsonReq(port, {
      body: { type: 'AUDIO', message: '某张卡没有语音' },
    });
    assert.strictEqual(anon.status, 200);
    assert.strictEqual(anon.body.feedback.status, 'OPEN');
    console.log('ok TEST 5 / TEST 6 default OPEN anonymous');

    const limitedIp = { 'x-forwarded-for': '203.0.113.10' };
    for (let i = 0; i < 5; i += 1) {
      const r = await jsonReq(port, {
        headers: limitedIp,
        body: { type: 'OTHER', message: 'rate limit public ' + i },
      });
      assert.strictEqual(r.status, 200, 'attempt ' + i);
    }
    const blocked = await jsonReq(port, {
      headers: limitedIp,
      body: { type: 'OTHER', message: 'rate limit public 5' },
    });
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.body.code, 'FEEDBACK_RATE_LIMITED');
    assertNoSecret(blocked.raw);
    console.log('ok TEST 7 public rate limit');
  });
}()).catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(function () { process.exit(1); }, 200);
}).then(function () {
  setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
});
