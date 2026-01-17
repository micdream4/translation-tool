import { PlaceholderMap, guardInlineTokens, restoreInlineTokens } from "./docx";

const UUID_REGEX =
  /\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/g;
const UUID_TEST =
  /\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/;
const ALPHANUM_HYPHEN_REGEX =
  /\b(?=[0-9A-Za-z-]*[A-Za-z])(?=[0-9A-Za-z-]*\d)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+\b/g;
const ALPHANUM_HYPHEN_TEST =
  /\b(?=[0-9A-Za-z-]*[A-Za-z])(?=[0-9A-Za-z-]*\d)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+\b/;

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
) => restoreInlineTokens(text, placeholders);

export const isLikelyIdentifier = (value: string) =>
  UUID_TEST.test(value) || ALPHANUM_HYPHEN_TEST.test(value);
