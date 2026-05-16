import type { POCTRecord } from '../types';

export type QualityDocumentKind = 'excel' | 'docx' | 'pdf' | 'string-resource' | 'generic';

export type QualityIssueType =
  | 'chinese'
  | 'placeholder'
  | 'idMismatch'
  | 'spacing'
  | 'emptyTranslation'
  | 'structureMismatch';

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
  locationLabel?: string;
}

export interface QualityCheckInput {
  units: QualityUnit[];
  rowsScanned: number;
}

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
