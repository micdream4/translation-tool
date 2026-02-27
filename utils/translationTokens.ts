import { PlaceholderMap, guardInlineTokens, restoreInlineTokens } from "./docx";

const UUID_REGEX =
  /\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/g;
const UUID_TEST =
  /\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/;
const ALPHANUM_HYPHEN_REGEX =
  /\b(?=[0-9A-Za-z-]*[A-Za-z])(?=[0-9A-Za-z-]*\d)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+\b/g;
const ALPHANUM_HYPHEN_TEST =
  /\b(?=[0-9A-Za-z-]*[A-Za-z])(?=[0-9A-Za-z-]*\d)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+\b/;
const DEFAULT_PROTECTED_TERMS = [
  "EHVT-75",
  "Ehome",
  "Ehome Health Technology Co",
  "Ehome Health Technology",
  "Ehome Health Technology Co., Ltd.",
  "Ehome Health Technology Co. , Ltd."
];

const normalizeProtectedText = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPlaceholderVariantPattern = (key: string) => {
  const match = key.match(/^__([A-Z]+)_(\d+)__$/i);
  if (!match) {
    return new RegExp(escapeRegex(key), "g");
  }
  const id = escapeRegex(match[2]);
  return new RegExp(`_*(?:TKN|ID|FMT)_${id}_*`, "gi");
};

const getProtectedTerms = () => {
  const envRaw =
    typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_PROTECTED_TERMS
      : typeof process !== "undefined"
        ? process.env.VITE_PROTECTED_TERMS || process.env.PROTECTED_TERMS
        : "";

  const list = String(envRaw || "")
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const merged = [...DEFAULT_PROTECTED_TERMS, ...list];
  return Array.from(new Set(merged.map((item) => item.trim()).filter(Boolean)));
};

const BASE_PROTECTED_TERMS = getProtectedTerms();
let runtimeProtectedTerms: string[] = [];
let effectiveProtectedTerms: string[] = BASE_PROTECTED_TERMS;
let effectiveProtectedTermsNorm = new Set(
  effectiveProtectedTerms.map((item) => normalizeProtectedText(item))
);
let effectiveProtectedTermPatterns = effectiveProtectedTerms
  .slice()
  .sort((a, b) => b.length - a.length)
  .map((item) => new RegExp(escapeRegex(item), "gi"));

const rebuildEffectiveTerms = () => {
  const merged = [...BASE_PROTECTED_TERMS, ...runtimeProtectedTerms];
  effectiveProtectedTerms = Array.from(
    new Set(merged.map((item) => String(item || "").trim()).filter(Boolean))
  );
  effectiveProtectedTermsNorm = new Set(
    effectiveProtectedTerms.map((item) => normalizeProtectedText(item))
  );
  effectiveProtectedTermPatterns = effectiveProtectedTerms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((item) => new RegExp(escapeRegex(item), "gi"));
};

export const setRuntimeProtectedTerms = (terms: string[]) => {
  runtimeProtectedTerms = Array.from(
    new Set((terms || []).map((item) => String(item || "").trim()).filter(Boolean))
  );
  rebuildEffectiveTerms();
};

export const guardTranslationTokens = (
  text: string
): { sanitized: string; placeholders: PlaceholderMap | null } => {
  if (!text) {
    return { sanitized: "", placeholders: null };
  }

  const base = guardInlineTokens(text);
  let sanitized = base.sanitized;
  const placeholders: PlaceholderMap = base.placeholders
    ? { ...base.placeholders }
    : {};
  let counter = Object.keys(placeholders).length;

  const replaceTokens = (regex: RegExp) => {
    sanitized = sanitized.replace(regex, (match) => {
      if (!match.trim()) return match;
      const placeholder = `__ID_${counter++}__`;
      placeholders[placeholder] = match;
      return placeholder;
    });
  };

  effectiveProtectedTermPatterns.forEach((regex) => {
    sanitized = sanitized.replace(regex, (match) => {
      if (!match.trim()) return match;
      const placeholder = `__ID_${counter++}__`;
      placeholders[placeholder] = match;
      return placeholder;
    });
  });
  replaceTokens(UUID_REGEX);
  replaceTokens(ALPHANUM_HYPHEN_REGEX);

  if (Object.keys(placeholders).length === 0) {
    return { sanitized, placeholders: null };
  }
  return { sanitized, placeholders };
};

export const restoreTranslationTokens = (
  text: string,
  placeholders?: PlaceholderMap | null
) => {
  if (!text || !placeholders) return text;
  let normalized = text;
  Object.keys(placeholders).forEach((key) => {
    const pattern = buildPlaceholderVariantPattern(key);
    normalized = normalized.replace(pattern, key);
  });
  return restoreInlineTokens(normalized, placeholders);
};

export const isLikelyIdentifier = (value: string) =>
  UUID_TEST.test(value) || ALPHANUM_HYPHEN_TEST.test(value);

export const isProtectedTerm = (value: string) =>
  effectiveProtectedTermsNorm.has(normalizeProtectedText(value));

export const containsProtectedTerm = (value: string) => {
  const normalized = normalizeProtectedText(value);
  if (!normalized) return false;
  return Array.from(effectiveProtectedTermsNorm).some((term) => normalized.includes(term));
};

export const stripProtectedTerms = (value: string) => {
  let output = String(value || "");
  effectiveProtectedTermPatterns.forEach((regex) => {
    output = output.replace(regex, " ");
  });
  return output.replace(/\s+/g, " ").trim();
};
