import type { DebugPackageInput, buildDebugPackage } from './debugPackage';
import type { TranslationIssueCase, TranslationIssueType } from './issueCases';
import { isLikelyTargetLanguage } from './language';
import { PLACEHOLDER_REGEX } from './quality';

export type RegressionAssertion =
  | 'bad-fails-target-language'
  | 'expected-passes-target-language'
  | 'placeholder-cleaned'
  | 'number-tokens-preserved'
  | 'requires-human-review';

export interface TranslationRegressionCase {
  schema: 'poct.translation_regression_case.v1';
  id: string;
  sourceHash: string;
  documentKind: TranslationIssueCase['documentKind'];
  targetLang: string;
  issueType: TranslationIssueType;
  locationLabel: string;
  sourceText: string;
  badTranslation: string;
  expectedTranslation: string;
  assertions: RegressionAssertion[];
  origin: 'issue-case' | 'debug-package';
  appVersion?: string;
  model?: string;
  notes?: string;
}

export interface RegressionAssertionFailure {
  id: string;
  assertion: RegressionAssertion;
  message: string;
}

const normalizeText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const numberTokenRegex = /(?:\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(?:%|°C|mg|ml|mmol|g|kg|mm|cm|μl|ul|µl|L|mL)?)/gi;

export const extractNumberTokens = (value: string) =>
  Array.from(normalizeText(value).matchAll(numberTokenRegex))
    .map((match) => normalizeText(match[0]).replace(/\s+/g, ''))
    .filter(Boolean);

const defaultAssertionsForIssueType = (
  issueType: TranslationIssueType,
  sourceText: string
): RegressionAssertion[] => {
  if (issueType === 'non-target-residual') {
    return ['bad-fails-target-language', 'expected-passes-target-language'];
  }
  if (issueType === 'placeholder') {
    return ['placeholder-cleaned'];
  }
  if (issueType === 'number-unit-format' || extractNumberTokens(sourceText).length > 0) {
    return ['number-tokens-preserved', 'expected-passes-target-language'];
  }
  if (issueType === 'terminology' || issueType === 'translation-memory' || issueType === 'accuracy' || issueType === 'style') {
    return ['expected-passes-target-language'];
  }
  return ['requires-human-review'];
};

export const buildRegressionCaseFromIssueCase = (
  issueCase: TranslationIssueCase,
  origin: TranslationRegressionCase['origin'] = 'issue-case'
): TranslationRegressionCase => ({
  schema: 'poct.translation_regression_case.v1',
  id: issueCase.id,
  sourceHash: issueCase.sourceHash,
  documentKind: issueCase.documentKind,
  targetLang: issueCase.targetLang,
  issueType: issueCase.issueType,
  locationLabel: issueCase.locationLabel,
  sourceText: issueCase.sourceText,
  badTranslation: issueCase.badTranslation,
  expectedTranslation: issueCase.correctedTranslation,
  assertions: defaultAssertionsForIssueType(issueCase.issueType, issueCase.sourceText),
  origin,
  appVersion: issueCase.appVersion,
  model: issueCase.model,
  notes: issueCase.notes
});

export const buildRegressionCasesFromIssueCases = (cases: TranslationIssueCase[]) =>
  cases
    .filter((item) => item.sourceText && item.correctedTranslation)
    .map((item) => buildRegressionCaseFromIssueCase(item));

type DebugPackageLike = ReturnType<typeof buildDebugPackage>;

const isTranslationIssueCase = (value: unknown): value is TranslationIssueCase => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TranslationIssueCase>;
  return Boolean(item.id && item.sourceHash && item.documentKind && item.targetLang && item.sourceText);
};

export const buildRegressionCasesFromDebugPackage = (
  debugPackage: DebugPackageLike | DebugPackageInput
): TranslationRegressionCase[] => {
  const packageLike = debugPackage as DebugPackageLike;
  const issueCases = packageLike.issueCases?.cases || (debugPackage as DebugPackageInput).issueCases || [];
  return issueCases
    .filter(isTranslationIssueCase)
    .filter((item) => item.correctedTranslation)
    .map((item) => buildRegressionCaseFromIssueCase(item, 'debug-package'));
};

export const serializeRegressionCasesJsonl = (cases: TranslationRegressionCase[]) =>
  cases.map((item) => JSON.stringify(item)).join('\n');

export const parseRegressionCasesJsonl = (raw: string): TranslationRegressionCase[] =>
  raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TranslationRegressionCase);

export const runRegressionCaseAssertions = (
  regressionCase: TranslationRegressionCase
): RegressionAssertionFailure[] => {
  const failures: RegressionAssertionFailure[] = [];
  const fail = (assertion: RegressionAssertion, message: string) => {
    failures.push({ id: regressionCase.id, assertion, message });
  };

  regressionCase.assertions.forEach((assertion) => {
    if (assertion === 'bad-fails-target-language') {
      if (isLikelyTargetLanguage(regressionCase.badTranslation, regressionCase.targetLang as any)) {
        fail(assertion, 'Bad translation no longer fails target-language detection.');
      }
      return;
    }
    if (assertion === 'expected-passes-target-language') {
      if (!isLikelyTargetLanguage(regressionCase.expectedTranslation, regressionCase.targetLang as any)) {
        fail(assertion, 'Expected translation does not pass target-language detection.');
      }
      return;
    }
    if (assertion === 'placeholder-cleaned') {
      if (PLACEHOLDER_REGEX.test(regressionCase.expectedTranslation)) {
        fail(assertion, 'Expected translation still contains protected placeholder token residue.');
      }
      return;
    }
    if (assertion === 'number-tokens-preserved') {
      const sourceTokens = extractNumberTokens(regressionCase.sourceText);
      const expectedCompact = normalizeText(regressionCase.expectedTranslation).replace(/\s+/g, '');
      const missing = sourceTokens.filter((token) => !expectedCompact.includes(token));
      if (missing.length) {
        fail(assertion, `Expected translation is missing number/unit tokens: ${missing.join(', ')}`);
      }
    }
  });

  return failures;
};

export const runRegressionCases = (cases: TranslationRegressionCase[]) => {
  const failures = cases.flatMap(runRegressionCaseAssertions);
  return {
    total: cases.length,
    passed: cases.length - new Set(failures.map((item) => item.id)).size,
    failed: new Set(failures.map((item) => item.id)).size,
    failures
  };
};
