# 新对话交接卡

## 使用方式

当当前聊天上下文太长时，在新对话里直接粘贴下面的“启动提示词”，并让对方优先阅读：

1. `AGENTS.md`
2. `docs/context-handoff.md`
3. `docs/translation-quality-loop.md`
4. `docs/ARCHITECTURE_REFACTOR_PLAN.md`
5. `docs/issue-report-workflow.md`
6. `docs/PROJECT_PROGRESS.md`

不要复制整段旧聊天。旧聊天只是过程，仓库文档才是稳定上下文。

## 新对话启动提示词

```text
这是我的 POCT 文档翻译工具项目。请先基于仓库里的 AGENTS.md、docs/context-handoff.md、docs/translation-quality-loop.md、docs/issue-report-workflow.md、docs/ARCHITECTURE_REFACTOR_PLAN.md 和 docs/PROJECT_PROGRESS.md 理解背景。

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

当前版本：`v0.0.66`。

稳定地址：

```text
https://translation-tool-917.pages.dev
```

最近已完成：

1. Cloudflare Access 应用已绑定白名单 policy。
2. 非敏感 Pages 配置已迁入 `wrangler.toml` 的 `[vars]`，包括：
   - `VITE_TRANSLATION_MODE=proxy`
   - `REQUIRE_CF_ACCESS_EMAIL=true`
   - `ALLOWED_USER_EMAILS`
   - `OPENROUTER_MODELS`
3. `OPENROUTER_API_KEY` 仍作为 Cloudflare encrypted Secret，不写入仓库。
4. 新增 `/api/me`，前端 Header 显示登录/访客/阻止状态。
5. 新增 `npm run test:real-docs`，用 `local-data` 中真实 Excel/DOCX/PDF 做 smoke。
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

## 真实回归基线

最近一次 `npm run test:real-docs` 结果摘要：

- Excel：真实文件 818 行解析和导出正常，结构无错、无中文残留、无空译文、无占位符异常；统一 Quality Core 统计正常，仍有大量 spacing 类提示，需要后续分级优化。
- DOCX 俄语：旧译文仍有英文残留，1195 段中 182 段被判非目标语言，35 段命中常见英文残留；Russian profile 已扩大词表和后处理，下一步继续通过真实 Issue/Debug Package 转规则。
- PDF：真实样本源 PDF 可抽取文本；旧法语译后 PDF 可渲染但文本层为空。新导出的法语 PDF 已改为先写规范化文本层，并在下载日志暴露文本层覆盖率。

## 当前主要待办

### 1. 问题反馈闭环

优先做：

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
