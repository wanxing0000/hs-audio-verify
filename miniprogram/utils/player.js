const { createPlayerController } = require('./playerController.js');

function applyInnerAudioOptions() {
  try {
    if (typeof wx !== 'undefined' && wx.setInnerAudioOption) {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true,
      });
    }
  } catch (e) {}
}

function createWxContext() {
  try {
    const ctx = wx.createInnerAudioContext();
    if (ctx) {
      ctx.autoplay = false;
      try { ctx.obeyMuteSwitch = false; } catch (err) {}
    }
    return ctx;
  } catch (e) {
    return null;
  }
}

function getWxPlatform() {
  try {
    if (typeof wx === 'undefined' || !wx.getSystemInfoSync) return '';
    const info = wx.getSystemInfoSync();
    return String((info && info.platform) || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

function downloadWxAudio(url, hooks) {
  hooks = hooks || {};
  let settled = false;
  let task = null;

  function finish(kind, payload) {
    if (settled) return;
    settled = true;
    if (kind === 'success') {
      if (hooks.success) hooks.success(payload);
    } else if (hooks.fail) {
      hooks.fail(payload);
    }
  }

  if (typeof wx === 'undefined' || !wx.downloadFile) {
    finish('fail', {
      stage: 'download',
      url: url,
      statusCode: 0,
      errMsg: 'downloadFile unavailable',
    });
    return { abort: function () { settled = true; } };
  }

  try {
    task = wx.downloadFile({
      url: url,
      success: function (res) {
        const code = res && res.statusCode;
        const tempFilePath = res && res.tempFilePath;
        if (Number(code) === 200 && tempFilePath) {
          finish('success', {
            tempFilePath: tempFilePath,
            statusCode: code,
          });
          return;
        }
        finish('fail', {
          stage: 'download',
          url: url,
          statusCode: code,
          errMsg: (res && res.errMsg) || ('HTTP ' + code),
        });
      },
      fail: function (err) {
        finish('fail', {
          stage: 'download',
          url: url,
          statusCode: 0,
          errMsg: (err && (err.errMsg || err.message)) || 'downloadFile fail',
        });
      },
    });
  } catch (e) {
    finish('fail', {
      stage: 'download',
      url: url,
      statusCode: 0,
      errMsg: (e && e.message) || 'downloadFile exception',
    });
  }

  return {
    abort: function () {
      settled = true;
      try {
        if (task && task.abort) task.abort();
      } catch (err) {}
    },
  };
}

function createPlayer() {
  applyInnerAudioOptions();
  return createPlayerController({
    createContext: createWxContext,
    reuseContext: false,
    getPlatform: getWxPlatform,
    downloadAudio: downloadWxAudio,
    log: function () {
      try { console.log.apply(console, arguments); } catch (e) {}
    },
  });
}

module.exports = {
  createPlayer,
  createPlayerController,
  getWxPlatform,
  downloadWxAudio,
};
