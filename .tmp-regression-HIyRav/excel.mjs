import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { scanXlsxEmbeddedVisuals } from './embeddedVisuals';
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const buildHeaderKeys = (worksheet, headerRow, range) => {
    const counts = new Map();
    const keys = [];
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
const detectDataStartRow = (headerRow) => {
    // Always include rows below the first header row so multi-line headers are translated too.
    return headerRow + 1;
};
export async function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target?.result;
                const data = new Uint8Array(arrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
                const parsed = parseExcelWorkbook(workbook);
                parsed.context.sourceArrayBuffer = arrayBuffer.slice(0);
                // Pictures, charts and drawing text are not translated; find them so the user is told.
                parsed.context.embeddedVisuals = await JSZip.loadAsync(arrayBuffer.slice(0))
                    .then((zip) => scanXlsxEmbeddedVisuals(zip))
                    .catch(() => undefined);
                resolve(parsed);
            }
            catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}
export function parseExcelWorkbook(workbook) {
    const records = [];
    const sheets = [];
    workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const ref = worksheet?.['!ref'];
        if (!worksheet || !ref)
            return;
        const range = XLSX.utils.decode_range(ref);
        const headerRow = range.s.r;
        const dataStartRow = detectDataStartRow(headerRow);
        const headerKeys = buildHeaderKeys(worksheet, headerRow, range);
        const startIndex = records.length;
        for (let r = dataStartRow; r <= range.e.r; r++) {
            const row = {};
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
const getExcelSheetContextForRow = (context, rowIndex) => {
    const sheets = context.sheets?.length ? context.sheets : [context];
    return (sheets.find((sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount) || context);
};
export const isExcelFormulaCell = (context, rowIndex, columnKey) => {
    if (!context)
        return false;
    const sheet = getExcelSheetContextForRow(context, rowIndex);
    const columnOffset = sheet.headerKeys.indexOf(columnKey);
    if (columnOffset < 0)
        return false;
    const row = sheet.dataStartRow + (rowIndex - sheet.startIndex);
    const column = sheet.range.s.c + columnOffset;
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    return Boolean(sheet.worksheet[address]?.f);
};
const setCellValue = (cell, value) => {
    if (value === undefined)
        return;
    const normalized = value === null ? '' : value;
    delete cell.w;
    delete cell.h;
    delete cell.r;
    cell.v = normalized;
    if (typeof normalized === 'number') {
        cell.t = 'n';
    }
    else if (typeof normalized === 'boolean') {
        cell.t = 'b';
    }
    else {
        cell.t = 's';
        if (CYRILLIC_REGEX.test(String(normalized))) {
            // Some source templates carry corrupted or non-Unicode-friendly font
            // metadata. For Cyrillic output, reset the cell style to a neutral base
            // so Excel falls back to a safe default font instead of preserving a bad one.
            cell.s = { patternType: 'none' };
        }
    }
};
export function exportToExcel(data, filename, context, options = {}) {
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
    data.forEach((row, rowIndex) => {
        const sheetContext = getExcelSheetContextForRow(context, rowIndex);
        const { worksheet, headerRow, dataStartRow, headerKeys, range, startIndex } = sheetContext;
        const startRow = Number.isFinite(dataStartRow) ? dataStartRow : headerRow + 1;
        const sheetRow = startRow + (rowIndex - startIndex);
        if (sheetRow > range.e.r)
            return;
        for (let c = range.s.c; c <= range.e.c; c++) {
            const key = headerKeys[c - range.s.c];
            if (!key)
                continue;
            const value = row?.[key];
            if (value === undefined)
                continue;
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
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeXmlText = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const escapeXmlAttribute = (value) => escapeXmlText(value).replace(/"/g, '&quot;');
const decodeXmlAttribute = (value) => value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const getXmlAttribute = (attributes, name) => {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`);
    return attributes.match(pattern)?.[1] || '';
};
const removeXmlAttribute = (attributes, name) => attributes.replace(new RegExp(`\\s${escapeRegExp(name)}="[^"]*"`, 'g'), '');
const setXmlAttribute = (attributes, name, value) => {
    const escapedValue = escapeXmlAttribute(value);
    const pattern = new RegExp(`\\b${escapeRegExp(name)}="[^"]*"`);
    if (pattern.test(attributes)) {
        return attributes.replace(pattern, `${name}="${escapedValue}"`);
    }
    return `${attributes} ${name}="${escapedValue}"`;
};
const normalizeWorkbookTargetPath = (target) => {
    const cleanTarget = target.replace(/^\/+/, '');
    return cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`;
};
const getWorkbookSheetPaths = async (zip) => {
    const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
    if (!workbookXml || !relsXml)
        return new Map();
    const worksheetTargetsById = new Map();
    Array.from(relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)).forEach((match) => {
        const attributes = match[1] || '';
        const type = getXmlAttribute(attributes, 'Type');
        if (!type.endsWith('/worksheet'))
            return;
        const id = getXmlAttribute(attributes, 'Id');
        const target = getXmlAttribute(attributes, 'Target');
        if (id && target)
            worksheetTargetsById.set(id, normalizeWorkbookTargetPath(target));
    });
    const sheetPaths = new Map();
    Array.from(workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)).forEach((match) => {
        const attributes = match[1] || '';
        const name = decodeXmlAttribute(getXmlAttribute(attributes, 'name'));
        const relationshipId = getXmlAttribute(attributes, 'r:id');
        const target = worksheetTargetsById.get(relationshipId);
        if (name && target)
            sheetPaths.set(name, target);
    });
    return sheetPaths;
};
const buildCellXml = (originalAttributes, value) => {
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
const getCellColumnIndex = (address) => XLSX.utils.decode_cell(address).c;
const insertCellIntoRowXml = (rowXml, cellXml, address) => {
    const targetColumn = getCellColumnIndex(address);
    const cellRegex = /<c\b(?=[^>]*\br="([^"]+)")[^>]*(?:>[\s\S]*?<\/c>|\s*\/>)/g;
    const cells = Array.from(rowXml.matchAll(cellRegex));
    const nextCell = cells.find((match) => getCellColumnIndex(match[1]) > targetColumn);
    if (nextCell?.index !== undefined) {
        return `${rowXml.slice(0, nextCell.index)}${cellXml}${rowXml.slice(nextCell.index)}`;
    }
    return rowXml.replace(/<\/row>$/, `${cellXml}</row>`);
};
const patchCellXml = (sheetXml, address, value, sourceCell, options, stats) => {
    if (value === undefined)
        return sheetXml;
    if ((value === '' || value === null) && (sourceCell?.v === undefined || sourceCell?.v === '')) {
        return sheetXml;
    }
    if (!sourceCell?.f && sourceCell?.v === value)
        return sheetXml;
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
        if (hasFormula)
            stats.overwrittenFormulas += 1;
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
export const buildStylePreservingExcelBuffer = async (data, context, options = {}) => {
    if (!context.sourceArrayBuffer) {
        throw new Error('Style-preserving Excel export requires the original workbook bytes.');
    }
    const zip = await JSZip.loadAsync(context.sourceArrayBuffer);
    const sheetPaths = await getWorkbookSheetPaths(zip);
    const sheetXmlByPath = new Map();
    const stats = {
        overwrittenFormulas: 0,
        skippedFormulas: 0,
        stylePreserved: true
    };
    const workbookSheets = context.sheets?.length ? context.sheets : [context];
    for (const sheet of workbookSheets) {
        const sheetPath = sheetPaths.get(sheet.sheetName);
        const file = sheetPath ? zip.file(sheetPath) : null;
        if (sheetPath && file && !sheetXmlByPath.has(sheetPath)) {
            sheetXmlByPath.set(sheetPath, await file.async('string'));
        }
    }
    data.forEach((row, rowIndex) => {
        const sheetContext = getExcelSheetContextForRow(context, rowIndex);
        const sheetPath = sheetPaths.get(sheetContext.sheetName);
        if (!sheetPath)
            return;
        const { worksheet, headerRow, dataStartRow, headerKeys, range, startIndex } = sheetContext;
        const startRow = Number.isFinite(dataStartRow) ? dataStartRow : headerRow + 1;
        const sheetRow = startRow + (rowIndex - startIndex);
        if (sheetRow > range.e.r)
            return;
        let sheetXml = sheetXmlByPath.get(sheetPath);
        if (sheetXml === undefined)
            return;
        for (let c = range.s.c; c <= range.e.c; c++) {
            const key = headerKeys[c - range.s.c];
            if (!key)
                continue;
            const value = row?.[key];
            if (value === undefined)
                continue;
            const address = XLSX.utils.encode_cell({ r: sheetRow, c });
            const existing = worksheet[address];
            const pendingXml = sheetXmlByPath.get(sheetPath);
            sheetXml = pendingXml;
            if (sheetXml === undefined)
                continue;
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
const downloadBytes = (bytes, filename) => {
    if (typeof document === 'undefined') {
        throw new Error('Excel download is only available in the browser.');
    }
    const blob = new Blob([bytes], { type: XLSX_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
export const exportToExcelPreservingStyles = async (data, filename, context, options = {}) => {
    if (!context?.sourceArrayBuffer) {
        return exportToExcel(data, filename, context, options);
    }
    const { bytes, stats } = await buildStylePreservingExcelBuffer(data, context, options);
    downloadBytes(bytes, filename);
    return stats;
};
