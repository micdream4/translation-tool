export type TranslationIssueType =
  | 'terminology'
  | 'translation-memory'
  | 'non-target-residual'
  | 'placeholder'
  | 'number-unit-format'
  | 'layout'
  | 'style'
  | 'accuracy';

export type TranslationIssueStatus =
  | 'new'
  | 'accepted'
  | 'converted-to-rule'
  | 'converted-to-test'
  | 'ignored';

export interface TranslationIssueCase {
  id: string;
  createdAt: string;
  appVersion: string;
  documentKind: 'excel' | 'docx' | 'pdf' | 'string-resource';
  targetLang: string;
  sourceText: string;
  badTranslation: string;
  correctedTranslation: string;
  issueType: TranslationIssueType;
  locationLabel: string;
  sourceHash: string;
  model?: string;
  promptProfile?: string;
  status: TranslationIssueStatus;
  notes?: string;
}

export interface TranslationIssueCaseInput {
  appVersion: string;
  documentKind: TranslationIssueCase['documentKind'];
  targetLang: string;
  sourceText: string;
  badTranslation: string;
  correctedTranslation: string;
  issueType: TranslationIssueType;
  locationLabel: string;
  model?: string;
  promptProfile?: string;
  notes?: string;
}

const ISSUE_CASES_STORAGE_KEY = 'poct.translation_issue_cases.v1';

export const normalizeIssueText = (value: string) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const hashIssueText = (value: string) => {
  const normalized = normalizeIssueText(value);
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(index);
  }
  return `${normalized.length}-${(hash >>> 0).toString(36)}`;
};

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const buildTranslationIssueCase = (
  input: TranslationIssueCaseInput,
  now: Date = new Date()
): TranslationIssueCase => {
  const sourceText = String(input.sourceText || '');
  const sourceHash = hashIssueText(sourceText);
  return {
    id: `issue-${now.getTime()}-${sourceHash}`,
    createdAt: now.toISOString(),
    appVersion: input.appVersion,
    documentKind: input.documentKind,
    targetLang: input.targetLang,
    sourceText,
    badTranslation: String(input.badTranslation || ''),
    correctedTranslation: String(input.correctedTranslation || ''),
    issueType: input.issueType,
    locationLabel: input.locationLabel,
    sourceHash,
    model: input.model,
    promptProfile: input.promptProfile,
    status: 'new',
    notes: input.notes
  };
};

export const loadTranslationIssueCases = (): TranslationIssueCase[] => {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(ISSUE_CASES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to load translation issue cases:', error);
    return [];
  }
};

const persistTranslationIssueCases = (cases: TranslationIssueCase[]) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ISSUE_CASES_STORAGE_KEY, JSON.stringify(cases));
};

export const saveTranslationIssueCase = (input: TranslationIssueCaseInput) => {
  const issueCase = buildTranslationIssueCase(input);
  try {
    const existing = loadTranslationIssueCases();
    persistTranslationIssueCases([issueCase, ...existing].slice(0, 1000));
  } catch (error) {
    console.warn('Failed to save translation issue case:', error);
  }
  return issueCase;
};

export const countTranslationIssueCases = () => loadTranslationIssueCases().length;

export const clearTranslationIssueCases = () => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(ISSUE_CASES_STORAGE_KEY);
};

export const serializeTranslationIssueCasesJsonl = (cases: TranslationIssueCase[]) =>
  cases.map((item) => JSON.stringify(item)).join('\n');
