import type { QualityRows } from '../quality/types';
import type { TargetLanguage } from '../types';
import type { UntranslatedCell } from './language';
import type { TranslationIssueCase } from './issueCases';
import type { QualityReport } from './quality';
import type { QualityFinding } from './qualityReport';

export type DebugDocumentKind = 'excel' | 'docx' | 'pdf';

export type DebugFormatSnapshot = {
  sheetName?: string;
  rows?: number;
  cols?: number;
  merges?: number;
} | null;

export type DebugIssueSummary = {
  cells: number;
  rows: number;
  rowIndices?: number[];
  missingRows?: number[];
  details: UntranslatedCell[];
};

export type DebugPackageInput = {
  appVersion: string;
  documentKind: DebugDocumentKind;
  targetLang: TargetLanguage;
  fileName?: string;
  modelLabel: string;
  modelPreference: string;
  generatedAt?: Date;
  qualityReport: QualityReport | null;
  issueSummary: DebugIssueSummary;
  qualityFindings: QualityFinding[];
  issueCases: TranslationIssueCase[];
  qualityRows: QualityRows;
  formatSnapshot: DebugFormatSnapshot;
};

const truncateText = (value: unknown, maxLength = 1000) => {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const sampleRows = (rows: QualityRows, details: UntranslatedCell[], limit = 20) => {
  const selected = new Set<number>();
  details.forEach((item) => {
    if (selected.size < limit && item.rowIndex >= 0) {
      selected.add(item.rowIndex);
    }
  });
  return Array.from(selected).map((rowIndex) => ({
    rowIndex,
    source: Object.fromEntries(
      Object.entries(rows.sourceRows[rowIndex] || {}).map(([key, value]) => [key, truncateText(value)])
    ),
    target: Object.fromEntries(
      Object.entries(rows.targetRows[rowIndex] || {}).map(([key, value]) => [key, truncateText(value)])
    )
  }));
};

export const buildDebugPackage = ({
  appVersion,
  documentKind,
  targetLang,
  fileName,
  modelLabel,
  modelPreference,
  generatedAt = new Date(),
  qualityReport,
  issueSummary,
  qualityFindings,
  issueCases,
  qualityRows,
  formatSnapshot
}: DebugPackageInput) => {
  const issueDetails = issueSummary.details || [];
  return {
    schema: 'poct.translation_debug_package.v1',
    privacyNote:
      'This package may include source text, translated text, and saved issue cases. Remove sensitive content before posting to public systems.',
    metadata: {
      appVersion,
      generatedAt: generatedAt.toISOString(),
      documentKind,
      targetLang,
      fileName: fileName || '',
      modelLabel,
      modelPreference,
      formatSnapshot
    },
    quality: {
      hasQualityReport: Boolean(qualityReport),
      report: qualityReport,
      issueSummary: {
        cells: issueSummary.cells,
        rows: issueSummary.rows,
        rowIndices: issueSummary.rowIndices || [],
        missingRows: issueSummary.missingRows || [],
        detailCount: issueDetails.length,
        details: issueDetails.slice(0, 80)
      },
      findingCount: qualityFindings.length,
      findings: qualityFindings.slice(0, 80)
    },
    issueCases: {
      count: issueCases.length,
      cases: issueCases.slice(0, 200)
    },
    samples: {
      issueRows: sampleRows(qualityRows, issueDetails)
    }
  };
};

export const serializeDebugPackage = (input: DebugPackageInput) =>
  JSON.stringify(buildDebugPackage(input), null, 2);

export const buildGitHubIssueMarkdown = (input: DebugPackageInput) => {
  const debugPackage = buildDebugPackage(input);
  const topFindings = input.qualityFindings.slice(0, 10);
  const issueDetails = input.issueSummary.details || [];
  const lines = [
    `# [Translation Bug] ${input.documentKind.toUpperCase()} ${input.targetLang} quality issue`,
    '',
    '## 问题现象',
    '<!-- 请在这里补充你看到的异常，例如：俄语目录残留英文、PDF 回写错位、下载按钮无响应等。 -->',
    '',
    '## 复现步骤',
    '1. 上传文件。',
    `2. 目标语言选择：${input.targetLang}。`,
    `3. 模型选择：${input.modelPreference || input.modelLabel}。`,
    '4. 运行翻译或 Quality Check。',
    '5. 观察结果或尝试导出文件。',
    '',
    '## 环境',
    `- Version: ${input.appVersion}`,
    `- File type: ${input.documentKind}`,
    `- File name: ${input.fileName || '(not provided)'}`,
    `- Target language: ${input.targetLang}`,
    `- Model: ${input.modelLabel}`,
    `- Model preference: ${input.modelPreference}`,
    `- Generated at: ${debugPackage.metadata.generatedAt}`,
    '',
    '## Quality Summary',
    `- Has quality report: ${debugPackage.quality.hasQualityReport ? 'yes' : 'no'}`,
    `- Non-target residual: ${input.issueSummary.cells} cells / ${input.issueSummary.rows} rows`,
    `- Quality findings: ${input.qualityFindings.length}`,
    `- Saved issue cases: ${input.issueCases.length}`,
    '',
    '## Top Findings'
  ];

  if (!topFindings.length && !issueDetails.length) {
    lines.push('- 暂无结构化 finding。请补充截图、日志或可复现描述。');
  } else {
    topFindings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. ${finding.locationLabel} | ${finding.category}`,
        `   - Source: ${truncateText(finding.original, 240) || '(empty)'}`,
        `   - Target: ${truncateText(finding.translated, 240) || '(empty)'}`,
        `   - Note: ${finding.description}`
      );
    });
    if (!topFindings.length) {
      issueDetails.slice(0, 10).forEach((item, index) => {
        lines.push(`${index + 1}. ${item.locationLabel || `${item.rowIndex}/${item.columnKey}`}: ${truncateText(item.value, 240)}`);
      });
    }
  }

  lines.push(
    '',
    '## Debug Package',
    '请把导出的 JSON 调试包作为附件上传到这个 Issue。下面是可直接粘贴的摘要，公开仓库使用前请先脱敏。',
    '',
    '<details>',
    '<summary>Debug package summary JSON</summary>',
    '',
    '```json',
    JSON.stringify(
      {
        schema: debugPackage.schema,
        metadata: debugPackage.metadata,
        quality: {
          hasQualityReport: debugPackage.quality.hasQualityReport,
          issueSummary: {
            cells: debugPackage.quality.issueSummary.cells,
            rows: debugPackage.quality.issueSummary.rows,
            detailCount: debugPackage.quality.issueSummary.detailCount
          },
          findingCount: debugPackage.quality.findingCount
        },
        issueCases: {
          count: debugPackage.issueCases.count
        }
      },
      null,
      2
    ),
    '```',
    '',
    '</details>'
  );

  return lines.join('\n');
};

export const serializeGitHubIssueMarkdown = (input: DebugPackageInput) =>
  buildGitHubIssueMarkdown(input);
