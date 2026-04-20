import { POCTRecord, TargetLanguage } from "../types";
import { getExactSeedTranslation } from "./seedTerminology";

export const normalizeTerminology = (
  record: POCTRecord,
  targetLang: TargetLanguage,
  originalRecord?: POCTRecord
): POCTRecord => {
  const normalized: POCTRecord = { ...record };
  if (!originalRecord) {
    return normalized;
  }

  Object.entries(record || {}).forEach(([key, value]) => {
    if (typeof value !== "string") return;
    const sourceValue = originalRecord[key];
    if (typeof sourceValue !== "string") return;
    const exact = getExactSeedTranslation(sourceValue, targetLang);
    if (exact) {
      normalized[key] = exact;
    }
  });

  return normalized;
};
