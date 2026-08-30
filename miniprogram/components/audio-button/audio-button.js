const audio = require('../../utils/audio.js');

Component({
  properties: {
    cardId: { type: String, value: '' },
    name: { type: String, value: '' },
    track: { type: String, value: 'play' },
    label: { type: String, value: '播放' },
    icon: { type: String, value: '' },
    available: { type: Boolean, value: false },
    note: { type: String, value: '' },
    emptyLabel: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },
  data: {
    btnText: '▶ 播放',
    playingKey: '',
  },
  lifetimes: {
    attached() {
      const app = getApp();
      const self = this;
      this._unsub = app.player && app.player.subscribe ? app.player.subscribe(function (state) {
        self.sync(state);
      }) : null;
    },
    detached() {
      if (this._unsub) this._unsub();
    },
  },
  methods: {
    trackKey() {
      return this.data.cardId + ':' + this.data.track;
    },
    sync(state) {
      const mine = state.key === this.trackKey();
      let btnText = '▶ 播放';
      if (mine && state.status === 'loading') btnText = '加载中...';
      else if (mine && state.status === 'playing') btnText = '⏸ 暂停';
      else if (mine && state.status === 'paused') btnText = '▶ 播放';
      else if (mine && state.status === 'error') btnText = '暂时无法播放';
      this.setData({ btnText: btnText });
    },
    onTap() {
      if (!this.data.available) return;
      const app = getApp();
      if (!app.player) return;
      const track = this.data.track;
      app.player.playAudio({
        type: track === 'music' ? 'music' : 'voice',
        cardId: this.data.cardId,
        url: audio.getTrackUrl(this.data.cardId, track),
        key: this.trackKey(),
        title: this.data.name + ' · ' + this.data.label,
        debug: !!(app.debug),
      });
    },
  },
});
