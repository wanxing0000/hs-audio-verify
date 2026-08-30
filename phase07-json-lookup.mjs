import fs from 'fs';
const cards = JSON.parse(fs.readFileSync('data/hearthstonejson/zhCN/cards.collectible.json', 'utf8'));
const all = JSON.parse(fs.readFileSync('data/hearthstonejson/zhCN/cards.json', 'utf8'));
const ids = ['VAC_954','VAC_301','CAP_107','CAP_106','CAP_106t','CFM_335','EDR_526','EDR_493','VAN_NEW1_010','NEW1_010'];
function info(c) {
  if (!c) return null;
  return { id: c.id, name: c.name, type: c.type, set: c.set, collectible: c.collectible, race: c.race, rarity: c.rarity, mechanics: c.mechanics, referencedTags: c.referencedTags };
}
for (const id of ids) {
  const c = all.find((x) => x.id === id);
  console.log(id, JSON.stringify(info(c)));
}
console.log('--- CAP_* ---');
for (const c of all.filter((x) => /^CAP_106/.test(x.id))) console.log(c.id, c.name, c.type, c.collectible);
console.log('--- VAC_30 / VAC_95 ---');
for (const c of all.filter((x) => /^VAC_30|^VAC_95/.test(x.id) && c.type === 'MINION')) console.log(c.id, c.name, c.collectible);
