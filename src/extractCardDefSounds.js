function extractPrintable(buf) {
  let s = '';
  for (const b of buf) s += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
  return s;
}

const PREFAB_RE = /([A-Za-z0-9_]+)\.prefab:([0-9a-f]{32})/g;

function prefabsFromText(text) {
  const out = [];
  PREFAB_RE.lastIndex = 0;
  let m;
  while ((m = PREFAB_RE.exec(text))) out.push({ name: m[1], guid: m[2] });
  return out;
}

const WAV_RE = /([A-Za-z0-9_]+)\.wav:([0-9a-f]{32})/g;
const MUSIC_FIELD_RE = /m_[A-Za-z0-9]*(?:Music|Stinger|SoundSpell)[A-Za-z0-9]*/g;

function wavsFromText(text) {
  const out = [];
  WAV_RE.lastIndex = 0;
  let m;
  while ((m = WAV_RE.exec(text))) out.push({ name: m[1], guid: m[2] });
  return out;
}

function musicFieldNamesFromText(text) {
  return [...new Set(text.match(MUSIC_FIELD_RE) || [])];
}

function emptySounds() {
  return {
    play: null,
    attack: null,
    death: null,
    customSummon: null,
    musicStinger: null,
    allPrefabs: [],
    wavRefs: [],
    musicFieldNames: [],
  };
}

function mergeSounds(into, part) {
  into.play = into.play || part.play;
  into.attack = into.attack || part.attack;
  into.death = into.death || part.death;
  into.customSummon = into.customSummon || part.customSummon;
  into.musicStinger = into.musicStinger || part.musicStinger;
  into.allPrefabs.push(...part.allPrefabs);
  into.wavRefs.push(...part.wavRefs);
  into.musicFieldNames.push(...part.musicFieldNames);
}

function soundsFromCardDefBody(body) {
  const text = extractPrintable(body);
  const merged = emptySounds();
  merged.wavRefs = wavsFromText(text);
  merged.musicFieldNames = musicFieldNamesFromText(text);
  for (const p of prefabsFromText(text)) {
    merged.allPrefabs.push(p);
    const n = p.name.toLowerCase();
    if (n === 'play' && !merged.play) merged.play = p.guid;
    else if (n === 'attack' && !merged.attack) merged.attack = p.guid;
    else if (n === 'death' && !merged.death) merged.death = p.guid;
    else if (/summon/i.test(p.name) && !merged.customSummon) merged.customSummon = p;
    if (/stinger/i.test(p.name) && !merged.musicStinger) merged.musicStinger = p;
  }
  return merged;
}

/**
 * Merge every MonoBehaviour on the CardDef GameObject.
 * Some cards (e.g. EDR_526) have a real CardDef MB plus a tiny extra MB;
 * using only the last MB drops Play/Attack/Death.
 */
function extractSoundsFromComponents(bodies) {
  const merged = emptySounds();
  for (const body of bodies) mergeSounds(merged, soundsFromCardDefBody(body));
  return merged;
}

module.exports = {
  prefabsFromText,
  wavsFromText,
  soundsFromCardDefBody,
  extractSoundsFromComponents,
  emptySounds,
};
