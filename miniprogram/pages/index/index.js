const catalogApi = require('../../utils/data.js');
const { getApiBase } = require('../../utils/config.js');

Page({
  data: {
    query: '',
    classFilter: 'ALL',
    rarityFilter: 'ALL',
    legendaryMusic: false,
    cards: [],
    page: 0,
    pageSize: 30,
    hasMore: true,
    loading: false,
    loadingMore: false,
    loadMoreError: false,
    status: 'loading',
    showTop: false,
    sectionTitle: '卡牌图鉴',
    emptyText: '没有找到相关卡牌',
  },
  onLoad() {
    this._seq = 0;
    this.resetAndLoad();
  },
  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },
  onReachBottom() {
    if (this.data.loading || this.data.loadingMore) return;
    if (!this.data.hasMore) return;
    if (this.data.loadMoreError) return;
    if (this.data.status === 'error' && !this.data.cards.length) return;
    this.fetchPage(this.data.page + 1, this._seq);
  },
  onPageScroll(e) {
    const showTop = !!(e && e.scrollTop > 500);
    if (showTop !== this.data.showTop) this.setData({ showTop: showTop });
  },
  isSearching() {
    return !!(this.data.query && String(this.data.query).trim());
  },
  resetAndLoad() {
    this._seq += 1;
    this.setData({
      cards: [],
      page: 0,
      hasMore: true,
      loading: true,
      loadingMore: false,
      loadMoreError: false,
      status: 'loading',
      showTop: false,
      sectionTitle: this.isSearching() ? '搜索结果' : '卡牌图鉴',
    });
    this.fetchPage(1, this._seq);
  },
  fetchPage(page, seq) {
    if (seq !== this._seq) return;
    const replacing = page === 1;
    if (!replacing && (this.data.loading || this.data.loadingMore)) return;
    if (!replacing && !this.data.hasMore) return;
    const self = this;
    if (replacing) this.setData({ loading: true, loadMoreError: false });
    else this.setData({ loadingMore: true, loadMoreError: false });
    const opts = {
      page: page,
      pageSize: this.data.pageSize,
      classFilter: this.data.classFilter,
      rarityFilter: this.data.rarityFilter,
      legendaryMusic: this.data.legendaryMusic,
    };
    const req = this.isSearching()
      ? catalogApi.searchRemote(getApiBase(), this.data.query, opts)
      : catalogApi.loadCatalogPage(getApiBase(), opts);
    req.then(function (body) {
      if (seq !== self._seq) return;
      const incoming = (body && body.items) || [];
      const merged = replacing ? incoming : catalogApi.mergePageItems(self.data.cards, incoming);
      self.setData({
        status: 'ready',
        loading: false,
        loadingMore: false,
        loadMoreError: false,
        cards: merged,
        page: (body && body.page) || page,
        hasMore: !!(body && body.hasMore),
        emptyText: self.isSearching() ? '没有找到相关卡牌' : '暂时没有可展示的卡牌',
      });
    }).catch(function () {
      if (seq !== self._seq) return;
      if (replacing && !(self.data.cards && self.data.cards.length)) {
        self.setData({ status: 'error', loading: false, loadingMore: false });
      } else {
        self.setData({
          status: 'ready',
          loading: false,
          loadingMore: false,
          loadMoreError: true,
        });
      }
    });
  },
  onRetry() {
    this.resetAndLoad();
  },
  onRetryMore() {
    this.fetchPage(this.data.page + 1, this._seq);
  },
  onSearchInput(e) {
    const self = this;
    this.setData({ query: (e.detail && e.detail.value) || '' });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(function () {
      self.resetAndLoad();
    }, 250);
  },
  onSearchConfirm(e) {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.setData({ query: (e.detail && e.detail.value) || '' });
    this.resetAndLoad();
  },
  onFilter(e) {
    const d = e.detail || {};
    this.setData({
      classFilter: d.classFilter || 'ALL',
      rarityFilter: d.rarityFilter || 'ALL',
      legendaryMusic: !!d.legendaryMusic,
    });
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
