import type { POCTRecord } from '../types';
import type { TargetLanguage } from '../types';
import { isLikelyTargetLanguage, isNeutralToken, type UntranslatedCell } from './language';
import {
  hasUntranslatedUiLabelResidue,
  isLikelyIdentifier
} from './translationTokens';

export type RetryCellTarget = {
  rowIdx: number;
  keys: Set<string>;
  sanitizedRow: POCTRecord;
  placeholders: Record<string, Record<string, string> | null>;
};

export type RetryableCellContext = {
  rowIndex: number;
  columnKey: string;
  value: string;
  originalValue: unknown;
  sourceValue: unknown;
};

export type GuardedTranslationTokens = {
  sanitized: string;
  placeholders?: Record<string, string> | null;
};

export const shouldTranslateCellValue = (
  key: string,
  value: unknown,
  targetLang: TargetLanguage,
  options: {
    ignoreLock?: boolean;
    requireTargetLanguageEvidence?: boolean;
    shouldLockCell?: (key: string, value: unknown) => boolean;
  } = {}
) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isNeutralToken(trimmed) || isLikelyIdentifier(trimmed)) return false;
  if (!options.ignoreLock && options.shouldLockCell?.(key, value)) return false;
  if (hasUntranslatedUiLabelResidue(trimmed, '', targetLang)) return true;
  return !isLikelyTargetLanguage(trimmed, targetLang, {
    requireTargetLanguageEvidence: options.requireTargetLanguageEvidence
  });
};

export type TextSegmentIssueDetail = {
  index: number;
  lowPriority: boolean;
};

export const groupRetryIssueKeys = (
  details: UntranslatedCell[],
  rowIndices: number[],
  rowCount: number
) => {
  const allowedRows = new Set(
    Array.from(new Set(rowIndices))
      .filter((idx) => idx >= 0 && idx < rowCount)
  );
  const grouped = new Map<number, Set<string>>();
  details.forEach((cell) => {
    if (!allowedRows.has(cell.rowIndex)) return;
    if (!grouped.has(cell.rowIndex)) {
      grouped.set(cell.rowIndex, new Set());
    }
    grouped.get(cell.rowIndex)!.add(cell.columnKey);
  });
  return grouped;
};

export const buildRetryableExcelSummary = ({
  details,
  originalRows,
  sourceRows,
  isRetryableCell
}: {
  details: UntranslatedCell[];
  originalRows: POCTRecord[];
  sourceRows: POCTRecord[];
  isRetryableCell: (context: RetryableCellContext) => boolean;
}) => {
  const grouped = groupRetryIssueKeys(
    details,
    details.map((item) => item.rowIndex),
    originalRows.length
  );
  const rowIndices: number[] = [];
  let cellCount = 0;

  grouped.forEach((keys, rowIndex) => {
    const originalRow = originalRows[rowIndex] || {};
    const sourceRow = sourceRows[rowIndex] || originalRow;
    let rowRetryable = false;
    keys.forEach((columnKey) => {
      const sourceValue = sourceRow?.[columnKey];
      const originalValue = originalRow?.[columnKey];
      const value = typeof sourceValue === 'string' ? sourceValue : originalValue;
      if (typeof value !== 'string') return;
      if (
        isRetryableCell({
          rowIndex,
          columnKey,
          value,
          originalValue,
          sourceValue
        })
      ) {
        cellCount += 1;
        rowRetryable = true;
      }
    });
    if (rowRetryable) rowIndices.push(rowIndex);
  });

  return {
    rowIndices: rowIndices.sort((a, b) => a - b),
    cellCount
  };
};

export const buildExcelRetryTargets = ({
  rowIndices,
  details,
  originalRows,
  sourceRows,
  isRetryableCell,
  guardTranslationTokens
}: {
  rowIndices: number[];
  details: UntranslatedCell[];
  originalRows: POCTRecord[];
  sourceRows: POCTRecord[];
  isRetryableCell: (context: RetryableCellContext) => boolean;
  guardTranslationTokens: (value: string) => GuardedTranslationTokens;
}): RetryCellTarget[] => {
  const grouped = groupRetryIssueKeys(details, rowIndices, originalRows.length);
  const targets: RetryCellTarget[] = [];

  Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([rowIdx, keys]) => {
      const originalRow = originalRows[rowIdx] || {};
      const sourceRow = sourceRows[rowIdx] || originalRow;
      const sanitizedRow: POCTRecord = {};
      const placeholdersForRow: Record<string, Record<string, string> | null> = {};

      keys.forEach((columnKey) => {
        const sourceValue = sourceRow?.[columnKey];
        const originalValue = originalRow?.[columnKey];
        const value = typeof sourceValue === 'string' ? sourceValue : originalValue;
        if (typeof value !== 'string') {
          sanitizedRow[columnKey] = value;
          return;
        }
        if (
          !isRetryableCell({
            rowIndex: rowIdx,
            columnKey,
            value,
            originalValue,
            sourceValue
          })
        ) {
          return;
        }
        const { sanitized, placeholders } = guardTranslationTokens(value);
        if (placeholders) {
          placeholdersForRow[columnKey] = placeholders;
        }
        sanitizedRow[columnKey] = sanitized;
      });

      if (Object.keys(sanitizedRow).length === 0) return;
      targets.push({
        rowIdx,
        keys,
        sanitizedRow,
        placeholders: placeholdersForRow
      });
    });

  return targets;
};

export const buildTextSegmentRetryPlan = (
  details: TextSegmentIssueDetail[],
  pendingIndices: number[]
) => {
  const recommendedIndices = details
    .filter((item) => !item.lowPriority)
    .map((item) => item.index);
  const targetIndices = recommendedIndices.length > 0 ? recommendedIndices : pendingIndices;
  return {
    targetIndices,
    recommendedIndices,
    skippedLowPriority: Math.max(details.length - recommendedIndices.length, 0),
    fallbackToLowPriority: recommendedIndices.length === 0 && details.length > 0
  };
};
