import type { TargetLanguage } from "../types";
import {
  GENERATED_DO_NOT_TRANSLATE_SEED,
  GENERATED_GLOSSARY_SEED,
  type GeneratedGlossarySeedRow
} from "./generatedTerminology";

const LATIN_WORD_REGEX = /^[A-Za-z0-9 ()#%.,/+:-]+$/;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeText = (value: unknown) => String(value || "").trim();

const normalizeLanguageKey = (targetLang?: TargetLanguage) =>
  String(targetLang || "").trim().toLowerCase();

const getLanguageColumn = (targetLang?: TargetLanguage) => {
  const key = normalizeLanguageKey(targetLang);
  switch (key) {
    case "english":
      return "en_draft";
    case "spanish":
      return "es_draft";
    case "french":
      return "fr_draft";
    case "german":
      return "de_draft";
    case "italian":
      return "it_draft";
    case "portuguese":
      return "pt_draft";
    case "russian":
      return "ru_draft";
    case "turkish":
      return "tr_draft";
    default:
      return null;
  }
};

const getPreferredTerm = (
  entry: GeneratedGlossarySeedRow,
  targetLang?: TargetLanguage
) => {
  const column = getLanguageColumn(targetLang);
  if (!column) return "";
  return normalizeText(entry[column]);
};

const isWordLikeVariant = (value: string) => LATIN_WORD_REGEX.test(value);

const replaceVariant = (text: string, variant: string, preferred: string) => {
  if (!text || !variant || !preferred || variant === preferred) return text;
  const escaped = escapeRegExp(variant);
  const pattern = isWordLikeVariant(variant)
    ? new RegExp(`\\b${escaped}\\b`, "gi")
    : new RegExp(escaped, "g");
  return text.replace(pattern, preferred);
};

const collectRelevantEntries = (sourceText: string, targetLang?: TargetLanguage) => {
  const normalizedSource = normalizeText(sourceText);
  if (!normalizedSource) return [] as GeneratedGlossarySeedRow[];
  return GENERATED_GLOSSARY_SEED.filter((entry) => {
    const preferred = getPreferredTerm(entry, targetLang);
    return Boolean(entry.zh_source && preferred && normalizedSource.includes(entry.zh_source));
  });
};

export const getSeedProtectedTerms = () =>
  GENERATED_DO_NOT_TRANSLATE_SEED.map((entry) => normalizeText(entry.source_text)).filter(Boolean);

export const getExactSeedTranslation = (
  sourceText: string,
  targetLang?: TargetLanguage
) => {
  const normalizedSource = normalizeText(sourceText);
  if (!normalizedSource) return "";
  const entry = GENERATED_GLOSSARY_SEED.find(
    (item) => normalizeText(item.zh_source) === normalizedSource
  );
  return entry ? getPreferredTerm(entry, targetLang) : "";
};

export const enforceSeedTerminology = (
  sourceText: string,
  translatedText: string,
  targetLang?: TargetLanguage
) => {
  const original = normalizeText(sourceText);
  if (!original || !translatedText) return translatedText;

  const exact = getExactSeedTranslation(original, targetLang);
  if (exact) {
    return exact;
  }

  const relevantEntries = collectRelevantEntries(original, targetLang);
  if (!relevantEntries.length) return translatedText;

  let output = translatedText;
  relevantEntries.forEach((entry) => {
    const preferred = getPreferredTerm(entry, targetLang);
    if (!preferred) return;
    const variants = Array.from(
      new Set(
        [
          entry.zh_source,
          entry.en_draft,
          entry.es_draft,
          entry.fr_draft,
          entry.de_draft,
          entry.it_draft,
          entry.pt_draft,
          entry.ru_draft,
          entry.tr_draft
        ]
          .map((value) => normalizeText(value))
          .filter(Boolean)
      )
    ).sort((a, b) => b.length - a.length);

    variants.forEach((variant) => {
      output = replaceVariant(output, variant, preferred);
    });
  });

  return output;
};

export const getSeedGlossaryPrompt = (
  targetLang: TargetLanguage,
  sourceText?: string
) => {
  const column = getLanguageColumn(targetLang);
  if (!column) return "";

  const entries = sourceText
    ? collectRelevantEntries(sourceText, targetLang)
    : GENERATED_GLOSSARY_SEED.filter((entry) => Boolean(getPreferredTerm(entry, targetLang)));

  const lines = Array.from(
    new Set(
      entries
        .map((entry) => {
          const preferred = getPreferredTerm(entry, targetLang);
          if (!entry.zh_source || !preferred) return "";
          return `${entry.zh_source} -> ${preferred}`;
        })
        .filter(Boolean)
    )
  );

  return lines.join("\n");
};
