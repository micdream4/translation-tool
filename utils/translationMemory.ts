import { TargetLanguage } from "../types";

const DB_NAME = "poct_translation_memory";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const DEFAULT_SOURCE_LANG = "auto";

export interface TranslationMemoryEntry {
  key: string;
  sourceLang: string;
  targetLang: TargetLanguage;
  normalizedSource: string;
  sourceText: string;
  targetText: string;
  model?: string;
  documentKind?: string;
  fileName?: string;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TranslationMemoryPair {
  sourceText: string;
  targetText: string;
  targetLang: TargetLanguage;
  sourceLang?: string;
  model?: string;
  documentKind?: string;
  fileName?: string;
}

export const normalizeMemorySource = (value: string) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const hashText = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

export const buildTranslationMemoryKey = (
  sourceText: string,
  targetLang: TargetLanguage,
  sourceLang: string = DEFAULT_SOURCE_LANG
) => {
  const normalized = normalizeMemorySource(sourceText);
  return `${sourceLang}::${targetLang}::${normalized.length}::${hashText(normalized)}`;
};

const getIndexedDb = (): IDBFactory | null => {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  return window.indexedDB;
};

const openDb = () =>
  new Promise<IDBDatabase | null>((resolve, reject) => {
    const indexedDb = getIndexedDb();
    if (!indexedDb) {
      resolve(null);
      return;
    }
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("targetLang", "targetLang", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | T
) => {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const completion = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const result = await run(store);
    await completion;
    return result;
  } finally {
    db.close();
  }
};

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const lookupTranslationMemoryBatch = async (
  items: Array<{ sourceText: string; targetLang: TargetLanguage; sourceLang?: string }>
) => {
  if (!items.length) return new Map<string, TranslationMemoryEntry>();
  const output = new Map<string, TranslationMemoryEntry>();
  try {
    await withStore("readwrite", async (store) => {
      await Promise.all(
        items.map(async (item) => {
          const sourceLang = item.sourceLang || DEFAULT_SOURCE_LANG;
          const normalizedSource = normalizeMemorySource(item.sourceText);
          if (!normalizedSource) return;
          const key = buildTranslationMemoryKey(item.sourceText, item.targetLang, sourceLang);
          const entry = await requestValue<TranslationMemoryEntry | undefined>(store.get(key));
          if (
            !entry ||
            entry.targetLang !== item.targetLang ||
            entry.sourceLang !== sourceLang ||
            entry.normalizedSource !== normalizedSource
          ) {
            return;
          }
          const updated: TranslationMemoryEntry = {
            ...entry,
            hitCount: (entry.hitCount || 0) + 1,
            updatedAt: Date.now()
          };
          store.put(updated);
          output.set(key, updated);
        })
      );
    });
  } catch (err) {
    console.warn("Failed to lookup translation memory:", err);
  }
  return output;
};

export const saveTranslationMemoryPairs = async (pairs: TranslationMemoryPair[]) => {
  const now = Date.now();
  const cleanPairs = pairs.filter((pair) => {
    const source = normalizeMemorySource(pair.sourceText);
    const target = String(pair.targetText || "").trim();
    return source && target && source !== normalizeMemorySource(target);
  });
  if (!cleanPairs.length) return 0;

  let saved = 0;
  try {
    await withStore("readwrite", async (store) => {
      await Promise.all(
        cleanPairs.map(async (pair) => {
          const sourceLang = pair.sourceLang || DEFAULT_SOURCE_LANG;
          const normalizedSource = normalizeMemorySource(pair.sourceText);
          const key = buildTranslationMemoryKey(pair.sourceText, pair.targetLang, sourceLang);
          const existing = await requestValue<TranslationMemoryEntry | undefined>(store.get(key));
          const entry: TranslationMemoryEntry = {
            key,
            sourceLang,
            targetLang: pair.targetLang,
            normalizedSource,
            sourceText: pair.sourceText,
            targetText: pair.targetText,
            model: pair.model,
            documentKind: pair.documentKind,
            fileName: pair.fileName,
            hitCount: existing?.hitCount || 0,
            createdAt: existing?.createdAt || now,
            updatedAt: now
          };
          store.put(entry);
          saved += 1;
        })
      );
    });
  } catch (err) {
    console.warn("Failed to save translation memory:", err);
  }
  return saved;
};

export const countTranslationMemoryEntries = async () => {
  try {
    const count = await withStore("readonly", (store) => requestValue<number>(store.count()));
    return count || 0;
  } catch (err) {
    console.warn("Failed to count translation memory:", err);
    return 0;
  }
};

export const clearTranslationMemory = async () => {
  try {
    await withStore("readwrite", (store) => requestValue(store.clear()));
  } catch (err) {
    console.warn("Failed to clear translation memory:", err);
  }
};
