# POCT 医学文档翻译与组合推理技术方案

## 1. 背景与目标
现有应用仅支持：上传 Excel → 通过 Gemini 将指定列翻译为 6 种预设语言 → 下载译文。  
为了支撑白细胞等血常规指标的临床解读，需要扩展为一个“翻译 + 组合校验 + 多模型交叉推断”的平台，覆盖以下核心需求：

1. **小语种翻译**：不限于固定 6 种语言，可按需求扩展到任意语言，并保持表格网格与编号一致。
2. **组合完整性校验**：解析表格中的临床规则，识别触发逻辑与组合，结合医疗知识检索漏掉的组合或缺失的解释。
3. **多 AI 交叉核实**：针对已有组合得出的总结/解读/病症推断，调用多种 AI 模型进行验证与一致性评估，输出最终可信建议。

## 2. 整体架构设计
```
┌──────────────┐     ┌────────────────────┐     ┌───────────────────┐
│ React UI 层   │──►  │ Workflow Orchestrator │──►│ Services 层        │
└──────────────┘     └──────────┬───────────┘     ├── ExcelService     │
        ▲                       │                 ├── TranslationHub   │
        │                       │                 ├── ClinicalLogicSvc │
        │                       │                 ├── MultiAIJudge     │
        │                 ┌─────▼─────┐           ├── KnowledgeStore   │
        │                 │状态 & 日志│           └───────────────────┘
        │                 └───────────┘                   │
        │                       │                         ▼
        │                  ┌────▼────┐         ┌──────────────────────┐
        └────────Data─────►│前后端API│◄────Data│本地/远程模型, KB, 索引│
                           └─────────┘         └──────────────────────┘
```

### 主要模块
- **React UI**：提供上传、语言选择、多阶段状态、结果比对、异常组合提示、AI 结论列表等交互。
- **Workflow Orchestrator**：前端或轻量后端状态机，串联“导入 → 翻译 → 组合解析 → 多 AI 验证 → 导出”各阶段，记录进度。
- **Services 层**：
  - `ExcelService`：负责 Excel 解析、结构化字段映射、导出。
  - `TranslationHub`：统一管理多语言翻译，支持多引擎（Gemini、OpenAI、DeepL 等）与缓存。
  - `ClinicalLogicService`：解析原始表内“组合—触发条件—解释”关系，构建规则图谱，检测缺失组合。
  - `MultiAIJudge`：串联多模型，对组合解读进行交叉验证、冲突检测、置信度评分。
  - `KnowledgeStore`：存放结构化指标阈值、疾病映射及历史组合，支持检索与比对。
- **模型与知识源**：至少 2 个异构大模型（如 Gemini + OpenAI/Claude），另外可以挂载内部医学知识库或术语本体。

## 3. 功能拆解与关键设计

### 3.1 Excel 解析与结构化
- 支持多工作表/多文件：上传时列出全部 sheet，并允许批量或逐个解析；对后续新增的其它血常规/生化/免疫表格保持同一解析路径。
- 将 `白细胞正常.xlsx` 等表格在上传后转换为结构化 JSON，字段示例：
  ```ts
  interface RuleRow {
    id: string;
    indicators: { name: string; relation: '>' | '<' | '=' | 'range' | 'status'; value: string }[];
    conclusion: string;
    severity?: 'normal' | 'warning' | 'critical';
    notes?: string;
  }
  ```
- 通过 `ExcelService` 增加工作表识别、列类型推断（文本/数值/逻辑表达式），并缓存原始单元格位置以便回写；对于未来若需导入 CSV/TSV/JSON 等其它文档类型，可共用同一抽象接口（`parseDocument()`）。

### 3.2 小语种翻译扩展
- 在 `TranslationHub` 中维护 `supportedLanguages` 配置，可从 UI 动态拉取，也支持手动输入（带正则校验，防止模型无法识别的语种）。
- Prompt 设计要允许“语言自动识别并翻译为目标语言”，并在混合文本中保留指示编码。
- 提供多模型 fallback：当 Gemini 失败或达到速率限制时，可切换至备选模型。
- 引入结果缓存（如 `IndexedDB` 或内存 Map）以避免重复翻译相同单元格。

### 3.3 组合逻辑解析与缺失校验
- 解析每行“组合”字段，将指标与条件转换为 AST/规则对象，示例：`(WBC ↑ AND NEU ↑) -> 细菌感染`。
- 构建指标映射表：结合 `CORE_METRICS` 和 Excel 中的其它字段，统一符号（↑、↓、±）转为标准表达。
- 校验流程：
  1. 从 Excel 中提取所有已存在组合；
  2. 基于医学知识库（可由 `白细胞正常.xlsx` + 官方指南 + AI 生成的 reference）生成“理论组合列表”；
  3. 使用集合差或图遍历找出尚未覆盖的组合，输出“缺失组合 + 建议解释”；
  4. 指定规则格式（YAML/JSON）以便人工校对后纳入 KnowledgeStore。
- 需要增加 `services/ruleEngine.ts`，包含：
  - 规则解析器（文本 → AST）；
  - 组合生成器（根据指标上下限，生成所有可能的“高/低/正常”组合）；
  - 缺失检测（AST 集合差、覆盖率统计）。

### 3.4 多 AI 交叉核实与结论生成
- `MultiAIJudge` 负责对每条组合的“翻译文本 + 原始中文 + 解释 + 推断疾病”进行核实：
  1. **模型 A（Gemini）**：生成详细解释、可能病因。
  2. **模型 B（OpenAI/Claude/自家 LLM）**：独立推断。
  3. **模型 C（规则引擎）**：根据知识库计算期望结论。
  4. 汇聚模块对比三方输出，计算一致度（例如余弦相似度 + 关键术语匹配）。
- 输出结构：
  ```ts
  interface CrossCheckResult {
    ruleId: string;
    conclusions: { model: 'Gemini' | 'OpenAI' | 'Rule'; text: string; confidence: number }[];
    aggregatedSummary: string;
    conflicts?: string[];
    finalRecommendation: string;
  }
  ```
- 针对冲突：提供“人工复核”标记位，并将问题组合导出成单独的 Excel/JSON。

### 3.5 UI/交互增强
- 上传阶段显示多工作表选择、字段映射。
- 处理流程拆分为 4 步进度条：`导入 -> 翻译 -> 组合校验 -> 多 AI 核验`，并允许在出错节点重试。
- 提供“组合覆盖视图”，按指标维度可视化已覆盖与缺失组合数量。
- 在 Live Preview 区域新增 tabs：`翻译结果`、`组合缺失`、`AI 结论`。
- 提供导出选项：`译文 Excel`、`缺失组合报告`、`AI 核验报告（JSON/Markdown）`。

### 3.6 日志、审计与可配置项
- 在 `LogConsole` 基础上新增日志级别和阶段标签（Translation/RuleCheck/AICheck）。
- 写入 `downloadable` 的 JSON 日志，以便溯源。
- 可配置项（可存于 `.env.local` 或前端设置）：
  - 各模型 API Key、模型名称、温度/上下文长度；
  - 并行批大小、速率保护；
  - 多 AI 决策阈值（如一致度 > 0.75 才自动通过）。

### 3.7 多格式文档（DOCX/PDF）解析与翻译
- **统一适配层**：新增 `DocumentAdapter` 抽象，具体实现包括 `ExcelAdapter`（已有）、`DocxAdapter`、`PdfAdapter`。所有适配器输出统一的节点数组：
  ```ts
  type RichNode =
    | { type: 'paragraph'; runs: TextRun[]; style: ParagraphStyle }
    | { type: 'table'; rows: TableCellNode[][] }
    | { type: 'image'; id: string; data: ArrayBuffer; width: number; height: number }
    | { type: 'page-break' | 'section-break' };
  ```
  节点结构中包含原始样式、图片占位与顺序编号，便于翻译后进行“原位置回写”。
- **DOCX 处理**：
  - 采用 `JSZip + XML DOM` 或第三方库解析段落、runs、表格、图片关系。
  - 翻译阶段仅替换 `run.text`，保留字体、加粗、颜色等 `run properties`。
  - 输出时通过 `docx`/`Packer` 按原结构生成新的 `.docx`，图片引用路径保持不变。
- **PDF 处理（预研）**：
  - 先支持“文本型 PDF”：利用 `pdf-lib` 抽取每页文本框，记录坐标与字体；翻译后在同一坐标绘制新文本，图片对象原样复制。
  - 扫描/图片型 PDF 记录为“需 OCR”的特殊类型，提示用户或转交服务器端 OCR。
- **翻译流水线**：
  - 解析器生成文本 runs，批次交给 `TranslationHub`，完成后按节点顺序回写。
  - 图片/图表节点仅做占位记录，不作改动，确保上下文不变。
- **导出策略**：
  - Excel：沿用现有 `exportToExcel`。
  - Docx：新增 `exportDocx(nodes)`，根据节点还原文档。
  - PDF：新增 `exportPdf(pages)`，用于文本型 PDF；扫描件可提示“暂不支持保持原格式”。
- **UI 影响**：
  - 上传组件根据扩展名自动选择适配器，显示文档类型与页数。
  - 翻译日志中标记“Docx Batch 3/10 (段落)”等信息，便于排错。

### 3.8 大体量 DOCX 稳定性（Python 分段 + 漏译审查）
- **分段翻译服务**：
  - 引入 `python-docx` + 自研脚本，将大段文本按照段落/表格单元拆解成 `payload.jsonl`，每条记录包含唯一键、原文、样式元信息。
  - Python 负责节流与批次控制：如 `chunk_size=800 token`，并对表格、标题、脚注等结构添加标签。
  - 前端上传 `.docx` 后可选择“浏览器模式”或“脚本模式”；脚本模式会触发 Node 调 Python（或用户本地 CLI）进行批量请求，避免浏览器中断。
- **漏译检测与重译**：
  - 翻译完成后运行 `detectUntranslatedSegments`，对每条段落判断是否仍含源语言字符或空文本。
  - UI 提供 `Retry Missing Segments` 按钮，按 ID 将漏译段落重新写入待翻译队列，可指定备用模型。
  - 生成 `translation_audit.json`，列出重译次数、最终状态，方便审查。
- **写回 & 审计**：
  - Python 脚本根据 ID 将译文写回 `docx`，确保 run 样式、图片、页眉页脚位置不变。
  - 最终导出：除了 `.docx` 成品，还输出 `translation_log.csv`，记录每个段落的原文、译文、批次、耗时，用于审查。
- **稳定性策略**：
  - 对 50+ 页文档启用“断点续传”：脚本定期保存 `state.json`，记录已完成段落，网络恢复后可继续。
  - 支持“只翻译指定页”或“仅表格/正文”模式，减少一次性请求量。

## 4. 三大功能解耦策略

### 4.1 翻译（现有）
- 入口：`Run Global Translation` 或 `智能补译`。
- 输出：结构化 `processedData`、本地缓存快照。
- 与其它功能关系：后续阶段消费 `processedData`，若尚未翻译则直接 fallback 到 `data`。

### 4.2 组合校验（新增 P1）
- 独立按钮 `Run Combination Check`，调用 `RuleEngine`。
- 依赖：**仅需结构化行数据**（中文或译文都可），不再强制等待翻译结束。
- 处理流程：
  1. 解析行 → 生成规则对象。
  2. 与“临床候选组合库”对比（医生确认过的模板），输出缺失/被忽略两类列表。
  3. 允许医生将某条标记为 `accepted / discarded`，结果写入本地/云端知识库。
- 输出：`rules`（已解析组合）、`missingCombinations`（建议补充项），可另存 Excel/JSON。

### 4.3 AI 解读与病症推断（新增 P2）
- 独立按钮 `Run Multi-AI Validation`，驱动 `MultiAIJudge`。
- 依赖：组合解析结果 + 当行的原文/译文（任意语言）。
- 处理流程：
  1. 对被选中的组合（全部或勾选）发送给多个模型生成解读。
  2. 聚合置信度、一致性评分，输出 `CrossCheckResult`。
  3. 支持只对 `missingCombinations` 或 `规则异常` 触发的行进行核查，降低费用。
- 输出：`aiFindings` 列表及导出报告，完全独立于翻译环节。

> 三段功能通过 Workflow 状态机串联，但每个按钮都可单独执行/重试；即使用户仅上传中文原始表，也能直接跑组合校验与 AI 解读，减少强耦合。

## 5. 实施路线图

| 阶段 | 目标 | 关键输出 |
| --- | --- | --- |
| P0 | 已完成：TranslationHub 多模型 + 智能补译 |  |
| P0.5 | 文档多格式适配（DOCX 优先，PDF 预研） | DocumentAdapter 抽象、Docx 导入/导出、图片占位 |
| P1 | 组合解析 + 缺失建议（遵循临床候选库，不做朴素穷举） | `RuleEngine`、组合列表 UI、导出 |
| P2 | 多 AI 解读/病症推断，允许与组合校验独立运行 | `MultiAIJudge` 扩展、AI Insights 面板 |
| P3 | 知识库管理、医生审核流程、部署/日志优化 | 知识库 API、审计日志、自动化测试 |

## 6. 后续讨论点
- 是否需要后端（Node/Edge）托管，以保护多家模型 Key，并避免浏览器跨域限制；
- 内部医学知识库来源（自建 KB、向量检索、还是完全依赖 AI）；
- 数据保密策略（是否要在本地浏览器内完成所有推理，或允许发往云端）；
- 结合真实 POCT 设备协议，输出格式是否需要适配固件或嵌入式配置文件。

> 本方案作为起点，后续可以按阶段落地和优化。我随时可以根据您的反馈调整细节或进入具体开发。
