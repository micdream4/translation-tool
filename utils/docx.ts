import JSZip from "jszip";

export interface DocxTextNode {
  id: string;
  original: string;
  node: Element;
}

export interface DocxContext {
  zip: JSZip;
  xmlDoc: Document;
  textNodes: DocxTextNode[];
  fileName: string;
}

const DOCUMENT_XML_PATH = "word/document.xml";
const CHINESE_REGEX = /[\u4e00-\u9fff]/;
const ASCII_TOKEN_REGEX = /[A-Za-z][A-Za-z0-9_\-/:+()#.]+/g;

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

  const textElements = Array.from(
    xmlDoc.getElementsByTagName("w:t")
  ).concat(Array.from(xmlDoc.getElementsByTagName("t")));

  const textNodes: DocxTextNode[] = textElements.map((node, idx) => ({
    id: `docx-text-${idx}`,
    original: node.textContent || "",
    node
  }));

  return {
    zip,
    xmlDoc,
    textNodes,
    fileName: file.name
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
  const sanitized = text.replace(ASCII_TOKEN_REGEX, (match) => {
    if (!match.trim()) return match;
    const placeholder = `__TKN_${counter++}__`;
    placeholders[placeholder] = match;
    return placeholder;
  });
  if (counter === 0) {
    return { sanitized: text, placeholders: null };
  }
  return { sanitized, placeholders };
};

export const restoreInlineTokens = (
  text: string,
  placeholders?: PlaceholderMap | null
) => {
  if (!text || !placeholders) return text;
  let restored = text;
  Object.entries(placeholders).forEach(([key, value]) => {
    const pattern = new RegExp(key, "g");
    restored = restored.replace(pattern, value);
  });
  return restored;
};

export async function exportDocxFile(
  context: DocxContext,
  filename: string
): Promise<void> {
  const serializer = new XMLSerializer();
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
