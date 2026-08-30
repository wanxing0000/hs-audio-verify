const { createHsjsonUpdater } = require('../src/services/hsjsonUpdater.js');

(async function () {
  const updater = createHsjsonUpdater({ rootDir: process.cwd() });
  try {
    const result = await updater.checkRemoteSnapshot();
    console.log(updater.formatCheckLog(result));
    if (result.status === 'UNKNOWN' && result.error === 'REMOTE_UNAVAILABLE') {
      process.exitCode = 0;
    }
  } catch (e) {
    console.log('[hsjson] source=hearthstonejson locale=zhCN');
    console.log('[hsjson] status=UNKNOWN');
    console.log('[hsjson] error=' + ((e && e.code) || 'REMOTE_UNAVAILABLE'));
    process.exitCode = 0;
  }
})();
