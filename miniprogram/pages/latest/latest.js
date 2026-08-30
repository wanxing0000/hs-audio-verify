const catalogApi = require('../../utils/data.js');
const { getApiBase } = require('../../utils/config.js');
const { groupLatestCardsByClass } = require('../../utils/latestGroups.js');

Page({
  data: {
    groups: [],
    cards: [],
    loading: false,
    status: 'loading',
    hasData: false,
    showTop: false,
    setName: '',
    cardCount: 0,
    emptyText: '暂时没有可展示的卡牌',
  },
  onLoad() {
    this._seq = 0;
    this.resetAndLoad();
  },
  onPageScroll(e) {
    const showTop = !!(e && e.scrollTop > 500);
    if (showTop !== this.data.showTop) this.setData({ showTop: showTop });
  },
  resetAndLoad() {
    this._seq += 1;
    const seq = this._seq;
    this.setData({
      groups: [],
      cards: [],
      loading: true,
      status: 'loading',
      hasData: false,
      showTop: false,
    });
    const self = this;
    catalogApi.loadLatestAll(getApiBase()).then(function (body) {
      if (seq !== self._seq) return;
      const items = (body && body.items) || [];
      const groups = groupLatestCardsByClass(items);
      const count = body && body.count != null ? body.count : items.length;
      self.setData({
        status: 'ready',
        loading: false,
        groups: groups,
        cards: items,
        hasData: items.length > 0,
        setName: (body && body.nameZh) || '',
        cardCount: count,
        emptyText: '暂时没有可展示的卡牌',
      });
    }).catch(function () {
      if (seq !== self._seq) return;
      self.setData({ status: 'error', loading: false, hasData: false });
    });
  },
  onRetry() {
    this.resetAndLoad();
  },
  onOpenCard(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(id) });
  },
  onBackTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
    this.setData({ showTop: false });
  },
});
