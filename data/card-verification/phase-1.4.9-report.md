# Phase 1.4.9 Report

调查最终 Entrance WAV 是否真正包含可听 Music。只调查，不改生产代码，不进入 1.4.10。

测量时间：2026-08-29。数据来自当时正在运行的 Mini（`127.0.0.1:8767`），不是磁盘上的旧分析笔记。

---

## 1. Phase 目标

定位苔丝（GIL_598）在 Phase 1.4.8 补偿 + Mini 重启之后，真机仍「只有语音、听不到登场音乐」时，BGM 卡在哪一层：

Voice PCM → Music PCM → compensation 后 PCM → `mixPcm16` → Entrance WAV → HTTP → Mini / PlayerController → 真机播放。

禁止猜测静音头，禁止改补偿参数，禁止修复。

---

## 2. 当前实际运行版本

### Mini Server 状态

| 项 | 实测 |
| --- | --- |
| `GET /api/mini/health` | **200** `{"ok":true,"service":"mini-api","host":"0.0.0.0","port":8767}` |
| 进程 | `npm run mini` → `scripts/run-mini.cjs` → 加载 `tmp/mini-server.cjs` |
| 本轮重启 | 2026-08-29T08:02:24Z 起，调查期间仍在运行 |

### ENTRANCE_MIX_VERSION

| 位置 | 值 |
| --- | --- |
| `src/music/entranceMixConfig.js` | **3** |
| 正在运行的 `tmp/mini-server.cjs` | `var ENTRANCE_MIX_VERSION = 3`（约 L39304） |

Q1：当前进程是否加载 `ENTRANCE_MIX_VERSION = 3`？ **YES。**

### Compensation 调用链（代码，非猜测）

```
GET /api/audio/entrance/GIL_598
  → miniServer.js  route /api/audio/entrance/:cardId
  → EntrancePreviewService.getEntrancePreview(cardId)
  → previewCacheKey = cardId + '_entrance_v' + ENTRANCE_MIX_VERSION   // GIL_598_entrance_v3
  → cache miss 时：
       audioService.getVoiceAudio(cardId, 'play')
       audioService.getMusicAudio(cardId)
       applyMusicStartCompensation(musicBuf)     // findMusicStartCompensation.js
       mixMusic = compensation.wav
       mixPcm16(mixMusic, voiceBuf, ENTRANCE_MIX)
       cache.write('preview', 'GIL_598_entrance_v3', mixed.wav)
  → sendWav（Cache-Control: private, max-age=86400）
```

运行中的 bundle 含同一调用：`applyMusicStartCompensation(musicBuf)` 后 `mixPcm16(mixMusic, voiceBuf, ENTRANCE_MIX)`。

Q2：`GET /api/audio/entrance/GIL_598` 是否进入 Phase 1.4.8 compensation？ **YES。** 证据不是「源码里有函数」，而是 HTTP 返回的 PCM **逐样本等于** `mixPcm16(compensatedMusic, voice, ENTRANCE_MIX)`，且 **不等于** 未补偿 mix。

Q3：本次实测 `compensationMs`（对当前 Music WAV 独立重算，不是抄 1.4.8 报告）：

| 卡 | compensationMs | frames | bytes | fallback |
| --- | ---: | ---: | ---: | --- |
| GIL_598 | **110** | 5280 | 21120 | false |
| GIL_692 | **10** | — | — | false |

`ENTRANCE_MIX` 实测：`musicVolume=0.7`，`voiceVolume=1`，`voiceDelayMs=0`，`leadingPaddingMs=0`，`targetRate=48000`。

---

## 3. API 实测

全部从当前 Mini 抓取，保存为 **TEMP INVESTIGATION ARTIFACT**（`tmp/phase-1.4.9/`）。未写入正式音频目录，未改 Catalog / API。

| Card | Type | HTTP | Bytes | SHA1 | Sample Rate | Channels | Bit | Duration |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| GIL_598 | Voice | 200 | 199468 | `66a7f60c07ea480c75126b33bf824898dd69d043` | 48000 | 1 | 16 | 2077.33 ms |
| GIL_598 | Music | 200 | 923984 | `fa81027d4c80ba9a8ed5d19b822e734327b85233` | 48000 | 2 | 16 | 4812.19 ms |
| GIL_598 | Entrance | 200 | 902864 | `0d49c58fcc0e71676f0d2cd3c66c5c077c91eb52` | 48000 | 2 | 16 | 4702.19 ms |
| GIL_692 | Voice | 200 | 388396 | `f670436a73fd998de859744c5cec7754c551515b` | 48000 | 1 | 16 | 4045.33 ms |
| GIL_692 | Music | 200 | 1243884 | `cc9b2ce673825bb4547cd04af2a73777b3c7d530` | 48000 | 2 | 16 | 6478.33 ms |
| GIL_692 | Entrance | 200 | 1241964 | `334a3e8fa01e0252a21cf1deefff28f7f3b3b121` | 48000 | 2 | 16 | 6468.33 ms |
| EX1_116 | Entrance | 200 | 814380 | `6c30a114843f3269ecf3d57e0469795454a1bfee` | 48000 | 2 | 16 | 4241.33 ms |
| ETC_409 | Music | **404** | — | — | — | — | — | — |
| ETC_409 | Entrance | **404** | — | — | — | — | — | — |

WAV Header：全部 `RIFF` / PCM `audioFormat=1`。Content-Type `audio/wav`。Cache-Control `private, max-age=86400`。

对照：ETC_409 无 Music → Entrance 404。苔丝 Music 200、Entrance 200。这不是「根本没有 BGM」那一类。

GIL_598 补偿后 Music 调查文件：`tmp/phase-1.4.9/GIL_598_music_compensated.wav`，`compensationMs=110`，902864 bytes，SHA1 `dff448329c631f434337730be7f2d1eaeb35e25f`。体积与 Entrance 相同是因为两者都是 4702.19 ms stereo PCM16（`225705 * 4 + 44`），**内容不同**（见 mix 验证）。

`GET /api/mini/card/GIL_598` → `id: "GIL_598"`，`name: "苔丝·格雷迈恩"`，`music.available=true`，`entrancePreview.available` 为真。

---

## 4. GIL_598 PCM 时间轴

RMS / Peak 为 int16 幅度。Voice 是 mono：Left RMS = Right RMS = Combined RMS。Music / Entrance 是 stereo：Combined RMS 为两声道样本一起算。nonZero = 非零样本 / 总样本（%）。

### Voice（mono，到 2077 ms 结束）

| Time (ms) | RMS | L RMS | R RMS | Peak | maxAbs | nonZero % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–100 | 6979 | 6979 | 6979 | 12998 | 12998 | 95.71 |
| 100–200 | 6802 | 6802 | 6802 | 15360 | 15360 | 99.98 |
| 200–300 | 4199 | 4199 | 4199 | 22886 | 22886 | 99.73 |
| 300–500 | 7871 | 7871 | 7871 | 16892 | 16892 | 99.99 |
| 500–1000 | 5440 | 5440 | 5440 | 20933 | 20933 | 98.98 |
| 1000–1500 | 6358 | 6358 | 6358 | 23913 | 23913 | 100 |
| 1500–2000 | 5310 | 5310 | 5310 | 22595 | 22595 | 99.99 |
| 2000–2500 | 257 | 257 | 257 | 1805 | 1805 | 93.80 |

2000–2500 只有 3712 frames（Voice 在 2077 ms 结束）。

### Music 原始（offset = 0，Music API）

| Time (ms) | RMS | L RMS | R RMS | Peak | maxAbs | nonZero % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–100 | 49 | 48 | 50 | 289 | 289 | 60.92 |
| 100–200 | 442 | 349 | 519 | 1862 | 1862 | 99.93 |
| 200–300 | 1857 | 1686 | 2013 | 8892 | 8892 | 99.93 |
| 300–500 | 5121 | 4778 | 5442 | 22321 | 22321 | 99.99 |
| 500–1000 | 5522 | 5589 | 5455 | 24707 | 24707 | 99.99 |
| 1000–1500 | 3698 | 3792 | 3601 | 12977 | 12977 | 99.99 |
| 1500–2000 | 4972 | 5162 | 4775 | 17789 | 17789 | 100 |
| 2000–2500 | 5791 | 6054 | 5516 | 24195 | 24195 | 100 |
| 2500–3000 | 6417 | 6826 | 5980 | 26940 | 26940 | 99.98 |

### Music compensation 后（offset = 110 ms）

| Time (ms) | RMS | L RMS | R RMS | Peak | maxAbs | nonZero % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–100 | 501 | 413 | 575 | 1959 | 1959 | 99.95 |
| 100–200 | 2074 | 1885 | 2248 | 8892 | 8892 | 99.94 |
| 200–300 | 3783 | 3296 | 4214 | 14325 | 14325 | 99.99 |
| 300–500 | 6741 | — | — | — | — | — |
| 500–1000 | 4753 | — | — | — | — | — |
| 1000–1500 | 3924 | — | — | — | — | — |
| 1500–2000 | 5354 | — | — | — | — | — |
| 2000–2500 | 5972 | — | — | — | — | — |

300 ms 之后的补偿后 RMS 来自与 Voice 对齐的窗口表（`tessRatiosComp`）。0–300 有完整 L/R。

### Entrance 最终 WAV

| Time (ms) | RMS | L RMS | R RMS | Peak | maxAbs | nonZero % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–100 | 6990 | 6987 | 6993 | 13957 | 13957 | 99.97 |
| 100–200 | 6930 | 6929 | 6931 | 17248 | 17248 | 99.99 |
| 200–300 | 4916 | 4889 | 4943 | 28299 | 28299 | 100 |
| 300–500 | 9245 | 9136 | 9352 | 28183 | 28183 | 100 |
| 500–1000 | 6386 | 6352 | 6420 | 24659 | 24659 | 99.99 |
| 1000–1500 | 6935 | 6954 | 6916 | 26248 | 26248 | 99.99 |
| 1500–2000 | 6455 | 6553 | 6355 | 31550 | 31550 | 100 |
| 2000–2500 | 4184 | 4368 | 3991 | 18858 | 18858 | 100 |
| 2500–3000 | 4250 | 4548 | 3930 | 16894 | 16894 | 99.99 |
| 3000–3500 | 2242 | 2250 | 2234 | 11668 | 11668 | 99.99 |
| 3500–4000 | 374 | 386 | 360 | 2629 | 2629 | 99.91 |
| 4000–4500 | 94 | 104 | 83 | 533 | 533 | 99.65 |
| 4500–4702 | 20 | 18 | 22 | 90 | 90 | 95.55 |

0–100 ms：Entrance RMS **6990** ≈ Voice **6979**。补偿后 Music RMS 仅 **501**。叠加上 `musicVolume=0.7` 后，Music 对总和的贡献很小。这不是 SHA1 比较，是 PCM 能量。

Voice 结束后（≥2077 ms）：Entrance 2000–2500 RMS **4184**，此时 Voice 只剩尾巴 RMS 257。该窗口的能量来自 Music。

---

## 5. GIL_692 对照

### 对照表（单位：int16 RMS，同一套窗口）

Music 列 = **Music API 原始**（offset 0）。Genn `compensationMs=10`，0–100 与补偿后几乎同档。

| Time (ms) | Tess Voice | Tess Music | Tess Entrance | Genn Voice | Genn Music | Genn Entrance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–100 | 6979 | **49** | 6990 | 5787 | **2190** | 5749 |
| 100–200 | 6802 | 442 | 6930 | 5923 | 4272 | 6575 |
| 200–300 | 4199 | 1857 | 4916 | 2427 | 5881 | 5102 |
| 300–500 | 7871 | 5121 | 9245 | 6078 | 6679 | 7651 |
| 500–1000 | 5440 | 5522 | 6386 | 4444 | 5857 | 5919 |

Music / Voice RMS 比：

| Time (ms) | Tess 原始 Music/Voice | Tess 补偿后 Music/Voice | Genn 原始 Music/Voice |
| --- | ---: | ---: | ---: |
| 0–100 | **0.007** | **0.072** | **0.378** |
| 100–200 | 0.065 | 0.305 | 0.721 |
| 200–300 | 0.442 | 0.901 | 2.423 |
| 300–500 | 0.651 | 0.856 | 1.099 |
| 500–1000 | 1.015 | 0.874 | 1.318 |

实测差异（不是听感形容词）：

- 吉恩 0–100 ms Music RMS **2190**，苔丝原始 **49**，补偿后 **501**。吉恩起音 Music 仍约为 Voice 的 38%；苔丝补偿后仍约为 Voice 的 **7.2%**。
- 苔丝 0–100 Entrance RMS 与 Voice 几乎相同（6990 vs 6979）。吉恩 0–100 Entrance 5749 vs Voice 5787，Music 已经在同量级。
- 苔丝 500–1000 之后，补偿后 Music RMS 与 Voice 同量级（0.87–1.01）。问题集中在 **起音 0–200 ms**，不是整条 WAV 没有 Music。
- 苔丝 Voice 只有 **2077 ms**；Entrance 总长 **4702 ms**。2077 ms 之后 Entrance RMS 4184 / 4250，这是 Music 独奏段。吉恩 Voice 4045 ms，重叠更长。

---

## 6. Compensation 验证

独立重算：GIL_598 `compensationMs = 110`（fallback=false）。

最终 mix 使用的 Music 对齐（Voice 结束后 48000 frames ≈ 1 s）：

| 相关对象 | 相关系数 |
| --- | ---: |
| Entrance vs `0.7 * Mc(t)`（补偿后 Music） | **1.0** |
| Entrance vs `0.7 * M(t)`（原始 Music，offset 0） | **−0.07** |
| Entrance vs `0.7 * M(t − 110 ms)` | **1.0** |

HTTP Entrance SHA1 vs 本地 `mixPcm16(compensatedMusic, voice, ENTRANCE_MIX)`：**相同** `0d49c58f…`。

HTTP vs 未补偿 mix SHA1 `a4ce91af…`：**不同**。meanAbsDiff = 2871.922，mismatch 450162 / 451410。

结论：最终 Entrance **使用的是 compensation 后 Music（offset ≈ 110 ms）**，不是 offset = 0 的原始 Music。

---

## 7. Mix 验证

### 身份（逐样本）

| 比较 | meanAbsDiff | maxAbsDiff | mismatch / compared |
| --- | ---: | ---: | --- |
| HTTP Entrance vs compensated mix | **0** | **0** | 0 / 451410 |
| HTTP vs uncompensated mix | 2871.922 | 31043 | 450162 / 451410 |
| HTTP vs Voice upmix 到 stereo | 2508.582 | 17295 | 199296 / 199424 |

`E(t) = mix(V(t), Mc(t))` 在当前 `ENTRANCE_MIX` 下 **样本级成立**。

GIL_692 HTTP Entrance SHA1 同样等于本地 mix（`httpEqualsLocal: true`）。

### Section 8 分类（PCM 身份）

| CASE | 是否成立 |
| --- | --- |
| A Entrance ≈ Voice，Music 没进 mix | **否。** SHA1 不同，MAD 2508，Voice 结束后 corr(E, 0.7·Mc)=1 |
| B Music 进了 mix 但整条能量极低 | **否（整条）。** 500–2000 ms 补偿后 Music RMS 3924–5354；2000–2500 Entrance RMS 4184 |
| C Music 进了 mix，被 Voice 在同时间掩盖 | **是（0–200 ms）。** 补偿后 0–100 Music/Voice = 0.072；Entrance RMS ≈ Voice RMS |
| D Entrance 明显含 Music 且与正常卡起音能量相近 | **否（起音）。** 苔丝 0–100 Music RMS 501 vs 吉恩 2190 |
| E 其他 | 见第 11 节总分类 |

Voice **进入** mix。Music **进入** mix。最终 WAV **符合** `mixPcm16(Mc, V, ENTRANCE_MIX)`。

### mixPcm16 代码事实（Q1–Q5）

Q1 Gain：不是 1.0+1.0。Entrance 使用 `ENTRANCE_MIX`：Music **0.7**，Voice **1.0**。先 `scalePcm16`，再相加。

Q2 Clipping：`a + b` 后 **clamp** 到 int16 `[-32768, 32767]`。没有整段 normalize，没有 divide。

Q3 Stereo / Mono（苔丝实测 48 kHz）：

```
Voice mono PCM16
  → upmixMonoToStereo（每样本复制到 L 和 R）
Music stereo PCM16
  → 声道已是 2，不转换
两边 scale（0.7 / 1.0）
Music 拷到输出缓冲
Voice 逐样本加到同一缓冲（clamp）
```

Q4 Sample Rate：Voice 48000、Music 48000、targetRate 48000。`resamplePcm16` 在 `fromRate === toRate` 时直接返回。苔丝 **无重采样**。

Q5 Duration：`outLen = max(musicOffset + musicLen, voiceOffset + voiceLen)`。`voiceDelayMs=0`，`leadingPaddingMs=0`。补偿后 Music 时长 = 4812.19 − 110 = **4702.19 ms** > Voice 2077.33 ms。最终长度 = **补偿后 Music 长度**（max 规则），与 HTTP 4702.19 ms 一致。

---

## 8. 缓存验证

key 公式：`{cardId}_entrance_v{ENTRANCE_MIX_VERSION}` → **`GIL_598_entrance_v3`**。

磁盘同时存在 v2 与 v3。**禁止删除**；本阶段只记录。

| 文件 | bytes | mtime (UTC) | SHA1 |
| --- | ---: | --- | --- |
| `tmp/preview/GIL_598_entrance_v2.wav` | 923984 | 2026-08-29T06:03:23.129Z | `a4ce91af6c2e8d91843380cb37e9df30572b1347` |
| `tmp/preview/GIL_598_entrance_v3.wav` | 902864 | 2026-08-29T08:02:35.153Z | `0d49c58fcc0e71676f0d2cd3c66c5c077c91eb52` |
| HTTP `GET /api/audio/entrance/GIL_598` | 902864 | — | `0d49c58fcc0e71676f0d2cd3c66c5c077c91eb52` |

v3 mtime 在 Mini 重启（08:02:24）之后约 11 秒，与本轮 v3 首次生成一致。

Q1：当前 HTTP 是否来自 v3？ **YES。** SHA1 与 `*_entrance_v3.wav` 一致，与 v2 不一致。

Q2：若来自缓存：v3 文件生成时间 **2026-08-29T08:02:35Z**。后续请求命中 `cache.has('preview', 'GIL_598_entrance_v3')` 时读的就是该文件。

Q3：缓存文件 SHA1 与 HTTP SHA1？ **一致。**

Q4：代码已是 v3 但 HTTP 仍返回 v2？ **否。** 服务端 key 带 `_v3`。v2 文件仍在磁盘，但当前路由不会读它。未补偿 mix SHA1 正是 v2 文件的 SHA1。

注意：HTTP 头 `Cache-Control: private, max-age=86400`。服务端已是 v3；**微信客户端 24h 缓存同一 URL 的旧 body** 本环境无法读取，标 **NOT DEVICE VERIFIED**。旧服务端若曾把 Voice-only 当 Entrance 返回，客户端仍可能播旧文件。那是设备层假设，不是本次 HTTP 实测。

---

## 9. 客户端调用链

CODE PATH VERIFIED。真机 `wxfile://` PCM：**NOT DEVICE VERIFIED**（本环境读不到手机临时文件）。

```
card.wxml  bindtap="onEntrance"
  → card.js onEntrance()
  → card.id（目录详情 API：GIL_598）
  → audio.getEntranceUrl(card)
       = apiBase() + '/api/audio/entrance/' + encodeURIComponent(id)
       无 cache-bust 查询参数
  → player.playAudio({ type:'entrance', cardId:card.id, url, key: card.id + ':entrance' })
  → playerController.play → loadSrc(url)
  → iOS：shouldDownload(url) === true
       wx.downloadFile({ url })   // 仍是 entrance URL，不是 music / voice
       success → tempFilePath
       InnerAudioContext.src = tempFilePath     // sourceType wxfile
  → 非 iOS：InnerAudioContext.src = http entrance URL
```

苔丝点「完整登场试听」请求的不是 `/api/audio/music/GIL_598`，也不是 `/api/audio/voice/GIL_598/play`，而是 **`/api/audio/entrance/GIL_598`**。

`playerController` 下载成功后校验 `isLive(session)`；过期 session 会忽略 download。代码上 tempFilePath 绑定当前 session。无法在本机验证用户手机上的实际文件内容。

---

## 10. GIL_598 与 GIL_692 差异（数据）

| 指标 | GIL_598 苔丝 | GIL_692 吉恩 |
| --- | --- | --- |
| Voice 时长 | 2077 ms | 4045 ms |
| Music 时长 | 4812 ms | 6478 ms |
| Entrance 时长 | 4702 ms（Music − 110 ms） | 6468 ms（Music − 10 ms） |
| 0–100 Music RMS（原始） | 49 | 2190 |
| 0–100 Music RMS（补偿后） | 501 | ≈2190（只跳 10 ms） |
| 0–100 Voice RMS | 6979 | 5787 |
| 0–100 Entrance RMS | 6990 | 5749 |
| 0–100 Music/Voice（补偿后） | 0.072 | 0.378 |
| 500–1000 Music/Voice | 0.874（补偿后） | 1.318 |
| Voice 结束后 Entrance | 2000–2500 RMS 4184（Music 独奏） | Voice 仍在说话（2000–2500 Voice RMS 7231） |

可听差异的测量结论：两条 Entrance **都含 Music**（样本级 mix 成立）。苔丝与吉恩的差别是 **起音 0–200 ms 的 Music 相对 Voice 能量**：苔丝补偿后仍低一个数量级以上；吉恩从第一窗就是同量级。苔丝还有约 **2.6 s** 的 Music-only 尾段（2077–4702 ms）。若真机整段 4.7 s 都完全听不到 BGM，服务端当前 WAV **解释不了「Music 不存在」**；那种情况要另查设备缓存/播放，且本阶段未能验证设备文件。

---

## 11. 频谱（简单 band energy）

对 PCM 做分频段能量（相对值，同一套脚本）。目标：Entrance 里有、Voice 里弱、Music 里有的成分。

| Band | Tess Voice | Tess Music | Tess Entrance | Entrance after Voice | Music after +110 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0–400 Hz | 113243 | 172990 | 409501 | 581357 | — |
| 400–2000 Hz | 16001 | 119234 | 250706 | 527210 | 753157 |
| 2000–8000 Hz | 2699 | 22941 | 70027 | — | — |

400–2000 Hz：Voice **16001**，Entrance **250706**（约 15.7×）。该带在 Music 中为 119234。Voice 结束后 Entrance 400–2000 升到 527210，与补偿后 Music 同带同量级。这支持「最终 WAV 含 Music 频谱」，不是只靠 SHA1。

未做源分离。不声称人耳一定能在 0–200 ms 听出 BGM。

---

## 12. 最终断点

```
Music Resolver                 PASS     Music API 200，SHA1 与历史 Music 文件一致
Music WAV                      PASS     48 kHz stereo PCM16，4812 ms，真机曾确认可听
Start Compensation Applied     PASS     compensationMs=110 进入最终 mix（corr=1 vs offset 110；≠ offset 0）
Music PCM In Mix               PASS     E(t) 与 mix(V, Mc) 样本差为 0
Final Entrance Contains Music  PASS     非 Voice 拷贝；Voice 结束后 RMS 4184；400–2000 Hz 带远高于 Voice
HTTP Response                  PASS     200，SHA1 = v3 缓存，≠ v2
iOS Download Code Path         PASS     下载的是 /api/audio/entrance/GIL_598（代码）
Device Playback                NOT VERIFIED   未读取手机 wxfile PCM
```

### 第 22.11 节总分类

**CATEGORY E（其他）**，拆开写清楚，避免把已证伪的 A/C 当成结论：

- **不是 CATEGORY A**：Music 进入了最终 mix（样本级）。
- **不是 CATEGORY C**：当前 HTTP **不是** 错的 v2；服务端返回 v3。
- **不完全是 CATEGORY B**：整条 Entrance 的 Music 能量在 500 ms 之后并不「异常低」；**仅 0–200 ms** Music 相对 Voice 很低（补偿后比 0.072）。
- **不完全是 CATEGORY D**：客户端 URL 正确（代码）。若用户听完整 4.7 s 仍完全无 BGM，设备缓存/播放仍可能，但 **NOT PROVEN**。
- **已证明的 WAV 层事实**：0–200 ms 符合 Section 8 **CASE C**（Voice 掩盖起音 Music）。`voiceVolume=1` 且 Voice 立即满幅，`musicVolume=0.7` 叠在仍偏弱的补偿后前奏上。110 ms 补偿把 0–100 Music RMS 从 49 提到 501，仍远小于 Voice 6979。

### 验收问答

**Q1** 最终 `/api/audio/entrance/GIL_598` PCM 中有没有 Music？ **YES。**

**Q2** Phase 1.4.8 的 `compensationMs=110` 是否真的进入最终 mix？ **YES。** 当前重算仍是 110，且对齐的是补偿后 PCM。

**Q3** 当前 HTTP 是否返回 v3 结果？ **YES。**

**Q4** 问题发生在哪一层？

| 层 | 判定 |
| --- | --- |
| Resolver | PASS / 不是断点 |
| Compensation | 已应用 / 不是「没切」 |
| Mix | **PROVEN**：0–200 ms Music 相对 Voice 能量过低，Entrance 听感被 Voice 主导 |
| Cache（服务端） | 当前返回 v3 / **不是** 错发 v2 |
| HTTP | 200 且 SHA1 正确 |
| Client URL | CODE PATH 正确 |
| Device | **NOT PROVEN** |

**Q5** 下一步是否应该继续改 compensation？ **否（由 PCM 决定，不是听感）。** 110 ms 已经进 mix。再加 skip 不能把 0–100 的 Voice RMS 6979 压下去，也不能把 Music 提到吉恩的 2190。Voice 结束后 Music 已经在 RMS 4184。继续加大 compensation **没有本阶段数据支持**。

---

## 修复建议（仅建议，禁止实施）

Recommended next phase: **Phase 1.4.10**（调查/设计 mix 听感，仍不要特判 CardID）：

1. 不要再调 `compensationMs` / `MAX_MUSIC_START_COMPENSATION_MS` 作为苔丝专项修复。
2. 若目标是「台词进行中也能听到 BGM」：查 **musicVolume / voiceDelayMs / ducking**，用本报告 0–200 ms 表做前后对比。本阶段不改。
3. 若用户听完整 4.7 s 仍完全无 BGM：查微信对同一 Entrance URL 的 **24h HTTP 缓存**（`max-age=86400`，无 cache-bust）。本环境未验证设备文件。
4. 不要删除服务端 v2 缓存来「试试」；key 已经是 v3。

---

## 测试

`npm test`：**NOT RUN**。

原因：本阶段未修改生产代码，测试通过 ≠ 苔丝真机问题已解决。

---

## 生产代码修改

**MODIFIED = 0**

本仓库不是 git 仓库（`fatal: not a git repository`）。对照禁止清单：未改 `entrancePreviewService.js`、`mixPcm16.js`、`entranceMixConfig.js`、`findMusicStartCompensation.js`、`src/music/*`、`src/audio/*`、resolver/extractor、Mini player、catalogAdapter、UI、缓存、索引、Catalog。

新增正式文件：`data/card-verification/phase-1.4.9-report.md`。

临时产物（TEMP INVESTIGATION ARTIFACT）：

- `tmp/phase-1.4.9/GIL_598_voice.wav`
- `tmp/phase-1.4.9/GIL_598_music.wav`
- `tmp/phase-1.4.9/GIL_598_entrance.wav`
- `tmp/phase-1.4.9/GIL_598_music_compensated.wav`
- `tmp/phase-1.4.9/GIL_692_voice.wav`
- `tmp/phase-1.4.9/GIL_692_music.wav`
- `tmp/phase-1.4.9/GIL_692_entrance.wav`
- `tmp/phase-1.4.9/_analysis.json`

调查脚本 `tmp/_phase149_probe.cjs` 已删除。

---

## 停止点

Phase 1.4.9 完成。不进入 1.4.10，不改音量 / Voice Delay / Music Gain / Compensation，不删缓存。等待审阅本报告后再决定下一步。
