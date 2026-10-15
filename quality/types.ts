import type { POCTRecord, TargetLanguage } from '../types';

export type QualityDocumentKind = 'excel' | 'docx' | 'pdf' | 'string-resource' | 'generic';

export type QualityIssueType =
  | 'chinese'
  | 'placeholder'
  | 'idMismatch'
  | 'spacing'
  | 'emptyTranslation'
  | 'structureMismatch'
  | 'nonTargetLanguage';

export type QualitySeverity = 'high' | 'medium' | 'low';

export interface QualityRows {
  sourceRows: POCTRecord[];
  targetRows: POCTRecord[];
}

export interface QualityUnit {
  id: string;
  documentKind: QualityDocumentKind;
  rowIndex: number;
  columnKey: string;
  originalValue: unknown;
  translatedValue: unknown;
  hasOriginal: boolean;
  hasTranslated: boolean;
  originalText: string;
  translatedText: string;
  structureOnly?: boolean;
  crossRunWordBreak?: boolean;
  locationLabel?: string;
}

export interface QualityCheckInput {
  units: QualityUnit[];
  rowsScanned: number;
}

export interface QualityCheckOptions {
  targetLang?: TargetLanguage;
  shouldIgnoreUnit?: (unit: QualityUnit) => boolean;
  /** Skip the user's "confirmed as correct" exceptions (tests and golden-set scoring). */
  ignoreExceptions?: boolean;
}

export interface QualityIssue {
  rowIndex: number;
  columnKey: string;
  locationLabel?: string;
  value: string;
  original?: string;
  type: QualityIssueType;
  severity?: QualitySeverity;
  /** Why the severity was lowered; 'retry-stuck' = retries keep returning the same text. */
  reason?: 'retry-stuck';
  /** Extra context, e.g. the code words missing from the translation. */
  detail?: string;
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
    nonTargetCells: number;
    nonTargetRows: number;
  };
  issues: {
    chinese: QualityIssue[];
    placeholders: QualityIssue[];
    idMismatch: QualityIssue[];
    spacing: QualityIssue[];
    emptyTranslations: QualityIssue[];
    structureMismatches: QualityIssue[];
    nonTargetLanguage: QualityIssue[];
  };
}
