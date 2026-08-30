# Phase 1.4.5 — Tess BGM Resolver 定位与修复

## 1. 最终根因

`Gilneas_Play_Stinger_6` 之前 Resolver 找不到，不是候选列表漏了 `soundlegend`，也不是 prefab 没进候选。

真实链：

```text
CardDef extra MusicStinger
  GUID d7504580b84df004e85650f93b1d14d2
  prefab initial_base_global-d2f4bda7-prefab-4.unity3d
↓
Prefab 内没有 AudioClip 对象（classId 83 = 0）
SoundDef 字符串：
  Gilneas_Play_Stinger_6.wav:ab456f99bb1621740ade826f5651d0fd
↓
索引记下了 SoundDef 左侧的 clip 名 Gilneas_Play_Stinger_6
↓
Resolver 在 19 个候选里按 **clip 名** 查找
  soundlegend_base_global-6c782fd0-audio-1.unity3d 里没有名为
  Gilneas_Play_Stinger_6 的 AudioClip
↓
CLIP_NOT_FOUND
```

该 SoundDef 右侧 GUID `ab456f99bb1621740ade826f5651d0fd` 就在已经搜过的：

`soundlegend_base_global-6c782fd0-audio-1.unity3d`

但容器里这个 GUID 对应的 AudioClip **实际名字是** `Gilneas_Play_Stinger_2`。

Unity 按 GUID 加载；索引/Resolver 按过期 clip 名匹配。名字对不上，GUID 对得上。

扫过的数据：

- `audio-index` / `music-assets` / `guid-voice-index` / `card-audio-index`
- `asset_manifest.unity3d`（有 MusicStinger GUID 与 AudioClip GUID）
- 全部 810 个 `-audio-` / `-content-` bundle 的解包字节：`Gilneas_Play_Stinger_6` 字符串 **零命中**
- 同文件中 `Gilneas_Play_Stinger_4` 命中 `soundlegend-…-audio-1`（吉恩对照）

Prefab `initial_base_global-d2f4bda7-prefab-4.unity3d` **有进入候选**（第 19 个，`indexed_prefab_bundle`）。它只含字符串引用，FSB 不在该包内。

### Candidate discovery（修复前，19 个）

```text
Candidate discovery:
1. hash_related_audio ×7   playsound_* / soundotherminion_* d2f4bda7-audio-*
2. soundlegend_audio_bundle ×4   soundlegend_base_global-6c782fd0-audio-0..3
3. music_catalog_bundle ×7   heromusic_* / musicexpansion_*
4. indexed_prefab_bundle ×1   initial_base_global-d2f4bda7-prefab-4.unity3d
```

无 sibling `-audio-`：Win 目录不存在 `initial_base_global-d2f4bda7-audio-*`。

不是只搜了 soundlegend；soundlegend-1 已被搜到，但按错误的 clip 名匹配。

## 2. 实际 Bundle

```text
clip (SoundDef / 索引名):
Gilneas_Play_Stinger_6

MusicStinger GUID:
d7504580b84df004e85650f93b1d14d2

AudioClip GUID:
ab456f99bb1621740ade826f5651d0fd

实际 AudioClip 名:
Gilneas_Play_Stinger_2

实际 Bundle:
soundlegend_base_global-6c782fd0-audio-1.unity3d

bundle type:
soundlegend audio / FSB5
resource:
CAB-76ea2b5005bee51de08b3fa8b82a6e66.resource
offset 30042432  size 157184  resourceLen 32895328  offsetValid true
```

依赖链：

```text
CardDef
↓
Prefab initial_base_global-d2f4bda7-prefab-4.unity3d
  MusicStinger d7504580…
  SoundDef  Gilneas_Play_Stinger_6.wav:ab456f99…
↓
Audio Bundle soundlegend_base_global-6c782fd0-audio-1.unity3d
  container key ab456f99… → AudioClip Gilneas_Play_Stinger_2
↓
FSB in .resource → decode WAV
```

这是调查清单 **情况 B + C**：prefab 只引用；真实 clip 在 global soundlegend bundle；引用用 GUID，名字已过期。

## 3. 修复方式

**通用修复，无 GIL_598 / clip 名硬编码。**

旧 Resolver / inspect：

- 候选仍含 soundlegend
- `inspectViaUnpack` 只 `clipNameMatches(m_Name, wantedName)`
- SoundDef 名与 bundle 内 AudioClip 名不一致时失败
- unity-js 未找到 clip 时不一定走 unpack（GUID 路径被跳过）

新逻辑：

1. `parseSoundDefWavRefs`：从 MusicStinger preload 解析 `Name.wav:<32-hex-guid>`
2. `recoverSoundDefClipGuid(prefabBundle, musicAssetId, wantedName)`
3. `inspectViaUnpack`：名字匹配 **或** AssetBundle container key == AudioClip GUID
4. unity-js 按名未找到且带有 GUID 时，强制 unpack
5. `getMusicAudio` 传入 `prefabGuid` / `prefabBundle`（来自已有 music meta，不是 CardID 分支）

吉恩 `Gilneas_Play_Stinger_4` 仍按名字命中同一 soundlegend 包，行为不变。

## 4. Tess 验证

```text
GIL_598 Voice = PASS
  GET /api/audio/voice/GIL_598/play → 200 audio/wav 199468  RIFF PCM16 48 kHz mono

GIL_598 BGM = PASS
  GET /api/audio/music/GIL_598 → 200 audio/wav 923984  RIFF PCM16 48 kHz stereo
  winner soundlegend_base_global-6c782fd0-audio-1.unity3d
```

## 5. 回归验证

```text
existing BGM GIL_692 / Gilneas_Play_Stinger_4 = PASS  (200, 1243884 bytes)
shared BGM CORE_GIL_598 = PASS  (200, 与 GIL_598 同 923984 bytes)
ordinary BGM EX1_116 = PASS  (200)
missing ETC_409 = PASS  (404 暂无可用音频)
missing clip Pegasus_Stinger_DoesNotExist_ZZZ = PASS  (CLIP_NOT_FOUND)
```

## 6. npm test

`npm test`: **PASS**

新增 `test/musicStingerGuid.live.js`（TEST 1–7）与 `test/audioBundleResolver.test.js` 中的 GUID/SoundDef 单元断言。

## 7. 修改文件

| 文件 | 原因 |
| --- | --- |
| `src/explorer/audioBundleResolver.js` | SoundDef `wav:guid` 解析；clip 名或 GUID pathId 匹配 |
| `src/explorer/HearthstoneAudioExtractor.js` | 从 MusicStinger prefab 恢复 AudioClip GUID；unpack 按 GUID 找 clip |
| `src/services/audioService.js` | 提取 BGM 时传入已有 prefabGuid/bundle |
| `src/validation/discoverAudioBundles.js` | discover 走同一 GUID 路径 |
| `test/audioBundleResolver.test.js` | 单元测试 + 禁止 GIL_598 特判 |
| `test/musicStingerGuid.live.js` | TEST 1–7 真机包回归 |
| `scripts/run-music-stinger-guid-live.cjs` | 打包运行 live 测试 |
| `package.json` | `npm test` 接入上述 live 测试 |
| `data/card-verification/phase-1.4.5-report.md` | 本报告 |

Extractor 的可选 `data/audio-verification/audio-bundle-resolution-cache.json` 在成功提取后写入了 `Gilneas_Play_Stinger_6` 的 bundle 记录。这是既有 runtime cache，不是新索引、不是 CardID 表。

未修改：Player、PlayerController、Catalog、搜索、UI、小程序页面、微信播放逻辑、`C:\Hearthstone`、音频索引 JSON。
