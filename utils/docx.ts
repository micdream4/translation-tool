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
  partPath: string;
  partLabel: string;
}

export interface DocxXmlPart {
  path: string;
  label: string;
  xmlDoc: Document;
  textNodes: DocxTextNode[];
  segments: DocxSegment[];
}

export interface DocxPartCoverage {
  path: string;
  label: string;
  textNodes: number;
  segments: number;
}

export interface DocxCoverage {
  parts: DocxPartCoverage[];
  totalTextNodes: number;
  totalSegments: number;
}

export interface DocxContext {
  zip: JSZip;
  xmlDoc: Document;
  parts: DocxXmlPart[];
  textNodes: DocxTextNode[];
  segments: DocxSegment[];
  fileName: string;
  coverage: DocxCoverage;
  coverageWarnings: string[];
}

const DOCUMENT_XML_PATH = "word/document.xml";
const DOCX_PART_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
  required?: boolean;
}> = [
  { label: "正文", pattern: /^word\/document\.xml$/, required: true },
  { label: "编号", pattern: /^word\/numbering\.xml$/ },
  { label: "页眉", pattern: /^word\/header\d*\.xml$/ },
  { label: "页脚", pattern: /^word\/footer\d*\.xml$/ },
  { label: "脚注", pattern: /^word\/footnotes\.xml$/ },
  { label: "尾注", pattern: /^word\/endnotes\.xml$/ },
  { label: "批注", pattern: /^word\/comments\.xml$/ }
];
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
const CJK_NUMBER_FORMAT_REGEX = /(chinese|japanese|korean|taiwanese|ideograph)/i;
const CJK_NUMBER_LITERAL_REGEX = /^[一二三四五六七八九十百千万零〇]+[、。．.]?$/;
const CJK_NUMBER_SEPARATOR_REGEX = /[、。．]/;
const CJK_NUMBER_SEPARATOR_GLOBAL_REGEX = /[、。．]/g;
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

const getDocxTextElements = (root: DocxSearchRoot) =>
  collectUniqueElements(root, ["w:t", "t"]);

const getDocxParagraphElements = (root: DocxSearchRoot) =>
  collectUniqueElements(root, ["w:p", "p"]);

const getDocxNumberingLevelElements = (root: DocxSearchRoot) =>
  collectUniqueElements(root, ["w:lvl", "lvl"]);

const buildSegmentText = (nodes: Element[]) =>
  nodes.map((node) => node.textContent || "").join("");

const getElementLocalName = (node: Element) =>
  (node.localName || node.tagName || "").split(":").pop() || "";

const collectDocxFlowElements = (root: Element) => {
  const output: Element[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 1) {
      const element = node as Element;
      const localName = getElementLocalName(element);
      if (["t", "tab", "instrText", "fldChar"].includes(localName)) {
        output.push(element);
      }
    }
    Array.from(node.childNodes || []).forEach(visit);
  };
  visit(root);
  return output;
};

const getDocxCoverageWarnings = (zip: JSZip) => {
  const warnings: string[] = [];
  if (zip.file(/^word\/glossary\/document\.xml$/).length) {
    warnings.push("术语表/构建基块文本暂不处理");
  }
  return warnings;
};

const getDocxPartEntries = (zip: JSZip) =>
  DOCX_PART_PATTERNS.flatMap(({ label, pattern }) =>
    zip
      .file(pattern)
      .map((file) => ({ label, path: file.name }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  );

const buildCoverage = (parts: DocxXmlPart[]): DocxCoverage => {
  const coverageParts = parts.map((part) => ({
    path: part.path,
    label: part.label,
    textNodes: part.textNodes.length,
    segments: part.segments.length
  }));
  return {
    parts: coverageParts,
    totalTextNodes: coverageParts.reduce((sum, part) => sum + part.textNodes, 0),
    totalSegments: coverageParts.reduce((sum, part) => sum + part.segments, 0)
  };
};

export const formatDocxCoverageSummary = (coverage: DocxCoverage) => {
  const grouped = new Map<string, { parts: number; segments: number; textNodes: number }>();
  coverage.parts.forEach((part) => {
    const current = grouped.get(part.label) || { parts: 0, segments: 0, textNodes: 0 };
    current.parts += 1;
    current.segments += part.segments;
    current.textNodes += part.textNodes;
    grouped.set(part.label, current);
  });
  const details = Array.from(grouped.entries())
    .map(([label, stats]) => `${label} ${stats.segments} 段`)
    .join("，");
  return `${details || "无可翻译段落"}；共 ${coverage.parts.length} 个 XML 部件，${coverage.totalSegments} 个语义段，${coverage.totalTextNodes} 个文本节点`;
};

export async function parseDocxFile(file: File): Promise<DocxContext> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file(DOCUMENT_XML_PATH);
  if (!docFile) {
    throw new Error("DOCX 文件缺少 word/document.xml，无法解析。");
  }
  const parser = new DOMParser();
  const partEntries = getDocxPartEntries(zip);
  const parts: DocxXmlPart[] = [];
  const textNodes: DocxTextNode[] = [];
  const segments: DocxSegment[] = [];

  for (const entry of partEntries) {
    const xmlString = await zip.file(entry.path)!.async("text");
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");
    const partTextNodes = getDocxTextElements(xmlDoc).map((node) => {
      const textNode = {
        id: `docx-text-${textNodes.length}`,
        original: node.textContent || "",
        node
      };
      textNodes.push(textNode);
      return textNode;
    });
    const partSegments: DocxSegment[] = [];
    getDocxParagraphElements(xmlDoc).forEach((paragraph) => {
      const nodes = getDocxTextElements(paragraph);
      if (!nodes.length) return;
      const segment = {
        id: `docx-segment-${segments.length}`,
        original: buildSegmentText(nodes),
        nodes,
        partPath: entry.path,
        partLabel: entry.label
      };
      segments.push(segment);
      partSegments.push(segment);
    });
    parts.push({
      path: entry.path,
      label: entry.label,
      xmlDoc,
      textNodes: partTextNodes,
      segments: partSegments
    });
  }

  const mainPart = parts.find((part) => part.path === DOCUMENT_XML_PATH);
  if (!mainPart) {
    throw new Error("DOCX 文件缺少 word/document.xml，无法解析。");
  }
  const coverage = buildCoverage(parts);

  return {
    zip,
    xmlDoc: mainPart.xmlDoc,
    parts,
    textNodes,
    segments,
    fileName: file.name,
    coverage,
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

const isWordInternalRunBoundary = (left: string, right: string) => {
  if (!left || !right) return false;
  const leftChar = left[left.length - 1] || "";
  const rightChar = right[0] || "";
  return /[A-Za-z\u00C0-\u024F]/.test(leftChar) && /[A-Za-z\u00C0-\u024F]/.test(rightChar);
};

const hasWordInternalRunSplit = (nodes: Element[]) => {
  for (let i = 0; i < nodes.length - 1; i += 1) {
    if (isWordInternalRunBoundary(nodes[i].textContent || "", nodes[i + 1].textContent || "")) {
      return true;
    }
  }
  return false;
};

const hasPreferredSplitPoint = (text: string) => {
  for (let i = 1; i < text.length; i += 1) {
    if (isPreferredSplitBoundary(text, i)) return true;
  }
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
    return;
  }

  if (nodes.length === 1) {
    nodes[0].textContent = text;
    ensurePreserveSpace(nodes[0]);
    return;
  }

  if (hasWordInternalRunSplit(nodes)) {
    nodes.forEach((node, idx) => {
      node.textContent = idx === 0 ? text : "";
      ensurePreserveSpace(node);
    });
    return;
  }

  if (!hasPreferredSplitPoint(text)) {
    nodes.forEach((node, idx) => {
      node.textContent = idx === 0 ? text : "";
      ensurePreserveSpace(node);
    });
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

const findDirectChildElement = (parent: Element, names: string[]) => {
  const expected = new Set(names);
  return Array.from(parent.children).find((child) => expected.has(child.tagName)) || null;
};

const getValAttribute = (node: Element | null) =>
  node?.getAttribute("w:val") ?? node?.getAttribute("val") ?? "";

const setValAttribute = (node: Element, value: string) => {
  if (node.hasAttribute("w:val")) {
    node.setAttribute("w:val", value);
    return;
  }
  node.setAttribute("val", value);
};

const normalizeCjkNumberingText = (value: string) => {
  const normalized = value.replace(CJK_NUMBER_SEPARATOR_GLOBAL_REGEX, ".");
  if (CJK_NUMBER_LITERAL_REGEX.test(normalized)) return "1.";
  if (/%\d+$/.test(normalized)) return `${normalized}.`;
  return normalized;
};

const normalizeDocxNumbering = (xmlDoc: Document) => {
  getDocxNumberingLevelElements(xmlDoc).forEach((level) => {
    const numFmt = findDirectChildElement(level, ["w:numFmt", "numFmt"]);
    const lvlText = findDirectChildElement(level, ["w:lvlText", "lvlText"]);
    const format = getValAttribute(numFmt);
    const marker = getValAttribute(lvlText);
    const usesCjkNumbering =
      CJK_NUMBER_FORMAT_REGEX.test(format) ||
      CJK_NUMBER_SEPARATOR_REGEX.test(marker) ||
      CJK_NUMBER_LITERAL_REGEX.test(marker);
    if (!usesCjkNumbering || !numFmt || !lvlText) return;

    setValAttribute(numFmt, "decimal");
    setValAttribute(lvlText, normalizeCjkNumberingText(marker));
  });
};

const getFldCharType = (node: Element) =>
  node.getAttribute("w:fldCharType") ?? node.getAttribute("fldCharType") ?? "";

const hasPageRefField = (nodes: Element[]) =>
  nodes.some(
    (node) =>
      getElementLocalName(node) === "instrText" &&
      /\bPAGEREF\b/i.test(node.textContent || "")
  );

const getVisibleDocxFlowText = (nodes: Element[]) =>
  nodes
    .map((node) => {
      const localName = getElementLocalName(node);
      if (localName === "t") return node.textContent || "";
      if (localName === "tab") return "\t";
      return "";
    })
    .join("");

const findFirstPageRefFieldResultTextIndex = (nodes: Element[], startIndex: number) => {
  let inPageRefField = false;
  let inPageRefResult = false;
  for (let i = startIndex + 1; i < nodes.length; i += 1) {
    const node = nodes[i];
    const localName = getElementLocalName(node);
    if (localName === "instrText" && /\bPAGEREF\b/i.test(node.textContent || "")) {
      inPageRefField = true;
      inPageRefResult = false;
      continue;
    }
    if (localName === "fldChar" && inPageRefField) {
      const type = getFldCharType(node);
      if (type === "separate") {
        inPageRefResult = true;
        continue;
      }
      if (type === "end") {
        inPageRefField = false;
        inPageRefResult = false;
        continue;
      }
    }
    if (localName === "t" && inPageRefField && inPageRefResult) {
      return i;
    }
  }
  return -1;
};

const normalizeDocxTocPageRefFields = (xmlDoc: Document) => {
  getDocxParagraphElements(xmlDoc).forEach((paragraph) => {
    const nodes = collectDocxFlowElements(paragraph);
    if (!hasPageRefField(nodes)) return;
    const pageRefInstructionIndex = nodes.findIndex(
      (node) =>
        getElementLocalName(node) === "instrText" &&
        /\bPAGEREF\b/i.test(node.textContent || "")
    );
    let tabIndex = -1;
    for (let index = 0; index < pageRefInstructionIndex; index += 1) {
      if (getElementLocalName(nodes[index]) === "tab") {
        tabIndex = index;
      }
    }
    if (tabIndex < 0) return;
    const visible = getVisibleDocxFlowText(nodes);
    const pageMatch = visible.replace(/\t/g, " ").match(/^(.*?)\s+(\d+)\s*$/);
    if (!pageMatch) return;
    const title = pageMatch[1].replace(/\s+/g, " ").trim();
    const page = pageMatch[2];
    if (!title || !page) return;

    const textNodesBeforeTab = nodes
      .slice(0, tabIndex)
      .filter((node) => getElementLocalName(node) === "t");
    const firstPageTextIndex = findFirstPageRefFieldResultTextIndex(nodes, tabIndex);
    if (!textNodesBeforeTab.length || firstPageTextIndex < 0) return;

    textNodesBeforeTab.forEach((node, index) => {
      node.textContent = index === 0 ? title : "";
      ensurePreserveSpace(node);
    });
    nodes.slice(firstPageTextIndex).forEach((node, index) => {
      if (getElementLocalName(node) !== "t") return;
      node.textContent = index === 0 ? ` ${page}` : "";
      ensurePreserveSpace(node);
    });
  });
};

const INVALID_NULL_RELATIONSHIP_REGEX =
  /<Relationship\b(?=[^>]*\bTarget=(["'])NULL\1)[^>]*\/>/gi;

const sanitizeInvalidDocxRelationships = async (zip: JSZip) => {
  const relPaths = Object.keys(zip.files).filter((entryPath) =>
    /(^|\/)_rels\/.+\.rels$/i.test(entryPath)
  );
  await Promise.all(
    relPaths.map(async (entryPath) => {
      const entry = zip.file(entryPath);
      if (!entry) return;
      const xml = await entry.async("string");
      const sanitized = xml.replace(INVALID_NULL_RELATIONSHIP_REGEX, "");
      if (sanitized !== xml) {
        zip.file(entryPath, sanitized);
      }
    })
  );
};

export async function buildDocxTranslationBuffer(
  context: DocxContext
): Promise<Uint8Array> {
  const serializer = new XMLSerializer();
  const parts = context.parts?.length
    ? context.parts
    : [
        {
          path: DOCUMENT_XML_PATH,
          label: "正文",
          xmlDoc: context.xmlDoc,
          textNodes: context.textNodes,
          segments: context.segments
        }
      ];
  parts.forEach((part) => {
    normalizeDocxNumbering(part.xmlDoc);
    normalizeDocxTocPageRefFields(part.xmlDoc);
    normalizeDocxRunSpacing(part.xmlDoc);
    const payload = serializer.serializeToString(part.xmlDoc);
    context.zip.file(part.path, payload);
  });
  await sanitizeInvalidDocxRelationships(context.zip);
  return context.zip.generateAsync({ type: "uint8array" });
}

export async function exportDocxFile(
  context: DocxContext,
  filename: string
): Promise<void> {
  const bytes = await buildDocxTranslationBuffer(context);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
