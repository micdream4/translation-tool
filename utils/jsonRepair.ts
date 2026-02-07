const STRUCTURAL_MAP: Record<string, string> = {
  "，": ",",
  "、": ",",
  "：": ":",
  "；": ";",
  "（": "(",
  "）": ")",
  "｛": "{",
  "｝": "}",
  "［": "[",
  "］": "]"
};

const QUOTE_MAP = new Map<string, string>([
  ["“", '"'],
  ["”", '"'],
  ["『", '"'],
  ["』", '"'],
  ["＂", '"']
]);

const normalizeStructuralChars = (input: string) => {
  const chars = Array.from(input);
  let inString = false;
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (QUOTE_MAP.has(ch)) {
      chars[i] = '"';
      inString = true;
      continue;
    }
    if (STRUCTURAL_MAP[ch]) {
      chars[i] = STRUCTURAL_MAP[ch];
    }
  }
  return chars.join("");
};

const extractJsonArraySegment = (text: string) => {
  const chars = Array.from(text);
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text;
};

export const sanitizeModelJson = (text: string) => {
  const trimmed = text.trim();
  const normalized = normalizeStructuralChars(trimmed);
  return extractJsonArraySegment(normalized);
};

export const parseModelJsonArray = <T = any>(text: string): T[] => {
  const sanitized = sanitizeModelJson(text);
  try {
    const parsed = JSON.parse(sanitized);
    if (!Array.isArray(parsed)) {
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { records?: unknown }).records)
      ) {
        return (parsed as { records: T[] }).records;
      }
      throw new Error("Model output is not a JSON array.");
    }
    return parsed;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
    throw new Error(`Failed to parse model JSON: ${message}`);
  }
};
