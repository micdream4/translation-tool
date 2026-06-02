# 新对话交接卡

## 使用方式

当当前聊天上下文太长时，在新对话里直接粘贴下面的“启动提示词”，并让对方优先阅读：

1. `AGENTS.md`
2. `docs/context-handoff.md`
3. `docs/translation-quality-loop.md`
4. `docs/ARCHITECTURE_REFACTOR_PLAN.md`
5. `docs/issue-report-workflow.md`
6. `docs/PROJECT_PROGRESS.md`
7. `docs/local-issue-capture-workflow.md`

不要复制整段旧聊天。旧聊天只是过程，仓库文档才是稳定上下文。

## 新对话启动提示词

```text
这是我的 POCT 文档翻译工具项目。请先基于仓库里的 AGENTS.md、docs/context-handoff.md、docs/translation-quality-loop.md、docs/issue-report-workflow.md、docs/local-issue-capture-workflow.md、docs/ARCHITECTURE_REFACTOR_PLAN.md 和 docs/PROJECT_PROGRESS.md 理解背景。

这个工具用于上传 Excel/DOCX/PDF/字符串资源，调用 LLM 翻译，并尽量保持原文档格式、表格结构、段落顺序、图片位置、单位、占位符、编号和术语一致性。

当前项目正在从“发现问题后被动修复”升级为“自我迭代型工具”。核心机制是：每次发现翻译问题，都不能只修当前 bug，而要沉淀为术语库、翻译记忆、自动 QA 规则、回归测试用例、目标语言 profile 或用户提示。

后续分析任何问题时，请按这个框架处理：
1. 先判断问题类型；
2. 判断应该沉淀到哪一层；
3. 给出产品逻辑；
4. 再给 Codex 可执行的修改方案；
5. 最后说明需要新增哪些测试，避免下次复发。

请不要只给临时修复方案。
```

## 项目当前状态

当前版本：`v0.0.109`。

稳定地址：

```text
https://translation-tool-917.pages.dev
```

最近一次确认部署：

```text
Preview: https://e1392e9d.translation-tool-917.pages.dev
Commit: 166c13d
```

## 2026-06-02 当前 Excel 法语批处理交接

当前目标：先把 `local-data/inbox/` 中 9 个新增 Excel 文件全部翻译成法语，完成后做独立 QA 扫描；如果中途发现系统性问题，必须建立 `local-data/issues/` 本地 issue 包，沉淀为 profile、术语、回归测试或 QA 规则，并在修复后 push & deploy。

当前状态：法语 9/9 已完成并通过独立 QA sweep；下一步可基于主流程继续俄语/葡语，并把旁路 QA 拆给只读 agent。

输入文件共 9 个：

```text
local-data/inbox/BA212+AI解读-二次审核-白细胞增高-20251226.xlsx
local-data/inbox/BA212+AI解读-二次审核-白细胞正常-20251226.xlsx
local-data/inbox/BA212+AI解读-二次审核-白细胞降低-20251226.xlsx
local-data/inbox/BA212+AI解读-二次审核-红细胞与血红蛋白-20251226.xlsx
local-data/inbox/独立组合更新-20260330.xlsx
local-data/inbox/白细胞增高-AWBC.xlsx
local-data/inbox/白细胞正常-AWBC.xlsx
local-data/inbox/白细胞降低-AWBC.xlsx
local-data/inbox/红细胞和血红蛋白-SRBC.xlsx
```

当前输出目录：

```text
local-data/done/2026-06-02-deepseek-v4-flash-excel/
```

当前批处理脚本：

```text
local-data/batch-runs/2026-06-02-deepseek-v4-flash-excel/translate-inbox-excel-deepseek.mjs
```

当前运行命令：

```bash
node local-data/batch-runs/2026-06-02-deepseek-v4-flash-excel/translate-inbox-excel-deepseek.mjs --targets=French --batch-size=5 --retry-passes=1
```

已完成并通过独立 QA sweep 的法语输出 9 个：

```text
Translated_French_BA212+AI解读-二次审核-白细胞增高-20251226.xlsx
Translated_French_BA212+AI解读-二次审核-白细胞正常-20251226.xlsx
Translated_French_BA212+AI解读-二次审核-白细胞降低-20251226.xlsx
Translated_French_BA212+AI解读-二次审核-红细胞与血红蛋白-20251226.xlsx
Translated_French_独立组合更新-20260330.xlsx
Translated_French_白细胞增高-AWBC.xlsx
Translated_French_白细胞正常-AWBC.xlsx
Translated_French_白细胞降低-AWBC.xlsx
Translated_French_红细胞和血红蛋白-SRBC.xlsx
```

独立 QA 结果：`inputFiles=9`、`outputFiles=9`、`okFiles=9`、`missingOutputs=0`、`failedFiles=0`、`untranslatedCells=0`、`frenchDiacriticRiskCells=0`、`protectedMismatches=0`。

本轮已修复并部署的线上问题：

1. v0.0.106 / `a624149`：法语重音风险补强，新增 `suggérer`、`déficit` 等 profile/postprocess 处理；短词 `名称/几率/分析` 增加法语/俄语/葡语确定译文；建立 `local-data/issues/2026-06-02-excel-french-diacritics-inconsistent/`。
2. v0.0.107 / `2a950ba`：修复法语输出中 `复合` 混入，如 `étiologie复合`，沉淀为 postprocess 规则和回归断言；建立 `local-data/issues/2026-06-02-excel-french-compound-chinese-residual/`。
3. v0.0.108 / `166c13d`：修复术语 seed 中 `大细胞性贫血` 法语 `Anemie macrocytaire` 缺重音问题，重新生成 `utils/generatedTerminology.ts`，新增法语/葡语术语重音回归断言。
4. v0.0.109：修复法语输出 QA sweep 发现的历史 `id` 列污染和 `序号` 中文短标签残留；新增 `序号` 三语确定译文和回归断言，本地批处理已改为 skip 前先 QA。

质量注意事项：

1. 缺少法语标准重音属于翻译质量错误，不应交付；例如 `Anemie` 应为 `Anémie`，`suggerer` 应为 `suggérer`。
2. Excel 回写必须继续保护 UUID、ID、代码、公式、sheet 数、行列位置和原格式；不要让多个进程同时写同一输出文件。
3. 用户提到多 agent 后，可以在法语完成后拆成“主翻译进程串行写 Excel”和“旁路 QA agent 只读扫描输出”的并行方式，避免写冲突。

最近已完成：

1. Cloudflare Access 应用已绑定白名单 policy。
2. 非敏感 Pages 配置已迁入 `wrangler.toml` 的 `[vars]`，包括：
   - `VITE_TRANSLATION_MODE=proxy`
   - `REQUIRE_CF_ACCESS_EMAIL=true`
   - `OPENROUTER_MODELS`
3. 访问邮箱只在 Cloudflare Zero Trust Access Policy 中维护；应用层不再读取 `ALLOWED_USER_EMAILS`。
4. `OPENROUTER_API_KEY` 仍作为 Cloudflare encrypted Secret，不写入仓库。
5. 新增 `/api/me`，前端 Header 显示登录/访客/阻止状态。
6. 新增 `npm run test:real-docs`，用 `local-data` 中真实 Excel/DOCX/PDF 做 smoke。
6. PDF 新导出对 Latin-1 可覆盖文本优先写真实文本层，不支持字符集回退 PNG 文本块。
7. DOCX/PDF 已接入 Quality Report 表面层；Quality Check Core 已开始抽离统一类型和 row adapter。
8. Quality Report 已加入 `Save Correction`，可将 finding 保存为本地 issue case，并可选择同步写入 Translation Memory。
9. GitHub Issue 已加入 `翻译结果问题` 模板，公司电脑发现问题时可直接提交结构化 Issue 和脱敏截图，Mac/Codex 端再按 Issue 修复。
10. Quality Report 纯逻辑已从 `App.tsx` 拆到 `utils/qualityReport.ts`，包含 finding 构建、报告文本导出和 issue type 映射。
11. 新增 `quality/types.ts` 和 `quality/adapters.ts`，`utils/quality.ts` 已通过 `QualityUnit` 执行检查，同时保留旧 `runQualityChecks` API。
12. `quality/adapters.ts` 已新增 `segmentsToQualityRows` / `segmentsToQualityUnits`，DOCX/PDF 的 Quality Report rows 映射已从 `App.tsx` 迁入 adapter。
13. DOCX/PDF 的 `Run Quality Check` 已直接走 `segmentsToQualityUnits -> runQualityChecksOnUnits`；rows 中间层只保留给报告展示和导出。
14. `components/QualityReportPanel.tsx` 已从 `App.tsx` 抽出，承接 Quality Report 展示、Quality Loop 和 AI Sample Review UI；`App.tsx` 只保留状态与动作接线。
15. `hooks/useAuth.ts` 已从 `App.tsx` 抽出，集中处理 `/api/me` 身份探测和 authenticated/blocked/anonymous 状态。
16. `hooks/useQualityWorkflow.ts` 已从 `App.tsx` 抽出，集中处理 Quality Report 状态、finding 派生、issue case 保存/导出、Sample Review、AI Sample Review 和 `runQualityCheck` 执行入口。
17. `utils/retryTargets.ts` 已抽出 Quality Issue 到 Retry target 的生成逻辑，Excel/DOCX/PDF 的补译候选选择已开始复用统一 helper。
18. `utils/debugPackage.ts` 已新增本地调试包导出，Quality Report 面板的 `Debug Package` 可下载结构化 JSON，用于 GitHub Issue 附件。
19. GitHub Issue 模板已加入 `Debug Package` 字段；当前模板使用仓库已有的 `bug` label，避免引用未创建的自定义 label。
20. Quality Report 面板已新增 `Issue Draft`，可把当前版本、文件类型、目标语言、模型、finding 摘要生成 GitHub Issue Markdown 草稿。
21. DOCX/PDF 的 `QualityUnit` 和 `QualityIssue` 已携带 `locationLabel`，报告和导出文本优先显示文档段落位置。
22. `utils/languageProfiles.ts` 已加入俄语 profile 第一版，沉淀常见英文残留词，供俄语残留检测复用。
23. `npm run test:real-docs` 的 PDF 样本发现已兼容 `检测教程-202英文.pdf` 和旧的 `(1)` 文件名，减少真实 PDF 回归误跳过。
24. `utils/regressionAssets.ts` 已加入问题样本到回归测试的转换层，支持从 issue cases 或 Debug Package 生成 `poct.translation_regression_case.v1`。
25. `fixtures/translation-issue-regression.jsonl` 和 `npm run test:issue-regression` 已覆盖首批问题资产回归。
26. Quality Report 面板已提供 `Regression JSONL`，人工修正样本可导出后追加进 fixture。
27. `scripts/debugPackageToRegression.mjs` 可把页面导出的 Debug Package JSON 转成回归测试 JSONL。
28. `quality/checks.ts` 已成为统一 Quality Check Core；`utils/quality.ts` 只做兼容导出。
29. `.github/workflows/quality-gate.yml` 和 `npm run test:quality-gate` 已建立质量闸门。
30. `QualityReport` 已把非目标语言残留纳入统一 core，`runQualityChecks` / `runQualityChecksOnUnits` 支持 `targetLang`，Excel/DOCX/PDF 的残留 finding、debug package 和 issue case 可以走同一份报告。
31. 已新增 `quality/report.ts` 和 `quality/retryTargets.ts` 入口，新的质量报告/补译目标代码优先从 `quality/` 引入，旧 `utils/` 入口保留兼容。
32. Russian/French profile 已进入可执行规则阶段：French 能检测 `Quickly squeeze`、`The blue button is lifted` 等英文标签残留，Russian 增加 `ref/year/reference/service/sample/result` 等真实 DOCX 残留词和轻量后处理。
33. Issue regression fixture 已扩到 5 条，新增法语 PDF 英文标签残留和俄语 `1-year` 残留样本。
34. PDF 文本层规范化已拆到 `utils/pdfTextLayer.ts`，法语 `’/œ/窄空格/长横线/µ` 等字符会先转成可复制文本层，不再整段退回 PNG。
35. PDF 下载前会记录文本层统计：可复制文本层段数、总段数和图片文本回退段数。
36. `utils/issueAssets.ts` 已新增问题样本资产转换层，可从 issue cases 生成 TM 句对、术语候选和 QA rule candidates。
37. Quality Loop 面板已提供 `Promote TM` 和 `Asset JSON`，人工修正样本可以批量写入 Translation Memory 或导出资产候选包。
38. 真实文档回归样本已抽成 `fixtures/real-document-regression.json`，`npm run test:real-docs` 按 manifest 跑本地 Excel / DOCX / PDF 样本，并输出每个 `caseId` 的检查状态。
39. 已新增本地问题捕获工作流：`docs/local-issue-capture-workflow.md` 和 `npm run issue:prepare`，Mac 本地发现问题可先保存到 ignored 的 `local-data/issues/`，公司电脑或跨设备问题仍走 GitHub Issue。
40. `local-data/README.md` 已改成中文目录规则，明确每个本地问题捕获目录应该放什么；`issue:prepare` 的 README 模板也已同步。
41. Codex 处理用户反馈的真实翻译/导出/格式问题时，应主动在 `local-data/issues/` 建本地 issue 包并写 `README.md`，再判断是否立刻修复或沉淀为后续测试/规则/术语/TM/profile。
42. Quality Report finding 已改为优先从 `qualityRows.sourceRows/targetRows` 展示 Source/Target，避免 DOCX/PDF 报告将译文误显示为原文。
43. Translation Memory 已加入 `Use Translation Memory` 开关；关闭后本次翻译不复用本地 TM，也不写入新 TM，便于做干净复测。
44. DOCX/PDF 的保护词检查会先剥离 Protected Terms；品牌名、公司名、型号等受保护词不会单独触发非目标语言残留。
45. 俄语 DOCX 质量检查已区分三类残留：真实英文/模型残片为高风险；`Wi-Fi`、单位、血球代码、标准号、型号等技术保护项不误判；按钮/图标 UI 标签保留为低风险提示，提醒人工核对截图或界面替换。
46. Translator 左侧旧 `Export Issue Report` 和 `Advanced Checks` 已清理；统一使用 Quality Report 面板的 `Export Report`、`Debug Package`、`Issue Draft`，Excel 专属的 `Apply Cleanup` / `Retry Placeholder Cells` 只在 Excel 场景显示。
47. v0.0.75 修复了短保护词边界：`EN`、`CE` 这类短缩写只在独立 token 时保护，避免从 `Enter`、`access`、`process` 内部截取并污染俄语译文。
48. DOCX retry 已改为使用原始 segment 重译，而不是把已污染译文再次送入模型；DOCX/PDF retry 与 Quality Check 使用同一套 UI 标签剥离逻辑。
49. Quality Report Findings 已加入 `All / High / Medium / Low` 筛选，优先处理高风险项。
50. Finding 人工修正按钮已改为 `Save & Apply`：DOCX/PDF 会把修正写回当前文档对象并刷新质量检查；之后下载的文件会包含该修正。Excel 目前仍只保存问题样本，直接写回表格尚未接入。
51. Live Data Preview 对 DOCX/PDF 已改用 segment 数据；点击 `Jump` 后会聚焦对应 segment 的原文/译文上下文，而不是跳到空的 Excel 风格预览。
52. v0.0.76 修复 DOCX 多 run 回写断词：原文 run 在单词内部切开时，译文写入首个 run 并清空后续 run，避免西语 `mult i funciona l`、`D e claración`、`Pr efacio`。
53. UI 标签策略已调整：按钮、图标、页面名等自然语言 UI label 默认翻译成目标语言，同时保留 `「」`、`【】`、`«»` 等外层符号，方便后续替换截图时核对。
54. 翻译前 token 保护只覆盖代码型 UI 标签、缩写、型号、ID、URL/单位等不可翻译锚点；`CBC`、`QC`、`USB2.0` 等保留，`Save`、`Home`、`Login` 这类普通按钮/页面名不再整体保护。v0.0.78 起，即使上传的是已翻译 DOCX、没有英文原文对照，译文中的 `«Save»` 这类英文 UI label 也会被 Smart Fill / Quality Check / Retry Missing Segments 检出。
55. v0.0.79 收紧 UI label 残留检测：只有明确英文 UI 词表命中的 label 才触发，如 `New Account`、`Save`；`"ozelle"` 这类密码/字面值即使被引号包裹，也不会被误判为英文 UI label。
56. v0.0.80 已收口 DOCX/PDF 问题来源：`buildDocxIssueDetails` / `buildPdfIssueDetails` 消费 Quality Core 的 `runQualityChecksOnUnits` 结果，Smart Fill / Excel retry 的单元格候选判断统一走 `shouldTranslateCellValue`。
57. 后处理已压缩章节编号、标准号和版本号空格，`1. 1`、`7. 2. 10`、`USB 2. 0` 会恢复为紧凑形式，减少 DOCX 目录更新后的割裂。
58. Quality Report 已继续降噪：单位/指标代码/URL 不再作为非目标语言或 high spacing 噪声；自然语言 UI label 若仍残留源文，会按普通非目标语言问题处理。

## 真实回归基线

最近一次 `npm run test:real-docs` 结果摘要：

- Excel：真实文件 818 行解析和导出正常，结构无错、无中文残留、无空译文、无占位符异常；v0.0.100 将本地可自动修复的 `e. g. ,`、`Co. , Ltd.` 等标点空格从 Quality Report 中降噪后，当前 spacing findings 为 0。
- DOCX 俄语：旧译文仍有英文残留，真实回归 manifest 会持续跟踪非目标语言段落、常见残留词和自动编号是否还带 CJK 格式。
- DOCX 俄语最新复测：`EN/CE` 子串污染明显减少；后续重点转为目录/标题编号空格、UI 标签策略和真实残留降噪。
- DOCX 西语最新复测：发现标题/目录编号空格、字母级 run 回写断词和个别语义错译；v0.0.76 已修 run split 和编号空格，v0.0.77 已将自然语言 UI 标签改为默认翻译，语义错译后续通过 issue case / sample review 沉淀。
- PDF：真实样本源 PDF 可抽取文本；最新法语译后 PDF `local-data/done/Translated_French_检测教程-202英文_0524.pdf` 可抽取 3923 个非空字符。旧 `local-data/pdf/Translated_French_检测教程-202英文.pdf` 仍是 image-only，但不再作为当前 smoke 的通过条件。

## 当前模型路由状态

- v0.0.95 已确认生产 Cloudflare Pages 配置了 `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY`，`/api/me` 能力响应中 `cloudflareAi/deepseek/openrouter` 均为 true。
- 2026-05-30 OpenRouter 实测：Google Gemini 3 Flash Preview、Gemini 3.1 Pro Preview、OpenAI GPT-5.3 Chat 仍返回 403 区域不可用；Qwen 3.6 Plus 与 DeepSeek V4 Pro 可用。
- 默认 OpenRouter 手工列表、Model Review、Sample Review、Multi-AI Judge 已收敛到 Qwen / DeepSeek；Gemini 默认继续走 Cloudflare AI Gateway。
- 后续如需恢复 OpenRouter Google/OpenAI 模型，先运行 `npm run smoke:openrouter` 验证，再显式加入 `OPENROUTER_MODELS` / `VITE_OPENROUTER_MODELS`。
- v0.0.98 调整后，默认 OpenRouter 模型列表为空；Auto 成本顺序为 Cloudflare Gemini 3 Flash -> DeepSeek Direct v4 Flash -> DeepSeek Direct v4 Pro -> Cloudflare GPT-5.4 -> Cloudflare Claude Sonnet 4.6 -> OpenRouter 显式兜底。Multi-AI Review 候选翻译模型为 Cloudflare Gemini 3 Flash、DeepSeek v4 Flash、DeepSeek v4 Pro、Cloudflare GPT-5.4、Cloudflare Claude Sonnet 4.6；匿名评审锁定为 Cloudflare GPT-5.4、Cloudflare Claude Sonnet 4.6、DeepSeek v4 Pro。

## 当前主要待办

### 1. 问题反馈闭环

优先做：

- 用 v0.0.77 重新翻译 DOCX 俄语/西语样本，确认目录编号、run split 和 UI 标签翻译策略是否已稳定。
- 将 GitHub Issue 与本地 issue cases 打通。
- 将 Issue Draft 进一步升级为可直接创建 GitHub Issue 的入口，或接入 GitHub CLI/API。
- 从问题样本转翻译记忆。
- 继续丰富 `fixtures/translation-issue-regression.jsonl`，把真实 Issue 中的 Debug Package 转成回归样本。
- 从问题样本转 QA 规则候选。
- 后续接 Cloudflare D1。

参考文档：

```text
docs/translation-quality-loop.md
docs/issue-report-workflow.md
```

### 2. Quality Check Core 抽离

目标：

- Excel、DOCX、PDF 共用 `QualityUnit` 和 `QualityIssue`。
- 文档格式只做 adapter。
- 检测、质量报告、补译目标生成共用逻辑。

已完成的第一步：

- `utils/qualityReport.ts` 已承接报告展示前的 finding 构建和导出文本生成。
- `quality/types.ts` 已定义统一 QualityUnit / QualityIssue / QualityReport。
- `quality/adapters.ts` 已支持 row-based 数据转 QualityUnit。
- `utils/quality.ts` 已新增 `runQualityChecksOnUnits`，旧 `runQualityChecks` 内部复用 adapter。
- `quality/adapters.ts` 已支持 DOCX/PDF 类文本段转 QualityRows / QualityUnit。
- DOCX/PDF 的检查执行路径已直接使用 `QualityUnit`，不再通过临时 rows 运行检查。
- Quality Report 面板 UI 已抽到 `components/QualityReportPanel.tsx`，后续可继续把质量状态和操作迁入 `hooks/useQualityWorkflow.ts`。
- 认证状态已抽到 `hooks/useAuth.ts`，App 只通过 `useAuth()` 给 Header 传递身份状态。
- Quality Report 状态、动作和 `runQualityCheck` 执行入口已抽到 `hooks/useQualityWorkflow.ts`，App 通过 hook 接收 `qualityReport`、`setQualityReport`、finding、issue case、Sample Review 和 Quality Check 操作。
- Retry target 生成已抽到 `utils/retryTargets.ts`，Excel 的可补译行/单元格统计和 DOCX/PDF 的高优先级 segment 选择复用同一层纯函数。
- Debug package 生成已抽到 `utils/debugPackage.ts`，先本地下载 JSON，不自动上传外部系统。
- 非目标语言残留已纳入 `QualityReport`，`quality/checks.ts` 统一负责 `targetLang` 语言检查，Excel/DOCX/PDF 不应再各自维护独立残留统计作为唯一来源。

参考文档：

```text
docs/ARCHITECTURE_REFACTOR_PLAN.md
```

### 3. 目标语言 Profile

优先语言：

- Russian：严格处理英文普通词残留。
- French / Spanish / Portuguese / Italian：处理重音符号、拉丁词误判、空格标点。
- German：复合词、名词大小写、单位/型号边界。
- Turkish：土耳其字符、后缀、大小写。
- Traditional Chinese (Taiwan)：简体残留和大陆地区表达。

### 4. App.tsx 拆分

优先拆：

- `hooks/useAuth.ts`（已完成第一阶段）
- `hooks/useQualityWorkflow.ts`（状态/动作和 `runQualityCheck` 执行入口已完成第一阶段抽离）
- `hooks/useTranslationWorkflow.ts`
- `components/QualityReportPanel.tsx`
- `components/TranslationSettingsPanel.tsx`
- `utils/retryTargets.ts`（已完成第一阶段）
- `utils/debugPackage.ts`（已完成第一阶段）

## Codex 固定开发原则

1. 先读 `AGENTS.md`。
2. 不要只修当前 bug；先判断该问题应沉淀为术语、TM、QA 规则、测试、语言 profile 还是 UI 提示。
3. 修改前尽量补测试，尤其是历史复发问题。
4. 涉及真实文档链路时运行：

```bash
npm run test:real-docs
```

5. 涉及常规代码时运行：

```bash
npm run typecheck
npm test
npm run build
```

6. push/deploy 前必须更新版本和 `docs/PROJECT_PROGRESS.md`。
7. 不要碰未关联的 dirty worktree 文件。

## 新对话交接更新规则

每次完成以下事件之一，都更新本文件：

1. 发布新版本。
2. 引入新的质量机制。
3. 修改认证/部署方式。
4. 发现新的真实文档系统性问题。
5. 完成大模块拆分。
6. 改变下一阶段优先级。

更新时只写稳定结论，不写长聊天过程。
