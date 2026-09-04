# PHASE 2.10-L-5 — TEST BASELINE FIX + E2E VERIFICATION + GIT CLOSEOUT

STATUS=**COMPLETE_VERIFIED**
DATE=2026-09-04 · BRANCH=master · HEAD_BEFORE=24fe4f8a915d61bcdda584a06453c32e63399214

## Scope

TIME_609 BGM 修复（L-3B）后的收尾阶段。仅执行：3 个 stale baseline 测试的最小修复 + 完整测试验证 + TIME_609 E2E 复验 + 安全 Git 收尾。
未调用 extraction / full extractor / global scan；未访问 C:\Hearthstone；未连接 VPS；未修改生产音频。

## Stale Failures (before fix, exactly 3)

| # | Test group | Test file | Failing assertion | Why |
|---|---|---|---|---|
| 1 | related card extraction priority audit | `test/phase210ExtractionPriority.test.js` | `assert.strictEqual(live.productionBaseline.music, 200)`（actual 201） | pre-L-3B music count frozen |
| 2 | first batch targeted extraction | `test/phase210I1TargetedExtraction.test.js` | `assert.strictEqual(prod.music, 200)`（actual 201） | 同上 |
| 3 | first batch production copy | `test/phase210I2ProductionCopy.test.js` | `assert.strictEqual(prod.music, 200)`（ExtractionPriority 与 I1 用 floor，I2 live 计数 201） | 同上 |

分类：**STALE_BASELINE**（全部为 live production snapshot 的 `music` 计数；无任何其它失败）。

## Test Fix Strategy

沿用各文件既有的模式（I-2 文件中 files/voice 已用 "floor" 模式；entrance 在 L-2C 已按 live 状态更新）：

- **ExtractionPriority / I1**（live production audit 类测试）：`music === 200` → `music >= 200`（保留 pre-TIME_609 底线，仍可捕获回退）+ 新增 `inventory.hasMusic('TIME_609') === true`（TIME_609 BGM 资产存在性被显式钉住，防止被静默移除）。
- **I2**（live 状态断言、且文件内注释已声明"this test asserts the CURRENT live production state"）：`music === 200` → `music === 201`（与既有 `entrance === 929` 同模式，反映 L-2C 之后的新权威 live 状态）。
- **历史冻结值不动**：I1 的 `result.productionBefore.files=685 / voice=386`、I2 的 `result.before.files=685 / voice=386 / after.music=200 / after.entrance=98` 等均为**历史工件的 freeze 值**（断言 I 阶段运行时刻的快照），不随部署演进，保留原样。

## Tests

| Suite | Result |
|---|---|
| targeted stale tests (3 files) | PASS（EXIT=0 ×3） |
| `npm run test:production` | **PASS** — 28/28 groups `PRODUCTION_TESTS_PASS`（修复前 25/28） |
| `npm test` | **PASS** — exit 0（283s，266 个 ok 输出，无任何 FAIL/断言错误；含 2 个 live-run scripts 均成功） |

## E2E (no redeployment)

本地（production mode，127.0.0.1:8819，`/api/mini/health` audioSource=production）：

| Endpoint | Result |
|---|---|
| TIME_609 play / attack / death / entrance / music | 200 ×5 |
| TIME_609 music SHA256 | `d4a0b280e0ec8cb907a2edc464261d6e4d4c8e76742b571a55bd561f9ddfa32a`（bytes=1310888，与权威值一致） |
| TOY_330 music（控制） | 200 |
| TIME_005 play（控制） | 200 |
| TIME_005t9 play（控制） | 200 |
| TIME_005 / TIME_005t9 music | 404（与 L-3B 报告记录的已知行为一致，非新回归） |

公网（https://api.hsvoiceguide.online，无重新部署）：

| Check | Result |
|---|---|
| TIME_609 music | **HTTP 200 `audio/wav`** · bytes=1310888 · SHA256=`d4a0b280…`（与权威值匹配） |
| `/api/mini/card/TIME_609` | music.available=**true** · play/attack/death/entrance 全 true · cardAudioStatus=**full** |
| TOY_330 music.available（控制） | true |
| TIME_005 play.available / TIME_005t9 play | true / HTTP 200（TIME_005t9 entrance=404 为已知既有行为，非新回归） |

## WeChat Client

仓库内无既有可运行的微信客户端自动化工作流/模拟器（无 miniprogram-automator 配置、无 client e2e 脚本）。按任务规则不安装工具、不建自动化。

**WECHAT_MANUAL_TEST_REQUIRED=YES**（物理设备 BGM 按钮播放需人工验证；API/前端数据链路已由上述 E2E 覆盖：music.available=true → 前端 BGM 按钮启用条件满足，`/api/audio/music/TIME_609` 200。）

## Git

- Phase-owned modifications: 仅上述 3 个 test 文件（逐文件 `git add`）
- Phase-owned report: `data/card-verification/phase-2.10-L-5-closeout-report.md`
- Pre-existing dirty（package.json / project.config.json / project.private.config.json + 约 100 个 untracked 历史工件）**未触碰、未 stage**
- `git diff --check`：CLEAN
- 生产音频 / manifest：未修改、未 stage（git-ignored deployment state）

## Guards

EXTRACTION=NOT_CALLED · FULL_EXTRACTOR=NOT_CALLED · GLOBAL_SCAN=NOT_CALLED · C:\Hearthstone=NOT_ACCESSED · VPS_DEPLOYMENT=NOT_CALLED · VPS_RESTART=NOT_CALLED · PRODUCTION_AUDIO_COMMITTED=NO · GIT_ADD_DOT=NOT_USED · GIT_ADD_ALL=NOT_USED · GIT_RESET=NOT_USED · GIT_CLEAN=NOT_USED · REBASE=NOT_USED · AMEND=NOT_USED · FORCE_PUSH=NOT_USED

## FINAL_RESULT

3 个 STALE_BASELINE 失败已按最小修复原则解决；`test:production` 28/28 PASS；`npm test` 全 PASS；TIME_609 本地+公网 E2E 全部验证通过（公网 SHA256 匹配权威值，music.available=true，cardAudioStatus=full）；控制组无回归。Git 收尾仅含本阶段 4 个文件。
