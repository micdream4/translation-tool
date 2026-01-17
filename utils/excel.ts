
import * as XLSX from 'xlsx';
import { POCTRecord } from '../types';

export interface ExcelContext {
  workbook: XLSX.WorkBook;
  worksheet: XLSX.WorkSheet;
  sheetName: string;
  headerRow: number;
  headerKeys: string[];
  range: XLSX.Range;
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

export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const ref = worksheet?.['!ref'] || 'A1';
        const range = XLSX.utils.decode_range(ref);
        const headerRow = range.s.r;
        const headerKeys = buildHeaderKeys(worksheet, headerRow, range);
        const records: POCTRecord[] = [];

        for (let r = headerRow + 1; r <= range.e.r; r++) {
          const row: POCTRecord = {};
          for (let c = range.s.c; c <= range.e.c; c++) {
            const key = headerKeys[c - range.s.c];
            const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
            row[key] = cell?.v ?? '';
          }
          records.push(row);
        }

        resolve({
          records,
          context: {
            workbook,
            worksheet,
            sheetName,
            headerRow,
            headerKeys,
            range
          }
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

const setCellValue = (cell: XLSX.CellObject, value: unknown) => {
  if (value === undefined) return;
  const normalized = value === null ? '' : value;
  cell.v = normalized as any;
  if (typeof normalized === 'number') {
    cell.t = 'n';
  } else if (typeof normalized === 'boolean') {
    cell.t = 'b';
  } else {
    cell.t = 's';
  }
};

export function exportToExcel(
  data: any[],
  filename: string,
  context?: ExcelContext
) {
  if (!context) {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
    XLSX.writeFile(workbook, filename);
    return;
  }

  const { workbook, worksheet, headerRow, headerKeys, range } = context;
  const startRow = headerRow + 1;

  data.forEach((row, rowIndex) => {
    const sheetRow = startRow + rowIndex;
    if (sheetRow > range.e.r) return;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = headerKeys[c - range.s.c];
      if (!key) continue;
      const value = row?.[key];
      if (value === undefined) continue;
      const address = XLSX.utils.encode_cell({ r: sheetRow, c });
      const existing = worksheet[address];
      if (existing?.f) continue;
      const cell = existing || (worksheet[address] = { t: 's', v: '' });
      setCellValue(cell, value);
    }
  });

  XLSX.writeFile(workbook, filename);
}
