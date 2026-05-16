import type { POCTRecord, TargetLanguage } from '../types';
import type { UntranslatedCell } from './language';
import type { TranslationIssueType } from './issueCases';
import type { QualityReport, QualitySeverity } from './quality';

export type QualityFindingCategory =
  | 'nonTarget'
  | 'chinese'
  | 'emptyTranslation'
  | 'placeholder'
  | 'idMismatch'
  | 'spacing'
  | 'structureMismatch';

export interface QualityFinding {
  id: string;
  category: QualityFindingCategory;
  rowIndex: number;
  columnKey: string;
  locationLabel: string;
  original: string;
  translated: string;
  description: string;
  severity?: QualitySeverity;
}

export interface QualityRows {
  sourceRows: POCTRecord[];
  targetRows: POCTRecord[];
}

type FormatLocationLabel = (rowIndex: number, columnKey: string) => string;

const getStringCell = (rows: POCTRecord[], rowIndex: number, columnKey: string) => {
  const value = rows[rowIndex]?.[columnKey];
  return typeof value === 'string' ? value : '';
};

export const mapQualityFindingToIssueType = (finding: QualityFinding): TranslationIssueType => {
  switch (finding.category) {
    case 'nonTarget':
    case 'chinese':
      return 'non-target-residual';
    case 'placeholder':
    case 'idMismatch':
      return 'placeholder';
    case 'spacing':
      return 'number-unit-format';
    case 'structureMismatch':
      return 'layout';
    case 'emptyTranslation':
    default:
      return 'accuracy';
  }
};

export const buildQualityFindings = ({
  qualityReport,
  nonTargetDetails,
  qualityRows,
  formatLocationLabel
}: {
  qualityReport: QualityReport | null;
  nonTargetDetails: UntranslatedCell[];
  qualityRows: QualityRows;
  formatLocationLabel: FormatLocationLabel;
}): QualityFinding[] => {
  if (!qualityReport) return [];

  const findingMap = new Map<string, QualityFinding>();
  const pushFinding = (finding: QualityFinding) => {
    if (!findingMap.has(finding.id)) {
      findingMap.set(finding.id, finding);
    }
  };

  nonTargetDetails.forEach((item) => {
    pushFinding({
      id: `nonTarget-${item.rowIndex}-${item.columnKey}`,
      category: 'nonTarget',
      rowIndex: item.rowIndex,
      columnKey: item.columnKey,
      locationLabel: formatLocationLabel(item.rowIndex, item.columnKey),
      original: getStringCell(qualityRows.sourceRows, item.rowIndex, item.columnKey),
      translated: getStringCell(qualityRows.targetRows, item.rowIndex, item.columnKey),
      description: '检测到非目标语言残留'
    });
  });

  const appendQualityIssues = (
    category: QualityFindingCategory,
    list: Array<{ rowIndex: number; columnKey: string; original?: string; value: string; severity?: QualitySeverity }>,
    description: string
  ) => {
    list.forEach((item) => {
      pushFinding({
        id: `${category}-${item.rowIndex}-${item.columnKey}`,
        category,
        rowIndex: item.rowIndex,
        columnKey: item.columnKey,
        locationLabel: formatLocationLabel(item.rowIndex, item.columnKey),
        original: item.original || '',
        translated: item.value || '',
        description,
        severity: item.severity
      });
    });
  };

  appendQualityIssues('chinese', qualityReport.issues.chinese, '仍有中文残留');
  appendQualityIssues('emptyTranslation', qualityReport.issues.emptyTranslations, '原文可译，但目标单元格为空');
  appendQualityIssues('placeholder', qualityReport.issues.placeholders, '占位符泄漏');
  appendQualityIssues('idMismatch', qualityReport.issues.idMismatch, '锁定字段与原文不一致');
  appendQualityIssues('spacing', qualityReport.issues.spacing, '格式或空格异常');
  appendQualityIssues('structureMismatch', qualityReport.issues.structureMismatches, '表结构与原文不一致');

  const order: Record<QualityFindingCategory, number> = {
    nonTarget: 0,
    emptyTranslation: 1,
    structureMismatch: 2,
    placeholder: 3,
    idMismatch: 4,
    chinese: 5,
    spacing: 6
  };

  return [...findingMap.values()].sort((a, b) => {
    if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
    if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
    return a.columnKey.localeCompare(b.columnKey);
  });
};

export const buildQualityReportText = ({
  qualityReport,
  nonTargetDetails,
  qualityRows,
  targetLang,
  formatLocationLabel,
  generatedAt = new Date()
}: {
  qualityReport: QualityReport;
  nonTargetDetails: UntranslatedCell[];
  qualityRows: QualityRows;
  targetLang: TargetLanguage;
  formatLocationLabel: FormatLocationLabel;
  generatedAt?: Date;
}) => {
  const nonTargetRows = new Set(nonTargetDetails.map((item) => item.rowIndex));
  const findings: Array<{
    type: string;
    severity?: QualitySeverity;
    location: string;
    original: string;
    translated: string;
  }> = [
    ...nonTargetDetails.map((item) => ({
      type: 'Non-target language',
      location: formatLocationLabel(item.rowIndex, item.columnKey),
      original: getStringCell(qualityRows.sourceRows, item.rowIndex, item.columnKey),
      translated: getStringCell(qualityRows.targetRows, item.rowIndex, item.columnKey)
    })),
    ...qualityReport.issues.emptyTranslations.map((item) => ({
      type: 'Empty translation',
      location: formatLocationLabel(item.rowIndex, item.columnKey),
      original: item.original || '',
      translated: item.value || ''
    })),
    ...qualityReport.issues.structureMismatches.map((item) => ({
      type: 'Structure mismatch',
      location: formatLocationLabel(item.rowIndex, item.columnKey),
      original: item.original || '',
      translated: item.value || ''
    })),
    ...qualityReport.issues.placeholders.map((item) => ({
      type: 'Placeholder',
      location: formatLocationLabel(item.rowIndex, item.columnKey),
      original: item.original || '',
      translated: item.value || ''
    })),
    ...qualityReport.issues.idMismatch.map((item) => ({
      type: 'ID mismatch',
      location: formatLocationLabel(item.rowIndex, item.columnKey),
      original: item.original || '',
      translated: item.value || ''
    })),
    ...qualityReport.issues.spacing.map((item) => ({
      type: 'Spacing issue',
      severity: item.severity || 'medium',
      location: formatLocationLabel(item.rowIndex, item.columnKey),
      original: item.original || '',
      translated: item.value || ''
    }))
  ];

  const lines = [
    'POCT Translation Quality Report',
    `Generated: ${generatedAt.toLocaleString()}`,
    `Target language: ${targetLang}`,
    '',
    'Overview',
    `- Rows scanned: ${qualityReport.totals.rowsScanned}`,
    `- Cells scanned: ${qualityReport.totals.cellsScanned}`,
    `- Non-target residual: ${nonTargetDetails.length} cells / ${nonTargetRows.size} rows`,
    `- Chinese residue: ${qualityReport.totals.chineseCells} cells / ${qualityReport.totals.chineseRows} rows`,
    `- Empty translations: ${qualityReport.totals.emptyTranslations} cells / ${qualityReport.totals.emptyTranslationRows} rows`,
    `- Placeholders: ${qualityReport.totals.placeholderCells} cells / ${qualityReport.totals.placeholderRows} rows`,
    `- ID mismatch: ${qualityReport.totals.idMismatches} cells / ${qualityReport.totals.idMismatchRows} rows`,
    `- Spacing issues: ${qualityReport.totals.spacingIssues} cells / ${qualityReport.totals.spacingRows} rows`,
    `  - High: ${qualityReport.totals.spacingHigh}`,
    `  - Medium: ${qualityReport.totals.spacingMedium}`,
    `  - Low: ${qualityReport.totals.spacingLow}`,
    `- Structure mismatch: ${qualityReport.totals.structureMismatches} cells / ${qualityReport.totals.structureMismatchRows} rows`,
    '',
    'Findings'
  ];

  findings.slice(0, 200).forEach((item, index) => {
    lines.push(
      `${index + 1}. [${item.type}${item.severity ? ` / ${String(item.severity).toUpperCase()}` : ''}] ${item.location}`,
      `   Source: ${String(item.original || '').replace(/\s+/g, ' ').trim() || '(empty)'}`,
      `   Target: ${String(item.translated || '').replace(/\s+/g, ' ').trim() || '(empty)'}`
    );
  });

  return lines.join('\n');
};
