import { POCTRecord } from '../types';
import { rowsToQualityUnits } from './adapters';
import type {
  QualityCheckInput,
  QualityCheckOptions,
  QualityIssue,
  QualityIssueType,
  QualityReport,
  QualitySeverity,
  QualityUnit
} from './types';
import { isLikelyTargetLanguage } from '../utils/language';
import {
  getSourceUiLabelCandidates,
  hasUntranslatedUiLabelResidue,
  isLikelyIdentifier,
  isProtectedUiLabel,
  stripUiLabels,
  stripProtectedTerms,
  stripPreservedUiLabels
} from '../utils/translationTokens';
import { isChineseTarget } from '../utils/targetLanguage';

export type {
  QualityCheckInput,
  QualityCheckOptions,
  QualityIssue,
  QualityIssueType,
  QualityReport,
  QualitySeverity,
  QualityUnit
} from './types';

const CHINESE_REGEX = /[\u4e00-\u9fff]/;
export const PLACEHOLDER_REGEX =
  /(?:_+\s*(?:TKN|ID|FMT|TAG)(?:\s*[_ ]\s*\d+)?\s*_+|(?:TKN|ID|FMT|TAG)\s*[_ ]\s*\d+\s*_*)/i;
const MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX =
  /\b(?:WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC)\s+\d+_+\b/i;
const MEDICAL_CODE_HASH_ARTIFACT_REGEX =
  /\b(?:WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC)_+\b/i;
const EG_REGEX = /\be\s*\.\s*g\s*\./i;
const EXTRA_SPACE_REGEX = / {2,}/;
const SPACE_BEFORE_PUNCT_REGEX = /\s+[,.;:!?]/;
const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/gi;
const LETTER_DIGIT_SPACE_REGEX = /\b[A-Za-z]\s+\d{1,3}\b|\b\d{1,3}\s+[A-Za-z]\b/;
const SAFE_MEDICAL_SPACING_REGEX = /\b(?:B\s*12|B\s*6|G\s*6|P\s*50)\b/i;
const SAFE_NUMBER_UNIT_SPACING_REGEX =
  /\b\d+(?:[.,]\d+)?\s+(?:V|Hz|Гц|kg|g|mg|mL|ml|L|mm|cm|pg|fL|dBA)\b/gi;
const SAFE_STANDARD_SPACING_REGEX =
  /\b(?:EN|IEC|ISO|GB|YY)\s+\d[\d-]*(?::\s?\d{4})?/gi;
const SAFE_LATIN_ABBREVIATION_REGEX = /\b(?:e\.g\.|i\.e\.|etc\.|vs\.|fig\.|no\.)/gi;
const GLUED_PUNCT_REGEX = /\b[A-Za-z]+[,.:][A-Za-z]+\b/;
const CAMEL_GLUE_REGEX = /\b[a-z]{2,}[A-Z][a-z]+\b/;
const UPPER_ABBR_GLUE_REGEX = /\b(?:[A-Z]{2,}\d*(?:\/[A-Z]+)?)(?:[A-Z][a-z]{2,}|[a-z]{2,})\b/;
const DIGIT_BOUNDARY_GLUE_REGEX =
  /\b(?:[a-z]{2,}\d+(?:[-/.]\d+)*[A-Za-z]{2,}|[A-Z][a-z]{3,}\d+|[A-Za-z]{3,}\d+[A-Za-z]{2,})\b/;
const LOWER_COMPOUND_GLUE_REGEX =
  /\b(?:connectthe|intothe|displaywbc|usesledlight|providesusbinterface|withtcp\/ipprotocol|withgb\/t|andgb\/t|thedcpower|cbcdetection|cbctest|pltthe|aianalysis|retand|supplyrequirements|compositiondescription|routineimaging|fluorescenceimage|andperformmaintenance|powerswitchto|tostart|is1year|enter\d+(?:[-/.]\d+)*digits|than\d+digits)\b/i;
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

const stripUrls = (value: string) => String(value || '').replace(URL_REGEX, ' ').replace(/ {2,}/g, ' ');

const shouldLockCell = (key: string, value: unknown) => {
  if (typeof value !== 'string') return false;
  if (!value.trim()) return false;
  if (CHINESE_REGEX.test(value)) return false;
  if (LOCKED_KEY_REGEX.test(key)) return true;
  return isLikelyIdentifier(value);
};

const isTranslatableSourceCell = (key: string, value: unknown) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (shouldLockCell(key, value)) return false;
  return !isLikelyIdentifier(trimmed);
};

const createQualityTotals = (rowsScanned: number): QualityReport['totals'] => ({
  cellsScanned: 0,
  rowsScanned,
  chineseCells: 0,
  chineseRows: 0,
  placeholderCells: 0,
  placeholderRows: 0,
  idMismatches: 0,
  idMismatchRows: 0,
  spacingIssues: 0,
  spacingRows: 0,
  spacingHigh: 0,
  spacingMedium: 0,
  spacingLow: 0,
  emptyTranslations: 0,
  emptyTranslationRows: 0,
  structureMismatches: 0,
  structureMismatchRows: 0,
  nonTargetCells: 0,
  nonTargetRows: 0
});

const createQualityIssues = (): QualityReport['issues'] => ({
  chinese: [],
  placeholders: [],
  idMismatch: [],
  spacing: [],
  emptyTranslations: [],
  structureMismatches: [],
  nonTargetLanguage: []
});

export const hasSpacingIssue = (value: string) => {
  return Boolean(getSpacingSeverity(value));
};

const normalizeAutoFixablePunctuationSpacing = (value: string) =>
  String(value || '')
    .replace(/\b([eE])\s*\.\s*g\s*\.\s*,/g, '$1.g.,')
    .replace(/\b([eE])\s*\.\s*g\s*\./g, '$1.g.')
    .replace(/\b([iI])\s*\.\s*e\s*\.\s*,/g, '$1.e.,')
    .replace(/\b([iI])\s*\.\s*e\s*\./g, '$1.e.')
    .replace(/\b(etc|vs|fig|no)\.\s+([,;:])/gi, '$1.$2')
    .replace(/\bCo\s*\.\s*,\s*Ltd\b(?:\s*\.)+/g, 'Co., Ltd.')
    .replace(/\s+([,.;:!?])/g, '$1');

const getSpacingCheckValue = (value: string) =>
  stripUrls(normalizeAutoFixablePunctuationSpacing(value))
    .replace(SAFE_NUMBER_UNIT_SPACING_REGEX, 'SAFE')
    .replace(SAFE_STANDARD_SPACING_REGEX, 'SAFE')
    .replace(SAFE_LATIN_ABBREVIATION_REGEX, 'SAFE');

export const getSpacingSeverity = (value: string): QualitySeverity | null => {
  if (hasGlueIssue(value)) return 'high';
  const checkValue = getSpacingCheckValue(value);
  if (EXTRA_SPACE_REGEX.test(checkValue) || SPACE_BEFORE_PUNCT_REGEX.test(checkValue) || EG_REGEX.test(checkValue)) {
    return 'medium';
  }
  if (LETTER_DIGIT_SPACE_REGEX.test(checkValue)) {
    if (SAFE_MEDICAL_SPACING_REGEX.test(checkValue)) return null;
    return 'medium';
  }
  return null;
};

export const hasGlueIssue = (value: string) => {
  const checkValue = stripUrls(normalizeAutoFixablePunctuationSpacing(value)).replace(SAFE_LATIN_ABBREVIATION_REGEX, 'SAFE');
  return (
    GLUED_PUNCT_REGEX.test(checkValue) ||
    CAMEL_GLUE_REGEX.test(checkValue) ||
    UPPER_ABBR_GLUE_REGEX.test(checkValue) ||
    DIGIT_BOUNDARY_GLUE_REGEX.test(checkValue) ||
    LOWER_COMPOUND_GLUE_REGEX.test(checkValue)
  );
};

const stripTargetLanguageNoise = (translatedText: string, originalText = '') => {
  const sourceLabels = getSourceUiLabelCandidates(originalText).filter(isProtectedUiLabel);
  return stripUiLabels(stripProtectedTerms(stripPreservedUiLabels(translatedText)), sourceLabels).trim();
};

const shouldCheckTargetLanguage = (unit: QualityUnit) => {
  if (typeof unit.translatedValue !== 'string') return false;
  const translatedText = unit.translatedText.trim();
  if (!translatedText) return false;
  if (shouldLockCell(unit.columnKey, unit.originalValue)) return false;
  const unprotectedText = stripTargetLanguageNoise(translatedText, unit.originalText);
  if (!unprotectedText) return false;
  return !isLikelyIdentifier(unprotectedText);
};

export const runQualityChecksOnUnits = (
  input: QualityCheckInput,
  options: QualityCheckOptions = {}
): QualityReport => {
  const totals = createQualityTotals(input.rowsScanned);
  const issues = createQualityIssues();

  const chineseRows = new Set<number>();
  const placeholderRows = new Set<number>();
  const idMismatchRows = new Set<number>();
  const spacingRows = new Set<number>();
  const emptyTranslationRows = new Set<number>();
  const structureMismatchRows = new Set<number>();
  const nonTargetRows = new Set<number>();

  input.units.forEach((unit) => {
    if (unit.structureOnly) {
      totals.structureMismatches += 1;
      structureMismatchRows.add(unit.rowIndex);
      issues.structureMismatches.push({
        rowIndex: unit.rowIndex,
        columnKey: '__ROW__',
        locationLabel: unit.locationLabel,
        value: unit.translatedText,
        original: unit.originalText,
        type: 'structureMismatch'
      });
      return;
    }

    if (unit.hasOriginal !== unit.hasTranslated) {
      totals.structureMismatches += 1;
      structureMismatchRows.add(unit.rowIndex);
      issues.structureMismatches.push({
        rowIndex: unit.rowIndex,
        columnKey: unit.columnKey,
        locationLabel: unit.locationLabel,
        value: unit.hasTranslated ? 'Unexpected target column' : 'Missing target column',
        original: unit.originalText,
        type: 'structureMismatch'
      });
    }

    if (isTranslatableSourceCell(unit.columnKey, unit.originalValue)) {
      const translatedText = unit.translatedText.trim();
      if (!translatedText) {
        totals.emptyTranslations += 1;
        emptyTranslationRows.add(unit.rowIndex);
        issues.emptyTranslations.push({
          rowIndex: unit.rowIndex,
          columnKey: unit.columnKey,
          locationLabel: unit.locationLabel,
          value: '',
          original: unit.originalText,
          type: 'emptyTranslation'
        });
      }
    }

    if (typeof unit.translatedValue !== 'string') return;
    totals.cellsScanned += 1;

    if (!isChineseTarget(options.targetLang) && CHINESE_REGEX.test(unit.translatedText)) {
      totals.chineseCells += 1;
      chineseRows.add(unit.rowIndex);
      issues.chinese.push({
        rowIndex: unit.rowIndex,
        columnKey: unit.columnKey,
        locationLabel: unit.locationLabel,
        value: unit.translatedText,
        original: unit.originalText,
        type: 'chinese'
      });
    }

    const targetLanguageCheckText = stripTargetLanguageNoise(unit.translatedText, unit.originalText);
    const hasUiLabelResidue = hasUntranslatedUiLabelResidue(
      unit.translatedText,
      unit.originalText,
      options.targetLang
    );
    if (
      options.targetLang &&
      shouldCheckTargetLanguage(unit) &&
      (!isLikelyTargetLanguage(targetLanguageCheckText, options.targetLang) || hasUiLabelResidue)
    ) {
      totals.nonTargetCells += 1;
      nonTargetRows.add(unit.rowIndex);
      issues.nonTargetLanguage.push({
        rowIndex: unit.rowIndex,
        columnKey: unit.columnKey,
        locationLabel: unit.locationLabel,
        value: unit.translatedText,
        original: unit.originalText,
        type: 'nonTargetLanguage'
      });
    }

    if (
      PLACEHOLDER_REGEX.test(unit.translatedText) ||
      MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX.test(unit.translatedText) ||
      MEDICAL_CODE_HASH_ARTIFACT_REGEX.test(unit.translatedText)
    ) {
      totals.placeholderCells += 1;
      placeholderRows.add(unit.rowIndex);
      issues.placeholders.push({
        rowIndex: unit.rowIndex,
        columnKey: unit.columnKey,
        locationLabel: unit.locationLabel,
        value: unit.translatedText,
        original: unit.originalText,
        type: 'placeholder'
      });
    }

    const spacingText = unit.translatedText.trim();
    const shouldSkipSpacingCheck =
      shouldLockCell(unit.columnKey, unit.originalValue) || isLikelyIdentifier(spacingText);
    const spacingSeverity = spacingText && !shouldSkipSpacingCheck ? getSpacingSeverity(spacingText) : null;
    if (spacingSeverity) {
      totals.spacingIssues += 1;
      spacingRows.add(unit.rowIndex);
      if (spacingSeverity === 'high') totals.spacingHigh += 1;
      if (spacingSeverity === 'medium') totals.spacingMedium += 1;
      if (spacingSeverity === 'low') totals.spacingLow += 1;
      issues.spacing.push({
        rowIndex: unit.rowIndex,
        columnKey: unit.columnKey,
        locationLabel: unit.locationLabel,
        value: unit.translatedText,
        original: unit.originalText,
        type: 'spacing',
        severity: spacingSeverity
      });
    }

    if (shouldLockCell(unit.columnKey, unit.originalValue) && unit.translatedValue !== unit.originalValue) {
      totals.idMismatches += 1;
      idMismatchRows.add(unit.rowIndex);
      issues.idMismatch.push({
        rowIndex: unit.rowIndex,
        columnKey: unit.columnKey,
        locationLabel: unit.locationLabel,
        value: unit.translatedText,
        original: unit.originalText,
        type: 'idMismatch'
      });
    }
  });

  totals.chineseRows = chineseRows.size;
  totals.placeholderRows = placeholderRows.size;
  totals.idMismatchRows = idMismatchRows.size;
  totals.spacingRows = spacingRows.size;
  totals.emptyTranslationRows = emptyTranslationRows.size;
  totals.structureMismatchRows = structureMismatchRows.size;
  totals.nonTargetRows = nonTargetRows.size;

  return {
    totals,
    issues
  };
};

export const runQualityChecks = (
  original: POCTRecord[],
  translated: POCTRecord[],
  options: QualityCheckOptions = {}
): QualityReport => runQualityChecksOnUnits(rowsToQualityUnits(original, translated, 'generic'), options);

export const collectPlaceholderIssues = (
  original: POCTRecord[],
  translated: POCTRecord[]
) => runQualityChecks(original, translated).issues.placeholders;
