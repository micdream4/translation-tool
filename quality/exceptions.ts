// "Confirmed as correct" exceptions: findings a person reviewed and accepted.
// Once accepted, the same (check type, target language, translated text) is not reported again
// by any entry point (Excel, DOCX, PDF), and repeated retries stop. Accepted findings are also
// exportable as rule golden cases (expect: "pass") so the rules can learn from them.
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
}

const STORAGE_KEY = 'poct.quality_exceptions.v1';

// Finding categories in the report use slightly different names than the core issue types.
const TYPE_ALIASES: Record<string, string> = {
  nonTarget: 'nonTargetLanguage',
  placeholder: 'placeholders'
};
const normalizeType = (type: string) => TYPE_ALIASES[type] || type;

export const buildQualityExceptionKey = (type: string, targetLang: string | undefined, translatedText: string) =>
  `${normalizeType(type)}|${String(targetLang || '').toLowerCase()}|${hashIssueText(translatedText)}`;

let cache: Map<string, QualityException> | null = null;

const getStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const load = () => {
  if (cache) return cache;
  cache = new Map();
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
  return cache;
};

const persist = () => {
  const storage = getStorage();
  if (!storage || !cache) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...cache.values()]));
  } catch {
    // Storage full or blocked: exceptions stay in memory for this session.
  }
};

export const isQualityExceptionAccepted = ({
  type,
  targetLang,
  translatedText
}: {
  type: string;
  targetLang?: string;
  translatedText: string;
}) => {
  const store = load();
  if (!store.size || !String(translatedText || '').trim()) return false;
  return store.has(buildQualityExceptionKey(type, targetLang, translatedText));
};

export const acceptQualityException = (input: Omit<QualityException, 'key' | 'createdAt'> & { createdAt?: string }) => {
  const store = load();
  const key = buildQualityExceptionKey(input.type, input.targetLang, input.translatedText);
  const entry: QualityException = {
    ...input,
    type: normalizeType(input.type),
    sourceText: normalizeIssueText(input.sourceText),
    translatedText: normalizeIssueText(input.translatedText),
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

export const listQualityExceptions = () => [...load().values()];

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
};
