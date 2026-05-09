import JSZip from "jszip";

export interface DocxTextNode {
  id: string;
  original: string;
  node: Element;
}

export interface DocxSegment {
  id: string;
  original: string;
  nodes: Element[];
}

export interface DocxContext {
  zip: JSZip;
  xmlDoc: Document;
  textNodes: DocxTextNode[];
  segments: DocxSegment[];
  fileName: string;
  coverageWarnings: string[];
}

const DOCUMENT_XML_PATH = "word/document.xml";
const CHINESE_REGEX = /[\u4e00-\u9fff]/;
const ASCII_TOKEN_REGEX = /[A-Za-z][A-Za-z0-9_\-/:+()#.]+/g;
const UI_MARKED_TOKEN_REGEX =
  /[『「“"'《【\[]\s*[A-Za-z][A-Za-z0-9 _\-\/]{0,30}\s*[』」”"'》】\]]/g;
const PLACEHOLDER_TOKEN_REGEX = /^__[A-Z]+_\d+__$/;
const PLACEHOLDER_FRAGMENT_REGEX = /^(?:TKN|ID|FMT)_\d+__$/i;
const UPPER_ABBR_REGEX = /^[A-Z]{2,}(?:[-/][A-Z0-9]{1,})*$/;
const CODE_WITH_DIGIT_REGEX = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9_\-/:+().#]*$/;
const PURE_ALPHA_WORD_REGEX = /^[A-Za-z]{2,}$/;
const DIGITISH_TOKEN_REGEX = /^\d+(?:[-/.]\d+)*[A-Za-z]*$/;
const RANGE_OR_NUMBER_REGEX = /^\d+(?:[-/.]\d+)*$/;
const SHORT_UPPER_TOKEN_REGEX = /^[A-Z]{2,8}$/;
const WORDISH_TAIL_REGEX = /([A-Za-z0-9][A-Za-z0-9_\-/:+().#]*)$/;
const WORDISH_HEAD_REGEX = /^([A-Za-z0-9][A-Za-z0-9_\-/:+().#]*)/;
const NO_SPACE_LEFT_SUFFIX_REGEX = /[-\/([{'"“‘]$/;
const NO_SPACE_RIGHT_PREFIX_REGEX = /^[,.;:!?%)\]}'"”’\/]/;
const ANALYZER_LEFT_BOUNDARY_WORDS = new Set([
  "after",
  "and",
  "away",
  "before",
  "by",
  "cause",
  "clean",
  "disassemble",
  "exceeds",
  "for",
  "from",
  "in",
  "into",
  "not",
  "notice",
  "of",
  "on",
  "onto",
  "or",
  "order",
  "the",
  "this",
  "to",
  "with"
]);
const ANALYZER_RIGHT_BOUNDARY_WORDS = new Set([
  "all",
  "any",
  "clean",
  "damage",
  "dcpowerinterface",
  "faults",
  "for",
  "housing",
  "interface",
  "is",
  "itself",
  "manual",
  "maintenance",
  "operation",
  "operations",
  "operational",
  "outer",
  "parts",
  "placed",
  "power",
  "powerswitch",
  "procedure",
  "procedures",
  "provides",
  "range",
  "rear",
  "reported",
  "requirements",
  "residual",
  "safety",
  "serial",
  "specified",
  "standard",
  "the",
  "when",
  "work"
]);

type DocxSearchRoot = ParentNode & {
  getElementsByTagName: Document["getElementsByTagName"];
};

const collectUniqueElements = (root: DocxSearchRoot, tagNames: string[]) => {
  const seen = new Set<Element>();
  const output: Element[] = [];
  tagNames.forEach((tagName) => {
    Array.from(root.getElementsByTagName(tagName)).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      output.push(node);
    });
  });
  return output;
};

const getDocxTextElements = (root: ParentNode) =>
  collectUniqueElements(root, ["w:t", "t"]);

const getDocxParagraphElements = (root: ParentNode) =>
  collectUniqueElements(root, ["w:p", "p"]);

const buildSegmentText = (nodes: Element[]) =>
  nodes.map((node) => node.textContent || "").join("");

const getDocxCoverageWarnings = (zip: JSZip) => {
  const warnings: string[] = [];
  if (zip.file(/^word\/header\d*\.xml$/).length || zip.file(/^word\/footer\d*\.xml$/).length) {
    warnings.push("页眉/页脚文本暂不翻译");
  }
  if (zip.file(/^word\/footnotes\.xml$/).length || zip.file(/^word\/endnotes\.xml$/).length) {
    warnings.push("脚注/尾注文本暂不翻译");
  }
  if (zip.file(/^word\/comments\.xml$/).length) {
    warnings.push("批注文本暂不翻译");
  }
  return warnings;
};

export async function parseDocxFile(file: File): Promise<DocxContext> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file(DOCUMENT_XML_PATH);
  if (!docFile) {
    throw new Error("DOCX 文件缺少 word/document.xml，无法解析。");
  }
  const xmlString = await docFile.async("text");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "application/xml");

  const textElements = getDocxTextElements(xmlDoc);

  const textNodes: DocxTextNode[] = textElements.map((node, idx) => ({
    id: `docx-text-${idx}`,
    original: node.textContent || "",
    node
  }));

  const segments: DocxSegment[] = getDocxParagraphElements(xmlDoc)
    .map((paragraph, idx) => {
      const nodes = getDocxTextElements(paragraph);
      return {
        id: `docx-segment-${idx}`,
        original: buildSegmentText(nodes),
        nodes
      };
    })
    .filter((segment) => segment.nodes.length > 0);

  return {
    zip,
    xmlDoc,
    textNodes,
    segments,
    fileName: file.name,
    coverageWarnings: getDocxCoverageWarnings(zip)
  };
}

export const containsChinese = (text: string) => CHINESE_REGEX.test(text);

export interface PlaceholderMap {
  [placeholder: string]: string;
}

export const guardInlineTokens = (
  text: string
): { sanitized: string; placeholders: PlaceholderMap | null } => {
  if (!text) {
    return { sanitized: "", placeholders: null };
  }
  if (!containsChinese(text)) {
    return { sanitized: text, placeholders: null };
  }
  let counter = 0;
  const placeholders: PlaceholderMap = {};
  const sanitized = text.replace(UI_MARKED_TOKEN_REGEX, (match) => {
    if (!match.trim()) return match;
    const placeholder = `__TKN_${counter++}__`;
    placeholders[placeholder] = match;
    return placeholder;
  });
  const workingText = sanitized || text;
  const shouldGuard = (token: string) => {
    const value = token.trim();
    const core = value.replace(/^[()[\]{}]+|[()[\]{}.,:;]+$/g, "");
    if (!core) return false;
    if (!value) return false;
    if (PLACEHOLDER_FRAGMENT_REGEX.test(core)) return false;
    if (PLACEHOLDER_TOKEN_REGEX.test(core)) return true;
    if (UPPER_ABBR_REGEX.test(core)) return true;
    if (CODE_WITH_DIGIT_REGEX.test(core)) return true;
    return false;
  };
  const guarded = workingText.replace(ASCII_TOKEN_REGEX, (match) => {
    if (!match.trim()) return match;
    if (!shouldGuard(match)) return match;
    const placeholder = `__TKN_${counter++}__`;
    placeholders[placeholder] = match;
    return placeholder;
  });
  if (counter === 0) {
    return { sanitized: text, placeholders: null };
  }
  return { sanitized: guarded, placeholders };
};

export const restoreInlineTokens = (
  text: string,
  placeholders?: PlaceholderMap | null
) => {
  if (!text || !placeholders) return text;
  let restored = text;
  Object.entries(placeholders).forEach(([key, value]) => {
    const match = key.match(/^__([A-Z]+)_(\d+)__$/i);
    const pattern = match
      ? new RegExp(`_*(?:TKN|ID|FMT)_${match[2]}_*`, "gi")
      : new RegExp(key, "g");
    restored = restored.replace(pattern, value);
  });
  return restored;
};

const ensurePreserveSpace = (node: Element) => {
  const text = node.textContent || "";
  if (!/^\s|\s$/.test(text)) return;
  node.setAttribute("xml:space", "preserve");
};

export const getDocxSegmentText = (segment: DocxSegment) =>
  buildSegmentText(segment.nodes);

const isPreferredSplitBoundary = (text: string, index: number) => {
  if (index <= 0 || index >= text.length) return false;
  const left = text[index - 1];
  const right = text[index];
  if (/\s/.test(left) || /\s/.test(right)) return true;
  if (/[,:;!?)}\]]/.test(left)) return true;
  if (/[({\["“‘]/.test(right)) return true;
  return false;
};

const adjustSplitIndex = (
  text: string,
  desired: number,
  min: number,
  max: number
) => {
  const safeMin = Math.max(0, min);
  const safeMax = Math.min(text.length, max);
  const clamped = Math.min(Math.max(desired, safeMin), safeMax);
  if (isPreferredSplitBoundary(text, clamped)) return clamped;
  for (let offset = 1; offset <= 24; offset += 1) {
    const right = clamped + offset;
    if (right < safeMax && isPreferredSplitBoundary(text, right)) {
      return right;
    }
    const left = clamped - offset;
    if (left > safeMin && isPreferredSplitBoundary(text, left)) {
      return left;
    }
  }
  return clamped;
};

export const setDocxSegmentText = (segment: DocxSegment, text: string) => {
  const nodes = segment.nodes;
  if (!nodes.length) {
    segment.original = text;
    return;
  }

  if (nodes.length === 1) {
    nodes[0].textContent = text;
    ensurePreserveSpace(nodes[0]);
    segment.original = text;
    return;
  }

  const originalLengths = nodes.map((node) => (node.textContent || "").length);
  const totalOriginal = originalLengths.reduce((sum, length) => sum + length, 0) || nodes.length;
  const parts: string[] = [];
  let previousCut = 0;
  let consumedOriginal = 0;

  for (let i = 0; i < nodes.length - 1; i += 1) {
    consumedOriginal += originalLengths[i] || 0;
    const desired = Math.round((consumedOriginal / totalOriginal) * text.length);
    const cut = adjustSplitIndex(text, desired, previousCut, text.length);
    parts.push(text.slice(previousCut, cut));
    previousCut = cut;
  }
  parts.push(text.slice(previousCut));

  nodes.forEach((node, idx) => {
    node.textContent = parts[idx] || "";
    ensurePreserveSpace(node);
  });
  segment.original = text;
};

const shouldInsertBoundarySpace = (left: string, right: string) => {
  if (!left || !right) return false;
  if (/\s$/.test(left) || /^\s/.test(right)) return false;
  if (NO_SPACE_LEFT_SUFFIX_REGEX.test(left) || NO_SPACE_RIGHT_PREFIX_REGEX.test(right)) {
    return false;
  }

  const leftTailRaw = left.match(WORDISH_TAIL_REGEX)?.[1] || "";
  const rightHeadRaw = right.match(WORDISH_HEAD_REGEX)?.[1] || "";
  const leftTail = leftTailRaw.toLowerCase();
  const rightHead = rightHeadRaw.toLowerCase();
  if (!leftTail || !rightHead) return false;

  const merged = `${leftTailRaw}${rightHeadRaw}`;
  if (PLACEHOLDER_TOKEN_REGEX.test(merged) || UPPER_ABBR_REGEX.test(merged)) {
    return false;
  }

  if (ANALYZER_LEFT_BOUNDARY_WORDS.has(leftTail) && rightHead.startsWith("analyzer")) {
    return true;
  }
  if (leftTail.endsWith("analyzer") && ANALYZER_RIGHT_BOUNDARY_WORDS.has(rightHead)) {
    return true;
  }

  const leftHasLetters = /[A-Za-z]/.test(leftTailRaw);
  const rightHasLetters = /[A-Za-z]/.test(rightHeadRaw);
  const leftHasDigits = /\d/.test(leftTailRaw);
  const rightHasDigits = /\d/.test(rightHeadRaw);
  const leftIsWord = PURE_ALPHA_WORD_REGEX.test(leftTailRaw);
  const rightIsWord = PURE_ALPHA_WORD_REGEX.test(rightHeadRaw);
  const leftIsDigitish = DIGITISH_TOKEN_REGEX.test(leftTailRaw);
  const rightIsDigitish = DIGITISH_TOKEN_REGEX.test(rightHeadRaw);
  const rightIsShortUpper = SHORT_UPPER_TOKEN_REGEX.test(rightHeadRaw);
  const leftIsShortUpper = SHORT_UPPER_TOKEN_REGEX.test(leftTailRaw);

  if (leftHasLetters && rightHasLetters) {
    return true;
  }
  if (leftIsWord && (rightIsDigitish || rightIsShortUpper)) {
    return true;
  }
  if ((leftIsDigitish || leftIsShortUpper) && rightIsWord) {
    return true;
  }
  if (
    CODE_WITH_DIGIT_REGEX.test(merged) &&
    !(
      (leftIsWord && rightIsDigitish) ||
      (leftIsDigitish && rightIsWord) ||
      (leftIsWord && rightIsShortUpper) ||
      (leftIsShortUpper && rightIsWord)
    )
  ) {
    return false;
  }
  if ((leftHasLetters && rightHasDigits) || (leftHasDigits && rightHasLetters)) {
    return true;
  }
  return false;
};

const normalizeDocxRunSpacing = (xmlDoc: Document) => {
  const paragraphs = getDocxParagraphElements(xmlDoc);

  paragraphs.forEach((paragraph) => {
    const textNodes = getDocxTextElements(paragraph);
    for (let i = 0; i < textNodes.length - 1; i += 1) {
      const current = textNodes[i];
      const next = textNodes[i + 1];
      const currentText = current.textContent || "";
      const nextText = next.textContent || "";
      if (!shouldInsertBoundarySpace(currentText, nextText)) continue;
      current.textContent = `${currentText} `;
      ensurePreserveSpace(current);
    }
  });
};

export async function exportDocxFile(
  context: DocxContext,
  filename: string
): Promise<void> {
  const serializer = new XMLSerializer();
  normalizeDocxRunSpacing(context.xmlDoc);
  const payload = serializer.serializeToString(context.xmlDoc);
  context.zip.file(DOCUMENT_XML_PATH, payload);
  const blob = await context.zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
