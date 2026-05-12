# 项目进度

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
