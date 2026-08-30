import fs from 'fs';
import path from 'path';
import { unpackUnityFS } from '../../unpack-search.mjs';
import { parseSerializedFile, parseGameObject } from '../../unity-serialized.mjs';
import { extractSoundsFromComponents } from '../extractCardDefSounds.js';

const HS_WIN = path.join('C:\\Hearthstone', 'Data', 'Win');

function unpackSafe(filePath) {
  try {
    return unpackUnityFS(filePath);
  } catch (e) {
    return { error: e.message, files: [] };
  }
}

export function scanCardDefs(hsWin = HS_WIN) {
  const files = fs.readdirSync(hsWin).filter((n) => n.startsWith('carddef_') && n.endsWith('.unity3d'));
  const byCard = {};
  const parseErrors = [];
  let parsedOk = 0;
  const t0 = Date.now();
  for (const name of files) {
    const f = path.join(hsWin, name);
    const unpacked = unpackSafe(f);
    if (unpacked.error || !unpacked.files.length) {
      parseErrors.push({ file: name, error: unpacked.error || 'empty' });
      continue;
    }
    const cab = unpacked.files[0].data;
    let parsed;
    try {
      parsed = parseSerializedFile(cab);
    } catch (e) {
      parseErrors.push({ file: name, error: e.message });
      continue;
    }
    parsedOk++;
    const byPath = new Map(parsed.objects.map((o) => [o.pathId, o]));
    for (const o of parsed.objects) {
      if (o.classId !== 1) continue;
      const go = parseGameObject(cab.subarray(o.absStart, o.absStart + o.byteSize));
      if (!go.name) continue;
      const bodies = [];
      for (const c of go.comps) {
        const obj = byPath.get(c.pathId);
        if (!obj || obj.classId !== 114) continue;
        bodies.push(cab.subarray(obj.absStart, obj.absStart + obj.byteSize));
      }
      if (!bodies.length) continue;
      const sounds = extractSoundsFromComponents(bodies);
      const rec = {
        files: [name],
        play: sounds.play,
        attack: sounds.attack,
        death: sounds.death,
        customSummon: sounds.customSummon,
        musicStinger: sounds.musicStinger,
        allPrefabs: sounds.allPrefabs,
        wavRefs: sounds.wavRefs,
        musicFieldNames: [...new Set(sounds.musicFieldNames)],
      };
      const prev = byCard[go.name];
      if (!prev) byCard[go.name] = rec;
      else {
        if (!prev.files.includes(name)) prev.files.push(name);
        prev.play = prev.play || rec.play;
        prev.attack = prev.attack || rec.attack;
        prev.death = prev.death || rec.death;
        prev.customSummon = prev.customSummon || rec.customSummon;
        prev.musicStinger = prev.musicStinger || rec.musicStinger;
        prev.allPrefabs.push(...rec.allPrefabs);
        prev.wavRefs.push(...rec.wavRefs);
        prev.musicFieldNames = [...new Set(prev.musicFieldNames.concat(rec.musicFieldNames))];
      }
    }
  }
  return {
    byCard,
    stats: { files: files.length, parsedOk, parseErrorFiles: parseErrors.length, ms: Date.now() - t0 },
    parseErrors,
  };
}

export function buildShareCounts(byCard, uniquePrefabs) {
  const counts = new Map();
  for (const rec of Object.values(byCard)) {
    const seen = new Set();
    for (const p of uniquePrefabs(rec.allPrefabs)) {
      if (seen.has(p.guid)) continue;
      seen.add(p.guid);
      counts.set(p.guid, (counts.get(p.guid) || 0) + 1);
    }
    for (const w of rec.wavRefs || []) {
      if (!w.guid || seen.has(w.guid)) continue;
      seen.add(w.guid);
      counts.set(w.guid, (counts.get(w.guid) || 0) + 1);
    }
  }
  return counts;
}
