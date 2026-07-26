import { PlaceholderMap, guardInlineTokens, restoreInlineTokens } from "./docx";

export interface StringResourceEntry {
  original: string;
  prefix: string;
  content: string;
  suffix: string;
  needsTranslation: boolean;
  explicitlyNonTranslatable?: boolean;
}

const STRING_RESOURCE_REGEX =
  /^(\s*<string\b[^>]*>)([\s\S]*?)(<\/string>\s*)$/;
const CHINESE_REGEX = /[\u4e00-\u9fff]/;
const NON_TRANSLATABLE_ATTR_REGEX = /\btranslatable\s*=\s*["']false["']/i;
const XML_COMMENT_LINE_REGEX = /^\s*<!\s*--[\s\S]*?-->\s*$/;
const CDATA_WRAP_REGEX = /^(\s*<!\[CDATA\[)([\s\S]*?)(\]\]>\s*)$/;
const HTML_TAG_REGEX = /<\/?[^>]+>/g;
const FORMAT_TOKEN_REGEX =
  /%(?:\d+\$)?[-+#0\s]*(?:\d+)?(?:\.\d+)?[a-zA-Z%]|\{\d+\}/g;
const DATE_PATTERN_TOKEN_CHARS = "GyYuUrQqMLlwWdDFgEecabBhHKkmsSzZOXVv";
const DATE_PATTERN_ALLOWED_REGEX = new RegExp(
  `^[${DATE_PATTERN_TOKEN_CHARS}'"\\s\\-/:.,年月日号星期周时分秒点()（）]+$`
);
const CHINESE_DATE_LITERAL_REGEX = /(星期|周|年|月|日|号|时|分|秒|点)/;
const LOCKED_ACRONYM_MAP: Record<string, string> = {
  cbc: "CBC",
  lis: "LIS",
  ping: "PING",
  wbc: "WBC",
  rbc: "RBC",
  qc: "QC",
  plt: "PLT",
  hgb: "HGB",
  hct: "HCT",
  mcv: "MCV",
  mch: "MCH",
  mchc: "MCHC",
  rdw: "RDW",
  mpv: "MPV",
  pct: "PCT",
  pdw: "PDW",
  neu: "NEU",
  lym: "LYM",
  mon: "MON",
  eos: "EOS",
  bas: "BAS",
  baso: "BASO",
  ret: "RET",
  nrbc: "NRBC",
  ig: "IG",
  aly: "ALY",
  lic: "LIC"
};
const LOCKED_ACRONYM_REGEX = new RegExp(
  `\\b(?:${Object.keys(LOCKED_ACRONYM_MAP).join("|")})\\b`,
  "gi"
);
const MODEL_TOKEN_REGEX = /\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g;
export const INTERNAL_STRING_PLACEHOLDER_REGEX =
  /(?:_+\s*(?:TKN|ID|FMT|TAG)(?:\s*[_ ]\s*\d+)?\s*_+|(?:TKN|ID|FMT|TAG)\s*[_ ]\s*\d+\s*_*)/i;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface StructuredStringContent {
  outerPrefix: string;
  translatableContent: string;
  outerSuffix: string;
}

export const isXmlCommentLine = (line: string) =>
  XML_COMMENT_LINE_REGEX.test(String(line || ""));

export const extractStructuredStringContent = (
  content: string
): StructuredStringContent => {
  const value = String(content || "");
  const match = value.match(CDATA_WRAP_REGEX);
  if (match) {
    return {
      outerPrefix: match[1],
      translatableContent: match[2],
      outerSuffix: match[3]
    };
  }
  return {
    outerPrefix: "",
    translatableContent: value,
    outerSuffix: ""
  };
};

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
  const explicitlyNonTranslatable = NON_TRANSLATABLE_ATTR_REGEX.test(prefix);
  const structured = extractStructuredStringContent(content);
  return {
    original: line,
    prefix,
    content,
    suffix,
    needsTranslation: CHINESE_REGEX.test(structured.translatableContent),
    explicitlyNonTranslatable
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
  const canonicalized = text.replace(LOCKED_ACRONYM_REGEX, (match) => {
    return LOCKED_ACRONYM_MAP[match.toLowerCase()] || match;
  });
  const { sanitized: formatSafe, placeholders: formatPlaceholders } =
    guardFormatTokens(canonicalized);

  // Placeholder restoration accepts tolerant type variants, so indices must
  // remain unique across FMT/ID/TKN namespaces to avoid restoring an ID as a
  // format token when both appear in the same resource value.
  let tokenCounter = Object.keys(formatPlaceholders || {}).length;
  const lockedTokenPlaceholders: PlaceholderMap = {};
  const withLockedTokens = formatSafe.replace(MODEL_TOKEN_REGEX, (match) => {
    const placeholder = `__ID_${tokenCounter++}__`;
    lockedTokenPlaceholders[placeholder] = match;
    return placeholder;
  }).replace(LOCKED_ACRONYM_REGEX, (match) => {
    const placeholder = `__ID_${tokenCounter++}__`;
    lockedTokenPlaceholders[placeholder] = LOCKED_ACRONYM_MAP[match.toLowerCase()] || match;
    return placeholder;
  });

  const { sanitized, placeholders: inlinePlaceholders } =
    guardInlineTokens(withLockedTokens);
  if (!formatPlaceholders && !inlinePlaceholders && tokenCounter === 0) {
    return { sanitized, placeholders: null };
  }
  return {
    sanitized,
    placeholders: {
      ...(formatPlaceholders || {}),
      ...lockedTokenPlaceholders,
      ...(inlinePlaceholders || {})
    }
  };
};

export const guardMarkupTags = (
  text: string
): { sanitized: string; placeholders: PlaceholderMap | null } => {
  if (!text) {
    return { sanitized: "", placeholders: null };
  }
  let counter = 0;
  const placeholders: PlaceholderMap = {};
  const sanitized = text.replace(HTML_TAG_REGEX, (match) => {
    const placeholder = `__TAG_${counter++}__`;
    placeholders[placeholder] = match;
    return placeholder;
  });
  if (counter === 0) {
    return { sanitized: text, placeholders: null };
  }
  return { sanitized, placeholders };
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

export const restoreMarkupTags = (
  text: string,
  placeholders?: PlaceholderMap | null
) => {
  if (!text || !placeholders) return text;
  let normalized = text;
  Object.entries(placeholders).forEach(([key, value]) => {
    const core = key.replace(/^_+|_+$/g, "");
    if (!core) return;
    const pattern = new RegExp(`_{0,2}${core}_{0,2}`, "g");
    normalized = normalized.replace(pattern, key);
    normalized = normalized.replace(new RegExp(key, "g"), value);
  });
  return normalized;
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

const getParserError = (doc: Document) => {
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (!parserError) return null;
  const text = String(parserError.textContent || "").replace(/\s+/g, " ").trim();
  return text || "XML parse error.";
};

export const validateStringResourceXml = (text: string) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { valid: false, error: "输出为空，无法校验 XML。" };
  }
  const source =
    /^\s*<\?xml/.test(trimmed) || /^\s*<resources\b/.test(trimmed)
      ? trimmed
      : `<resources>\n${trimmed}\n</resources>`;
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(source, "application/xml");
  const parserError = getParserError(xmlDoc);
  if (parserError) {
    return { valid: false, error: parserError };
  }
  return { valid: true, error: null as string | null };
};
