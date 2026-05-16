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
