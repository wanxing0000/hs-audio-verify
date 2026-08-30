Component({
  properties: {
    liftForTabBar: { type: Boolean, value: false },
  },
  data: {
    visible: false,
    title: '',
    icon: '▶',
    action: '暂停',
  },
  lifetimes: {
    attached() {
      const app = getApp();
      const self = this;
      if (!app.player || !app.player.subscribe) return;
      this._unsub = app.player.subscribe(function (state) {
        let title = '';
        let icon = '▶';
        let action = '播放';
        if (state.status === 'loading') {
          title = '加载中...';
          icon = '...';
          action = '';
        } else if (state.status === 'playing' || state.status === 'paused') {
          title = state.title || '';
          icon = state.status === 'playing' ? '暂停' : '播放';
          action = state.status === 'playing' ? '暂停' : '播放';
        } else if (state.status === 'error') {
          title = '暂时无法播放';
          icon = '!';
          action = '重试';
        }
        self.setData({
          visible: !!title,
          title: title,
          icon: icon,
          action: action,
        });
      });
    },
    detached() {
      if (this._unsub) this._unsub();
    },
  },
  methods: {
    onToggle() {
      const app = getApp();
      if (!app.player) return;
      const state = app.player.getState();
      if (state.status === 'playing') app.player.pause();
      else if (state.status === 'paused' || state.status === 'error' || state.status === 'ended') {
        app.player.play(state.src || '', { key: state.key, title: state.title, type: state.type, cardId: state.cardId });
      }
    },
  },
});
