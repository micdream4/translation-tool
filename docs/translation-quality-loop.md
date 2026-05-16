# 翻译质量自我迭代机制

## 目标

把项目从“发现问题后找 Codex 救火”改成“每个问题都进入产品系统并变成可复用资产”。以后任何新问题都要被归档、分类、沉淀、验证，避免同类问题反复出现。

核心原则：

```text
问题不能只反馈给 Codex。
问题必须反馈进产品系统。
```

每次问题至少沉淀为以下之一：

1. 术语库。
2. 翻译记忆。
3. QA 规则。
4. 回归测试。
5. 目标语言 profile。
6. 用户可见的修正入口或风险提示。

## 闭环流程

```text
发现问题
  ↓
保存问题样本
  ↓
分类归因
  ↓
沉淀为术语 / 翻译记忆 / QA 规则 / 测试用例 / 语言 profile
  ↓
Codex 修改代码或配置
  ↓
自动跑回归测试和真实文档 smoke
  ↓
通过后发布
  ↓
下次同类问题自动拦截
```

## 远程问题入口

公司电脑使用翻译网站但不能直接改代码时，问题应进入 GitHub Issue，而不是通过手机转发截图。

入口文件：

```text
.github/ISSUE_TEMPLATE/translation-bug.yml
docs/issue-report-workflow.md
```

Issue 负责记录远程复现信息：

- 问题现象。
- 文件类型。
- 目标语言。
- 网站版本。
- 初步问题类型。
- 复现步骤。
- 脱敏截图。
- Quality Report 或日志摘录。

`Save Correction` 负责保存具体翻译样本：

- 原文。
- 当前错译。
- 人工修正。
- 问题类型。
- 位置。
- 模型和版本。

Codex 修复时应把 GitHub Issue 和本地 issue case 合并判断：Issue 说明场景和复现路径，issue case 提供可沉淀为测试、术语、TM 或 QA 规则的具体样本。

## 本地问题入口

Mac 本地发现问题时，不一定需要创建 GitHub Issue。优先按照 `docs/local-issue-capture-workflow.md` 保存本地问题包：

```text
local-data/inbox/
local-data/issues/
local-data/debug-packages/
local-data/regression-jsonl/
local-data/issue-assets/
local-data/screenshots/
```

可先运行：

```bash
npm run issue:prepare
```

本地问题包用于减少截图转发和口头描述成本；修复时再把其中的 `Regression JSONL`、Debug Package 或脱敏样本沉淀进仓库。

## 问题样本结构

第一阶段可以先存本地 IndexedDB，并支持导出 JSONL。后续接 Cloudflare D1。

```ts
type TranslationIssueCase = {
  id: string;
  createdAt: string;
  appVersion: string;
  documentKind: 'excel' | 'docx' | 'pdf' | 'string-resource';
  targetLang: string;
  sourceText: string;
  badTranslation: string;
  correctedTranslation: string;
  issueType:
    | 'terminology'
    | 'translation-memory'
    | 'non-target-residual'
    | 'placeholder'
    | 'number-unit-format'
    | 'layout'
    | 'style'
    | 'accuracy';
  locationLabel: string;
  sourceHash: string;
  model?: string;
  promptProfile?: string;
  status: 'new' | 'accepted' | 'converted-to-rule' | 'converted-to-test' | 'ignored';
  notes?: string;
};
```

## 问题分类与沉淀策略

### 1. 术语问题

表现：

- `reference range`、`whole blood`、`lancet` 等术语翻译不稳定。
- 品牌、型号、标准号被翻译或改写。

沉淀位置：

- 术语库。
- Protected Terms。
- 目标语言术语 profile。

处理要求：

- 优先规则化，不要只靠 prompt。
- 如术语跨 Excel/DOCX/PDF 都出现，必须放共用术语层。

### 2. 翻译记忆问题

表现：

- 相同原文在同一目标语言下出现多个译文。
- 用户人工确认过的句子再次被模型重新发挥。

沉淀位置：

- `translationMemory`。
- 后续可接服务端 TM 表。

处理要求：

- `sourceHash + targetLang` 命中后优先复用。
- 人工修正必须先进入待确认状态，确认后才能污染全局记忆。

### 3. 格式、占位符、数字、单位问题

表现：

- `2-8°C` 被改成不符合说明书格式的表达。
- `%s`、XML 标签、`__TKN_0__`、型号、ID 被破坏。
- 数字范围、单位、括号、冒号、斜杠丢失。

沉淀位置：

- QA 规则。
- 预保护/后还原规则。
- 回归测试。

处理要求：

- 本地规则优先于模型重试。
- 修复这类问题时必须增加测试。

### 4. 源语言残留或第三方语言残留

表现：

- 俄语 DOCX 中残留 `List`、`service`、`feces`、`reference`。
- 法语/西语/德语结果中残留英文普通词。
- 目标语言检测误判为已完成。

沉淀位置：

- 目标语言 profile。
- Quality Check Core。
- Retry Missing Segments / Cells。
- 真实文档 smoke。

处理要求：

- 检测、质量报告、补译必须共用同一套判定逻辑。
- 不允许“智能补译说完成，但 Quality Check 能发现残留”。

### 5. 布局和回填问题

表现：

- DOCX 自动编号残留中文编号。
- PDF 图片位置和文本不对应。
- Excel 行列错位、公式被覆盖、空单元格被填充。

沉淀位置：

- 文档 adapter 回归测试。
- `npm run test:real-docs`。
- 导出前结构检查。

处理要求：

- 这类问题优先判断为工程问题，不要先换模型。
- 必须用真实文件或 fixture 复现。

### 6. 语义准确性和风格问题

表现：

- 译文意思偏离原文。
- IFU 说明书语气不自然。
- UI 文案和表格短文本被扩写。

沉淀位置：

- 人工修正样本库。
- Model Review 样本。
- Prompt profile。
- 目标语言风格指南。

处理要求：

- 不要把单个语义问题硬编码成通用规则。
- 先沉淀样本，再观察是否形成可规则化模式。

## 产品功能路线

### 第一阶段：本地问题样本库

新增功能：

- 在 Quality Report 和预览区域加入 `Save Correction`。
- 用户填写人工修正和问题类型。
- 本地保存 issue cases。
- 支持导出 JSONL。
- 支持从 issue case 一键写入翻译记忆。

验收标准：

- 不接数据库也能把问题样本带到新对话和 Codex 修改中。
- 每条 issue case 至少包含源文、错误译文、修正译文、目标语言、文件类型、位置。

### 第二阶段：资产化入口

新增功能：

- `Promote to Terminology`。
- `Promote to Translation Memory`。
- `Promote to QA Rule Candidate`。
- `Promote to Regression Case`。

验收标准：

- 用户不是只反馈截图，而是能把问题转为具体资产。
- Codex 修复时优先读取这些资产。

### 第三阶段：服务端问题库

基于 Cloudflare Access 邮箱身份和 D1：

- 按用户记录问题样本。
- 按语言/模型/版本统计问题。
- 生成质量趋势面板。
- 支持团队共享术语和翻译记忆。

## 回归测试策略

固定测试层级：

1. `npm test`: 代码级无网络回归。
2. `npm run test:real-docs`: 真实文档 smoke。
3. 后续新增 `npm run test:issue-cases`: 从问题样本库生成的回归。

黄金样本建议：

- 一个普通 POCT Excel。
- 一个多 sheet Excel。
- 一个俄语 DOCX 问题文件。
- 一个包含自动编号的 DOCX。
- 一个文本型 PDF。
- 一个旧 bug 文件夹。

## 新问题处理模板

以后给 Codex 的问题尽量包含：

```text
问题现象：
文件路径：
目标语言：
源文：
当前译文：
期望译文：
问题类型：
是否应该沉淀为术语/TM/QA规则/测试：
```

如果问题来自公司电脑，优先新建 GitHub Issue，并在新对话或 Codex 任务里引用 Issue 编号。

Codex 修复时必须回答：

```text
归因：
沉淀资产：
改动文件：
新增/更新测试：
验证命令：
是否影响 Excel/DOCX/PDF 其他链路：
```
