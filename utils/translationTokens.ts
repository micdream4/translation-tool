import { PlaceholderMap, guardInlineTokens, restoreInlineTokens } from "./docx";
import { getSeedProtectedTerms } from "./seedTerminology";

const UUID_REGEX =
  /\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/g;
const ALPHANUM_HYPHEN_REGEX =
  /\b(?=[0-9A-Za-z-]*[A-Za-z])(?=[0-9A-Za-z-]*\d)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+\b/g;
const ALPHANUM_HYPHEN_TEST =
  /^(?=[0-9A-Za-z-]*[A-Za-z])(?=[0-9A-Za-z-]*\d)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+$/;
const UUID_TEST =
  /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const UI_LABEL_REGEX =
  /([『「“"'《【\[«])\s*([A-Za-z][A-Za-z0-9 _.\-\/]{0,60})\s*([』」”"'》】\]»])/g;
const SOURCE_UI_LABEL_CONTEXT_REGEX =
  /\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,4})\s+(?:button|icon|status|page|tab|menu)\b/g;
const SOURCE_UI_BUTTON_CONTEXT_REGEX =
  /\b(?:button|icon|status|page|tab|menu)\s+([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,4})\b/g;
const DEFAULT_PROTECTED_TERMS = [
  "EHVT-75",
  "EHBT-75",
  "Ehome",
  "Ehome Health Technology Co",
  "Ehome Health Technology",
  "Ehome Health Technology Co., Ltd.",
  "Ehome Health Technology Co. , Ltd.",
  "Wi-Fi",
  "SSID",
  "IPP",
  "IEEE",
  "IEC",
  "EN",
  "EMC",
  "in vitro",
  "Sysmex",
  "e-CHECK",
  "Country",
  "Garden",
  "Smart",
  "Park",
  "Country Garden Smart Park",
  "Xueshi",
  "Yuelu",
  "Changsha",
  "Hunan",
  "Yulian",
  "Liandong",
  "Valley",
  "Liandong U Valley",
  "Taenia",
  "Brachylaime",
  "Trichomonas",
  "Giardia",
  "Isospora",
  "Toxoplasma",
  "gondii",
  "Toxoplasma gondii",
  ...getSeedProtectedTerms()
];

const normalizeProtectedText = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();

const UI_CODE_TOKEN_REGEX =
  /^(?:[A-Z]{1,10}\d[A-Z0-9#%+_.\/-]*|[A-Z0-9#%+_.\/-]*\d[A-Z0-9#%+_.\/-]*|[A-Z]{2,10}(?:\/[A-Z0-9#%]+)+|[A-Z]{1,10}[#%])$/;
const UI_ALWAYS_PROTECTED_LABELS = new Set(["id", "uuid"]);

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildProtectedTermPattern = (value: string) => {
  const escaped = escapeRegex(value).replace(/\\ /g, "\\s+");
  const trimmed = String(value || "").trim();
  if (/^[A-Za-z0-9#%+_.\/-]{1,12}$/.test(trimmed)) {
    return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi");
  }
  return new RegExp(escaped, "gi");
};

const buildPlaceholderVariantPattern = (key: string) => {
  const match = key.match(/^__([A-Z]+)_(\d+)__$/i);
  if (!match) {
    return new RegExp(escapeRegex(key), "g");
  }
  const id = escapeRegex(match[2]);
  return new RegExp(`_*(?:TKN|ID|FMT)_${id}_*`, "gi");
};

const PLACEHOLDER_REMAINDER_REGEX =
  /(?:_+\s*(TKN|ID|FMT)(?:\s*[_ ]\s*(\d+))?\s*_+|(?:TKN|ID|FMT)\s*[_ ]\s*(\d+)\s*_*)/gi;

const normalizeBrokenPlaceholders = (
  text: string,
  placeholders: PlaceholderMap
) => {
  const byType: Record<string, string[]> = { TKN: [], ID: [], FMT: [] };
  Object.keys(placeholders).forEach((key) => {
    const match = key.match(/^__([A-Z]+)_\d+__$/i);
    if (!match) return;
    const type = match[1].toUpperCase();
    if (!byType[type]) byType[type] = [];
    byType[type].push(key);
  });
  const cursors: Record<string, number> = { TKN: 0, ID: 0, FMT: 0 };

  return text.replace(PLACEHOLDER_REMAINDER_REGEX, (match, groupA, groupB, groupC) => {
    const type = String(groupA || match.match(/TKN|ID|FMT/i)?.[0] || "").toUpperCase();
    const explicitIndex = String(groupB || groupC || "").trim();
    if (!type || !byType[type]?.length) return match;

    if (explicitIndex) {
      const exactKey = `__${type}_${explicitIndex}__`;
      if (placeholders[exactKey]) {
        return exactKey;
      }
    }

    const fallbackKey = byType[type][cursors[type]++] || byType[type][0];
    return fallbackKey || match;
  });
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
  .map(buildProtectedTermPattern);

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
    .map(buildProtectedTermPattern);
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

  const createPlaceholder = (match: string) => {
    if (!match.trim()) return match;
    const placeholder = `__ID_${counter++}__`;
    placeholders[placeholder] = match;
    return placeholder;
  };

  const replaceTokens = (regex: RegExp) => {
    sanitized = sanitized.replace(regex, (match) => {
      return createPlaceholder(match);
    });
  };

  sanitized = sanitized.replace(UI_LABEL_REGEX, (match, _open, label) => {
    return isProtectedUiLabel(label) ? createPlaceholder(match) : match;
  });
  sanitized = sanitized.replace(SOURCE_UI_LABEL_CONTEXT_REGEX, (match, label) =>
    isProtectedUiLabel(label) ? match.replace(label, createPlaceholder(label)) : match
  );
  sanitized = sanitized.replace(SOURCE_UI_BUTTON_CONTEXT_REGEX, (match, label) =>
    isProtectedUiLabel(label) ? match.replace(label, createPlaceholder(label)) : match
  );
  effectiveProtectedTermPatterns.forEach((regex) => {
    sanitized = sanitized.replace(regex, (match) => {
      return createPlaceholder(match);
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
  if (PLACEHOLDER_REMAINDER_REGEX.test(normalized)) {
    PLACEHOLDER_REMAINDER_REGEX.lastIndex = 0;
    normalized = normalizeBrokenPlaceholders(normalized, placeholders);
  }
  return restoreInlineTokens(normalized, placeholders);
};

export const isLikelyIdentifier = (value: string) => {
  const trimmed = String(value || "").trim();
  return UUID_TEST.test(trimmed) || ALPHANUM_HYPHEN_TEST.test(trimmed);
};

export const isProtectedTerm = (value: string) =>
  effectiveProtectedTermsNorm.has(normalizeProtectedText(value));

export const isProtectedUiLabel = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (isProtectedTerm(trimmed) || isLikelyIdentifier(trimmed)) return true;
  if (UI_ALWAYS_PROTECTED_LABELS.has(normalizeProtectedText(trimmed))) return true;
  return UI_CODE_TOKEN_REGEX.test(trimmed);
};

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

export const getPreservedUiLabels = (value: string) => {
  const labels: string[] = [];
  String(value || "").replace(UI_LABEL_REGEX, (_match, _open, label) => {
    const trimmed = String(label || "").trim();
    if (trimmed) labels.push(trimmed);
    return "";
  });
  return labels;
};

export const getSourceUiLabelCandidates = (value: string) => {
  const labels = new Set<string>();
  getPreservedUiLabels(value).forEach((label) => labels.add(label));
  String(value || '').replace(SOURCE_UI_LABEL_CONTEXT_REGEX, (_match, label) => {
    if (label) labels.add(String(label).trim());
    return '';
  });
  String(value || '').replace(SOURCE_UI_BUTTON_CONTEXT_REGEX, (_match, label) => {
    if (label) labels.add(String(label).trim());
    return '';
  });
  return Array.from(labels).filter((label) => label.length > 1);
};

export const stripUiLabels = (value: string, labels: string[]) => {
  let output = String(value || '');
  labels.forEach((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  });
  return output.replace(/\s+/g, ' ').trim();
};

export const stripPreservedUiLabels = (value: string) =>
  String(value || "")
    .replace(UI_LABEL_REGEX, (match, _open, label) =>
      isProtectedUiLabel(label) ? " " : match
    )
    .replace(/\s+/g, " ")
    .trim();
