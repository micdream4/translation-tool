import { PlaceholderMap, guardInlineTokens, restoreInlineTokens } from "./docx";

export interface StringResourceEntry {
  original: string;
  prefix: string;
  content: string;
  suffix: string;
  needsTranslation: boolean;
}

const STRING_RESOURCE_REGEX =
  /^(\s*<string\b[^>]*>)([\s\S]*?)(<\/string>\s*)$/;
const CHINESE_REGEX = /[\u4e00-\u9fff]/;
const FORMAT_TOKEN_REGEX =
  /%(?:\d+\$)?[-+#0\s]*(?:\d+)?(?:\.\d+)?[a-zA-Z%]|\{\d+\}/g;
const DATE_PATTERN_TOKEN_CHARS = "GyYuUrQqMLlwWdDFgEecabBhHKkmsSzZOXVv";
const DATE_PATTERN_ALLOWED_REGEX = new RegExp(
  `^[${DATE_PATTERN_TOKEN_CHARS}'"\\s\\-/:.,年月日号星期周时分秒点()（）]+$`
);
const CHINESE_DATE_LITERAL_REGEX = /(星期|周|年|月|日|号|时|分|秒|点)/;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseStringResourceLine = (line: string): StringResourceEntry => {
  const match = line.match(STRING_RESOURCE_REGEX);
  if (!match) {
    return {
      original: line,
      prefix: "",
      content: line,
      suffix: "",
      needsTranslation: CHINESE_REGEX.test(line)
    };
  }
  const [, prefix, content, suffix] = match;
  return {
    original: line,
    prefix,
    content,
    suffix,
    needsTranslation: CHINESE_REGEX.test(content)
  };
};

export const guardFormatTokens = (
  text: string
): { sanitized: string; placeholders: PlaceholderMap | null } => {
  if (!text) {
    return { sanitized: "", placeholders: null };
  }
  let counter = 0;
  const placeholders: PlaceholderMap = {};
  const sanitized = text.replace(FORMAT_TOKEN_REGEX, (match) => {
    const placeholder = `__FMT_${counter++}__`;
    placeholders[placeholder] = match;
    return placeholder;
  });
  if (counter === 0) {
    return { sanitized: text, placeholders: null };
  }
  return { sanitized, placeholders };
};

export const guardStringResourceTokens = (
  text: string
): { sanitized: string; placeholders: PlaceholderMap | null } => {
  const { sanitized: formatSafe, placeholders: formatPlaceholders } =
    guardFormatTokens(text);
  const { sanitized, placeholders: inlinePlaceholders } =
    guardInlineTokens(formatSafe);
  if (!formatPlaceholders && !inlinePlaceholders) {
    return { sanitized, placeholders: null };
  }
  return {
    sanitized,
    placeholders: { ...(formatPlaceholders || {}), ...(inlinePlaceholders || {}) }
  };
};

export const restoreStringResourceTokens = (
  text: string,
  placeholders?: PlaceholderMap | null
) => {
  if (!text || !placeholders) return text;
  let normalized = text;
  Object.keys(placeholders).forEach((key) => {
    const core = key.replace(/^_+|_+$/g, "");
    if (!core) return;
    const pattern = new RegExp(`_{0,2}${core}_{0,2}`, "g");
    normalized = normalized.replace(pattern, key);
  });
  return restoreInlineTokens(normalized, placeholders);
};

export const isLikelyDateFormatPattern = (text: string) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (!CHINESE_DATE_LITERAL_REGEX.test(trimmed)) return false;
  if (!new RegExp(`[${DATE_PATTERN_TOKEN_CHARS}]`).test(trimmed)) return false;
  return DATE_PATTERN_ALLOWED_REGEX.test(trimmed);
};

export const localizeDateFormatPattern = (text: string, targetLang: string) => {
  const original = String(text || "");
  if (!original.trim()) return original;

  const dateSeparator =
    targetLang === "German" || targetLang === "Russian" ? "." : "/";
  const timeSeparator = ":";

  let output = original;
  output = output.replace(/星期|周/g, " ");
  output = output.replace(/年/g, dateSeparator);
  output = output.replace(/月/g, dateSeparator);
  output = output.replace(/[日号]/g, "");
  output = output.replace(/[时点]/g, timeSeparator);
  output = output.replace(/[分秒]/g, "");
  output = output.replace(/\s+/g, " ");
  output = output.replace(
    new RegExp(`${escapeRegExp(dateSeparator)}{2,}`, "g"),
    dateSeparator
  );
  output = output.replace(
    new RegExp(`${escapeRegExp(timeSeparator)}{2,}`, "g"),
    timeSeparator
  );
  output = output.replace(/\s*([/:.-])\s*/g, "$1");
  output = output.replace(/([/:.-])(?=\s|$)/g, "");
  output = output.replace(/\s+/g, " ").trim();
  return output;
};
