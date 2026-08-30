const CLASS_ZH = {
  DEATHKNIGHT: '死亡骑士',
  DEMONHUNTER: '恶魔猎手',
  DRUID: '德鲁伊',
  HUNTER: '猎人',
  MAGE: '法师',
  PALADIN: '圣骑士',
  PRIEST: '牧师',
  ROGUE: '潜行者',
  SHAMAN: '萨满祭司',
  WARLOCK: '术士',
  WARRIOR: '战士',
  NEUTRAL: '中立',
};

const RARITY_ZH = {
  FREE: '免费',
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
};

const CLASS_ORDER = [
  'DEATHKNIGHT', 'DEMONHUNTER', 'DRUID', 'HUNTER', 'MAGE', 'PALADIN',
  'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR', 'NEUTRAL',
];

const RARITY_ORDER = ['LEGENDARY', 'EPIC', 'RARE', 'COMMON'];

function classFilters() {
  return [{ id: 'ALL', label: '全部' }].concat(CLASS_ORDER.map((id) => ({ id, label: CLASS_ZH[id] })));
}

function rarityFilters() {
  return [{ id: 'ALL', label: '全部' }].concat(RARITY_ORDER.map((id) => ({ id, label: RARITY_ZH[id] })));
}

module.exports = { CLASS_ZH, RARITY_ZH, CLASS_ORDER, RARITY_ORDER, classFilters, rarityFilters };
