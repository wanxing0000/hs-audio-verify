const catalogApi = require('../../utils/data.js');
const { getApiBase } = require('../../utils/config.js');
const {
  LATEST_BATCH_SIZE,
  orderLatestCards,
  sliceLatestVisible,
} = require('../../utils/latestGroups.js');

Page({
  data: {
    groups: [],
    cards: [],
    loading: false,
    loadingMoreLatest: false,
    hasMoreLatest: false,
    latestDisplayCount: 0,
    status: 'loading',
    hasData: false,
    showTop: false,
    setName: '',
    cardCount: 0,
    emptyText: '暂时没有可展示的卡牌',
  },
  onLoad() {
    this._seq = 0;
    this._allLatestCards = [];
    this.resetAndLoad();
  },
  onPageScroll(e) {
    const showTop = !!(e && e.scrollTop > 500);
    if (showTop !== this.data.showTop) this.setData({ showTop: showTop });
  },
  onReachBottom() {
    this.loadMoreLatest();
  },
  applyVisible(displayCount) {
    const sliced = sliceLatestVisible(this._allLatestCards, displayCount);
    this.setData({
      groups: sliced.groups,
      cards: sliced.visible,
      latestDisplayCount: sliced.displayCount,
      hasMoreLatest: sliced.hasMore,
    });
  },
  resetAndLoad() {
    this._seq += 1;
    const seq = this._seq;
    this._allLatestCards = [];
    this.setData({
      groups: [],
      cards: [],
      loading: true,
      loadingMoreLatest: false,
      hasMoreLatest: false,
      latestDisplayCount: 0,
      status: 'loading',
      hasData: false,
      showTop: false,
    });
    const self = this;
    catalogApi.loadLatestAll(getApiBase()).then(function (body) {
      if (seq !== self._seq) return;
      const items = (body && body.items) || [];
      self._allLatestCards = orderLatestCards(items);
      const count = body && body.count != null ? body.count : items.length;
      const sliced = sliceLatestVisible(self._allLatestCards, LATEST_BATCH_SIZE);
      self.setData({
        status: 'ready',
        loading: false,
        loadingMoreLatest: false,
        groups: sliced.groups,
        cards: sliced.visible,
        latestDisplayCount: sliced.displayCount,
        hasMoreLatest: sliced.hasMore,
        hasData: items.length > 0,
        setName: (body && body.nameZh) || '',
        cardCount: count,
        emptyText: '暂时没有可展示的卡牌',
      });
    }).catch(function () {
      if (seq !== self._seq) return;
      self.setData({ status: 'error', loading: false, loadingMoreLatest: false, hasData: false });
    });
  },
  loadMoreLatest() {
    if (this.data.loading || this.data.loadingMoreLatest) return;
    if (!this.data.hasMoreLatest) return;
    if (this.data.status === 'error' && !this.data.hasData) return;
    this.setData({ loadingMoreLatest: true });
    const next = this.data.latestDisplayCount + LATEST_BATCH_SIZE;
    this.applyVisible(next);
    this.setData({ loadingMoreLatest: false });
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
