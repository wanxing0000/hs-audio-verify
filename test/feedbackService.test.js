const assert = require('assert');
const crypto = require('crypto');
const {
  FEEDBACK_TYPES,
  FEEDBACK_STATUSES,
  validateCreate,
  createMemoryFeedbackStore,
  createIpRateLimiter,
  createFeedbackService,
} = require('../src/services/feedbackService.js');

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function nowSeq() {
  let n = 0;
  return function () {
    n += 1;
    return '2026-08-29T12:00:0' + n + '.000Z';
  };
}

(async function () {
  const body = validateCreate({ type: 'BUG', message: '卡牌详情页打不开了' });
  assert.strictEqual(body.type, 'BUG');
  assert.ok(body.message.length >= 5);

  const store = createMemoryFeedbackStore();
  const service = createFeedbackService(store, {
    newId: function () { return ID_A; },
    nowIso: function () { return '2026-08-29T12:00:00.000Z'; },
  });
  const row = await service.createFeedback({ type: 'FEATURE_REQUEST', message: '希望增加收藏功能' });
  assert.strictEqual(row.status, 'OPEN');
  assert.strictEqual(row.type, 'FEATURE_REQUEST');
  assert.strictEqual(row.content, '希望增加收藏功能');
  assert.strictEqual(row.id, ID_A);
  const listed = await service.listFeedback({ page: 1, pageSize: 20 });
  assert.strictEqual(listed.items.length, 1);
  assert.strictEqual(listed.items[0].message, '希望增加收藏功能');
  assert.ok(!('service_role' in listed.items[0]));
  console.log('ok TEST 1 / TEST 5 / TEST 6 service create anonymous default OPEN');

  try {
    validateCreate({ type: 'BUG', message: '   ' });
    assert.fail('empty message should throw');
  } catch (e) {
    assert.strictEqual(e.code, 'FEEDBACK_MESSAGE_TOO_SHORT');
    assert.strictEqual(e.status, 400);
  }
  console.log('ok TEST 2 empty message');

  try {
    validateCreate({ type: 'BUG', message: 'x'.repeat(2001) });
    assert.fail('long message should throw');
  } catch (e) {
    assert.strictEqual(e.code, 'FEEDBACK_MESSAGE_TOO_LONG');
    assert.strictEqual(e.status, 400);
  }
  console.log('ok TEST 3 message too long');

  try {
    validateCreate({ type: 'bug', message: 'this is a valid length' });
    assert.fail('invalid type should throw');
  } catch (e) {
    assert.strictEqual(e.code, 'FEEDBACK_TYPE_INVALID');
    assert.strictEqual(e.status, 400);
  }
  console.log('ok TEST 4 invalid type');

  const limiter = createIpRateLimiter({ max: 5, windowMs: 10 * 60 * 1000 });
  const limited = createFeedbackService(createMemoryFeedbackStore(), {
    limiter: limiter,
    newId: function () { return crypto.randomUUID(); },
  });
  for (let i = 0; i < 5; i += 1) {
    await limited.createFeedback({ type: 'OTHER', message: 'rate limit body ' + i }, { ip: '10.0.0.9' });
  }
  try {
    await limited.createFeedback({ type: 'OTHER', message: 'rate limit body 5' }, { ip: '10.0.0.9' });
    assert.fail('6th should rate limit');
  } catch (e) {
    assert.strictEqual(e.code, 'FEEDBACK_RATE_LIMITED');
    assert.strictEqual(e.status, 429);
  }
  await limited.createFeedback({ type: 'OTHER', message: 'other ip still works' }, { ip: '10.0.0.10' });
  console.log('ok TEST 7 rate limit');

  const seeded = createMemoryFeedbackStore([
    { id: ID_A, content: 'alpha feedback message', type: 'BUG', status: 'OPEN', created_at: '2026-08-29T12:00:03.000Z', updated_at: '2026-08-29T12:00:03.000Z' },
    { id: ID_B, content: 'beta feedback message', type: 'AUDIO', status: 'IN_PROGRESS', created_at: '2026-08-29T12:00:02.000Z', updated_at: '2026-08-29T12:00:02.000Z' },
    { id: ID_C, content: 'gamma feedback message', type: 'BUG', status: 'OPEN', created_at: '2026-08-29T12:00:01.000Z', updated_at: '2026-08-29T12:00:01.000Z' },
  ]);
  const listedService = createFeedbackService(seeded, { nowIso: nowSeq() });
  const page1 = await listedService.listFeedback({ page: 1, pageSize: 2 });
  assert.strictEqual(page1.pagination.total, 3);
  assert.strictEqual(page1.pagination.totalPages, 2);
  assert.strictEqual(page1.items.length, 2);
  assert.strictEqual(page1.items[0].id, ID_A);
  const openOnly = await listedService.listFeedback({ status: 'OPEN', page: 1, pageSize: 20 });
  assert.strictEqual(openOnly.pagination.total, 2);
  openOnly.items.forEach(function (item) { assert.strictEqual(item.status, 'OPEN'); });
  const audioOnly = await listedService.listFeedback({ type: 'AUDIO', page: 1, pageSize: 20 });
  assert.strictEqual(audioOnly.pagination.total, 1);
  assert.strictEqual(audioOnly.items[0].type, 'AUDIO');
  const detail = await listedService.getFeedbackById(ID_B);
  assert.strictEqual(detail.message, 'beta feedback message');
  try {
    await listedService.getFeedbackById(MISSING);
    assert.fail('missing should 404');
  } catch (e) {
    assert.strictEqual(e.code, 'FEEDBACK_NOT_FOUND');
    assert.strictEqual(e.status, 404);
  }
  const updated = await listedService.updateFeedbackStatus(ID_A, 'IN_PROGRESS');
  assert.strictEqual(updated.fromStatus, 'OPEN');
  assert.strictEqual(updated.toStatus, 'IN_PROGRESS');
  assert.strictEqual(updated.row.status, 'IN_PROGRESS');
  assert.ok(updated.row.updatedAt);
  assert.notStrictEqual(updated.row.updatedAt, '2026-08-29T12:00:03.000Z');
  const after = await listedService.getFeedbackById(ID_A);
  assert.strictEqual(after.type, 'BUG');
  assert.strictEqual(after.message, 'alpha feedback message');
  try {
    await listedService.updateFeedbackStatus(ID_A, 'DONE');
    assert.fail('invalid status');
  } catch (e) {
    assert.strictEqual(e.code, 'FEEDBACK_STATUS_INVALID');
    assert.strictEqual(e.status, 400);
  }
  assert.ok(FEEDBACK_TYPES.indexOf('CARD_DATA') >= 0);
  assert.ok(FEEDBACK_STATUSES.indexOf('CLOSED') >= 0);
  console.log('ok service list/filter/detail/status');
}()).catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
  setTimeout(function () { process.exit(1); }, 200);
}).then(function () {
  setTimeout(function () { process.exit(process.exitCode || 0); }, 200);
});
