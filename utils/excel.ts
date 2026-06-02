
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { POCTRecord } from '../types';

const CYRILLIC_REGEX = /[\u0400-\u04FF]/;

export interface ExcelContext {
  workbook: XLSX.WorkBook;
  worksheet: XLSX.WorkSheet;
  sheetName: string;
  sourceArrayBuffer?: ArrayBuffer;
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
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
        const parsed = parseExcelWorkbook(workbook);
        parsed.context.sourceArrayBuffer = arrayBuffer.slice(0);
        resolve(parsed);
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

export interface ExcelExportStats {
  overwrittenFormulas: number;
  skippedFormulas: number;
  stylePreserved?: boolean;
}

export function exportToExcel(
  data: any[],
  filename: string,
  context?: ExcelContext,
  options: ExportOptions = {}
): ExcelExportStats {
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

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeXmlText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeXmlAttribute = (value: string) =>
  escapeXmlText(value).replace(/"/g, '&quot;');

const decodeXmlAttribute = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const getXmlAttribute = (attributes: string, name: string) => {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`);
  return attributes.match(pattern)?.[1] || '';
};

const removeXmlAttribute = (attributes: string, name: string) =>
  attributes.replace(new RegExp(`\\s${escapeRegExp(name)}="[^"]*"`, 'g'), '');

const setXmlAttribute = (attributes: string, name: string, value: string) => {
  const escapedValue = escapeXmlAttribute(value);
  const pattern = new RegExp(`\\b${escapeRegExp(name)}="[^"]*"`);
  if (pattern.test(attributes)) {
    return attributes.replace(pattern, `${name}="${escapedValue}"`);
  }
  return `${attributes} ${name}="${escapedValue}"`;
};

const normalizeWorkbookTargetPath = (target: string) => {
  const cleanTarget = target.replace(/^\/+/, '');
  return cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`;
};

const getWorkbookSheetPaths = async (zip: JSZip) => {
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relsXml) return new Map<string, string>();

  const worksheetTargetsById = new Map<string, string>();
  Array.from(relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)).forEach((match) => {
    const attributes = match[1] || '';
    const type = getXmlAttribute(attributes, 'Type');
    if (!type.endsWith('/worksheet')) return;
    const id = getXmlAttribute(attributes, 'Id');
    const target = getXmlAttribute(attributes, 'Target');
    if (id && target) worksheetTargetsById.set(id, normalizeWorkbookTargetPath(target));
  });

  const sheetPaths = new Map<string, string>();
  Array.from(workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)).forEach((match) => {
    const attributes = match[1] || '';
    const name = decodeXmlAttribute(getXmlAttribute(attributes, 'name'));
    const relationshipId = getXmlAttribute(attributes, 'r:id');
    const target = worksheetTargetsById.get(relationshipId);
    if (name && target) sheetPaths.set(name, target);
  });
  return sheetPaths;
};

const buildCellXml = (originalAttributes: string, value: unknown) => {
  const normalized = value === null ? '' : value;
  let attributes = removeXmlAttribute(originalAttributes, 't');

  if (typeof normalized === 'number') {
    return `<c${attributes}><v>${String(normalized)}</v></c>`;
  }

  if (typeof normalized === 'boolean') {
    attributes = setXmlAttribute(attributes, 't', 'b');
    return `<c${attributes}><v>${normalized ? '1' : '0'}</v></c>`;
  }

  const text = String(normalized ?? '');
  attributes = setXmlAttribute(attributes, 't', 'inlineStr');
  const preserveSpace = text !== text.trim() || /[\r\n]/.test(text);
  const spaceAttribute = preserveSpace ? ' xml:space="preserve"' : '';
  return `<c${attributes}><is><t${spaceAttribute}>${escapeXmlText(text)}</t></is></c>`;
};

const getCellColumnIndex = (address: string) => XLSX.utils.decode_cell(address).c;

const insertCellIntoRowXml = (rowXml: string, cellXml: string, address: string) => {
  const targetColumn = getCellColumnIndex(address);
  const cellRegex = /<c\b(?=[^>]*\br="([^"]+)")[^>]*(?:>[\s\S]*?<\/c>|\s*\/>)/g;
  const cells = Array.from(rowXml.matchAll(cellRegex));
  const nextCell = cells.find((match) => getCellColumnIndex(match[1]) > targetColumn);
  if (nextCell?.index !== undefined) {
    return `${rowXml.slice(0, nextCell.index)}${cellXml}${rowXml.slice(nextCell.index)}`;
  }
  return rowXml.replace(/<\/row>$/, `${cellXml}</row>`);
};

const patchCellXml = (
  sheetXml: string,
  address: string,
  value: unknown,
  sourceCell: XLSX.CellObject | undefined,
  options: ExportOptions,
  stats: ExcelExportStats
) => {
  if (value === undefined) return sheetXml;
  if ((value === '' || value === null) && (sourceCell?.v === undefined || sourceCell?.v === '')) {
    return sheetXml;
  }
  if (!sourceCell?.f && sourceCell?.v === value) return sheetXml;

  const escapedAddress = escapeRegExp(address);
  const cellRegex = new RegExp(`<c\\b(?=[^>]*\\br="${escapedAddress}")[^>]*(?:>[\\s\\S]*?<\\/c>|\\s*\\/>)`);
  const existingCell = sheetXml.match(cellRegex)?.[0];
  const defaultAttributes = ` r="${escapeXmlAttribute(address)}"`;

  if (existingCell) {
    const hasFormula = /<f\b/.test(existingCell);
    if (hasFormula && !options.overwriteFormulas) {
      stats.skippedFormulas += 1;
      return sheetXml;
    }
    if (hasFormula) stats.overwrittenFormulas += 1;
    const openMatch = existingCell.match(/^<c\b([^>]*?)(?:\/>|>)/);
    const attributes = openMatch?.[1] || defaultAttributes;
    return sheetXml.replace(cellRegex, buildCellXml(attributes, value));
  }

  const rowNumber = XLSX.utils.decode_cell(address).r + 1;
  const rowRegex = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*(?:>[\\s\\S]*?<\\/row>|\\s*\\/>)`);
  const newCellXml = buildCellXml(defaultAttributes, value);
  const existingRow = sheetXml.match(rowRegex)?.[0];
  if (existingRow) {
    const nextRow = existingRow.endsWith('/>')
      ? existingRow.replace(/\s*\/>$/, `>${newCellXml}</row>`)
      : insertCellIntoRowXml(existingRow, newCellXml, address);
    return sheetXml.replace(rowRegex, nextRow);
  }

  const newRowXml = `<row r="${rowNumber}">${newCellXml}</row>`;
  return sheetXml.replace(/<\/sheetData>/, `${newRowXml}</sheetData>`);
};

export const buildStylePreservingExcelBuffer = async (
  data: any[],
  context: ExcelContext,
  options: ExportOptions = {}
): Promise<{ bytes: Uint8Array; stats: ExcelExportStats }> => {
  if (!context.sourceArrayBuffer) {
    throw new Error('Style-preserving Excel export requires the original workbook bytes.');
  }

  const zip = await JSZip.loadAsync(context.sourceArrayBuffer);
  const sheetPaths = await getWorkbookSheetPaths(zip);
  const sheetXmlByPath = new Map<string, string>();
  const stats: ExcelExportStats = {
    overwrittenFormulas: 0,
    skippedFormulas: 0,
    stylePreserved: true
  };
  const sheets = context.sheets?.length ? context.sheets : [context];
  for (const sheet of sheets) {
    const sheetPath = sheetPaths.get(sheet.sheetName);
    const file = sheetPath ? zip.file(sheetPath) : null;
    if (sheetPath && file && !sheetXmlByPath.has(sheetPath)) {
      sheetXmlByPath.set(sheetPath, await file.async('string'));
    }
  }

  data.forEach((row, rowIndex) => {
    const sheetContext =
      sheets.find(
        (sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount
      ) || context;
    const sheetPath = sheetPaths.get(sheetContext.sheetName);
    if (!sheetPath) return;

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

    let sheetXml = sheetXmlByPath.get(sheetPath);
    if (sheetXml === undefined) return;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = headerKeys[c - range.s.c];
      if (!key) continue;
      const value = row?.[key];
      if (value === undefined) continue;
      const address = XLSX.utils.encode_cell({ r: sheetRow, c });
      const existing = worksheet[address];
      const pendingXml = sheetXmlByPath.get(sheetPath);
      sheetXml = pendingXml;
      if (sheetXml === undefined) continue;
      sheetXmlByPath.set(sheetPath, patchCellXml(sheetXml, address, value, existing, options, stats));
    }
  });

  for (const [sheetPath, sheetXml] of sheetXmlByPath.entries()) {
    if (sheetXml) {
      zip.file(sheetPath, sheetXml);
    }
  }

  return {
    bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    stats
  };
};

const downloadBytes = (bytes: Uint8Array, filename: string) => {
  if (typeof document === 'undefined') {
    throw new Error('Excel download is only available in the browser.');
  }
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportToExcelPreservingStyles = async (
  data: any[],
  filename: string,
  context?: ExcelContext,
  options: ExportOptions = {}
): Promise<ExcelExportStats> => {
  if (!context?.sourceArrayBuffer) {
    return exportToExcel(data, filename, context, options);
  }
  const { bytes, stats } = await buildStylePreservingExcelBuffer(data, context, options);
  downloadBytes(bytes, filename);
  return stats;
};
