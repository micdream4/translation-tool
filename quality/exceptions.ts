// "Confirmed as correct" exceptions: findings a person reviewed and accepted.
// Once accepted, the same (check type, target language, source text, translated text) is not
// reported again by any entry point (Excel, DOCX, PDF), and repeated retries stop. The source text
// is part of the key so one click cannot silence the same translation of a different sentence.
// Every confirmation stays "pending" (待审核) until it is reviewed into the rule golden set; until
// then the report and the export bar still list it, so a wrong click is visible and can be undone.
import { hashIssueText, normalizeIssueText } from '../utils/issueCases';

export interface QualityException {
  key: string;
  type: string;
  targetLang: string;
  sourceText: string;
  translatedText: string;
  createdAt: string;
  appVersion?: string;
  documentKind?: string;
  locationLabel?: string;
  /** Hash of the source text; absent on entries saved before v0.3.2 (those match any source). */
  sourceHash?: string;
  /** 'pending' until the confirmation is reviewed into the rule golden set. */
  reviewStatus?: 'pending' | 'reviewed';
  /** True once the shared store (Cloudflare) has this entry. */
  synced?: boolean;
}

const STORAGE_KEY = 'poct.quality_exceptions.v1';

// Finding categories in the report use slightly different names than the core issue types.
const TYPE_ALIASES: Record<string, string> = {
  nonTarget: 'nonTargetLanguage',
  placeholder: 'placeholders'
};
const normalizeType = (type: string) => TYPE_ALIASES[type] || type;

const buildTranslatedKey = (type: string, targetLang: string | undefined, translatedText: string) =>
  `${normalizeType(type)}|${String(targetLang || '').toLowerCase()}|${hashIssueText(translatedText)}`;

export const buildQualityExceptionKey = (
  type: string,
  targetLang: string | undefined,
  translatedText: string,
  sourceText = ''
) => {
  const base = buildTranslatedKey(type, targetLang, translatedText);
  return String(sourceText || '').trim() ? `${base}|${hashIssueText(sourceText)}` : base;
};

let cache: Map<string, QualityException> | null = null;
// translated-text key -> exceptions with that translation (any source)
let byTranslated: Map<string, QualityException[]> | null = null;

const getStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const translatedKeyOf = (item: QualityException) => item.key.split('|').slice(0, 3).join('|');

const rebuildIndex = () => {
  byTranslated = new Map();
  cache?.forEach((item) => {
    const key = translatedKeyOf(item);
    byTranslated!.set(key, [...(byTranslated!.get(key) || []), item]);
  });
};

const load = () => {
  if (cache) return cache;
  cache = new Map();
  byTranslated = new Map();
  const storage = getStorage();
  if (!storage) return cache;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) {
      parsed.forEach((item: QualityException) => {
        if (item && typeof item.key === 'string') cache!.set(item.key, item);
      });
    }
  } catch {
    // Corrupt storage: start empty rather than failing quality checks.
  }
  rebuildIndex();
  return cache;
};

const persist = () => {
  rebuildIndex();
  const storage = getStorage();
  if (!storage || !cache) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...cache.values()]));
  } catch {
    // Storage full or blocked: exceptions stay in memory for this session.
  }
};

/** The confirmation that covers this finding, if any. */
export const findQualityException = ({
  type,
  targetLang,
  translatedText,
  sourceText = ''
}: {
  type: string;
  targetLang?: string;
  translatedText: string;
  sourceText?: string;
}): QualityException | undefined => {
  const store = load();
  if (!store.size || !String(translatedText || '').trim()) return undefined;
  const candidates = byTranslated?.get(buildTranslatedKey(type, targetLang, translatedText)) || [];
  if (!candidates.length) return undefined;
  // Without source context (e.g. a scan of the translated file alone) the translation is the only key.
  if (!String(sourceText || '').trim()) return candidates[0];
  const sourceHash = hashIssueText(sourceText);
  return candidates.find((item) => !item.sourceHash || item.sourceHash === sourceHash);
};

export const isQualityExceptionAccepted = (input: {
  type: string;
  targetLang?: string;
  translatedText: string;
  sourceText?: string;
}) => Boolean(findQualityException(input));

export const acceptQualityException = (input: Omit<QualityException, 'key' | 'createdAt'> & { createdAt?: string }) => {
  const store = load();
  const key = buildQualityExceptionKey(input.type, input.targetLang, input.translatedText, input.sourceText);
  const entry: QualityException = {
    ...input,
    type: normalizeType(input.type),
    sourceText: normalizeIssueText(input.sourceText),
    translatedText: normalizeIssueText(input.translatedText),
    sourceHash: String(input.sourceText || '').trim() ? hashIssueText(input.sourceText) : undefined,
    reviewStatus: input.reviewStatus || 'pending',
    key,
    createdAt: input.createdAt || new Date().toISOString()
  };
  store.set(key, entry);
  persist();
  return entry;
};

export const removeQualityException = (key: string) => {
  const store = load();
  store.delete(key);
  persist();
};

export const listQualityExceptions = () =>
  [...load().values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

export const isPendingReview = (item: QualityException) => item.reviewStatus !== 'reviewed';

export const markQualityExceptionSynced = (key: string) => {
  const entry = load().get(key);
  if (!entry || entry.synced) return;
  entry.synced = true;
  persist();
};

/**
 * Merges the shared store into this browser. The shared store wins for entries it has
 * (review status included); synced local entries it no longer has were undone on another
 * device and are removed; unsynced local entries are kept and returned so they can be pushed.
 */
export const mergeRemoteQualityExceptions = (remote: QualityException[]) => {
  const store = load();
  const remoteKeys = new Set<string>();
  remote.forEach((item) => {
    if (!item || typeof item.key !== 'string' || !item.translatedText) return;
    remoteKeys.add(item.key);
    store.set(item.key, { ...item, synced: true });
  });
  [...store.values()].forEach((item) => {
    if (item.synced && !remoteKeys.has(item.key)) store.delete(item.key);
  });
  persist();
  return [...store.values()].filter((item) => !item.synced);
};

export const clearQualityExceptions = () => {
  cache = new Map();
  persist();
};

/** Accepted findings as rule golden cases, ready to append to fixtures/rule-golden-captured.jsonl. */
export const serializeExceptionsAsGoldenCases = (exceptions = listQualityExceptions()) =>
  exceptions
    .map((item) =>
      JSON.stringify({
        schema: 'poct.rule_golden_case.v1',
        id: `captured-${item.key.replace(/[^A-Za-z0-9-]+/g, '-')}`,
        targetLang: item.targetLang,
        category: 'captured_accepted',
        sourceText: item.sourceText,
        translatedText: item.translatedText,
        expect: 'pass',
        origin: 'user-accepted',
        acceptedType: item.type,
        createdAt: item.createdAt
      })
    )
    .join('\n');

/** Test helper: reset the in-memory cache (and storage, when present). */
export const resetQualityExceptionsForTest = () => {
  cache = null;
  byTranslated = null;
};
