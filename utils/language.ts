import { POCTRecord, TargetLanguage } from "../types";
import { isLikelyIdentifier } from "./translationTokens";

export interface UntranslatedCell {
  rowIndex: number;
  columnKey: string;
  value: string;
}

type LangCode = "zh" | "en" | "es" | "fr" | "de" | "it" | "pt" | "ru" | "unknown";

const CJK_REGEX = /[\u4e00-\u9fff]/;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const LATIN_WORD_REGEX = /[A-Za-z\u00C0-\u024F]/;
const SHORT_CODE_REGEX = /^[A-Z0-9#%+_.\-\/]+$/;
const SYMBOL_ONLY_REGEX = /^[\s\-–—=+<>↑↓*·•.()（）【】[\]{}\\/]+$/;
const CODE_WITH_ARROW_REGEX = /^[A-Z]{1,6}[#%]?[↑↓]?$/
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;
const ID_TOKEN_REGEX = /^(id|uuid)$/i;

const LANGUAGE_HINTS: Record<Exclude<LangCode, "zh" | "ru" | "unknown">, string[]> = {
  en: [
    "the",
    "and",
    "of",
    "to",
    "in",
    "with",
    "possible",
    "suggests",
    "increase",
    "decrease",
    "elevated",
    "indicates",
    "seen",
    "likely",
    "mild",
    "moderate",
    "severe"
  ],
  es: [
    "el",
    "la",
    "los",
    "las",
    "de",
    "y",
    "en",
    "con",
    "posible",
    "sugiere",
    "aumento",
    "disminucion",
    "elevado",
    "indica",
    "leve",
    "moderado",
    "grave"
  ],
  fr: [
    "le",
    "la",
    "les",
    "de",
    "et",
    "en",
    "avec",
    "possible",
    "suggere",
    "augmentation",
    "diminution",
    "eleve",
    "indique",
    "leger",
    "modere",
    "grave"
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "mit",
    "bei",
    "moeglich",
    "erhoeht",
    "zunahme",
    "abnahme",
    "weist",
    "leicht",
    "maessig",
    "schwer"
  ],
  it: [
    "il",
    "la",
    "le",
    "di",
    "e",
    "con",
    "possibile",
    "suggerisce",
    "aumento",
    "diminuzione",
    "elevato",
    "indica",
    "lieve",
    "moderato",
    "grave"
  ],
  pt: [
    "o",
    "a",
    "os",
    "as",
    "de",
    "e",
    "em",
    "com",
    "possivel",
    "sugere",
    "aumento",
    "diminuicao",
    "elevado",
    "indica",
    "leve",
    "moderado",
    "grave"
  ]
};

const LANGUAGE_DIACRITICS: Record<
  Exclude<LangCode, "zh" | "ru" | "unknown">,
  RegExp
> = {
  en: /[A-Za-z]/,
  es: /[ñáéíóúü¡¿]/i,
  fr: /[éèêëàâçîïôûùüÿœ]/i,
  de: /[äöüß]/i,
  it: /[àèéìòù]/i,
  pt: /[ãõçáéíóúàâêô]/i
};

const normalizeLatin = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const tokenizeLatin = (text: string) =>
  normalizeLatin(text)
    .split(/[^a-z]+/g)
    .filter(Boolean);

const scoreLanguage = (
  tokens: string[],
  hints: string[],
  hasDiacritics: boolean
) => {
  if (!tokens.length) return hasDiacritics ? 2 : 0;
  const set = new Set(hints);
  let score = hasDiacritics ? 2 : 0;
  tokens.forEach((token) => {
    if (set.has(token)) score += 1;
  });
  return score;
};

const getLanguageScores = (
  text: string
): Array<{ lang: Exclude<LangCode, "zh" | "ru" | "unknown">; score: number }> => {
  const tokens = tokenizeLatin(text);
  return (Object.keys(LANGUAGE_HINTS) as Array<
    Exclude<LangCode, "zh" | "ru" | "unknown">
  >)
    .map((lang) => ({
      lang,
      score: scoreLanguage(tokens, LANGUAGE_HINTS[lang], LANGUAGE_DIACRITICS[lang].test(text))
    }))
    .sort((a, b) => b.score - a.score);
};

const detectLanguage = (text: string): LangCode => {
  if (CJK_REGEX.test(text)) return "zh";
  if (CYRILLIC_REGEX.test(text)) return "ru";

  if (!LATIN_WORD_REGEX.test(text)) return "unknown";
  const scores = getLanguageScores(text);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.score === 0) return "unknown";
  if (second && best.score === second.score) return "unknown";
  return best.lang;
};

const targetLangToCode = (targetLang: TargetLanguage): LangCode => {
  const normalized = String(targetLang || "").toLowerCase();
  if (normalized.includes("chinese")) return "zh";
  if (normalized.includes("english")) return "en";
  if (normalized.includes("spanish")) return "es";
  if (normalized.includes("french")) return "fr";
  if (normalized.includes("german")) return "de";
  if (normalized.includes("italian")) return "it";
  if (normalized.includes("portuguese")) return "pt";
  if (normalized.includes("russian")) return "ru";
  return "unknown";
};

export const isLikelyTargetLanguage = (text: string, targetLang: TargetLanguage) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (SYMBOL_ONLY_REGEX.test(trimmed)) return true;
  if (CODE_WITH_ARROW_REGEX.test(trimmed)) return true;
  if (!LATIN_WORD_REGEX.test(trimmed) && !CJK_REGEX.test(trimmed) && !CYRILLIC_REGEX.test(trimmed)) {
    return true;
  }
  if (trimmed.length <= 6 && SHORT_CODE_REGEX.test(trimmed)) {
    return true;
  }

  const targetCode = targetLangToCode(targetLang);
  if (targetCode === "zh") return CJK_REGEX.test(trimmed);
  if (targetCode === "ru") return CYRILLIC_REGEX.test(trimmed);

  // For non-Chinese / non-Russian targets, any residual CJK/Cyrillic means not fully translated.
  if (CJK_REGEX.test(trimmed) || CYRILLIC_REGEX.test(trimmed)) {
    return false;
  }

  const scores = getLanguageScores(trimmed);
  const best = scores[0] || { lang: "en", score: 0 };
  const second = scores[1] || { lang: "en", score: 0 };

  if (best.score === 0) {
    if (targetCode === "en") {
      return !CJK_REGEX.test(trimmed) && !CYRILLIC_REGEX.test(trimmed);
    }
    return true;
  }

  if (best.lang === targetCode) return true;

  const strongSignal = best.score >= 2 && best.score >= second.score + 1;
  if (strongSignal) return false;

  return true;
};

export const detectUntranslatedCells = (
  records: POCTRecord[],
  targetLang: TargetLanguage
): UntranslatedCell[] => {
  if (!records || records.length === 0) return [];

  const flagged: UntranslatedCell[] = [];
  records.forEach((row, rowIndex) => {
    Object.entries(row).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (
        LOCKED_KEY_REGEX.test(key) ||
        ID_TOKEN_REGEX.test(trimmed) ||
        isNeutralToken(trimmed) ||
        isLikelyIdentifier(trimmed)
      ) {
        return;
      }
      if (!isLikelyTargetLanguage(trimmed, targetLang)) {
        flagged.push({ rowIndex, columnKey: key, value: trimmed });
      }
    });
  });

  return flagged;
};
export { detectLanguage, getLanguageScores };
export const isNeutralToken = (text: string) =>
  SYMBOL_ONLY_REGEX.test(text.trim()) ||
  CODE_WITH_ARROW_REGEX.test(text.trim()) ||
  (text.trim().length <= 6 && SHORT_CODE_REGEX.test(text.trim()));
