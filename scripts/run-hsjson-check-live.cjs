const { CARDS_URL, COLLECTIBLE_URL, parseRemoteMeta } = require('../src/services/hsjsonUpdater.js');

async function headMeta(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    err.code = 'REMOTE_UNAVAILABLE';
    throw err;
  }
  return parseRemoteMeta(res.headers, url);
}

(async function () {
  console.log('[hsjson-live] HEAD only, no download, no production writes');
  try {
    const cards = await headMeta(CARDS_URL);
    const collectible = await headMeta(COLLECTIBLE_URL);
    const cardsOk = !!(cards.etag || cards.lastModified || cards.contentLength != null);
    const collOk = !!(collectible.etag || collectible.lastModified || collectible.contentLength != null);
    if (!cardsOk || !collOk) {
      console.log('[hsjson-live] status=REMOTE UNAVAILABLE');
      console.log('[hsjson-live] LIVE CHECK SKIPPED / REMOTE UNAVAILABLE');
      return;
    }
    console.log('[hsjson-live] cards etag=' + (cards.etag || 'null') + ' length=' + cards.contentLength);
    console.log('[hsjson-live] collectible etag=' + (collectible.etag || 'null') + ' length=' + collectible.contentLength);
    console.log('[hsjson-live] status=OK');
  } catch (e) {
    console.log('[hsjson-live] status=REMOTE UNAVAILABLE');
    console.log('[hsjson-live] LIVE CHECK SKIPPED / REMOTE UNAVAILABLE');
  }
})();
