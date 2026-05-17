# POCT Translation Tool Agent Guide

## 项目目标

本项目是 POCT 医疗文档翻译工具，支持 Excel、DOCX、PDF 和字符串资源翻译。核心目标不是“把文字翻出来”，而是稳定保留文档结构、表格位置、段落顺序、图片位置、编号、单位、占位符、术语和模型/品牌标识，并通过质量检查降低人工返工。

## 核心迭代原则

每次发现问题，不能只做一次临时 patch。必须判断它是否应该沉淀为以下资产之一：

1. 回归测试用例。
2. QA 校验规则。
3. 术语库条目。
4. 翻译记忆条目。
5. 目标语言 profile 规则。
6. 用户可见的提示、修正入口或质量报告项。

如果只修改代码而没有留下可复用资产，需要在最终说明中明确原因。

## 本地 Issue 包硬规则

当用户反馈任何翻译、质量检查、补译、导出、PDF/DOCX/Excel 回填、格式保真、模型路由或部署问题时，Codex 必须主动判断是否需要建立本地 issue 包。只要问题来自真实使用、真实文件、截图、导出结果或用户明确指出异常，就优先在 ignored 的 `local-data/issues/` 下建立一个问题目录，除非用户明确说不要记录。

命名格式：

```text
local-data/issues/YYYY-MM-DD-documentkind-targetlang-short-problem/
```

本地 issue 包至少包含 `README.md`，记录：

1. 用户反馈的现象。
2. 涉及文件路径，优先使用 `local-data/inbox/`、`local-data/done/`、`local-data/failed/` 中的相对路径。
3. 初步归因。
4. 优先级判断：立即修复、后续优化、按当前策略暂缓。
5. 后续应沉淀到哪一层：测试、QA 规则、术语、翻译记忆、语言 profile、真实文档 smoke 或用户提示。

如果能安全生成截图、渲染图、Debug Package、Regression JSONL 或 Asset JSON，也应放入同一个 issue 包。不要把原始敏感文件复制进 GitHub Issue；`local-data/` 继续只作为本地受控问题资产区。

用户侧反馈流程保持最简：用户只需要把原文放 `local-data/inbox/`，译文或结果放 `local-data/done/`，Quality Report / Debug Package 放 `local-data/debug-packages/`，截图放 `local-data/screenshots/`。Codex 负责从这些入口材料中建立或更新 `local-data/issues/` 问题包，并判断是否需要沉淀为回归测试、术语、翻译记忆或 QA 规则。不要要求用户手动分类到所有子目录。

## Codex 固定工作流

处理任何翻译质量、导出、补译、模型路由或文档结构问题时，按这个顺序执行：

1. 先定位问题属于哪条链路：导入解析、分段、翻译、后处理、质量检查、补译、导出回写、认证、部署。
2. 分类问题类型：
   - `terminology`: 术语不一致或术语误译。
   - `translation-memory`: 相同原文在同目标语言下译文不一致。
   - `non-target-residual`: 目标语言中残留源语言或第三方语言。
   - `placeholder`: 占位符、标签、ID、代码被破坏。
   - `number-unit-format`: 数字、单位、温度、范围、符号格式被改变。
   - `layout`: DOCX/PDF/Excel 结构、图片、编号、表格或回填位置异常。
   - `style`: 说明书语气、UI 文案、医学表达风格不稳定。
   - `accuracy`: 语义误译、遗漏或擅自扩写。
   - `auth-deploy`: 认证、环境变量、Cloudflare Pages 部署问题。
3. 优先新增或更新测试，再改实现。对于真实文件问题，优先扩展 `npm run test:real-docs` 或补充固定 fixture。
4. 保持 Excel、DOCX、PDF 的质量检查逻辑一致。不要让一个入口提示完成，而另一个入口仍能发现同类问题。
5. 对同类问题优先沉淀到共用层：语言 profile、Quality Check Core、术语库、翻译记忆，而不是在 `App.tsx` 里继续堆 if/else。
6. 修改后运行相关验证，并在最终说明中列出实际执行的命令和结果。

## 必跑或优先运行的验证

常规代码修改：

```bash
npm run typecheck
npm test
npm run build
```

涉及真实文档链路、质量检查、导出、DOCX/PDF/Excel 结构时：

```bash
npm run test:real-docs
```

涉及 Cloudflare Pages 发布时：

```bash
npm run deploy:pages
```

部署后需要给出预览 URL、稳定 URL 和当前 commit hash。不要声称 push/deploy 成功，除非命令实际成功。

## 当前关键架构方向

1. 目标语言规则应拆成“基础规则 + 语言 profile 覆盖”。俄语、法语、德语、土耳其语、葡语、繁体中文台湾都可能有独立问题。
2. Quality Check 应抽成 Excel/DOCX/PDF 共用核心，由不同文档 adapter 提供统一检查单元。
3. `App.tsx` 需要继续拆分，优先拆：
   - `useAuth`
   - `useTranslationWorkflow`
   - `useQualityWorkflow`
   - `TranslationSettingsPanel`
   - `QualityReportPanel`
   - `WorkflowConsole`
   - `PreviewPanel`
4. 问题反馈闭环应支持：保存人工修正、问题样本库、转术语、转翻译记忆、转 QA 规则、转回归测试。
5. 跨电脑问题反馈以 GitHub Issue 为正式入口：公司电脑提交结构化 Issue，Mac/Codex 读取 Issue 后按本文件和 `docs/translation-quality-loop.md` 分类、复现、修复和沉淀测试资产。

## 质量规则基线

1. 相同 source text + target language 在有确认译文时应优先复用翻译记忆。
2. 占位符、HTML/XML 标签、ID、型号、标准号、单位、数值范围不得被模型改写。
3. DOCX 自动编号不能残留中文编号格式到非中文目标语言。
4. DOCX 段落、表格、页眉页脚、脚注尾注、批注的覆盖范围必须可审计。
5. Excel 不得破坏行列位置、空单元格、公式、合并区域和多 sheet 回填关系。
6. PDF 文本型文件应尽量保留可核对性；拉丁字符目标语言优先输出可选择文本层，不支持字符集再回退图片文字。
7. 有异常时可以允许下载，但必须给出明确风险提示和可重试入口。

## 版本和进度

每次准备 push/deploy 时必须：

1. 更新 `package.json` 和 `package-lock.json` 版本。
2. 更新 `docs/PROJECT_PROGRESS.md`。
3. 跑相关验证。
4. push 后再部署 Cloudflare Pages。

如果只是本地文档或方案草稿，未 push/deploy，则不强制 bump 版本。

## 重要配置

Cloudflare Pages 非敏感配置在 `wrangler.toml` 的 `[vars]` 中维护，包括：

- `VITE_TRANSLATION_MODE`
- `REQUIRE_CF_ACCESS_EMAIL`
- `ALLOWED_USER_EMAILS`
- `OPENROUTER_MODELS`

`OPENROUTER_API_KEY` 继续作为 Cloudflare encrypted Secret，不写入仓库。

## 长对话迁移

当上下文变长或准备换新对话时，更新 `docs/context-handoff.md`。新对话只需要引用这个文件和本 `AGENTS.md`，不要复制整段聊天记录。

## 跨电脑问题入口

公司电脑发现问题时，优先使用 GitHub Issue 模板 `翻译结果问题`，不要依赖手机转发截图。Codex 处理 Issue 时必须读取：

1. Issue 中的网站版本、文件类型、目标语言、复现步骤、截图和 Quality Report。
2. `docs/issue-report-workflow.md`。
3. `docs/translation-quality-loop.md`。

如果 Issue 只包含截图，先要求补齐最低复现信息或从截图中提取可执行线索；不要在缺少版本、目标语言、文件类型时贸然改核心逻辑。
