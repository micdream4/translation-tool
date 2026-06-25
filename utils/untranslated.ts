import { POCTRecord, TargetLanguage, UntranslatedSummary } from "../types";
import { detectUntranslatedCells, type DetectUntranslatedOptions } from "./language";

export const summarizeUntranslated = (
  records: POCTRecord[],
  targetLang: TargetLanguage,
  options: DetectUntranslatedOptions = {}
): UntranslatedSummary => {
  const cells = detectUntranslatedCells(records, targetLang, options);
  const rowIndices = Array.from(new Set(cells.map((cell) => cell.rowIndex))).sort(
    (a, b) => a - b
  );
  return {
    cells: cells.length,
    rows: rowIndices.length,
    rowIndices,
    details: cells
  };
};
