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
