
import type { ExcelContext } from '../../utils/excel';
import type { UntranslatedCell } from '../../utils/language';

export interface IssueLocationsContext {
  excelContext: ExcelContext;
}

export const useIssueLocations = (ctx: IssueLocationsContext) => {
  const {
    excelContext
  } = ctx;

  const getExcelSheetForRow = (rowIndex: number) => {
    if (!excelContext) return null;
    return (
      excelContext.sheets?.find(
        (sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount
      ) || excelContext
    );
  };

const formatExcelRowNumber = (rowIndex: number) => {
    const sheetContext = getExcelSheetForRow(rowIndex);
    if (!sheetContext) return rowIndex + 1;
    const startRow =
      Number.isFinite(sheetContext.dataStartRow)
        ? sheetContext.dataStartRow
        : sheetContext.headerRow + 1;
    return startRow + (rowIndex - sheetContext.startIndex) + 1;
  };

const encodeExcelColumn = (index: number) => {
    let value = index + 1;
    let output = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      output = String.fromCharCode(65 + remainder) + output;
      value = Math.floor((value - 1) / 26);
    }
    return output;
  };

const getColumnLocationMeta = (columnKey: string, rowIndex?: number) => {
    const sheetContext =
      typeof rowIndex === 'number' ? getExcelSheetForRow(rowIndex) : excelContext;
    if (!sheetContext || columnKey === '__ROW__') {
      return {
        columnKey,
        columnLetter: '',
        headerName: columnKey,
        occurrence: null as number | null,
        sheetName: sheetContext?.sheetName || ''
      };
    }

    const columnIndex = sheetContext.headerKeys.indexOf(columnKey);
    if (columnIndex === -1) {
      return {
        columnKey,
        columnLetter: '',
        headerName: columnKey,
        occurrence: null as number | null,
        sheetName: sheetContext.sheetName
      };
    }

    const sheetColumn = sheetContext.range.s.c + columnIndex;
    const headerAddress = `${encodeExcelColumn(sheetColumn)}${sheetContext.headerRow + 1}`;
    const rawHeader = sheetContext.worksheet[headerAddress]?.v ?? columnKey;
    const headerName = String(rawHeader || columnKey);
    const sameHeaderCount = sheetContext.headerKeys.reduce((count, key, idx) => {
      const addr = `${encodeExcelColumn(sheetContext.range.s.c + idx)}${sheetContext.headerRow + 1}`;
      const value = String(sheetContext.worksheet[addr]?.v ?? key);
      return value === headerName ? count + 1 : count;
    }, 0);
    const occurrence =
      sameHeaderCount > 1
        ? sheetContext.headerKeys.slice(0, columnIndex + 1).reduce((count, key, idx) => {
            const addr = `${encodeExcelColumn(sheetContext.range.s.c + idx)}${sheetContext.headerRow + 1}`;
            const value = String(sheetContext.worksheet[addr]?.v ?? key);
            return value === headerName ? count + 1 : count;
          }, 0)
        : null;

    return {
      columnKey,
      columnLetter: encodeExcelColumn(sheetColumn),
      headerName,
      occurrence,
      sheetName: sheetContext.sheetName
    };
  };

const formatIssueLocationPreview = (details: UntranslatedCell[], limit: number = 5) => {
    if (!details.length) return '';
    const seen = new Set<string>();
    const picked: string[] = [];
    details.forEach((issue) => {
      const location = issue.locationLabel || formatLocationLabel(issue.rowIndex, issue.columnKey);
      if (seen.has(location)) return;
      seen.add(location);
      picked.push(location);
    });
    if (!picked.length) return '';
    const displayed = picked.slice(0, limit);
    return displayed.join(', ') + (picked.length > limit ? ', ...' : '');
  };

const formatLocationLabel = (rowIndex: number, columnKey: string) => {
    const rowNo = formatExcelRowNumber(rowIndex);
    const sheetName =
      excelContext && (excelContext.sheets?.length || 0) > 1
        ? `${getExcelSheetForRow(rowIndex)?.sheetName || excelContext.sheetName}!`
        : '';
    if (columnKey === '__ROW__') return `${sheetName}R${rowNo}`;
    const meta = getColumnLocationMeta(columnKey, rowIndex);
    if (!meta.columnLetter) return `R${rowNo}/${columnKey}`;
    const duplicateLabel = meta.occurrence ? `（第${meta.occurrence}列）` : '';
    return `${sheetName}R${rowNo} / ${meta.columnLetter}列 / ${meta.headerName}${duplicateLabel}`;
  };

  return {
    formatExcelRowNumber,
    formatIssueLocationPreview,
    formatLocationLabel
  };
};
