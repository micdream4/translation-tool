import { POCTRecord } from '../types';
import { isLikelyIdentifier } from './translationTokens';

export type QualityIssueType = 'chinese' | 'placeholder' | 'idMismatch' | 'spacing';

export interface QualityIssue {
  rowIndex: number;
  columnKey: string;
  value: string;
  original?: string;
  type: QualityIssueType;
}

export interface QualityReport {
  totals: {
    cellsScanned: number;
    rowsScanned: number;
    chineseCells: number;
    chineseRows: number;
    placeholderCells: number;
    placeholderRows: number;
    idMismatches: number;
    idMismatchRows: number;
    spacingIssues: number;
    spacingRows: number;
  };
  issues: {
    chinese: QualityIssue[];
    placeholders: QualityIssue[];
    idMismatch: QualityIssue[];
    spacing: QualityIssue[];
  };
}

const CHINESE_REGEX = /[\u4e00-\u9fff]/;
export const PLACEHOLDER_REGEX = /__TKN_\d+__|__ID_\d+__|__FMT_\d+__/;
const EG_REGEX = /\be\s*\.\s*g\s*\./i;
const EXTRA_SPACE_REGEX = / {2,}/;
const SPACE_BEFORE_PUNCT_REGEX = /\s+[,.;:!?]/;
const LETTER_DIGIT_SPACE_REGEX = /\b[A-Za-z]\s+\d{1,3}\b|\b\d{1,3}\s+[A-Za-z]\b/;
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

const shouldLockCell = (key: string, value: unknown) => {
  if (typeof value !== 'string') return false;
  if (LOCKED_KEY_REGEX.test(key)) return true;
  if (!value.trim()) return false;
  if (CHINESE_REGEX.test(value)) return false;
  return isLikelyIdentifier(value);
};

export const hasSpacingIssue = (value: string) => {
  return (
    EG_REGEX.test(value) ||
    EXTRA_SPACE_REGEX.test(value) ||
    SPACE_BEFORE_PUNCT_REGEX.test(value) ||
    LETTER_DIGIT_SPACE_REGEX.test(value)
  );
};

export const runQualityChecks = (
  original: POCTRecord[],
  translated: POCTRecord[]
): QualityReport => {
  const totals = {
    cellsScanned: 0,
    rowsScanned: Math.max(original.length, translated.length),
    chineseCells: 0,
    chineseRows: 0,
    placeholderCells: 0,
    placeholderRows: 0,
    idMismatches: 0,
    idMismatchRows: 0,
    spacingIssues: 0,
    spacingRows: 0
  };

  const issues: QualityReport['issues'] = {
    chinese: [],
    placeholders: [],
    idMismatch: [],
    spacing: []
  };

  const chineseRows = new Set<number>();
  const placeholderRows = new Set<number>();
  const idMismatchRows = new Set<number>();
  const spacingRows = new Set<number>();

  const rowCount = Math.max(original.length, translated.length);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const originalRow = original[rowIndex] || {};
    const translatedRow = translated[rowIndex] || {};
    const keys = new Set([
      ...Object.keys(originalRow),
      ...Object.keys(translatedRow)
    ]);

    keys.forEach((key) => {
      const value = translatedRow[key];
      if (typeof value !== 'string') return;
      totals.cellsScanned += 1;

      if (CHINESE_REGEX.test(value)) {
        totals.chineseCells += 1;
        chineseRows.add(rowIndex);
        issues.chinese.push({
          rowIndex,
          columnKey: key,
          value,
          original: typeof originalRow[key] === 'string' ? originalRow[key] : '',
          type: 'chinese'
        });
      }

      if (PLACEHOLDER_REGEX.test(value)) {
        totals.placeholderCells += 1;
        placeholderRows.add(rowIndex);
        issues.placeholders.push({
          rowIndex,
          columnKey: key,
          value,
          original: typeof originalRow[key] === 'string' ? originalRow[key] : '',
          type: 'placeholder'
        });
      }

      if (hasSpacingIssue(value)) {
        totals.spacingIssues += 1;
        spacingRows.add(rowIndex);
        issues.spacing.push({
          rowIndex,
          columnKey: key,
          value,
          original: typeof originalRow[key] === 'string' ? originalRow[key] : '',
          type: 'spacing'
        });
      }

      const originalValue = originalRow[key];
      if (shouldLockCell(key, originalValue) && value !== originalValue) {
        totals.idMismatches += 1;
        idMismatchRows.add(rowIndex);
        issues.idMismatch.push({
          rowIndex,
          columnKey: key,
          value,
          original: typeof originalValue === 'string' ? originalValue : '',
          type: 'idMismatch'
        });
      }
    });
  }

  totals.chineseRows = chineseRows.size;
  totals.placeholderRows = placeholderRows.size;
  totals.idMismatchRows = idMismatchRows.size;
  totals.spacingRows = spacingRows.size;

  return {
    totals,
    issues
  };
};
