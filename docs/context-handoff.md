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

当前版本：`v0.0.50`。

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
7. DOCX/PDF 已接入 Quality Report 表面层，但 Quality Check Core 尚未完全抽离。
8. Quality Report 已加入 `Save Correction`，可将 finding 保存为本地 issue case，并可选择同步写入 Translation Memory。
9. GitHub Issue 已加入 `翻译结果问题` 模板，公司电脑发现问题时可直接提交结构化 Issue 和脱敏截图，Mac/Codex 端再按 Issue 修复。

## 真实回归基线

最近一次 `npm run test:real-docs` 结果摘要：

- Excel：真实文件 818 行解析和导出正常，结构无错、无中文残留、无空译文、无占位符异常；仍有大量 spacing 类提示，需要后续分级优化。
- DOCX 俄语：旧译文仍有英文残留，1195 段中 182 段被判非目标语言，35 段命中常见英文残留。
- PDF：源 PDF 可抽取文本，旧法语译后 PDF 可渲染但不可文本抽取；新导出逻辑已开始改善拉丁文字 PDF 文本层。

## 当前主要待办

### 1. 问题反馈闭环

优先做：

- 将 GitHub Issue 与本地 issue cases 打通。
- 从问题样本转翻译记忆。
- 从问题样本转回归测试。
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

- `hooks/useAuth.ts`
- `hooks/useQualityWorkflow.ts`
- `hooks/useTranslationWorkflow.ts`
- `components/QualityReportPanel.tsx`
- `components/TranslationSettingsPanel.tsx`

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
