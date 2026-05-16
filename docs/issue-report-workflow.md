# 跨电脑问题反馈工作流

## 背景

代码主要在个人 Mac 上开发，公司电脑主要用于办公和真实使用翻译网站。公司电脑发现问题后，不应该再走“截图到手机、手机传 Mac、Mac 再交给 Codex”的链路，而应该直接把问题提交到 GitHub Issue。

目标是：

```text
公司电脑发现问题
  ↓
GitHub Issue 结构化记录
  ↓
Mac / Codex 读取 Issue
  ↓
复现、修复、增加回归资产
  ↓
发布后关闭 Issue
```

## 公司电脑操作

1. 打开 GitHub 仓库的 `Issues`。
2. 点击 `New issue`。
3. 选择 `翻译结果问题` 模板。
4. 填写：
   - 问题现象。
   - 文件类型。
   - 目标语言。
   - 网站版本。
   - 初步问题类型。
   - 复现步骤。
   - 原文 / 当前译文 / 期望译文。
   - 脱敏截图或录屏。
   - Quality Report 或日志摘录。
   - Debug Package 摘要或 JSON 附件。
   - Issue Draft 内容可以直接粘贴到 Issue 正文中。
5. 如果问题明确且希望尽快处理，在 Issue 正文或评论里写：

```text
@codex 请按 AGENTS.md 和 docs/translation-quality-loop.md 处理：
先分类问题，再判断应沉淀为测试、QA 规则、术语库、翻译记忆、语言 profile 还是 UI 提示。
不要只做一次性 patch。
```

## Mac / Codex 操作

在 Mac 上可以用 GitHub 网页，也可以用 GitHub CLI：

```bash
gh issue list --label translation-bug --state open
gh issue view <issue-number> --comments
```

处理 Issue 时固定流程：

1. 读取 Issue 中的复现步骤、截图和版本。
2. 判断链路：导入解析、翻译、后处理、质量检查、补译、导出回写、认证、部署。
3. 判断问题类型：术语、TM、残留、占位符、数字单位、布局、风格、语义、认证部署。
4. 先补回归测试或真实文档 smoke，再改实现。
5. 如果 Issue 附了 Debug Package，先转成回归样本：

```bash
npm run debug:to-regression -- --input path/to/Translation_Debug_Package.json --output /tmp/issue-regression.jsonl
cat /tmp/issue-regression.jsonl >> fixtures/translation-issue-regression.jsonl
npm run test:issue-regression
```

6. 修复后更新 `docs/PROJECT_PROGRESS.md`。
7. push/deploy 后在 Issue 里回复：

```text
已修复：
- Commit:
- Version:
- Preview URL:
- 验证命令：
- 新增/更新的测试或质量规则：
```

## 隐私规则

不要把未脱敏原始文件上传到公开 Issue。

Issue 中优先放：

- 脱敏截图。
- 可公开的问题段落。
- 文件类型。
- 目标语言。
- 网站版本。
- 复现步骤。
- Quality Report 摘录。

如果必须使用原始文件复现，只放在受控的本地目录或私有存储，并在 Issue 中写清楚本地文件名或内部路径，不把文件本身公开上传。

## 与质量闭环的关系

GitHub Issue 是“远程问题入口”，网站内 `Save Correction` 是“翻译样本入口”。两者互补：

- Issue 适合公司电脑快速提交截图、复现步骤和版本信息。
- `Save Correction` 适合保存具体原文、错译和人工修正。
- `Regression JSONL` 适合把人工修正样本转成可提交的回归测试 fixture。
- `Debug Package` 适合把一次翻译任务的版本、模型、质量报告和样本行打包给 Codex 复现。
- Codex 修复时应把 Issue 或 `Save Correction` 样本沉淀为测试、QA 规则、术语、翻译记忆或语言 profile。

Mac 本地发现的小问题不强制创建 GitHub Issue。可以先按 `docs/local-issue-capture-workflow.md` 保存到 `local-data/issues/`；跨电脑、多人协作、需要排期或需要历史追踪的问题，再提交 GitHub Issue。
