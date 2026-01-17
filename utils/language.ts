import { POCTRecord, TargetLanguage } from "../types";

export interface UntranslatedCell {
  rowIndex: number;
  columnKey: string;
  value: string;
}

export const detectUntranslatedCells = (
  records: POCTRecord[],
  targetLang: TargetLanguage
): UntranslatedCell[] => {
  if (!records || records.length === 0) return [];
  if (targetLang?.toLowerCase().includes("chinese")) return [];

  const flagged: UntranslatedCell[] = [];
  records.forEach((row, rowIndex) => {
    Object.entries(row).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (containsSourceLanguage(trimmed)) {
        flagged.push({ rowIndex, columnKey: key, value: trimmed });
      }
    });
  });

  return flagged;
};

const containsSourceLanguage = (text: string) => {
  return /[\u4e00-\u9fff]/.test(text);
};
