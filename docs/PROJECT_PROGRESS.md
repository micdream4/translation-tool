# 项目进度

## v0.0.55

- 继续拆分 `App.tsx`：新增 `components/QualityReportPanel.tsx`，把 Quality Report 展示、finding 列表、Quality Loop、抽样复核 UI 从主组件抽出。
- `App.tsx` 现在只保留 Quality Report 的状态、动作和数据接线，面板组件通过 props 接收导出、保存修正、跳转预览、AI Sample Review 等回调。
- 回归测试更新为同时检查 App 接线和 QualityReportPanel UI，确保 `Save Correction`、`Export Cases`、`Quality Loop` 仍然存在。
- 版本号更新为 `v0.0.55`。

## v0.0.54

- DOCX/PDF 的 `Run Quality Check` 执行路径改为直接使用 `segmentsToQualityUnits -> runQualityChecksOnUnits`，不再先转成临时 rows 后再检查。
- `buildDocumentQualityRows` 仍保留给 Quality Report 导出和 finding 展示使用，避免 UI 行为变化；检查核心已先迁到统一 `QualityUnit`。
- 回归测试补充断言，确保 App 已接入 `runQualityChecksOnUnits` 和 `segmentsToQualityUnits`。
- 版本号更新为 `v0.0.54`。

## v0.0.53

- 继续推进 Quality Check Core adapter：新增 `segmentsToQualityRows` / `segmentsToQualityUnits`，将 DOCX/PDF 文本段转换为统一质量检查 rows/units。
- `App.tsx` 中 DOCX/PDF Quality Report 使用的 `{ content }` 临时映射已迁入 `quality/adapters.ts`，减少主组件对文档段落结构的直接拼装。
- 回归测试扩展 segment adapter，覆盖 DOCX/PDF 类文本段到 `QualityRows` / `QualityUnit` 的转换。
- 版本号更新为 `v0.0.53`。

## v0.0.52

- 继续推进 Quality Check Core 抽离：新增 `quality/types.ts`，定义统一的 `QualityUnit`、`QualityCheckInput`、`QualityIssue`、`QualityReport` 和文档类型。
- 新增 `quality/adapters.ts`，提供 `rowsToQualityUnits` / `qualityRowsToUnits`，为 Excel、DOCX、PDF 后续统一质量检查入口打基础。
- `utils/quality.ts` 保持原有 `runQualityChecks(originalRows, translatedRows)` API 不变，但内部已迁移为 `rowsToQualityUnits -> runQualityChecksOnUnits`，降低 App 侧改动风险。
- 回归测试新增 unified QualityUnit 路径与旧 row-based 路径结果一致性校验。
- 版本号更新为 `v0.0.52`。

## v0.0.51

- 继续拆分 `App.tsx`：新增 `utils/qualityReport.ts`，把 Quality Report finding 构建、导出文本生成、finding 到 issue case 类型映射从主组件抽成纯逻辑模块。
- `App.tsx` 质量报告相关代码减少约 150 行，后续拆 `QualityReportPanel` 时可直接复用 `buildQualityFindings`、`buildQualityReportText` 和 `mapQualityFindingToIssueType`。
- 回归测试扩展到新的质量报告模块，覆盖 finding 排序、Issue 类型映射和 Quality Report 文本导出。
- 版本号更新为 `v0.0.51`。

## v0.0.50

- 新增 GitHub Issue 表单 `.github/ISSUE_TEMPLATE/translation-bug.yml`，公司电脑发现翻译、格式、导出、补译、质量检查问题时可直接提交结构化问题和脱敏截图。
- 新增 `docs/issue-report-workflow.md`，明确“公司电脑提交 Issue，Mac/Codex 读取 Issue，修复后沉淀测试/QA/术语/TM/语言 profile”的跨电脑工作流。
- 更新 `AGENTS.md`、`docs/translation-quality-loop.md` 和 `docs/context-handoff.md`，把 GitHub Issue 作为远程问题入口纳入质量闭环。
- 版本号更新为 `v0.0.50`。

## v0.0.49

- 落地质量闭环第一阶段：新增本地问题样本库 `utils/issueCases.ts`，支持保存人工修正、统计、清空、导出 JSONL。
- Quality Report 的每条 finding 新增 `Save Correction`，可把源文、错误译文、人工修正、问题类型、位置、版本、模型写入本地 issue case，并可选择同步写入 Translation Memory。
- Quality Report 新增 `Quality Loop` 区块，显示本地问题样本数量，并支持导出/清空问题样本。
- 新增回归测试覆盖 issue case 构建、JSONL 导出和 Quality Report 保存入口。
- 版本号更新为 `v0.0.49`。

## v0.0.48

- 新增 `npm run test:real-docs` 真实文档 smoke：覆盖本地 `local-data` 中的 Excel 解析/导出/Quality Check、俄语 DOCX 残留扫描、PDF 文本抽取与首屏渲染基线。
- 真实回归结果显示：Excel 结构/导出正常但存在大量 spacing 类质量提示；俄语 DOCX 样本仍有英文残留；现有法语 PDF 译后文件可渲染但不可文本抽取。
- PDF 直出新增可选择文本层优先路径：Latin-1 可覆盖的目标语言文本（如英文/法语/西语/德语/意大利语/葡语常见字符）优先写为 jsPDF 文本；不支持的字符集继续回退为 PNG 文本块。
- 版本号更新为 `v0.0.48`。

## v0.0.47

- 将非敏感 Cloudflare Pages 配置移入 `wrangler.toml` 的 `[vars]`：`VITE_TRANSLATION_MODE=proxy`、`REQUIRE_CF_ACCESS_EMAIL=true`、邮箱白名单和 OpenRouter 模型顺序以后都能在代码里直接查看和修改。
- 计划删除 Dashboard 中同名 encrypted Secret，避免邮箱白名单被隐藏；`OPENROUTER_API_KEY` 仍保留 Secret，不写入仓库。
- 版本号更新为 `v0.0.47`。

## v0.0.46

- 抽出 Cloudflare Pages Functions 共享认证层：`/api/translate`、`/api/review-samples`、`/api/model-review` 统一使用邮箱白名单、Cloudflare Access Header、本地调试邮箱和按用户 OpenRouter Key 解析。
- 新增 `/api/me` 身份探测接口，前端 Header 会显示当前访问状态（登录邮箱、Guest、Blocked、Checking），为对外开放使用和后续额度/审计打基础。
- 明确下一阶段架构方向：语言规则应拆成“基础规则 + 目标语言 profile 覆盖”，Quality Check 应抽成 Excel/DOCX/PDF 共用核心，再由各文档 adapter 提供检查单元。
- 版本号更新为 `v0.0.46`。

## v0.0.45

- DOCX/PDF 的 `Run Quality Check` 接入主质量报告，不再只支持 Excel；DOCX/PDF 会把非目标语言残留、空译文、占位符和格式问题同步到 Quality Report。
- 强化俄语 DOCX 残留英文处理：文档翻译 prompt 明确要求补译 `List / Building / feces / service / reference` 等常见英文残留，并增加少量俄语后处理修复。
- 改善 PDF 直出回写稳定性：按字号变化拆分 PDF 文本段，并在导出时按原段落高度自适应缩小译文字号，减少长段落覆盖图片和后续文本。
- 版本号更新为 `v0.0.45`。

## v0.0.44

- PDF 补译逻辑对齐 DOCX：翻译后自动审计空译文、源语言残留、占位符残留和英文目标粘词问题。
- PDF 新增 `Retry Missing PDF Segments`，只重译审计发现的问题文本段，并优先跳过低优先级短文本。
- 版本号更新为 `v0.0.44`。

## v0.0.43

- 修复 PDF 译文已处理完成后仍被下载前检查误判为“可能未翻译”的问题：现在仅在完全没有译文时阻止导出，部分段落缺译时提示 warning 并继续导出。
- 模型下拉中的 DOCX/PDF Auto 文案改为从实际模型链路生成，当前顺序显示为 Gemini Flash → DeepSeek → Qwen → Gemini 3.1 Pro → GPT-5.3。
- 版本号更新为 `v0.0.43`。

## v0.0.42

- 按最新策略调整 DOCX/PDF Auto 文档模型顺序：Gemini Flash → DeepSeek → Qwen → Gemini 3.1 Pro → GPT-5.3。
- PDF 下载按钮改为至少有译文后才启用；PDF / Review DOCX 导出失败会写入日志，不再表现为点击后无反馈。
- 版本号更新为 `v0.0.42`。

## v0.0.41

- 修复 PDF 未完成翻译时仍可下载的问题：当 PDF 没有译文或仍有疑似未翻译文本段时，下载译文 PDF 会被阻止并提示先继续翻译。
- PDF 直出改为白底重建页面：按原坐标放回可提取图片，并将译文渲染为文本图片块贴到对应位置，避免原文背景残留和浏览器 PDF 字体不支持多语言的问题。
- PDF 的 Word 辅助导出从不稳定的绝对定位 Layout DOCX 改为 Review DOCX，按页输出译文和源图片，便于复制核对，不再生成错乱排版。
- DOCX/PDF Auto 文档模型顺序调整为 Gemini Flash → GPT-5.3 → Gemini 3.1 Pro → DeepSeek → Qwen，避免 Qwen 首位导致长时间卡住或失败。
- 版本号更新为 `v0.0.41`。

## v0.0.40

- 修复俄语 DOCX 目标语言检测：`Home / Orders / Reports / AI analysis` 等英文残留混在俄文中时不再误判为已完成，智能补译会继续处理。
- DOCX 导出新增 `word/numbering.xml` 编号样式归一化，自动编号中的中文/东亚格式（如 `一、二、三`、`%1、`、`%1．`）会转换为通用数字编号。
- PDF 翻译导出升级为坐标保留：解析时记录文本段坐标、字号和图片位置，Layout DOCX 按 PDF 页面位置回填，便于复制核对。
- PDF 新增直出译文 PDF：以原 PDF 页面渲染为背景，覆盖原文本区域并按坐标写入译文，优先保持图片与页面版式。
- 新增 `jspdf` 依赖用于浏览器端译文 PDF 生成；回归测试已覆盖 PDF 直出、Layout DOCX、DOCX 编号与俄语混合英文残留检测。
- 版本号更新为 `v0.0.40`，页面 Header、浏览器标题和 URL 参数会显示当前版本。

## v0.0.39

- 补齐 TypeScript 类型健康基线，新增 `npm run typecheck`，当前 `typecheck / test / build` 均通过。
- DOCX 覆盖范围从仅 `word/document.xml` 扩展到正文、页眉、页脚、脚注、尾注、批注，并在导入/导出时显示覆盖统计。
- 增加无网络 mock 回归测试，覆盖 `/api/translate`、`/api/review-samples`、`/api/model-review` 和代理翻译拆半重试流程。
- 修复代理翻译返回记录数不匹配时未触发拆半重试的问题，现在代理路径与直连路径使用同一套返回长度/对象校验。
- 增加 Vite 手动分包，将 React、XLSX、DOCX/JSZip、PDF 相关依赖拆成独立 chunk，主入口包从约 2.07 MB 降至约 182 kB。

## v0.0.38

- PDF 正式翻译模型选择已改为与 DOCX 一致：PDF 上传后显示高质量文档模型组，Auto 使用 Qwen → DeepSeek → Gemini 3.1 → OpenAI → Gemini Flash 的文档质量链路。
- PDF 翻译请求改为使用 `docx-manual` 文档质量 prompt/profile，和 DOCX 一样强调说明书/文档语气、占位符、单位、代码和段落边界保护。

## v0.0.37

- 修复本地 dev 环境 `APP_VERSION` 为空导致 Header 不显示版本号的问题，改为从 `package.json` 兜底读取版本。
- 版本号展示位置调整到页面左上角标题 `POCT Document Translator` 右侧，同时保留浏览器标签页标题和 URL 参数版本。

## v0.0.36

- 新增目标语言 `Traditional Chinese (Taiwan) / 繁體中文（台灣）`，适用于台湾地区繁体医学/技术表达，不只是简繁字符转换。
- Excel、DOCX、PDF 翻译 prompt 已接入台湾繁体本地化约束，要求使用自然台湾用语并保留术语、单位、代码、占位符。
- 样本审核与 Multi-AI Review 已加入台湾繁体评分标准：简体残留、大陆地区表达、非台湾医学用语会被扣分。
- 漏翻/目标语言检测已对繁體中文（台灣）增加简体残留识别，避免把明显简体输出误判为合格繁体。
- 字符串资源批量输出也支持繁體中文（台灣）。
- 浏览器标签页标题、页面 Header、网址参数均显示当前版本；本版本为第 36 个 main 提交，对应 `v0.0.36`。

## v0.0.35

- 已支持 Excel `.xlsx`、Word `.docx`、文本型 PDF 上传与翻译。
- PDF 第一阶段输出为 Word `.docx`：可复制文本会翻译为译文，PDF 中可提取图片会回填到导出的 Word 中。
- 已新增独立入口 `Multi-AI Review Lab`：复用 Translator 当前上传文件和目标语言，执行抽样、多模型候选翻译、匿名评审与 Markdown 报告导出。
- 多 AI 审核支持 Excel / DOCX / PDF 抽样；当前为均匀抽样，不是随机抽样。
- 多 AI 审核支持评审风格选择：
  - `Recommended`：按文件类型推荐，Excel 默认医学报告/表格解读，DOCX 默认说明书/IFU，PDF 默认 Auto。
  - `Auto / General medical`：由评审模型根据样本自行判断风格。
  - `Medical report / Table interpretation`：适合 Excel AI 解读、报告备注、表格单元格。
  - `Instructions for use / IFU`：适合说明书、操作手册。
  - `Marketing / User-readable`：适合产品介绍或面向用户的可读文案。
  - `Terminology-faithful / Low rewrite`：适合参数表、术语表、法规/标签类保守翻译。
- 多 AI 审核已增加失败诊断：候选模型或评审模型因区域限制、不可用、无分数返回时，会显示具体原因，不再把未评分误显示为 `0.00`。
- 版本号按远端 `main` 提交数递增；本版本为第 35 个 main 提交，对应 `v0.0.35`，页面 Header 显示版本号，网址会自动补充 `?v=0.0.35`。

## 已知限制

- PDF 图片内文字暂不 OCR 翻译。
- PDF 暂不做原 PDF 坐标级版式复原，当前以可编辑 Word 译文为第一阶段输出。
- 多 AI 审核依赖 OpenRouter 模型可用性；部分模型可能受区域或节点限制。
- Excel 解析仍使用 `xlsx`，npm audit 存在 high 公告且暂无官方修复版本；当前仅建议处理可信 `.xlsx` 文件。
