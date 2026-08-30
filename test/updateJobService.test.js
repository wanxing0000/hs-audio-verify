const assert = require('assert');
const {
  createMemoryUpdateJobStore,
  createUpdateJobService,
  sanitizeJobMessage,
} = require('../src/services/updateJobService.js');

function service(store) {
  return createUpdateJobService(store || createMemoryUpdateJobStore(), {
    nowIso: function () { return '2026-08-29T12:00:00.000Z'; },
    newId: function () { return '22222222-2222-4222-8222-222222222222'; },
  });
}

(async function () {
  {
    const svc = service();
    const job = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    assert.strictEqual(job.status, 'PENDING');
    assert.strictEqual(job.job_type, 'HSJSON_SNAPSHOT');
    assert.strictEqual(job.source, 'hearthstonejson');
    console.log('ok TEST 1 create job');
  }

  {
    const store = createMemoryUpdateJobStore();
    let n = 0;
    const svc = createUpdateJobService(store, {
      nowIso: function () { return '2026-08-29T12:00:00.000Z'; },
      newId: function () {
        n += 1;
        return '33333333-3333-4333-8333-' + String(n).padStart(12, '0');
      },
    });
    const job = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    const checking = await svc.updateJobStatus(job.id, 'CHECKING');
    assert.strictEqual(checking.status, 'CHECKING');
    const downloading = await svc.updateJobStatus(job.id, 'DOWNLOADING');
    assert.strictEqual(downloading.status, 'DOWNLOADING');
    console.log('ok TEST 2 status transition');
  }

  {
    const svc = service();
    const job = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    const failed = await svc.failJob(
      job.id,
      'VALIDATION_FAILED',
      'boom\n    at Object.<anonymous> (C:\\secret\\file.js:1:1)\ntoken=admin-token SUPERBASE_SERVICE_ROLE_KEY=sb_secret_nope',
    );
    assert.strictEqual(failed.status, 'FAILED');
    assert.strictEqual(failed.error_code, 'VALIDATION_FAILED');
    assert.ok(!String(failed.error_message).includes('at Object'));
    assert.ok(!String(failed.error_message).includes('admin-token'));
    assert.ok(!String(failed.error_message).includes('sb_secret'));
    assert.ok(failed.failed_at);
    assert.ok(failed.finished_at);
    const cleaned = sanitizeJobMessage('password=hunter2 eyJaaaaaaaaaaa');
    assert.strictEqual(cleaned, '操作失败');
    console.log('ok TEST 3 failed job');
  }

  {
    const svc = service();
    const job = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    await svc.updateJobStatus(job.id, 'CHECKING');
    const done = await svc.completeJob(job.id, { dataVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    assert.strictEqual(done.status, 'SUCCEEDED');
    assert.strictEqual(done.data_version_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.ok(done.finished_at);
    console.log('ok TEST 4 completed job');
  }

  {
    const store = createMemoryUpdateJobStore();
    let n = 0;
    const svc = createUpdateJobService(store, {
      nowIso: function () { return '2026-08-29T12:00:0' + n + '.000Z'; },
      newId: function () {
        n += 1;
        return '44444444-4444-4444-8444-' + String(n).padStart(12, '0');
      },
    });
    const a = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    await svc.completeJob((await svc.updateJobStatus(a.id, 'CHECKING')).id);
    const b = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    const listed = await svc.listJobs();
    assert.strictEqual(listed.length, 2);
    assert.strictEqual(listed[0].id, b.id);
    console.log('ok TEST 5 list jobs');
  }

  {
    const store = createMemoryUpdateJobStore();
    let n = 0;
    const svc = createUpdateJobService(store, {
      nowIso: function () { return '2026-08-29T12:00:00.000Z'; },
      newId: function () {
        n += 1;
        return '55555555-5555-4555-8555-' + String(n).padStart(12, '0');
      },
    });
    const a = await svc.createJob({ job_type: 'HSJSON_SNAPSHOT' });
    await svc.updateJobStatus(a.id, 'CHECKING');
    await assert.rejects(
      () => svc.createJob({ job_type: 'HSJSON_SNAPSHOT' }),
      function (err) { return err && err.code === 'DATA_UPDATE_ALREADY_RUNNING'; },
    );
    console.log('ok TEST 6 duplicate running job blocked');
  }

  console.log('ok updateJobService');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
