export interface StringTranslationHistoryEntry {
  id: string;
  createdAt: number;
  source: string;
  outputs: Record<string, string>;
}

const STORAGE_KEY = "poct_string_history_v1";

export const loadStringHistory = (): StringTranslationHistoryEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StringTranslationHistoryEntry[];
  } catch (err) {
    console.warn("Failed to load string translation history:", err);
    return [];
  }
};

const saveStringHistory = (entries: StringTranslationHistoryEntry[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn("Failed to save string translation history:", err);
  }
};

export const appendStringHistory = (
  entry: StringTranslationHistoryEntry
): StringTranslationHistoryEntry[] => {
  const entries = loadStringHistory();
  entries.push(entry);
  saveStringHistory(entries);
  return entries;
};

export const clearStringHistory = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to clear string translation history:", err);
  }
};
