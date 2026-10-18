// Cell lookups the main page needs before any Excel file is parsed. They only read the parsed
// context, so they live apart from utils/excel.ts and the page does not have to download the
// spreadsheet library up front.
import type { ExcelContext } from './excel';

/** Same as XLSX.utils.encode_cell: zero-based row/column to an A1 address. */
const encodeCellAddress = (row: number, column: number) => {
  let letters = '';
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
};

export const getExcelSheetContextForRow = (context: ExcelContext, rowIndex: number) => {
  const sheets = context.sheets?.length ? context.sheets : [context];
  return (
    sheets.find(
      (sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount
    ) || context
  );
};

export const isExcelFormulaCell = (
  context: ExcelContext | null | undefined,
  rowIndex: number,
  columnKey: string
) => {
  if (!context) return false;
  const sheet = getExcelSheetContextForRow(context, rowIndex);
  const columnOffset = sheet.headerKeys.indexOf(columnKey);
  if (columnOffset < 0) return false;
  const row = sheet.dataStartRow + (rowIndex - sheet.startIndex);
  const column = sheet.range.s.c + columnOffset;
  return Boolean(sheet.worksheet[encodeCellAddress(row, column)]?.f);
};
