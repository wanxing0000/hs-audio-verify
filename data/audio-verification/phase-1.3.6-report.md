# Phase 1.3.6 Audio Bundle Resolution Report

## 1. Summary

**EX1_414 已修复。EX1_543 已修复。**

两张卡的 Play / Music / Entrance 均能提取有效 PCM16 WAV，Mini API 返回 HTTP 200 `audio/wav`。根因不是播放器，而是 Extractor 在 `zhcnBundles` 为空时把 prefab/content 包当成 FSB 源，unity-js 加载越界后把整个提取判失败。本阶段加入 Audio Bundle Resolver：按证据生成候选包，FSB offset 越界只淘汰当前候选，再继续下一个，并用 unpack + type tree 读取 unity-js 无法加载的 content 包。

未改播放器、混音、index、C:\Hearthstone。没有 CardID 特判。没有全量 WAV 导出。不进入 Phase 1.3.7。

## 2. EX1_414

主卡随从 **EX1_414**（格罗玛什·地狱咆哮）。CORE_EX1_414 / VAN_EX1_414 为 `shared`，共用同一 VoiceKey / Music clip。

### Voice chain

| Step | Result |
|---|---|
| VoiceKey | `VO_EX1_414_Play_01` |
| sourceCardId | EX1_414 |
| Index zhcnBundles | `[]`（indexMismatch，本阶段不改 index） |
| Index prefabBundles | `essential_base_global-prefab-0.unity3d`, `essential_base_zhcn-content-0.unity3d` |
| Candidate 1 | `essential_base_global-audio-0.unity3d` sibling_audio → clipFound=false（正确跳过） |
| Candidate 2 | `essential_base_zhcn-content-0.unity3d` indexed_content → **winner** |
| AudioClip | `VO_EX1_414_Play_01` |
| FSB | `CAB-2c4ea62f671516b3f442827af165e5e6.resource` |
| Offset / Size | 7506176 / 25472，范围内 |
| Decode | FSB5 → WAV SUCCESS（unpack fallback：unity-js 无法 load 该 content 包） |
| WAV | `tmp/audio/VO_EX1_414_Play_01.wav`，复制 `tmp/audio-verification/EX1_414_voice.wav` |
| API | `GET /api/audio/voice/EX1_414/play` → **200 audio/wav RIFF PCM 16-bit 48 kHz** |

Prefab 包 `essential_base_global-prefab-0.unity3d` 里只有 `VO_EX1_414_Play_01.wav:<guid>` 字符串引用，没有可解码 FSB。unity-js `loadAssetBundle` 对该 prefab/content 都会 `End position ... out of boundary`。以前把这次越界当成最终失败。

### Music chain

| Step | Result |
|---|---|
| musicAssetId | `8a14ada18351c4e4f812beee175d5432` |
| Prefab Bundle | `essential_base_global-prefab-0.unity3d`（SoundDef / MusicStinger 元数据） |
| AudioClip | `Pegasus_Stinger_Horde1` |
| 实际 Bundle | `essential_base_global-audio-0.unity3d`（sibling of `*-prefab-*`） |
| FSB | `CAB-c491983cea83897756f11fa097177509.resource` |
| Offset / Size | 8378688 / 160640，范围内 |
| Decode | FSB5 → WAV SUCCESS（unity-js） |
| WAV | `tmp/music/EX1_414_MusicStinger.wav`，复制 `tmp/audio-verification/EX1_414_music.wav` |
| API | `GET /api/audio/music/EX1_414` → **200** |

`Pegasus_Stinger_Horde1` **不在** soundlegend 包里，而在 classic `essential_base_global-audio-0`。Resolver 没有把 soundlegend 写死为第一名；sibling audio 因证据分更高且硬验证通过而胜出。

### Entrance

Play + Music 均可提取后混音成功。`GET /api/audio/entrance/EX1_414` → **200**。复制 `tmp/audio-verification/EX1_414_entrance.wav`。

## 3. EX1_543

主卡随从 **EX1_543**（暴龙王克鲁什）。CORE_EX1_543 / VAN_EX1_543：Play/Music 均为 `shared` → sourceCardId `EX1_543`。

### Voice chain

| Step | Result |
|---|---|
| VoiceKey | `SFX_EX1_543_EnterPlay` |
| Candidate | sibling `essential_base_global-audio-0.unity3d` |
| AudioClip | found |
| FSB Offset / Size | 5410496 / 19552 |
| WAV | `tmp/audio-verification/EX1_543_voice.wav` |
| API | `GET /api/audio/voice/EX1_543/play` → **200** PCM 16-bit 44.1 kHz |

### Music chain

| Step | Result |
|---|---|
| AudioClip | `Pegasus_Stinger_Beast_Villain` |
| Prefab | `essential_base_global-prefab-0.unity3d` 等（元数据） |
| 实际 Bundle | `essential_base_global-audio-0.unity3d` |
| FSB Offset / Size | 31358368 / 186272 |
| WAV | `tmp/audio-verification/EX1_543_music.wav` |
| API | `GET /api/audio/music/EX1_543` → **200** |

### Entrance

`GET /api/audio/entrance/EX1_543` → **200**。复制 `tmp/audio-verification/EX1_543_entrance.wav`。

## 4. EX1_116 Regression

Play / Music / Entrance 全部 **PASS**。Play 仍走已有 `zhcnBundles`：`playsound_base_zhcn-775a814d-audio-0.unity3d`（Level 1，优先于 sibling/soundlegend）。API Play 200。

## 5. EX1_572 Regression

Play / Music / Entrance 全部 **PASS**（live extract + 既有缓存）。未因 Resolver 改动失败。

## 6. BOT_548 Regression

Play / Music / Entrance 全部 **PASS**。奇利亚斯未再失败。本阶段未改播放器 / 混音 / delay。

## 7. Shared Resource

`VAN_NEW1_010` Play status=`shared`，sourceCardId=`NEW1_010`，VoiceKey 含 `NEW1_010`。实际提取 **PASS**。Resolver 按 **VoiceKey / source clip** 定位，不按当前 CardID 猜资源。

`CORE_EX1_116` 等 CORE 共享同样保持 sourceCardId 路径。

## 8. Shared Audio

`VAC_954` Play status=`shared`，sourceCardId=`VAC_301`，VoiceKey ≠ `VO_VAC_954_Play_01`。实际提取 **PASS**。未因优先 sibling/soundlegend 而破坏 shared_audio。

## 9. Named SFX

`CFM_335` Play VoiceKey 匹配 `ClumsyKodo` / `CFM_`。实际提取 **PASS**。未强制走 Music Stinger 路径。

## 10. Failure Classification

本阶段样本（必测卡 + 随机 10 Play + 10 Music 传说 + 负例）：

| Class | Count | Notes |
|---|---|---|
| NO_DATA | 2 | HERO_01 Play；ETC_409 Music。正确拒绝，未伪造 |
| INDEX_MISSING | 0 | |
| BUNDLE_NOT_FOUND | 0 | |
| CLIP_NOT_FOUND | 0 | 必测卡均找到 clip |
| FSB_NOT_FOUND | 0 | |
| FSB_OFFSET_INVALID | 0 | 越界候选被跳过，不再作为最终失败 |
| FSB_DECODE_FAILED | 0 | |
| WAV_INVALID | 0 | |
| API_FAILED | 0 | EX1_414 / EX1_543 Play+Music+Entrance 均为 200 |
| UNKNOWN | 0 | |
| SUCCESS | 必测全过；随机 20/20 提取成功 | |

`indexMismatch`（zhcnBundles 空，真实 FSB 在 sibling audio / zhcn content）仍然存在，只记录，**未改 index**。

负例：

- **HERO_01**：无随从 Play。`GET /api/audio/voice/HERO_01/play` → 404 `暂无可用音频`。未把 Start/Greeting/Picked 当成 Play。
- **ETC_409**：无 Music。`GET /api/audio/music/ETC_409` → 404 `暂无可用音频`。

## 11. Root Cause

EX1_414 / EX1_543 之前失败，是因为：

1. `audio-index` 的 **zhcnBundles 为空**（Phase 0.8 只扫文件名同时含 `zhcn`+`audio` 的包）。classic 语音在 `essential_base_zhcn-content-0`（无 `audio` 段），Music/SFX 在 `essential_base_global-audio-0`（无 `zhcn`）。
2. Extractor fallback 顺序是 **prefab → 全量 soundlegend**。`essential_base_global-prefab-0` / `essential_base_zhcn-content-0` 被 unity-js `loadAssetBundle` 时抛 `End position (184546655) out of boundary (11514864)`。
3. `findClip` 用 `Array.find` 访问 `o.name`，加载失败即 **整个 extraction return null**，即使后面的候选可能有效。
4. prefab 名 `essential_base_global-prefab-0` **没有 8 位 hash**，旧 hash 关联逻辑加不上 `essential_base_global-audio-0`。
5. EX1_414 Play 的真实 FSB 在 content 包的 `.resource` 节点（offset 7506176 对 11602336 字节资源合法）。unity-js 读的是 CAB（11514864）才会越界。需要 **unpack + AudioClip type tree + 按 m_Source 切 .resource**。

EX1_543 Play（`SFX_EX1_543_EnterPlay`）和两张卡的 Music 实际都在 sibling audio 包里，硬验证通过即可，不必猜 soundlegend。

## 12. Fix

1. 新增 `src/explorer/audioBundleResolver.js`：候选列表带 `bundleName/path/reason/priority/evidence`。优先级：zhcn → sibling `*-audio-*` → hash 相关 audio → content → soundlegend（仅 Music clip）→ prefab。评分不能替代硬验证。
2. `HearthstoneAudioExtractor`：按候选逐个 inspect；FSB 越界只标记 invalid 并继续；成功条件为 clip + FSB + offset valid + decode。unity-js 加载失败时，对 **该候选** 走 unpack/type-tree 读取 `.resource`。对象扫描逐条 try/catch，避免一根坏 object 毁掉整个 bundle。
3. Voice 与 Music 共用 Resolver（Music 仍先 `extractVoice(audioClip)`）。
4. `?debug=1` 才打 `[AudioBundleResolver]` 日志。生产默认安静。
5. 可选缓存 `data/audio-verification/audio-bundle-resolution-cache.json`（可删后重建）。不覆盖任何 index。
6. CLI：`npm run discover:audio-bundles -- --cardId EX1_414`。
7. AudioService / Mini API 传入 `{ debug, cardId }` 仅用于日志，不含 CardID 分支。

## 13. Safety

| Item | Status |
|---|---|
| C:\Hearthstone | **unchanged**（只读 Win 目录 listing + 读 bundle） |
| Index（card-audio / music / voice / audio-index） | **unchanged** |
| Full export | **NO** |
| CardID special case | **NO** |
| Player / InnerAudioContext / mix / delay | **untouched** |
| 微信吞首字 | **未处理**（仍属 1.3.5 INCONCLUSIVE） |

## 14. Performance

EX1_414 `discover:audio-bundles`（冷路径，含 decode）：

| Phase | ms |
|---|---|
| load indexes | 311 |
| Voice resolve | 5 |
| Voice inspect+decode | 264 |
| Music resolve | 11 |
| Music inspect+decode | 111 |
| extract (discover 合计) | 391 |
| total | 704 |

之后 Mini API 走 `tmp/audio` / `tmp/music` 缓存，diagnose extractMs ≈ 2–39 ms。未递归扫描整个 `C:\Hearthstone`；只对当前 clip 的候选包 listing + 按需 unpack。Win 目录 `readdir` 一次缓存。

## 15. Tests

`npm test` = **PASS**（含既有套件 + `test/audioBundleResolver.test.js` + live extract）。

Live 覆盖：EX1_414/543 Voice+Music+Entrance；EX1_116/572/BOT_548；shared_resource；shared_audio；named_sfx；invalid-FSB 候选被评分拒绝；无 CardID 特判；Hearthstone probe 文件 mtime/size 不变。

---

## Required table

| Card | Slot | Index | Candidate | Bundle | Clip | FSB | Offset | WAV | API |
|---|---|---|---|---|---|---|---|---|---|
| EX1_414 | Play | FOUND `VO_EX1_414_Play_01` | indexed_content_bundle | essential_base_zhcn-content-0.unity3d | YES | YES | 7506176 | YES | 200 |
| EX1_414 | Music | FOUND `Pegasus_Stinger_Horde1` | sibling_audio_bundle | essential_base_global-audio-0.unity3d | YES | YES | 8378688 | YES | 200 |
| EX1_414 | Entrance | FOUND | mix(Play+Music) | — | — | — | — | YES | 200 |
| EX1_543 | Play | FOUND `SFX_EX1_543_EnterPlay` | sibling_audio_bundle | essential_base_global-audio-0.unity3d | YES | YES | 5410496 | YES | 200 |
| EX1_543 | Music | FOUND `Pegasus_Stinger_Beast_Villain` | sibling_audio_bundle | essential_base_global-audio-0.unity3d | YES | YES | 31358368 | YES | 200 |
| EX1_543 | Entrance | FOUND | mix(Play+Music) | — | — | — | — | YES | 200 |
| EX1_116 | Play | FOUND zhcnBundles | zhcn_audio_bundle | playsound_base_zhcn-775a814d-audio-0.unity3d | YES | YES | (existing) | YES | 200 |
| EX1_116 | Music | FOUND | existing path | (unchanged Leeroy stinger) | YES | YES | (existing) | YES | 200 |
| BOT_548 | Play | FOUND | existing path | (unchanged) | YES | YES | (existing) | YES | 200 |
| BOT_548 | Music | FOUND `Zilliax_Play_Stinger` | soundlegend / existing | soundlegend_base_global-6c782fd0-audio-3.unity3d | YES | YES | (existing) | YES | 200 |
