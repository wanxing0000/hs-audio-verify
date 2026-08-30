# Phase 1.3.1 Report

Generated: 2026-08-29

Hearthstone client directory `C:\Hearthstone` was read-only. No game files were modified. No full 35,807-card rescan. No CardID special-case in mixer or parser.

These mix experiments are **preview optimization**, not official Hearthstone mix timing. `timingVerified = false`.

---

## A. User feedback: 「地狱咆哮没有任何声音」— which CardID?

Search `地狱咆哮` in `cards.json` / mini catalog (collectible only) returns four cards:

| CardID | Name | Type | Set | List quickPlay |
| --- | --- | --- | --- | --- |
| `CORE_EX1_414` | 格罗玛什·地狱咆哮 | MINION | CORE | 完整登场 |
| `EX1_414` | 格罗玛什·地狱咆哮 | MINION | EXPERT1 | 完整登场 |
| **`HERO_01`** | **加尔鲁什·地狱咆哮** | **HERO** | **HERO_SKINS** | **none** |
| `VAN_EX1_414` | 格罗玛什·地狱咆哮 | MINION | VANILLA | 完整登场 |

The silent collectible the user can actually open with **no Play / no Music / no 完整登场** is **`HERO_01`** (Garrosh the hero). The three Grommash minion reprints all have Play + Music + entrance.

Do not treat “地狱咆哮” as a single CardID. The famous hero name and the classic minion share the same Chinese substring.

---

## B. `HERO_01` in cards.json

```json
{
  "id": "HERO_01",
  "name": "加尔鲁什·地狱咆哮",
  "type": "HERO",
  "class": "WARRIOR",
  "rarity": "FREE",
  "collectible": true,
  "set": "HERO_SKINS",
  "dbfId": 7
}
```

---

## C. Play / Attack / Death / Music for `HERO_01`

| Slot | Present? | Evidence |
| --- | --- | --- |
| Play Voice | **No** | CardDef GameObject has **no** `Play.prefab`. Unified index `play.status = unavailable`. |
| Attack Voice | **Yes** | `VO_HERO_01_Attack_16` via Attack prefab GUID `30e37701…` |
| Death Voice | **Yes** | `VO_HERO_01_Death_17` via Death prefab GUID `c619dc74…` |
| Music Stinger | **No** | No MusicStinger prefab on CardDef. Unified `music.status = unavailable`. |

Detail page still offers 攻击语音 / 死亡语音. Death extracts as PCM WAV. Attack is indexed (`VO_HERO_01_Attack_16`) but the current on-demand extractor hits a stub AudioClip in `essential_base_global-prefab-0` (offset past bundle size) and cannot locate a matching audio bundle hash for that essential prefab name. Mini API returns **404 暂时无法播放**, not 500. This phase does not rebuild the 700+ audio bundle index or remap hero emotes.

Homepage/search list has **no** play button because `quickPlay.type = none` (no Play + no Music).

Minion versions:

| CardID | Play | Attack | Death | Music |
| --- | --- | --- | --- | --- |
| `EX1_414` | `VO_EX1_414_Play_01` | yes | yes | `Pegasus_Stinger_Horde1` |
| `CORE_EX1_414` / `VAN_EX1_414` | shared from `EX1_414` | shared | shared | shared |

Sharing is by **identical Play/Attack/Death/MusicStinger GUIDs**, not by stripping `CORE_` / `VAN_`.

---

## D. Was anything leaked?

**No parser leak for minion Play voice.**

Live CardDef unpack of `carddef_base_global-244154c1-prefab-1.unity3d`:

- 1 MonoBehaviour on GameObject `HERO_01` (6944 bytes)
- Merged Play = null, Attack + Death present
- Extra prefabs are **hero emotes** (`Emote_Start`, `Emote_Greetings`, `Emote_Picked`, errors, holidays) plus announcer name VO
- Those clips exist in `audio-index.json` (`VO_HERO_01_Start_09`, etc.)

This is a **different audio system** (in-match hero emotes), not minion Play/Attack/Death. Phase 1.3.1 does **not** map `Emote_Start` to Play. Voice index was **not** rebuilt.

`indexChanged = false`. See `data/audio-verification/phase-1.3.1-index-diff.json`.

---

## E. If there is truly no Play voice — chains checked

For `HERO_01`:

1. `cards.json` name/id variants (地狱咆哮 / Grommash / Hellscream / Garrosh)
2. `card-audio-index.json` play/attack/death/music/entrance
3. `card-voice-index.json` evidence
4. CardDef bundle, **all** MonoBehaviours on the same GameObject (merge, no last-MB overwrite)
5. Every `.prefab:GUID` on that CardDef
6. `guid-voice-index.json` + prefab preload VO keys
7. `audio-index.json` clip records
8. Same-name collectible minions (`EX1_414` family) — those **do** have Play+Music; they are different cards

Conclusion: the game client has **no minion Play SoundSpell and no Music Stinger** on `HERO_01`. Mini UI keeps **暂无登场语音**. Do not fabricate Play from Start emote.

---

## F. 奇利亚斯 first syllable — which layer?

User-facing collectible **`BOT_548`** (奇利亚斯, Boomsday). Also `CORE_BOT_548` (shared) and `TOY_330` (奇利亚斯豪华版3000型, different VO).

Layer (required enum):

**Music Masking**

Not FSB Extraction, not WAV Conversion, not sample-rate conversion skip, not mixer hard-trim, not WAV encoding. Mini Program Player has no `seek` / `startTime` skip in code (`startTime` is forced to `0`). Device-level InnerAudioContext skip was not proven in this environment.

---

## G. Voice-only complete?

**Yes** for `BOT_548`, `EX1_116`, `EX1_572`.

`tmp/audio-verification/BOT_548/voice-original.wav`: 48 kHz mono PCM16, 4757 ms, leading silence **57.9 ms** (pre-roll, not a missing character), peak in first 200 ms = 22379. Speech energy is in the file.

`EX1_116` voice: 48 kHz, leading silence 87.5 ms, RMS 200 ms = 1704.

---

## H. Did Entrance Preview truncate Voice in the data layer?

**No.**

Mixer copies music, then **adds** every voice sample from index 0 (plus optional delay/padding). No `slice` of the first voice block. 44.1 kHz music + 48 kHz voice resample to 48 kHz with `i=0 → src=0`.

`BOT_548` mix vs voice (200 ms window): `truncated = false`, `mixedDiffersFrames = 12276`, mixed duration 6538 ms ≥ voice 4757 ms.

Synthetic test: 48 kHz impulse at sample 0 + silent 44.1 kHz stereo music → mixed peak 20000 at t=0.

---

## I. Music covering Voice — production preview params

Investigation baseline (equal add, pre-fix) masked the first syllable because stinger peak in 0–200 ms ≥ voice peak (`BOT_548` music 28090 vs voice 22379; `EX1_116` music 25841 vs voice 10316).

Production mixer (unified, no CardID branch):

| Param | Value |
| --- | --- |
| Music Volume | **0.70** |
| Voice Volume | **1.00** |
| Voice Delay | **0 ms** |
| Leading Padding | **0 ms** |
| Target rate | 48 kHz |

Cache key is versioned (`_entrance_v2`) so old equal-gain previews are not reused. `tmp/audio/` and `tmp/music/` originals were not overwritten.

Delay/padding experiments were generated under `tmp/audio-verification/` for listening. They are **not** claimed as official game timing. Delay was **not** used to hide a trim bug.

---

## J. Unified algorithm? CardID special-case?

**NO.** `src/music/entranceMixConfig.js` has one config object. Mixer never branches on CardID.

---

## Acceptance samples

| CardID | Mapping | Result |
| --- | --- | --- |
| `EX1_116` | direct | Play+Music+entrance; voice-only intact; masking ducked |
| `VAN_NEW1_010` | shared_resource | unchanged |
| `VAC_954` | shared_audio | unchanged |
| `CAP_107` | token_clip | graceful (no fake `VO_CAP_107`) |
| `CFM_335` | named_sfx | unchanged |
| `HERO_01` | no Play | 404/暂无登场语音, no 500 |
| `BOT_548` | direct | entrance uses ducked mix |

---

## Tools added

```text
npm run investigate:audio -- --cardId <CardID>
npm run verify:entrance -- <CardID> [CardID...]
```

- `src/validation/investigateCardAudio.js` (+ live CardDef walker)
- `src/validation/audioIntegrity.js`
- Tests: `test/cardAudioException.test.js`, `test/entranceAudioIntegrity.test.js`

---

## Mini API

Restarted after mixer change. Port **8767**. `C:\Hearthstone` remains read-only.
