# 本地问题捕获工作流

## 目标

当前阶段先不做完整多 Agent 闭环，而是把人工发现的问题稳定沉淀为可复现资产。Mac 本地发现问题时，不必先创建 GitHub Issue；公司电脑或跨设备协作场景再使用 GitHub Issue。

核心原则：

```text
截图只是证据，Debug Package / Regression JSONL / Issue Case 才是可复现资产。
```

## 本地目录

运行：

```bash
npm run issue:prepare
```

会在 ignored 的 `local-data/` 下准备这些目录：

```text
local-data/inbox/              # 待测试或待翻译文件
local-data/issues/             # 本地问题包，每个问题一个子目录
local-data/debug-packages/     # 页面导出的 Debug Package JSON
local-data/issue-assets/       # 页面导出的 Asset JSON
local-data/regression-jsonl/   # 页面导出的 Regression JSONL 临时文件
local-data/screenshots/        # 脱敏截图或录屏
local-data/done/               # 已确认通过的样本或结果
local-data/failed/             # 需要继续分析的失败样本
```

这些目录不提交到 git。仓库只提交规则、脚本、测试和脱敏后的 fixture。

## 用户侧最简流程

为了减少操作成本，用户只需要把材料放到四类入口；后续分类、复制、归档由 Codex 处理：

1. 原文或待测文件放到 `local-data/inbox/`。
2. 译后结果如果基本满意放到 `local-data/done/`；如果明显失败，也可以先放到 `local-data/done/` 并在对话里说明问题，Codex 会再归类。
3. 页面导出的 Quality Report / Debug Package 放到 `local-data/debug-packages/`。
4. 截图或录屏放到 `local-data/screenshots/`。

用户不需要手动建立 `issues/`、`regression-jsonl/` 或 `issue-assets/`。这些目录由 Codex 根据反馈自动整理。

## Codex 归档流程

Codex 收到反馈后，为这次问题建立本地目录：

```text
local-data/issues/2026-05-16-docx-russian-list-residual/
```

根据 `inbox/`、`done/`、`debug-packages/`、`screenshots/` 中的材料，复制或生成：

```text
README.md
debug-package.json
regression.jsonl
asset.json
screenshot.png
```

## Codex 处理用户反馈时

当用户在对话中反馈真实翻译问题时，Codex 不应只在聊天里判断“要不要修”。默认动作是：

1. 先查看相关文件、截图或导出结果。
2. 在 `local-data/issues/` 下建立一个本地 issue 包，除非用户明确说不要记录。
3. 至少写入 `README.md`，记录现象、文件路径、初步归因、优先级和后续沉淀方向。
4. 如果能安全生成渲染图、截图、Debug Package、Regression JSONL 或 Asset JSON，就放进同一个问题目录。
5. 再判断是否需要立刻修代码，或只是记录为后续优化。

命名格式：

```text
local-data/issues/YYYY-MM-DD-documentkind-targetlang-short-problem/
```

示例：

```text
local-data/issues/2026-05-16-pdf-french-visual-fidelity/
local-data/issues/2026-05-16-docx-russian-toc-english-residual/
local-data/issues/2026-05-16-excel-french-placeholder-broken/
```

## 公司电脑发现问题

公司电脑上不能直接改代码时，仍然走 GitHub Issue：

```text
Run Quality Check
  ↓
Debug Package + 脱敏截图
  ↓
GitHub Issue 模板
  ↓
Mac / Codex 修复
```

Issue Draft 只是 Markdown 草稿，不会自动上传。需要手动复制到 GitHub Issue，直到后续实现一键创建 Issue。

## 进入代码修复前

Codex 处理本地问题时，先判断应该沉淀到哪一层：

- `fixtures/translation-issue-regression.jsonl`: 小片段回归测试。
- `fixtures/real-document-regression.json`: 本地真实文档 smoke 清单。
- `utils/languageProfiles.ts`: 目标语言残留或语种特有规则。
- 术语库 / Protected Terms: 术语和不翻译内容。
- Translation Memory: 已确认的源文到译文。
- Quality Check Core: 格式、占位符、数字单位、结构规则。

修复前优先补测试或更新真实文档基线，修复后必须运行：

```bash
npm run test:quality-gate
```

## 后续升级路径

当前阶段是人工捕获问题。目录结构稳定后，可以逐步升级：

1. `npm run agent:batch`: 批量扫描 `local-data/inbox/`，生成 QA 报告和本地 issue 包。
2. `npm run issue:create`: 从本地 issue 包创建 GitHub Issue。
3. Runner Agent / QA Agent / Fix Agent 闭环：修复发布后自动重跑失败样本。
