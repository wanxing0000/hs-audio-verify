const catalogApi = require('../../utils/data.js');
const audio = require('../../utils/audio.js');
const { getApiBase } = require('../../utils/config.js');

Page({
  data: {
    card: null,
    relatedCards: [],
    error: '',
    status: 'loading',
    entranceText: '🎵 完整登场试听',
    showAudioDebug: false,
    dbgStatus: 'idle',
    dbgSession: 0,
    dbgType: '',
    dbgCardId: '',
    dbgSrc: '',
    dbgEvents: [],
  },
  onLoad(query) {
    this.cardId = (query && query.id) || '';
    this.debug = (query && query.debug === '1') || (getApp().debug === true);
    if (this.debug) {
      const app = getApp();
      app.debug = true;
      if (app.player && app.player.setDebug) app.player.setDebug(true);
      this.setData({ showAudioDebug: true });
    }
    this.load();
  },
  onUnload() {
    if (this._unsub) this._unsub();
  },
  onRetry() {
    this.load();
  },
  load() {
    const self = this;
    if (!this.cardId) {
      this.setData({ status: 'error', error: '没有找到相关卡牌', card: null, relatedCards: [] });
      return;
    }
    this.setData({ status: 'loading', error: '', card: null, relatedCards: [] });
    catalogApi.loadCardDetail(getApiBase(), this.cardId).then(function (card) {
      if (!self.debug && card.debug) delete card.debug;
      self.setData({
        card: card,
        relatedCards: (card.relatedCards || []).slice(0, 12),
        status: 'ready',
        error: '',
      });
      self.bindPlayer();
    }).catch(function () {
      self.setData({
        status: 'error',
        card: null,
        relatedCards: [],
        error: '网络异常，请稍后重试',
      });
    });
  },
  bindPlayer() {
    const app = getApp();
    const self = this;
    if (!app.player || !app.player.subscribe) return;
    if (this._unsub) this._unsub();
    this._unsub = app.player.subscribe(function (state) {
      const mine = state.key === self.cardId + ':entrance';
      let entranceText = '🎵 完整登场试听';
      if (mine && state.status === 'loading') entranceText = '加载中...';
      else if (mine && state.status === 'playing') entranceText = '暂停';
      else if (mine && state.status === 'paused') entranceText = '🎵 完整登场试听';
      else if (mine && state.status === 'error') entranceText = '暂时无法播放';
      const patch = { entranceText: entranceText };
      if (self.debug) {
        patch.dbgStatus = state.status || 'idle';
        patch.dbgSession = state.sessionId || 0;
        patch.dbgType = state.type || '';
        patch.dbgCardId = state.cardId || '';
        patch.dbgSrc = state.src || '';
        patch.dbgEvents = (app.player.getDebugLog ? app.player.getDebugLog() : []).map(function (line, i) {
          return { id: i, text: line };
        });
      }
      self.setData(patch);
    });
  },
  onEntrance() {
    const card = this.data.card;
    const app = getApp();
    if (!card || !card.entrancePreview || !card.entrancePreview.available || !app.player) return;
    app.player.playAudio({
      type: 'entrance',
      cardId: card.id,
      url: audio.getEntranceUrl(card),
      key: card.id + ':entrance',
      title: card.name + ' · 完整登场试听',
      debug: !!this.debug,
    });
  },
  onImgErr() {
    this.setData({ 'card.imageUrl': '' });
  },
  onRelatedTap(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(id) });
  },
  findRelated(id) {
    const list = this.data.relatedCards || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
      const kids = list[i].relatedCards || [];
      for (let j = 0; j < kids.length; j++) {
        if (kids[j].id === id) return kids[j];
      }
    }
    return null;
  },
  onRelatedPlay(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const related = this.findRelated(id);
    const app = getApp();
    if (!related || !related.audio || !related.audio.playable || !related.audio.hasVoice || !app.player) return;
    app.player.playAudio({
      type: 'voice',
      cardId: related.id,
      url: audio.getVoiceUrl(related.id, 'play'),
      key: related.id + ':play',
      title: related.name + ' · 登场语音',
      debug: !!this.debug,
    });
  },
});
