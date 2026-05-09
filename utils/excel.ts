
import * as XLSX from 'xlsx';
import type { POCTRecord } from '../types';

const CYRILLIC_REGEX = /[\u0400-\u04FF]/;

export interface ExcelContext {
  workbook: XLSX.WorkBook;
  worksheet: XLSX.WorkSheet;
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  headerKeys: string[];
  range: XLSX.Range;
  startIndex: number;
  rowCount: number;
  sheets: ExcelSheetContext[];
}

export interface ExcelSheetContext {
  workbook: XLSX.WorkBook;
  worksheet: XLSX.WorkSheet;
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  headerKeys: string[];
  range: XLSX.Range;
  startIndex: number;
  rowCount: number;
}

export interface ExcelParseResult {
  records: POCTRecord[];
  context: ExcelContext;
}

const buildHeaderKeys = (
  worksheet: XLSX.WorkSheet,
  headerRow: number,
  range: XLSX.Range
) => {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    const raw = cell?.v ?? '';
    const base = String(raw || '__EMPTY');
    const seen = counts.get(base) ?? 0;
    const key = seen === 0 ? base : `${base}_${seen}`;
    counts.set(base, seen + 1);
    keys.push(key);
  }
  return keys;
};

const detectDataStartRow = (headerRow: number) => {
  // Always include rows below the first header row so multi-line headers are translated too.
  return headerRow + 1;
};

export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
        resolve(parseExcelWorkbook(workbook));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function parseExcelWorkbook(workbook: XLSX.WorkBook): ExcelParseResult {
  const records: POCTRecord[] = [];
  const sheets: ExcelSheetContext[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const ref = worksheet?.['!ref'];
    if (!worksheet || !ref) return;
    const range = XLSX.utils.decode_range(ref);
    const headerRow = range.s.r;
    const dataStartRow = detectDataStartRow(headerRow);
    const headerKeys = buildHeaderKeys(worksheet, headerRow, range);
    const startIndex = records.length;

    for (let r = dataStartRow; r <= range.e.r; r++) {
      const row: POCTRecord = {};
      for (let c = range.s.c; c <= range.e.c; c++) {
        const key = headerKeys[c - range.s.c];
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        row[key] = cell?.v ?? '';
      }
      records.push(row);
    }

    sheets.push({
      workbook,
      worksheet,
      sheetName,
      headerRow,
      dataStartRow,
      headerKeys,
      range,
      startIndex,
      rowCount: records.length - startIndex
    });
  });

  if (!sheets.length) {
    throw new Error('Excel 文件中没有可读取的工作表。');
  }

  const firstSheet = sheets[0];

  return {
    records,
    context: {
      workbook,
      worksheet: firstSheet.worksheet,
      sheetName: firstSheet.sheetName,
      headerRow: firstSheet.headerRow,
      dataStartRow: firstSheet.dataStartRow,
      headerKeys: firstSheet.headerKeys,
      range: firstSheet.range,
      startIndex: firstSheet.startIndex,
      rowCount: firstSheet.rowCount,
      sheets
    }
  };
}

const setCellValue = (cell: XLSX.CellObject, value: unknown) => {
  if (value === undefined) return;
  const normalized = value === null ? '' : value;
  delete (cell as any).w;
  delete (cell as any).h;
  delete (cell as any).r;
  cell.v = normalized as any;
  if (typeof normalized === 'number') {
    cell.t = 'n';
  } else if (typeof normalized === 'boolean') {
    cell.t = 'b';
  } else {
    cell.t = 's';
    if (CYRILLIC_REGEX.test(String(normalized))) {
      // Some source templates carry corrupted or non-Unicode-friendly font
      // metadata. For Cyrillic output, reset the cell style to a neutral base
      // so Excel falls back to a safe default font instead of preserving a bad one.
      (cell as any).s = { patternType: 'none' };
    }
  }
};

export interface ExportOptions {
  overwriteFormulas?: boolean;
}

export function exportToExcel(
  data: any[],
  filename: string,
  context?: ExcelContext,
  options: ExportOptions = {}
) {
  let overwrittenFormulas = 0;
  let skippedFormulas = 0;

  if (!context) {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
    XLSX.writeFile(workbook, filename);
    return { overwrittenFormulas, skippedFormulas };
  }

  const overwriteFormulas = options.overwriteFormulas === true;
  const { workbook } = context;
  const sheets = context.sheets?.length ? context.sheets : [context];

  data.forEach((row, rowIndex) => {
    const sheetContext =
      sheets.find(
        (sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount
      ) || context;
    const {
      worksheet,
      headerRow,
      dataStartRow,
      headerKeys,
      range,
      startIndex
    } = sheetContext;
    const startRow = Number.isFinite(dataStartRow) ? dataStartRow : headerRow + 1;
    const sheetRow = startRow + (rowIndex - startIndex);
    if (sheetRow > range.e.r) return;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = headerKeys[c - range.s.c];
      if (!key) continue;
      const value = row?.[key];
      if (value === undefined) continue;
      const address = XLSX.utils.encode_cell({ r: sheetRow, c });
      const existing = worksheet[address];
      if (existing?.f) {
        if (!overwriteFormulas) {
          skippedFormulas += 1;
          continue;
        }
        delete existing.f;
        overwrittenFormulas += 1;
      }
      const cell = existing || (worksheet[address] = { t: 's', v: '' });
      setCellValue(cell, value);
    }
  });

  XLSX.writeFile(workbook, filename);
  return { overwrittenFormulas, skippedFormulas };
}
