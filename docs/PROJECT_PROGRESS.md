# 项目进度

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
