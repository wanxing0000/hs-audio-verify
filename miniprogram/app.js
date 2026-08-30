const { createPlayer } = require('./utils/player.js');

App({
  onLaunch() {
    try {
      this.player = createPlayer();
    } catch (e) {
      this.player = null;
    }
  },
  onHide() {},
});
