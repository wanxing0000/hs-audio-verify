import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/voice-verification/phase-0.6-results.json', 'utf8'));
const special = data.results.filter((r) => ['indirect', 'not_found'].includes(r.play.status));
const slim = special.map((r) => ({
  cardId: r.cardId,
  name: r.name,
  set: r.set,
  dbfId: r.dbfId,
  status: r.play.status,
  cardDefFiles: r.cardDefFiles,
  extra: r.extra,
  play: { voiceKey: r.play.voiceKey, guid: r.play.prefabGuid, evidence: r.play.evidence },
  attack: { voiceKey: r.attack.voiceKey, guid: r.attack.prefabGuid, evidence: r.attack.evidence },
  death: { voiceKey: r.death.voiceKey, guid: r.death.prefabGuid, evidence: r.death.evidence },
}));
fs.writeFileSync('tmp/phase07-targets.json', JSON.stringify(slim, null, 2));
console.log(JSON.stringify(slim, null, 2));
