import type { TranslationMemoryPair } from './translationMemory';
import type { TranslationIssueCase, TranslationIssueType } from './issueCases';

export interface TerminologyCandidate {
  sourceText: string;
  targetText: string;
  targetLang: string;
  issueIds: string[];
  confidence: 'high' | 'medium';
  reason: string;
}

export interface QaRuleCandidate {
  ruleType:
    | 'target-language-residual'
    | 'placeholder-preservation'
    | 'number-unit-preservation'
    | 'layout-preservation'
    | 'human-review-sample';
  targetLang: string;
  issueType: TranslationIssueType;
  examples: Array<{
    issueId: string;
    sourceText: string;
    badTranslation: string;
    correctedTranslation: string;
    locationLabel: string;
  }>;
  suggestion: string;
}

export interface IssueAssetPackage {
  schema: 'poct.translation_issue_assets.v1';
  generatedAt: string;
  counts: {
    issueCases: number;
    translationMemoryPairs: number;
    terminologyCandidates: number;
    qaRuleCandidates: number;
  };
  translationMemoryPairs: TranslationMemoryPair[];
  terminologyCandidates: TerminologyCandidate[];
  qaRuleCandidates: QaRuleCandidate[];
}

const normalizeInline = (value: string) =>
  String(value || '').replace(/\s+/g, ' ').trim();

const isShortTermLike = (value: string) => {
  const normalized = normalizeInline(value);
  if (!normalized) return false;
  if (normalized.length > 48) return false;
  if (/[.!?。！？]\s*$/.test(normalized)) return false;
  return normalized.split(/\s+/g).length <= 5;
};

export const buildTranslationMemoryPairsFromIssueCases = (
  cases: TranslationIssueCase[],
  fileName?: string
): TranslationMemoryPair[] =>
  cases
    .filter((item) => item.sourceText.trim() && item.correctedTranslation.trim())
    .map((item) => ({
      sourceText: item.sourceText,
      targetText: item.correctedTranslation,
      targetLang: item.targetLang,
      model: item.model,
      documentKind: item.documentKind,
      fileName
    }));

export const buildTerminologyCandidatesFromIssueCases = (
  cases: TranslationIssueCase[]
): TerminologyCandidate[] => {
  const grouped = new Map<string, TerminologyCandidate>();
  cases.forEach((item) => {
    if (!item.sourceText.trim() || !item.correctedTranslation.trim()) return;
    if (item.issueType !== 'terminology' && !isShortTermLike(item.sourceText)) return;
    const key = `${item.targetLang}\u0000${normalizeInline(item.sourceText).toLowerCase()}\u0000${normalizeInline(item.correctedTranslation).toLowerCase()}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.issueIds.push(item.id);
      existing.confidence = 'high';
      return;
    }
    grouped.set(key, {
      sourceText: normalizeInline(item.sourceText),
      targetText: normalizeInline(item.correctedTranslation),
      targetLang: item.targetLang,
      issueIds: [item.id],
      confidence: item.issueType === 'terminology' ? 'high' : 'medium',
      reason: item.issueType === 'terminology' ? 'explicit terminology correction' : 'short repeated term-like correction'
    });
  });
  return [...grouped.values()];
};

const qaRuleTypeForIssue = (issueType: TranslationIssueType): QaRuleCandidate['ruleType'] => {
  if (issueType === 'non-target-residual') return 'target-language-residual';
  if (issueType === 'placeholder') return 'placeholder-preservation';
  if (issueType === 'number-unit-format') return 'number-unit-preservation';
  if (issueType === 'layout') return 'layout-preservation';
  return 'human-review-sample';
};

const qaSuggestionForIssue = (issueType: TranslationIssueType) => {
  if (issueType === 'non-target-residual') return 'Add target-language residual detection or language profile entries for these examples.';
  if (issueType === 'placeholder') return 'Add or tighten placeholder protection and post-translation placeholder validation.';
  if (issueType === 'number-unit-format') return 'Add number/unit preservation checks for these source and target formats.';
  if (issueType === 'layout') return 'Add document adapter or export structure regression coverage for these examples.';
  if (issueType === 'terminology') return 'Promote these examples to glossary or terminology seed entries.';
  if (issueType === 'translation-memory') return 'Promote these examples to translation memory and same-source reuse tests.';
  return 'Keep these examples as human-reviewed samples and consider model prompt or sample review rules.';
};

export const buildQaRuleCandidatesFromIssueCases = (
  cases: TranslationIssueCase[]
): QaRuleCandidate[] => {
  const grouped = new Map<string, QaRuleCandidate>();
  cases.forEach((item) => {
    if (!item.sourceText.trim() && !item.badTranslation.trim() && !item.correctedTranslation.trim()) return;
    const ruleType = qaRuleTypeForIssue(item.issueType);
    const key = `${item.targetLang}\u0000${item.issueType}\u0000${ruleType}`;
    const existing = grouped.get(key);
    const example = {
      issueId: item.id,
      sourceText: item.sourceText,
      badTranslation: item.badTranslation,
      correctedTranslation: item.correctedTranslation,
      locationLabel: item.locationLabel
    };
    if (existing) {
      if (existing.examples.length < 20) existing.examples.push(example);
      return;
    }
    grouped.set(key, {
      ruleType,
      targetLang: item.targetLang,
      issueType: item.issueType,
      examples: [example],
      suggestion: qaSuggestionForIssue(item.issueType)
    });
  });
  return [...grouped.values()];
};

export const buildIssueAssetPackage = (
  cases: TranslationIssueCase[],
  options: { generatedAt?: Date; fileName?: string } = {}
): IssueAssetPackage => {
  const translationMemoryPairs = buildTranslationMemoryPairsFromIssueCases(cases, options.fileName);
  const terminologyCandidates = buildTerminologyCandidatesFromIssueCases(cases);
  const qaRuleCandidates = buildQaRuleCandidatesFromIssueCases(cases);
  return {
    schema: 'poct.translation_issue_assets.v1',
    generatedAt: (options.generatedAt || new Date()).toISOString(),
    counts: {
      issueCases: cases.length,
      translationMemoryPairs: translationMemoryPairs.length,
      terminologyCandidates: terminologyCandidates.length,
      qaRuleCandidates: qaRuleCandidates.length
    },
    translationMemoryPairs,
    terminologyCandidates,
    qaRuleCandidates
  };
};

export const serializeIssueAssetPackage = (assetPackage: IssueAssetPackage) =>
  JSON.stringify(assetPackage, null, 2);
