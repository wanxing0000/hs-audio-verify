# Phase 2.10-A Related Card Display & Audio Chain

## Status

COMPLETE VERIFIED. Read-only design plus a minimal related-card DTO, parent-detail API, and miniapp section. Catalog publish rules and production-audio were not changed.

## Architecture

```
Normal catalog (collectible || VERIFY_IDS)
        unchanged — still 7263

Parent card detail
        │
        └── relatedCards[]
              ├── metadata + imageUrl
              └── audio
                    ├── indexed
                    ├── productionAvailable
                    └── playable = indexed AND production
```

Relation detection is reused from `src/audit/relatedAudioAudit.js` (`collectStructuredRelations`). Display lives in `src/miniprogram/relatedCards.js`.

Unpublished tokens can open `/api/mini/card/:id` via `resolveDetailCard` (adapt from `card-audio-index` when `catalog.byId` misses). They are not added to `GET /api/mini/catalog`.

## Relation Filtering

Displayed only when all of these hold:

- confidence is `STRUCTURED` or `PROJECT_INDEXED`
- relation type is not enchantment / hero_power / Battlegrounds pointer
- card type is MINION / SPELL / WEAPON / LOCATION / HERO
- depth <= 2

`INFERRED` text mentions are not displayed. `ENCHANTMENT` and `HERO_POWER` are hidden.

## Sylvanas

`GET /api/mini/card/TIME_609` related cards:

| id | name | shown | indexed | production | playable |
|---|---|---|---|---|---|
| TIME_609t1 | 游侠队长奥蕾莉亚 | YES | YES | NO | NO |
| TIME_609t2 | 游侠新兵温蕾萨 | YES | YES | NO | NO |
| TIME_609t2e | 风行者之誓 | NO | NO | NO | — |

## Rafaam

`GET /api/mini/card/TIME_005` first-level related cards: `TIME_005t1` … `TIME_005t9`.

`TIME_005t9.relatedCards` contains `TIME_005t9t` 拉法姆绵羊.

Enchantments `TIME_005t2e` / `TIME_005t8e` are filtered.

## Audio Availability

Related DTO uses the existing production inventory:

- `indexed` = card-audio-index mapping
- `productionAvailable` = production manifest
- `playable` = both

TIME_609 / TIME_005 tokens: indexed yes, production no, playable false. The UI shows「暂时无法播放」and does not request a missing WAV.

`AT_003` parent play remains playable under the production overlay.

## UI

`miniprogram/pages/card/` adds an「关联卡」block only when `relatedCards.length > 0`. First batch is 12. Images use `lazy-load` and `mode="widthFix"`. Tap opens `/pages/card/card?id=<relatedId>`. Play button is shown only when `audio.playable` is true.

## Tests

`test/relatedCardDisplay.test.js` covers TIME_609 / TIME_609t2e / TIME_005 / TIME_005t9t / playable=false / catalog 7263 / empty `relatedCards=[]` / INFERRED hidden / local health+catalog+latest+card routes.

## Production Audio

NOT MODIFIED. Manifest not modified. Extractor not called. `C:\Hearthstone` not accessed.

## VPS

NOT MODIFIED. No deploy, no systemd, no Nginx.

## Git

COMMIT=NO. PUSH=NO.

## Next Phase

Do not start automatically. A later phase may expand production-audio for already-indexed related voiceKeys, or decide whether voiced tokens belong on the parent page only.

## Q&A

1. TIME_609 finds TIME_609t1 / TIME_609t2? **YES**
2. TIME_609t2e filtered? **YES**
3. TIME_005 finds TIME_005t1..t9? **YES**
4. TIME_005t9t recognized under TIME_005t9? **YES**
5. Related cards enter global catalog? **NO**
6. Related cards can open detail? **YES**
7. Production-missing audio advertised as playable? **NO**
8. production-audio modified? **NO**
