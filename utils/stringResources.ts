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
