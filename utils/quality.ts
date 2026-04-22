import { POCTRecord } from '../types';
import { isLikelyIdentifier } from './translationTokens';

export type QualityIssueType =
  | 'chinese'
  | 'placeholder'
  | 'idMismatch'
  | 'spacing'
  | 'emptyTranslation'
  | 'structureMismatch';

export type QualitySeverity = 'high' | 'medium' | 'low';

export interface QualityIssue {
  rowIndex: number;
  columnKey: string;
  value: string;
  original?: string;
  type: QualityIssueType;
  severity?: QualitySeverity;
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
    spacingHigh: number;
    spacingMedium: number;
    spacingLow: number;
    emptyTranslations: number;
    emptyTranslationRows: number;
    structureMismatches: number;
    structureMismatchRows: number;
  };
  issues: {
    chinese: QualityIssue[];
    placeholders: QualityIssue[];
    idMismatch: QualityIssue[];
    spacing: QualityIssue[];
    emptyTranslations: QualityIssue[];
    structureMismatches: QualityIssue[];
  };
}

const CHINESE_REGEX = /[\u4e00-\u9fff]/;
export const PLACEHOLDER_REGEX =
  /(?:_+\s*(?:TKN|ID|FMT|TAG)(?:\s*[_ ]\s*\d+)?\s*_+|(?:TKN|ID|FMT|TAG)\s*[_ ]\s*\d+\s*_*)/i;
const EG_REGEX = /\be\s*\.\s*g\s*\./i;
const EXTRA_SPACE_REGEX = / {2,}/;
const SPACE_BEFORE_PUNCT_REGEX = /\s+[,.;:!?]/;
const LETTER_DIGIT_SPACE_REGEX = /\b[A-Za-z]\s+\d{1,3}\b|\b\d{1,3}\s+[A-Za-z]\b/;
const SAFE_MEDICAL_SPACING_REGEX = /\b(?:B\s*12|B\s*6|G\s*6|P\s*50)\b/i;
const GLUED_PUNCT_REGEX = /\b[A-Za-z]+[,.:][A-Za-z]+\b/;
const CAMEL_GLUE_REGEX = /\b[a-z]{2,}[A-Z][a-z]+\b/;
const UPPER_ABBR_GLUE_REGEX = /\b(?:[A-Z]{2,}\d*(?:\/[A-Z]+)?)(?:[A-Z][a-z]+|[a-z]{2,})\b/;
const DIGIT_BOUNDARY_GLUE_REGEX =
  /\b(?:[a-z]{2,}\d+(?:[-/.]\d+)*[A-Za-z]{2,}|[A-Z][a-z]{3,}\d+|[A-Za-z]{3,}\d+[A-Za-z]{2,})\b/;
const LOWER_COMPOUND_GLUE_REGEX =
  /\b(?:connectthe|intothe|displaywbc|usesledlight|providesusbinterface|withtcp\/ipprotocol|withgb\/t|andgb\/t|thedcpower|cbcdetection|cbctest|pltthe|aianalysis|retand|supplyrequirements|compositiondescription|routineimaging|fluorescenceimage|andperformmaintenance|powerswitchto|tostart|is1year|enter\d+(?:[-/.]\d+)*digits|than\d+digits)\b/i;
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

const shouldLockCell = (key: string, value: unknown) => {
  if (typeof value !== 'string') return false;
  if (!value.trim()) return false;
  if (CHINESE_REGEX.test(value)) return false;
  if (LOCKED_KEY_REGEX.test(key)) return true;
  return isLikelyIdentifier(value);
};

const isTranslatableSourceCell = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!CHINESE_REGEX.test(trimmed)) return false;
  return !isLikelyIdentifier(trimmed);
};

export const hasSpacingIssue = (value: string) => {
  if (SAFE_MEDICAL_SPACING_REGEX.test(value)) {
    return (
      EG_REGEX.test(value) ||
      EXTRA_SPACE_REGEX.test(value) ||
      SPACE_BEFORE_PUNCT_REGEX.test(value)
    );
  }
  return (
    EG_REGEX.test(value) ||
    EXTRA_SPACE_REGEX.test(value) ||
    SPACE_BEFORE_PUNCT_REGEX.test(value) ||
    LETTER_DIGIT_SPACE_REGEX.test(value)
  );
};

export const getSpacingSeverity = (value: string): QualitySeverity | null => {
  if (hasGlueIssue(value)) return 'high';
  if (EXTRA_SPACE_REGEX.test(value) || SPACE_BEFORE_PUNCT_REGEX.test(value) || EG_REGEX.test(value)) {
    return 'medium';
  }
  if (LETTER_DIGIT_SPACE_REGEX.test(value)) {
    if (SAFE_MEDICAL_SPACING_REGEX.test(value)) return 'low';
    return 'medium';
  }
  return null;
};

export const hasGlueIssue = (value: string) => {
  return (
    GLUED_PUNCT_REGEX.test(value) ||
    CAMEL_GLUE_REGEX.test(value) ||
    UPPER_ABBR_GLUE_REGEX.test(value) ||
    DIGIT_BOUNDARY_GLUE_REGEX.test(value) ||
    LOWER_COMPOUND_GLUE_REGEX.test(value)
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
    spacingRows: 0,
    spacingHigh: 0,
    spacingMedium: 0,
    spacingLow: 0,
    emptyTranslations: 0,
    emptyTranslationRows: 0,
    structureMismatches: 0,
    structureMismatchRows: 0
  };

  const issues: QualityReport['issues'] = {
    chinese: [],
    placeholders: [],
    idMismatch: [],
    spacing: [],
    emptyTranslations: [],
    structureMismatches: []
  };

  const chineseRows = new Set<number>();
  const placeholderRows = new Set<number>();
  const idMismatchRows = new Set<number>();
  const spacingRows = new Set<number>();
  const emptyTranslationRows = new Set<number>();
  const structureMismatchRows = new Set<number>();

  const rowCount = Math.max(original.length, translated.length);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const originalRow = original[rowIndex] || {};
    const translatedRow = translated[rowIndex] || {};
    const keys = new Set([
      ...Object.keys(originalRow),
      ...Object.keys(translatedRow)
    ]);

    if (
      rowIndex >= original.length ||
      rowIndex >= translated.length
    ) {
      totals.structureMismatches += 1;
      structureMismatchRows.add(rowIndex);
      issues.structureMismatches.push({
        rowIndex,
        columnKey: '__ROW__',
        value: rowIndex >= translated.length ? 'Missing translated row' : 'Extra translated row',
        original: rowIndex >= original.length ? '' : 'Expected row from source',
        type: 'structureMismatch'
      });
    }

    keys.forEach((key) => {
      const value = translatedRow[key];
      const originalValue = originalRow[key];
      const hasTranslatedKey = Object.prototype.hasOwnProperty.call(translatedRow, key);
      const hasOriginalKey = Object.prototype.hasOwnProperty.call(originalRow, key);

      if (hasOriginalKey !== hasTranslatedKey) {
        totals.structureMismatches += 1;
        structureMismatchRows.add(rowIndex);
        issues.structureMismatches.push({
          rowIndex,
          columnKey: key,
          value: hasTranslatedKey ? 'Unexpected target column' : 'Missing target column',
          original: typeof originalValue === 'string' ? originalValue : '',
          type: 'structureMismatch'
        });
      }

      if (isTranslatableSourceCell(originalValue)) {
        const translatedText = typeof value === 'string' ? value.trim() : '';
        if (!translatedText) {
          totals.emptyTranslations += 1;
          emptyTranslationRows.add(rowIndex);
          issues.emptyTranslations.push({
            rowIndex,
            columnKey: key,
            value: '',
            original: typeof originalValue === 'string' ? originalValue : '',
            type: 'emptyTranslation'
          });
        }
      }

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

      const spacingSeverity = getSpacingSeverity(value);
      if (spacingSeverity) {
        totals.spacingIssues += 1;
        spacingRows.add(rowIndex);
        if (spacingSeverity === 'high') totals.spacingHigh += 1;
        if (spacingSeverity === 'medium') totals.spacingMedium += 1;
        if (spacingSeverity === 'low') totals.spacingLow += 1;
        issues.spacing.push({
          rowIndex,
          columnKey: key,
          value,
          original: typeof originalRow[key] === 'string' ? originalRow[key] : '',
          type: 'spacing',
          severity: spacingSeverity
        });
      }

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
  totals.emptyTranslationRows = emptyTranslationRows.size;
  totals.structureMismatchRows = structureMismatchRows.size;

  return {
    totals,
    issues
  };
};

export const collectPlaceholderIssues = (
  original: POCTRecord[],
  translated: POCTRecord[]
) => runQualityChecks(original, translated).issues.placeholders;
