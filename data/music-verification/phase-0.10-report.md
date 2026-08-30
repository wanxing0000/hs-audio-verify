# Phase 0.10 — Music Stinger / 登场音乐最小验证

测试对象：`EX1_116` 火车王里诺艾。未扫描全部卡牌，未批量导出，未修改 `C:\Hearthstone`。

## 结论

链路成立：

`CardID → CardDef → MusicStinger GUID → MusicStinger.prefab → SoundDef AudioClip → FSB5 (Vorbis) → PCM 16-bit WAV → Play Voice 组合 Preview`

这不是完整 BGM / Background Music。提取到的是约 **4.27 秒** 的短 stinger：`Pegasus_Stinger_Leeroy_Jenkins`。

## 验收清单

- [x] EX1_116 MusicStinger 定位成功
- [x] MusicStinger GUID 定位成功（`c6aaf3440b38a664db44d8870f3864d1`）
- [x] 找到实际 AudioClip
- [x] 找到实际资源块（FSB5 / Vorbis）
- [x] 成功提取音乐到 `tmp/music/`
- [x] 成功转换成 PCM 16-bit WAV
- [x] 浏览器 / HTTP API 可播放（`/api/music/`）
- [x] EX1_116 Play Voice 可播放
- [x] Music + Play Voice 生成本地 Preview
- [x] 没有修改 `C:\Hearthstone`
- [x] 没有批量导出
- [x] `npm test` 通过

## 报告问题

### 1. MusicStinger 是否可以解析？

可以。GUID `c6aaf3440b38a664db44d8870f3864d1` 位于 bundle：

`initial_base_global-775a814d-prefab-1.unity3d`

Container preload（9 个对象）包括：

| 类型 | 名称 / 角色 |
| --- | --- |
| MonoScript (115) | `MusicStingerSpell` |
| MonoScript (115) | `SoundDef` |
| GameObject (1) | `MusicStinger` |
| GameObject (1) | `AudioSource` |
| Transform (4) | ×2 |
| MonoBehaviour (114) | `MusicStingerSpell` 实例 |
| MonoBehaviour (114) | `SoundDef` 实例 |
| AudioSource (82) | 播放器 |

### 2. EX1_116 是否存在 MusicStinger？

存在。CardDef TypeTree **没有** 独立字段：

- `m_MusicStinger`：未发现该参数
- `m_MusicStingerPath`：未发现该参数
- `m_MusicStingerDef`：未发现该参数

实际挂在 **Play 特效** 上：

`m_PlayEffectDef.m_SoundSpellPaths` =

1. `Play.prefab:abd4cfd794032624785f78a5de7da354`
2. `MusicStinger.prefab:c6aaf3440b38a664db44d8870f3864d1`

因此 Music Stinger 与 Play Voice 同属登场 Play 效果，而不是单独的 BGM 槽。

### 3. MusicStinger 最终引用了什么？

`SoundDef.m_AudioClip` =

`Pegasus_Stinger_Leeroy_Jenkins.wav:46bf63d9a1db6644ca1dec9ec5a61103`

不是 heromusic，也不是卡牌 ID 同名音频。资源名是 Pegasus 引擎的 Leeroy Jenkins stinger。

### 4. 是否找到 AudioClip？

是。`Pegasus_Stinger_Leeroy_Jenkins`

### 5. AudioClip 位于哪个 Bundle？

`soundlegend_base_global-6c782fd0-audio-2.unity3d`

Container GUID = `46bf63d9a1db6644ca1dec9ec5a61103`。只打开了 EX1_116 相关 hash 的 audio / soundlegend bundle，没有扫描全部 702 个 audio pack。

### 6. 是否找到 FSB5？

是。`m_Resource`：

- source: `archive:/CAB-4235e0476c977c9e859e6e856d7b67cc/CAB-4235e0476c977c9e859e6e856d7b67cc.resource`
- offset: `21092384`
- size: `145184`
- compression: Vorbis（Unity `m_CompressionFormat = 1`）

原始块：`tmp/music/EX1_116_MusicStinger.fsb`（魔数 `FSB5`）

### 7. 是否成功转换 WAV？

是。复用 Phase 0.9 的 `convertFsb` + `wavToPcm16`。

`tmp/music/EX1_116_MusicStinger.wav`

- PCM 16-bit
- 44100 Hz（资源原始采样率，不是 48 kHz）
- 2 声道
- 753508 bytes

Play Voice 为 48 kHz。原始 stinger WAV **未**被重采样；只有 Preview 混音为了叠加才把两边对齐到 48 kHz。

### 8. 音频时长是多少？

约 **4.271 秒**。这是短 stinger，不是循环战场 BGM。

### 9. 是否成功与 Play Voice 组合？

是。Play Voice：`VO_EX1_116_Play_01` → `tmp/audio/VO_EX1_116_Play_01.wav`

验证用 Preview（不改原始资源）：

| 文件 | 说明 |
| --- | --- |
| `tmp/music/EX1_116_entrance_preview.wav` | t=0 同时开始 |
| `tmp/music/EX1_116_entrance_preview_d100.wav` | Voice 延迟 100 ms |
| `tmp/music/EX1_116_entrance_preview_d200.wav` | Voice 延迟 200 ms |
| `tmp/music/EX1_116_entrance_preview_d300.wav` | Voice 延迟 300 ms |

这些 Preview 是本地叠加，不是游戏内部混音还原。

### 10. 是否发现 delay？

发现。`MusicStingerSpell.m_CardSoundData.m_DelaySec = 0`

未发现独立的 Play-vs-Stinger 时序字段。游戏把两者都挂在 `m_PlayEffectDef` 上，CardDef 层 delay 为 0。100/200/300 ms Preview 只是验证叠加，不是从资源读出的官方偏移。

未发现：`duration` / `fade` / `trigger` / `timing`（MusicStingerSpell 顶层）。

### 11. 是否发现 volume？

发现，在 AudioSource 与 SoundDef 上：

- AudioSource `m_Volume = 1`，`m_Pitch = 1`
- SoundDef `m_RandomVolumeMin = 1`，`m_RandomVolumeMax = 1`
- SoundDef `m_RandomPitchMin = 1`，`m_RandomPitchMax = 1`

MusicStingerSpell 自身没有 `m_Volume`。`m_MusicStingerData` 解析结果为空对象 `{}`。

### 12. 是否发现 loop？

发现。AudioSource 字段名为 `Loop`（不是 `m_Loop`），值为 **false**。

`m_PlayOnAwake = false`（由 Spell 触发，不是 Awake 自动播）。

未发现 `m_SpatialBlend` 字段；3D 相关存在 `panLevelCustomCurve` / `MinDistance=100` / `MaxDistance=500`。

### 13. MusicStinger 是否属于“登场音乐”？

资源关系证据支持“登场 stinger”，不支持“完整 BGM”：

1. CardDef 把它放在 `m_PlayEffectDef.m_SoundSpellPaths` 里，与 Play Voice 并列。
2. Prefab 名是 `MusicStinger`，脚本是 `MusicStingerSpell`。
3. AudioClip 名是 `Pegasus_Stinger_Leeroy_Jenkins`（stinger，不是 heromusic / 循环 BGM）。
4. 时长约 4.3 秒，`Loop = false`。

**不要**把它叫作 Background Music。

### 14. 当前链路是否可以未来批量化？

对“有 MusicStinger 的卡牌”：**可以沿同一条链批量化**，不需要扫全部 audio bundle。

建议未来步骤（本阶段不做）：

1. 从已有 CardDef TypeTree 读 `m_PlayEffectDef.m_SoundSpellPaths`（以及若出现的独立 MusicStinger 字段）。
2. GUID → 已有 `guid-voice-index`（或等价 preload 索引）。
3. SoundDef `m_AudioClip` 名 → `audio-index` / hash-sibling `soundlegend_*` audio bundle。
4. TypeTree `m_Resource` 切片 → FSB5 → WAV。

未知：有多少卡牌把 Stinger 放在 Play 槽、有多少用独立字段、有多少指向 heromusic。

### 15. 当前还有什么未知问题？

- CardDef 没有 `m_MusicStinger*` 字段；其它卡是否同样只挂在 Play 槽，未验证。
- `m_MusicStingerData` 为空，可能是空结构体，也可能还有未解码字段。
- Stinger 原始采样率 44.1 kHz，语音 48 kHz；游戏如何对齐未知。
- AudioSource `m_audioClip` PPtr 为 0，真实 clip 走 SoundDef 字符串 GUID，不是 AudioSource 直接引用。
- 未验证第二张传说随从。
- 未建立全量 Music Index。
- 游戏内部是否对 stinger duck / 动画节点触发，本阶段不还原。

## 核心问题 A–J

| | 答案 |
| --- | --- |
| A | 是。SoundDef → AudioClip `Pegasus_Stinger_Leeroy_Jenkins` |
| B | 是。GUID `c6aaf344…` → prefab bundle + preload |
| C | 是。Prefab：`initial_base_global-775a814d-prefab-1.unity3d`；音频：`soundlegend_base_global-6c782fd0-audio-2.unity3d` |
| D | 是。`Pegasus_Stinger_Leeroy_Jenkins` |
| E | 是。FSB5 + Vorbis，`m_Resource` offset/size 如上 |
| F | 是。PCM 16-bit stereo 44.1 kHz WAV |
| G | 是登场 Music Stinger（Play 特效槽），不是 BGM |
| H | 可以组合成浏览器可播放 Preview；不是官方混音 |
| I | delay=0；volume=1；loop=false；playOnAwake=false。未发现 fade / trigger / 官方 voice delay |
| J | 足以未来按 CardDef → GUID → clip 批量建索引；本阶段只做了 EX1_116 |

## 产物

- `data/music-verification/phase-0.10-results.json`
- `data/music-verification/music-sample-index.json`
- `data/music-verification/phase-0.10-unity-dump.json`
- `data/music-verification/phase-0.10-report.md`
- `tmp/music/EX1_116_MusicStinger.fsb`
- `tmp/music/EX1_116_MusicStinger.wav`
- `tmp/music/EX1_116_entrance_preview*.wav`
- `test/musicStinger.test.js`
- `npm run verify:music`

本地 Explorer 增加只读播放：`GET /api/music-index`、`GET /api/music/:file`。不是产品网站。

HTTP 实测（`127.0.0.1:8766`）：

- `/api/music/EX1_116_MusicStinger.wav` → 200 `audio/wav` 753508 bytes，RIFF
- `/api/music/EX1_116_entrance_preview.wav` → 200 820140 bytes
- `/api/audio/VO_EX1_116_Play_01` → 200 cache hit

Cursor 内置浏览器 MCP 本次不可用（`Server not found: cursor-ide-browser`），播放验收以 HTTP WAV 响应为准。
