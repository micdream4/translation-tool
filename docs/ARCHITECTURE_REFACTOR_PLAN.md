# 架构梳理计划

## 背景

当前 Excel、DOCX、PDF 的翻译流程已经覆盖导入、翻译、补译、质量检查、导出，但 `App.tsx` 同时承担了 UI、状态机、文档适配、质量检查、补译和模型评审。随着俄语、法语、土耳其语等非英语目标语言开始暴露特定问题，统一规则硬塞在一个组件里会持续增加误判和修复成本。

## 目标结构

### 1. 目标语言规则 Profile

保留一套基础规则，再为每个目标语言叠加 profile：

- `base`: 占位符、ID、单位、型号、受保护术语、空译文、结构一致性。
- `Russian`: 严格检查英文普通词残留，允许真实缩写、型号、单位和品牌名；重点处理 `List / service / feces / reference / Building / Street` 等残留。
- `French / Spanish / Portuguese / Italian`: 重点处理拉丁词误判、重音符号、断词、空格和标点。
- `German`: 重点处理名词大小写、复合词、单位/型号边界。
- `Turkish`: 重点处理土耳其字符、后缀、大小写和 UI 术语。
- `Traditional Chinese (Taiwan)`: 重点处理简体残留和大陆地区表达。

建议落点：`utils/languageProfiles.ts`，由翻译 prompt、后处理、Quality Check、Retry Missing 共用。

当前进度：

- `utils/languageProfiles.ts` 已扩展为 profile registry。
- 第一版已覆盖 Russian、French、Spanish、Portuguese、German、Italian、Turkish、Traditional Chinese (Taiwan)。
- Russian 已实际接入残留检测，并加入 `ref/year/reference/service/sample/result` 等真实 DOCX 残留词和轻量后处理。
- French 已加入高置信英文残留词/短语规则，覆盖真实 PDF 中的 `Quickly squeeze`、`The blue button is lifted` 这类操作标签残留。
- 其他 Latin 语种先沉淀 function words、特色字符和数字单位规则说明，后续从真实 Issue 逐步转为硬规则。

### 2. 统一 Quality Check Core

将 Quality Check 从 `App.tsx` 抽成文档无关核心：

- `quality/types.ts`: `QualityUnit`、`QualityIssue`、`QualityReport`。
- `quality/adapters.ts`: Excel row、DOCX segment、PDF segment 转为统一 `QualityUnit[]`。
- `quality/checks.ts`: 非目标语言、空译文、占位符、ID/代码、格式、结构、语言 profile 检查。
- `quality/retryTargets.ts`: 将质量问题转成 Excel row / DOCX segment / PDF segment 的补译目标。
- `quality/report.ts`: 统一导出 Markdown/JSON。

原则：Excel、DOCX、PDF 不再各自写一套残留识别和 issue summary。

当前进度：

- 已新增 `utils/languageProfiles.ts`，先落地多语种 profile registry，Russian profile 已接入俄语目标语言检测。
- 已新增 `utils/qualityReport.ts`，先抽出 Quality Report finding 构建、报告文本导出和 issue type 映射。
- 已新增 `quality/types.ts`，定义 `QualityUnit`、`QualityCheckInput`、`QualityIssue`、`QualityReport` 和文档类型。
- 已新增 `quality/adapters.ts`，支持 row-based 数据转 `QualityUnit[]`。
- 已新增 `quality/checks.ts`，承接统一 Quality Check Core；`utils/quality.ts` 保留兼容导出。
- `quality/adapters.ts` 已新增 `segmentsToQualityRows` / `segmentsToQualityUnits`，DOCX/PDF Quality Report 的文本段 rows 映射已从 `App.tsx` 迁出。
- DOCX/PDF 的 `Run Quality Check` 执行路径已直接基于 `QualityUnit`，rows 中间层只用于报告展示和导出。
- `QualityUnit` / `QualityIssue` 已携带 `locationLabel`，报告展示和导出文本可优先显示 DOCX/PDF 段落位置。
- `components/QualityReportPanel.tsx` 已抽出 Quality Report、Quality Loop、AI Sample Review 展示层，主组件只保留状态和回调接线。
- `hooks/useAuth.ts` 已抽出 `/api/me` 身份探测，主组件不再直接处理认证请求和状态归一化。
- `hooks/useQualityWorkflow.ts` 已抽出 Quality Report 状态、finding 派生、issue case 操作、Sample Review、AI Sample Review 和 `runQualityCheck` 的 Excel/DOCX/PDF 执行入口。
- `utils/retryTargets.ts` 已抽出 Quality Issue 到 Retry target 的生成逻辑，Excel/DOCX/PDF 的补译候选选择开始复用统一 helper。
- `utils/debugPackage.ts` 已新增本地调试包构建器，Quality Report 面板可导出版本、模型、Quality Report、issue cases 和样本行，作为 GitHub Issue 的结构化附件。
- GitHub Issue 模板已补充 `Debug Package` 字段，并使用当前仓库已有的 `bug` label。
- Quality Report 面板已新增 `Issue Draft`，可导出 GitHub Issue Markdown 草稿。
- 已新增 `utils/regressionAssets.ts`、`fixtures/translation-issue-regression.jsonl` 和 `scripts/debugPackageToRegression.mjs`，支持从 Issue Case / Debug Package 生成回归测试资产。
- 已新增 `.github/workflows/quality-gate.yml` 和 `npm run test:quality-gate`。
- 已新增 `fixtures/real-document-regression.json`，将本地真实 Excel / DOCX / PDF 样本路径和质量预期从 smoke 脚本中抽成 manifest；真实文档继续留在 `local-data/`，只提交规则和相对路径。
- `quality/checks.ts` 已接收 `targetLang`，并把非目标语言残留沉淀为 `QualityReport.issues.nonTargetLanguage` 与 `nonTargetCells/nonTargetRows` 统计；Excel/DOCX/PDF 的 Quality Check 均已传入目标语言。
- 已新增 `quality/report.ts` 和 `quality/retryTargets.ts` 入口，后续新代码优先从 `quality/` 命名空间调用报告与补译目标逻辑，`utils/` 保留兼容层。
- 下一步优先做 Russian/French profile 真实化、PDF 文本层专项和问题样本到规则候选的自动沉淀。

### 3. App.tsx 拆分

第一阶段保持行为不变，只拆边界：

- `hooks/useAuth.ts`: `/api/me` 身份状态。
- `hooks/useTranslationWorkflow.ts`: 运行、暂停、恢复、进度。
- `hooks/useQualityWorkflow.ts`: 质量检查、报告、抽样池。
- `components/TranslationSettingsPanel.tsx`
- `components/QualityReportPanel.tsx`
- `components/WorkflowConsole.tsx`
- `components/PreviewPanel.tsx`

当前进度：

- `components/QualityReportPanel.tsx` 已完成第一阶段抽离。
- `hooks/useAuth.ts` 已完成第一阶段抽离。
- `hooks/useQualityWorkflow.ts` 已完成状态/动作和 `runQualityCheck` 执行入口抽离。
- `utils/retryTargets.ts` 已完成第一阶段抽离，统一 Excel/DOCX/PDF 的补译候选选择。
- `utils/debugPackage.ts` 已完成第一阶段，先支持本地 JSON 调试包导出。
- `utils/pdfTextLayer.ts` 已从 PDF 导出中拆出，负责 Latin 目标语言 PDF 文本层规范化和可复制文本层判断。
- `utils/issueAssets.ts` 已新增，负责将 issue cases 转成 Translation Memory、术语候选和 QA rule candidates。
- GitHub Issue 模板已与 debug package 对齐。
- `Issue Draft` 已完成第一阶段，先支持本地 Markdown 草稿导出。
- 下一步优先做 GitHub Issue 自动创建入口 / 初始化自定义 labels，或继续拆 Preview / Translation settings。

### 4. 认证与对外开放

短期使用 Cloudflare Access：

- Cloudflare Zero Trust 负责登录和邮箱身份。
- Pages Functions 读取 `CF-Access-Authenticated-User-Email`。
- `ALLOWED_USER_EMAILS` 控制白名单。
- `OPENROUTER_KEYS_BY_EMAIL` 支持按用户分配模型 Key 和预算。
- `/api/me` 供前端显示当前用户状态。

中期再考虑完整账号系统、用量日志、组织/角色、任务队列和额度面板。
