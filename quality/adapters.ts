import type { POCTRecord } from '../types';
import type { QualityCheckInput, QualityDocumentKind, QualityRows, QualityUnit } from './types';

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

export const buildQualityUnitId = (documentKind: QualityDocumentKind, rowIndex: number, columnKey: string) =>
  `${documentKind}:${rowIndex}:${columnKey}`;

export const rowsToQualityUnits = (
  sourceRows: POCTRecord[],
  targetRows: POCTRecord[],
  documentKind: QualityDocumentKind = 'generic'
): QualityCheckInput => {
  const units: QualityUnit[] = [];
  const rowCount = Math.max(sourceRows.length, targetRows.length);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const originalRow = sourceRows[rowIndex] || {};
    const translatedRow = targetRows[rowIndex] || {};
    const hasSourceRow = rowIndex < sourceRows.length;
    const hasTargetRow = rowIndex < targetRows.length;

    if (hasSourceRow !== hasTargetRow) {
      units.push({
        id: buildQualityUnitId(documentKind, rowIndex, '__ROW__'),
        documentKind,
        rowIndex,
        columnKey: '__ROW__',
        originalValue: hasSourceRow ? 'Expected row from source' : '',
        translatedValue: hasTargetRow ? 'Extra translated row' : 'Missing translated row',
        hasOriginal: hasSourceRow,
        hasTranslated: hasTargetRow,
        originalText: hasSourceRow ? 'Expected row from source' : '',
        translatedText: hasTargetRow ? 'Extra translated row' : 'Missing translated row',
        structureOnly: true
      });
    }

    const keys = new Set([
      ...Object.keys(originalRow),
      ...Object.keys(translatedRow)
    ]);

    keys.forEach((columnKey) => {
      const originalValue = originalRow[columnKey];
      const translatedValue = translatedRow[columnKey];
      const hasOriginal = Object.prototype.hasOwnProperty.call(originalRow, columnKey);
      const hasTranslated = Object.prototype.hasOwnProperty.call(translatedRow, columnKey);
      units.push({
        id: buildQualityUnitId(documentKind, rowIndex, columnKey),
        documentKind,
        rowIndex,
        columnKey,
        originalValue,
        translatedValue,
        hasOriginal,
        hasTranslated,
        originalText: toText(originalValue),
        translatedText: toText(translatedValue)
      });
    });
  }

  return {
    units,
    rowsScanned: rowCount
  };
};

export const qualityRowsToUnits = (
  rows: QualityRows,
  documentKind: QualityDocumentKind = 'generic'
): QualityCheckInput => rowsToQualityUnits(rows.sourceRows, rows.targetRows, documentKind);

type TextQualitySegment = {
  original: string;
};

export const segmentsToQualityRows = <T extends TextQualitySegment>(
  segments: T[],
  getTranslatedText: (segment: T, index: number) => string,
  getOriginalText: (segment: T, index: number) => string = (segment) => segment.original
): QualityRows => ({
  sourceRows: segments.map((segment, index) => ({
    content: getOriginalText(segment, index)
  })),
  targetRows: segments.map((segment, index) => ({
    content: getTranslatedText(segment, index)
  }))
});

export const segmentsToQualityUnits = <T extends TextQualitySegment>(
  segments: T[],
  documentKind: Extract<QualityDocumentKind, 'docx' | 'pdf' | 'string-resource'>,
  getTranslatedText: (segment: T, index: number) => string,
  getOriginalText: (segment: T, index: number) => string = (segment) => segment.original,
  getLocationLabel?: (segment: T, index: number) => string
): QualityCheckInput => ({
  units: segments.map((segment, index) => {
    const originalText = getOriginalText(segment, index);
    const translatedText = getTranslatedText(segment, index);
    return {
      id: buildQualityUnitId(documentKind, index, 'content'),
      documentKind,
      rowIndex: index,
      columnKey: 'content',
      originalValue: originalText,
      translatedValue: translatedText,
      hasOriginal: true,
      hasTranslated: true,
      originalText,
      translatedText,
      locationLabel: getLocationLabel?.(segment, index)
    };
  }),
  rowsScanned: segments.length
});
