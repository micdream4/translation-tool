/**
 * Run logs are written with English prefixes in the workflow code (tests and Debug Packages depend on
 * those strings). For the Chinese UI they are rewritten at display time only.
 */
const LOG_RULES_ZH: Array<[RegExp, string]> = [
  [/^Importing: /, '正在导入：'],
  [/^Success: Loaded DOCX with (\d+) semantic segments\.?$/, '成功：已载入 DOCX，共 $1 个语义段。'],
  [/^Success: Loaded PDF with (\d+) page\(s\) and (\d+) text segments\.?$/, '成功：已载入 PDF，共 $1 页、$2 个文本段。'],
  [/^Success: /, '成功：'],
  [/^Error: /, '错误：'],
  [/^Stage\[translate\]: /, '翻译阶段：'],
  [/^Stage\[ingest\]: /, '导入阶段：'],
  [/^Stage\[ruleCheck\]: /, '规则检查阶段：'],
  [/^Stage\[aiValidate\]: /, 'AI 校验阶段：'],
  [/^Stage\[(\w+)\] /, '阶段 $1 '],
  [/^Translating Batch (\d+)\/(\d+) \((\d+) records/, '正在翻译第 $1/$2 批（$3 条记录'],
  [/^Translation Memory: /, '翻译记忆：'],
  [/^Translation warning: /, '翻译警告：'],
  [/^Translation Completed/, '翻译完成'],
  [/^Translation audit: /, '翻译审计：'],
  [/^Translation Failed: /, '翻译失败：'],
  [/^Quality Check: /, '质量检查：'],
  [/^Quality Report: /, '质量报告：'],
  [/^Docx audit: /, 'DOCX 审计：'],
  [/^DOCX coverage: /, 'DOCX 覆盖范围：'],
  [/^DOCX scope note: /, 'DOCX 范围说明：'],
  [/^PDF scope note: /, 'PDF 范围说明：'],
  [/^Excel Skip Scope: /, 'Excel 跳过范围：'],
  [/^Multi-AI Review: /, '多模型审核：'],
  [/^AI Sample Review: /, 'AI 抽样审核：'],
  [/^Sample Review: /, '抽样检查：'],
  [/^Issue Cases?: /, '问题样本：'],
  [/^Regression Cases: /, '回归用例：'],
  [/^Issue Assets: /, '问题素材：'],
  [/^Issue Draft: /, 'Issue 草稿：'],
  [/^Debug Package: /, '调试包：'],
  [/^Generating review DOCX: /, '正在生成对照 DOCX：'],
  [/^Generating file: /, '正在生成文件：'],
  [/^PDF review DOCX export completed: /, '对照 DOCX 导出完成：'],
  [/^PDF review DOCX export failed: /, '对照 DOCX 导出失败：'],
  [/^PDF export completed: /, 'PDF 导出完成：'],
  [/^PDF export failed: /, 'PDF 导出失败：'],
  [/^Excel export failed: /, 'Excel 导出失败：'],
  [/^PDF Retry Failed: /, 'PDF 重译失败：'],
  [/^Docx translation paused before batch (\d+)\.?$/, 'DOCX 翻译已在第 $1 批前暂停。'],
  [/^Docx translation paused after batch (\d+)\.?$/, 'DOCX 翻译已在第 $1 批后暂停。'],
  [/^Docx retry paused before batch (\d+)\.?$/, 'DOCX 重译已在第 $1 批前暂停。'],
  [/^Docx retry paused after batch (\d+)\.?$/, 'DOCX 重译已在第 $1 批后暂停。'],
  [/^PDF retry paused before batch (\d+)\.?$/, 'PDF 重译已在第 $1 批前暂停。'],
  [/^PDF retry paused after batch (\d+)\.?$/, 'PDF 重译已在第 $1 批后暂停。']
];

export const localizeLogMessage = (message: string, lang: 'zh' | 'en') => {
  if (lang !== 'zh') return message;
  for (const [pattern, replacement] of LOG_RULES_ZH) {
    if (pattern.test(message)) {
      return message.replace(pattern, replacement);
    }
  }
  return message;
};
