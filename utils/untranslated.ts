import { POCTRecord, TargetLanguage, UntranslatedSummary } from "../types";
import { detectUntranslatedCells } from "./language";

export const summarizeUntranslated = (
  records: POCTRecord[],
  targetLang: TargetLanguage
): UntranslatedSummary => {
  const cells = detectUntranslatedCells(records, targetLang);
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
