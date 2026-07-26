import JSZip from "jszip";

export interface DocxTextNode {
  id: string;
  original: string;
  node: Element;
}

export interface DocxSegment {
  id: string;
  coordinate: string;
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
const CJK_NUMBER_FORMAT_REGEX = /(chinese|japanese|korean|taiwanese|ideograph)/i;
const CJK_NUMBER_LITERAL_REGEX = /^[一二三四五六七八九十百千万零〇]+[、。．.]?$/;
const CJK_NUMBER_SEPARATOR_REGEX = /[、。．]/;
const CJK_NUMBER_SEPARATOR_GLOBAL_REGEX = /[、。．]/g;

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

const isDocxParagraphElement = (node: Node | null): node is Element => {
  if (!node || node.nodeType !== 1) return false;
  const element = node as Element;
  return (element.localName || element.tagName.split(":").pop()) === "p";
};

const getParagraphOwnedTextElements = (paragraph: Element) =>
  getDocxTextElements(paragraph).filter((node) => {
    let parent = node.parentNode;
    while (parent && parent !== paragraph) {
      if (isDocxParagraphElement(parent)) return false;
      parent = parent.parentNode;
    }
    return parent === paragraph;
  });

const getDocxNumberingLevelElements = (root: DocxSearchRoot) =>
  collectUniqueElements(root, ["w:lvl", "lvl"]);

const buildSegmentText = (nodes: Element[]) =>
  nodes.map((node) => node.textContent || "").join("");

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
    getDocxParagraphElements(xmlDoc).forEach((paragraph, paragraphIndex) => {
      const nodes = getParagraphOwnedTextElements(paragraph);
      if (!nodes.length) return;
      const coordinate = `${entry.path}#paragraph-${paragraphIndex}`;
      const segment = {
        id: coordinate,
        coordinate,
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

export const hasDocxCrossRunWordBreak = (
  sourceRunTexts: readonly string[],
  targetSegment: DocxSegment
) => {
  const boundaryCount = Math.min(
    sourceRunTexts.length,
    targetSegment.nodes.length
  ) - 1;
  for (let index = 0; index < boundaryCount; index += 1) {
    const sourceLeft = sourceRunTexts[index] || "";
    const sourceRight = sourceRunTexts[index + 1] || "";
    if (!isWordInternalRunBoundary(sourceLeft, sourceRight)) continue;
    const targetLeft = targetSegment.nodes[index].textContent || "";
    const targetRight = targetSegment.nodes[index + 1].textContent || "";
    const targetAddsWordInternalSpace =
      (/[A-Za-z\u00C0-\u024F]\s+$/.test(targetLeft) &&
        /^\s*[A-Za-z\u00C0-\u024F]/.test(targetRight)) ||
      (/[A-Za-z\u00C0-\u024F]$/.test(targetLeft) &&
        /^\s+[A-Za-z\u00C0-\u024F]/.test(targetRight));
    if (targetAddsWordInternalSpace) return true;
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

export async function buildDocxFileBytes(
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
    const payload = serializer.serializeToString(part.xmlDoc);
    context.zip.file(part.path, payload);
  });
  return context.zip.generateAsync({ type: "uint8array" });
}

export async function exportDocxFile(
  context: DocxContext,
  filename: string
): Promise<void> {
  const bytes = await buildDocxFileBytes(context);
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
