const { classFilters, rarityFilters } = require('../../utils/labels.js');

Component({
  properties: {
    classValue: { type: String, value: 'ALL' },
    rarityValue: { type: String, value: 'ALL' },
    legendaryMusic: { type: Boolean, value: false },
  },
  data: {
    classes: classFilters(),
    rarities: rarityFilters(),
  },
  methods: {
    emit(patch) {
      const classFilter = patch.classFilter != null ? patch.classFilter : this.data.classValue;
      const rarityFilter = patch.rarityFilter != null ? patch.rarityFilter : this.data.rarityValue;
      const legendaryMusic = patch.legendaryMusic != null ? patch.legendaryMusic : this.data.legendaryMusic;
      this.triggerEvent('change', {
        classFilter: classFilter,
        rarityFilter: rarityFilter,
        legendaryMusic: legendaryMusic,
      });
    },
    onClass(e) {
      const classValue = e.currentTarget.dataset.id;
      this.setData({ classValue: classValue });
      this.emit({ classFilter: classValue });
    },
    onRarity(e) {
      const rarityValue = e.currentTarget.dataset.id;
      this.setData({ rarityValue: rarityValue });
      this.emit({ rarityFilter: rarityValue });
    },
    onLegendaryMusic() {
      const legendaryMusic = !this.data.legendaryMusic;
      this.setData({ legendaryMusic: legendaryMusic });
      this.emit({ legendaryMusic: legendaryMusic });
    },
  },
});
