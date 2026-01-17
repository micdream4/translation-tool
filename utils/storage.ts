import { POCTRecord, TargetLanguage } from "../types";

const STORAGE_PREFIX = "poct_translation_progress_";

export interface TranslationProgressSnapshot {
  targetLang: TargetLanguage;
  records: POCTRecord[];
  translatedFlags?: boolean[];
  missingRows?: number[];
  updatedAt: number;
}

export interface TranslationProgressPayload {
  records: POCTRecord[];
  translatedFlags?: boolean[];
  missingRows?: number[];
}

const getKey = (fileId: string, targetLang: TargetLanguage) =>
  `${STORAGE_PREFIX}${fileId}_${targetLang}`;

export const saveTranslationProgress = (
  fileId: string | null,
  targetLang: TargetLanguage,
  payload: TranslationProgressPayload
) => {
  if (!fileId || typeof window === "undefined") return;
  try {
    const snapshot: TranslationProgressSnapshot = {
      targetLang,
      records: payload.records,
      translatedFlags: payload.translatedFlags,
      missingRows: payload.missingRows,
      updatedAt: Date.now()
    };
    localStorage.setItem(getKey(fileId, targetLang), JSON.stringify(snapshot));
  } catch (err) {
    console.warn("Failed to save translation progress:", err);
  }
};

export const loadTranslationProgress = (
  fileId: string | null,
  targetLang: TargetLanguage
): TranslationProgressSnapshot | null => {
  if (!fileId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getKey(fileId, targetLang));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Backward compatibility: older snapshot only stored records array
      return {
        targetLang,
        records: parsed,
        updatedAt: Date.now()
      };
    }
    return parsed as TranslationProgressSnapshot;
  } catch (err) {
    console.warn("Failed to load translation progress:", err);
    return null;
  }
};

export const clearTranslationProgress = (
  fileId: string | null,
  targetLang?: TargetLanguage
) => {
  if (!fileId || typeof window === "undefined") return;
  try {
    if (targetLang) {
      localStorage.removeItem(getKey(fileId, targetLang));
    } else {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(`${STORAGE_PREFIX}${fileId}_`)) {
          localStorage.removeItem(key);
        }
      });
    }
  } catch (err) {
    console.warn("Failed to clear translation progress:", err);
  }
};
