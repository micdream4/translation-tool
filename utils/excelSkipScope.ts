import type { ExcelContext, ExcelSheetContext } from './excel';

export interface ExcelSkipScope {
  raw: string;
  skippedRows: Set<number>;
  skippedColumnsBySheet: Map<string, Set<string>>;
  skippedCells: Set<string>;
  errors: string[];
  rowRuleCount: number;
  columnRuleCount: number;
  cellCount: number;
}

const CELL_KEY_SEPARATOR = '\u0000';

const createEmptyScope = (raw: string, errors: string[] = []): ExcelSkipScope => ({
  raw,
  skippedRows: new Set<number>(),
  skippedColumnsBySheet: new Map<string, Set<string>>(),
  skippedCells: new Set<string>(),
  errors,
  rowRuleCount: 0,
  columnRuleCount: 0,
  cellCount: 0
});

const normalize = (value: string) => String(value || '').trim().toLowerCase();

const splitRuleTokens = (value: string) =>
  String(value || '')
    .split(/[,;，；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const columnLettersToIndex = (letters: string) => {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    index = index * 26 + (code - 64);
  }
  return index - 1;
};

const indexToColumnLetters = (index: number) => {
  let value = index + 1;
  let output = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
};

const findSheets = (context: ExcelContext, sheetName?: string) => {
  const sheets = context.sheets?.length ? context.sheets : [context];
  if (!sheetName) return sheets;
  const wanted = normalize(sheetName);
  return sheets.filter((sheet) => normalize(sheet.sheetName) === wanted);
};

const getExcelRowNumber = (sheet: ExcelSheetContext, rowIndex: number) => {
  const startRow = Number.isFinite(sheet.dataStartRow) ? sheet.dataStartRow : sheet.headerRow + 1;
  return startRow + (rowIndex - sheet.startIndex) + 1;
};

const addSkippedCell = (scope: ExcelSkipScope, rowIndex: number, columnKey: string) => {
  scope.skippedCells.add(`${rowIndex}${CELL_KEY_SEPARATOR}${columnKey}`);
};

const addSkippedColumn = (scope: ExcelSkipScope, sheet: ExcelSheetContext, columnKey: string) => {
  const existing = scope.skippedColumnsBySheet.get(sheet.sheetName) || new Set<string>();
  existing.add(columnKey);
  scope.skippedColumnsBySheet.set(sheet.sheetName, existing);
  for (let rowIndex = sheet.startIndex; rowIndex < sheet.startIndex + sheet.rowCount; rowIndex += 1) {
    addSkippedCell(scope, rowIndex, columnKey);
  }
};

const addSkippedRows = (
  scope: ExcelSkipScope,
  context: ExcelContext,
  token: string,
  sheetName?: string
) => {
  const match = token.match(/^(\d+)(?:\s*[-:]\s*(\d+))?$/);
  if (!match) {
    scope.errors.push(`无法识别行规则：${token}`);
    return;
  }
  const from = Number(match[1]);
  const to = Number(match[2] || match[1]);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const sheets = findSheets(context, sheetName);
  if (!sheets.length) {
    scope.errors.push(`找不到工作表：${sheetName}`);
    return;
  }
  let matched = 0;
  sheets.forEach((sheet) => {
    for (let rowIndex = sheet.startIndex; rowIndex < sheet.startIndex + sheet.rowCount; rowIndex += 1) {
      const excelRow = getExcelRowNumber(sheet, rowIndex);
      if (excelRow < start || excelRow > end) continue;
      scope.skippedRows.add(rowIndex);
      sheet.headerKeys.forEach((columnKey) => addSkippedCell(scope, rowIndex, columnKey));
      matched += 1;
    }
  });
  if (matched === 0) {
    scope.errors.push(`行规则未匹配到数据行：${sheetName ? `${sheetName}!` : ''}${token}`);
  } else {
    scope.rowRuleCount += 1;
  }
};

const resolveColumnKeys = (
  sheet: ExcelSheetContext,
  token: string
) => {
  const rangeMatch = token.match(/^([A-Za-z]+)(?:\s*[-:]\s*([A-Za-z]+))?$/);
  if (rangeMatch) {
    const start = columnLettersToIndex(rangeMatch[1]);
    const end = columnLettersToIndex(rangeMatch[2] || rangeMatch[1]);
    if (start === null || end === null) return [];
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const keys: string[] = [];
    for (let c = from; c <= to; c += 1) {
      const key = sheet.headerKeys[c - sheet.range.s.c];
      if (key) keys.push(key);
    }
    return keys;
  }

  const wanted = normalize(token);
  return sheet.headerKeys.filter((key, index) => {
    if (normalize(key) === wanted) return true;
    const headerCell = sheet.worksheet[`${indexToColumnLetters(sheet.range.s.c + index)}${sheet.headerRow + 1}`];
    return normalize(String(headerCell?.v ?? '')) === wanted;
  });
};

const addSkippedColumns = (
  scope: ExcelSkipScope,
  context: ExcelContext,
  token: string,
  sheetName?: string
) => {
  const sheets = findSheets(context, sheetName);
  if (!sheets.length) {
    scope.errors.push(`找不到工作表：${sheetName}`);
    return;
  }
  let matched = 0;
  sheets.forEach((sheet) => {
    const keys = resolveColumnKeys(sheet, token);
    keys.forEach((key) => {
      addSkippedColumn(scope, sheet, key);
      matched += 1;
    });
  });
  if (matched === 0) {
    scope.errors.push(`列规则未匹配到列：${sheetName ? `${sheetName}!` : ''}${token}`);
  } else {
    scope.columnRuleCount += 1;
  }
};

const parseRuleLine = (line: string) => {
  const sheetSplit = line.match(/^([^!]+)!(.+)$/);
  const sheetName = sheetSplit ? sheetSplit[1].trim() : undefined;
  const body = (sheetSplit ? sheetSplit[2] : line).trim();
  const prefixed = body.match(/^(rows?|行|cols?|columns?|列)\s*[:=：]\s*(.+)$/i);
  if (prefixed) {
    const kind = /^(rows?|行)$/i.test(prefixed[1]) ? 'row' : 'column';
    return { sheetName, kind, tokens: splitRuleTokens(prefixed[2]) };
  }
  const tokens = splitRuleTokens(body);
  const allRows = tokens.length > 0 && tokens.every((token) => /^\d+(?:\s*[-:]\s*\d+)?$/.test(token));
  const allColumns = tokens.length > 0 && tokens.every((token) => /^[A-Za-z]+(?:\s*[-:]\s*[A-Za-z]+)?$/.test(token));
  return {
    sheetName,
    kind: allRows ? 'row' : allColumns ? 'column' : 'column',
    tokens
  };
};

export const parseExcelSkipScope = (
  raw: string,
  context: ExcelContext | null
): ExcelSkipScope => {
  const input = String(raw || '').trim();
  if (!input) return createEmptyScope(raw);
  if (!context) return createEmptyScope(raw, ['请先上传 Excel 文件，再配置跳过行/列。']);

  const scope = createEmptyScope(raw);
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const rule = parseRuleLine(line);
      if (!rule.tokens.length) return;
      rule.tokens.forEach((token) => {
        if (rule.kind === 'row') {
          addSkippedRows(scope, context, token, rule.sheetName);
        } else {
          addSkippedColumns(scope, context, token, rule.sheetName);
        }
      });
    });

  scope.cellCount = scope.skippedCells.size;
  return scope;
};

export const isExcelCellSkipped = (
  scope: ExcelSkipScope,
  rowIndex: number,
  columnKey: string
) => scope.skippedCells.has(`${rowIndex}${CELL_KEY_SEPARATOR}${columnKey}`);

export const isExcelRowFullySkipped = (
  scope: ExcelSkipScope,
  rowIndex: number
) => scope.skippedRows.has(rowIndex);

export const formatExcelSkipScopeSummary = (scope: ExcelSkipScope) => {
  if (!scope.raw.trim()) return '未配置跳过范围。';
  return `将跳过 ${scope.skippedRows.size} 行、${scope.columnRuleCount} 条列规则，共 ${scope.cellCount} 个单元格。`;
};
