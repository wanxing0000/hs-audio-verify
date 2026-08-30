const audio = require('../../utils/audio.js');

Component({
  properties: {
    card: { type: Object, value: {} },
  },
  methods: {
    onOpen() {
      const card = this.data.card || {};
      this.triggerEvent('open', { id: card.id });
    },
    onPlay() {
      const card = this.data.card;
      const app = getApp();
      const qp = card && card.quickPlay;
      if (!card || !qp || !qp.available || !app.player) return;
      const url = audio.getQuickPlayUrl(card);
      if (!url) return;
      app.player.playAudio({
        type: qp.type,
        cardId: card.id,
        url: url,
        key: card.id + ':' + qp.type,
        title: card.name + ' · ' + qp.label,
      });
    },
    onImgErr() {
      this.setData({ 'card.imageUrl': '' });
    },
  },
});
