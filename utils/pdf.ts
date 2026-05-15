import * as pdfjsLib from 'pdfjs-dist';
import {
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun
} from 'docx';
import { jsPDF } from 'jspdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export interface PdfSegment {
  id: string;
  pageNumber: number;
  original: string;
  translated: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PdfImage {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PdfPageContext {
  pageNumber: number;
  width: number;
  height: number;
  segments: PdfSegment[];
  imageCount: number;
  images: PdfImage[];
}

export interface PdfContext {
  fileName: string;
  sourceData: Uint8Array;
  pageCount: number;
  pages: PdfPageContext[];
  segments: PdfSegment[];
  images: PdfImage[];
  coverageWarnings: string[];
}

type TextItemLike = {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
};

type PdfImageData = {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array;
};

type Matrix = [number, number, number, number, number, number];

const IMAGE_OPERATORS = new Set<number>([
  pdfjsLib.OPS.paintImageMaskXObject,
  pdfjsLib.OPS.paintImageMaskXObjectGroup,
  pdfjsLib.OPS.paintImageXObject,
  pdfjsLib.OPS.paintInlineImageXObject,
  pdfjsLib.OPS.paintInlineImageXObjectGroup,
  pdfjsLib.OPS.paintImageXObjectRepeat,
  pdfjsLib.OPS.paintImageMaskXObjectRepeat
]);

const PDF_IMAGE_MAX_WIDTH = 420;
const PX_PER_POINT = 96 / 72;
const PDF_TEXT_LINE_Y_TOLERANCE = 4;
const PDF_TEXT_SAME_LINE_MAX_GAP_MULTIPLIER = 3.5;
const PDF_BLOCK_X_TOLERANCE = 18;
const PDF_BLOCK_GAP_MULTIPLIER = 1.45;
const PDF_TEXT_CANVAS_SCALE = 2;
const PDF_TEXT_MIN_FONT_SIZE = 4.5;
const PDF_TEXT_MAX_FONT_SIZE = 18;

type PositionedTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

type PositionedTextLine = PositionedTextItem & {
  texts: string[];
};

const splitPageText = (items: TextItemLike[]) => {
  const lines: string[] = [];
  let current = '';

  items.forEach((item) => {
    const text = item.str || '';
    if (text.trim()) {
      current += text;
    }
    if (item.hasEOL) {
      const normalized = current.trim();
      if (normalized) {
        lines.push(normalized);
      }
      current = '';
    } else if (text && !/\s$/.test(text)) {
      current += ' ';
    }
  });

  const tail = current.trim();
  if (tail) {
    lines.push(tail);
  }

  return lines
    .join('\n')
    .split(/\n{2,}/)
    .map((line) => line.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean);
};

const toImagePixels = (points: number, scale: number) =>
  Math.max(1, Math.round(points * PX_PER_POINT * scale));

const mergeTextWithGap = (left: string, right: string, gap: number, fontSize: number) => {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/.test(left) || /^\s/.test(right)) return `${left}${right}`;
  if (/^[,.;:!?%)\]}]/.test(right)) return `${left}${right}`;
  if (/[-/([{"']$/.test(left)) return `${left}${right}`;
  return gap > Math.max(1, fontSize * 0.22) ? `${left} ${right}` : `${left}${right}`;
};

const getPositionedTextItems = (
  items: TextItemLike[],
  viewport: any
): PositionedTextItem[] =>
  items
    .map((item) => {
      const text = item.str || '';
      if (!text.trim() || !item.transform) return null;
      const [, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
      const [x, baselineY] = viewport.convertToViewportPoint(e, f);
      const fontSize = Math.max(1, item.height || Math.hypot(b, d) || 10);
      const width = Math.max(1, item.width || text.length * fontSize * 0.5);
      const height = Math.max(1, item.height || Math.hypot(c, d) || fontSize);
      return {
        text,
        x,
        y: Math.max(0, baselineY - height),
        width,
        height,
        fontSize
      };
    })
    .filter((item): item is PositionedTextItem => Boolean(item));

const mergeItemsIntoLines = (items: PositionedTextItem[]) => {
  const lines: PositionedTextLine[] = [];
  const sorted = [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  sorted.forEach((item) => {
    const line = lines.find(
      (candidate) => {
        const yAligned =
          Math.abs(candidate.y - item.y) <= Math.max(PDF_TEXT_LINE_Y_TOLERANCE, item.height * 0.35);
        const gap = item.x - (candidate.x + candidate.width);
        const closeHorizontally =
          gap <= Math.max(18, item.fontSize * PDF_TEXT_SAME_LINE_MAX_GAP_MULTIPLIER);
        return yAligned && closeHorizontally;
      }
    );
    if (!line) {
      lines.push({ ...item, texts: [item.text] });
      return;
    }
    const previousRight = line.x + line.width;
    const gap = item.x - previousRight;
    line.text = mergeTextWithGap(line.text, item.text, gap, line.fontSize);
    line.texts.push(item.text);
    const right = Math.max(previousRight, item.x + item.width);
    const bottom = Math.max(line.y + line.height, item.y + item.height);
    line.x = Math.min(line.x, item.x);
    line.y = Math.min(line.y, item.y);
    line.width = right - line.x;
    line.height = bottom - line.y;
    line.fontSize = Math.max(line.fontSize, item.fontSize);
  });

  return lines.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
};

const mergeLinesIntoSegments = (
  lines: PositionedTextLine[],
  pageNumber: number,
  pageWidth: number
) => {
  const segments: PdfSegment[] = [];
  let current: PositionedTextLine | null = null;

  const flush = () => {
    if (!current) return;
    segments.push({
      id: `pdf-page-${pageNumber}-segment-${segments.length}`,
      pageNumber,
      original: current.text.trim(),
      translated: '',
      x: current.x,
      y: current.y,
      width: Math.min(pageWidth - current.x, Math.max(current.width, pageWidth - current.x - 24)),
      height: current.height,
      fontSize: current.fontSize
    });
    current = null;
  };

  lines.forEach((line) => {
    if (!current) {
      current = { ...line, texts: [...line.texts] };
      return;
    }
    const currentBottom = current.y + current.height;
    const gap = line.y - currentBottom;
    const sameColumn = Math.abs(line.x - current.x) <= PDF_BLOCK_X_TOLERANCE;
    const closeEnough = gap >= -2 && gap <= Math.max(current.fontSize, line.fontSize) * PDF_BLOCK_GAP_MULTIPLIER;
    const fontSimilar =
      Math.abs(current.fontSize - line.fontSize) <= Math.max(2, Math.min(current.fontSize, line.fontSize) * 0.25);
    if (!sameColumn || !closeEnough || !fontSimilar) {
      flush();
      current = { ...line, texts: [...line.texts] };
      return;
    }
    const right = Math.max(current.x + current.width, line.x + line.width);
    current.text = `${current.text}\n${line.text}`;
    current.texts.push(...line.texts);
    current.x = Math.min(current.x, line.x);
    current.y = Math.min(current.y, line.y);
    current.width = right - current.x;
    current.height = Math.max(currentBottom, line.y + line.height) - current.y;
    current.fontSize = Math.min(current.fontSize, line.fontSize);
  });
  flush();

  return segments.filter((segment) => segment.original.trim());
};

const getPositionedPageSegments = (
  items: TextItemLike[],
  viewport: any,
  pageNumber: number
) => {
  const positioned = getPositionedTextItems(items, viewport);
  const lines = mergeItemsIntoLines(positioned);
  return mergeLinesIntoSegments(lines, pageNumber, viewport.width);
};

const imageDataToPng = async (image: PdfImageData): Promise<Uint8Array | null> => {
  const width = image.width || 0;
  const height = image.height || 0;
  const source = image.data;
  if (!width || !height || !source) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;
  const kind = image.kind;

  if (kind === pdfjsLib.ImageKind.RGBA_32BPP) {
    pixels.set(source.subarray(0, pixels.length));
  } else if (kind === pdfjsLib.ImageKind.RGB_24BPP) {
    for (let src = 0, dest = 0; src < source.length && dest < pixels.length; src += 3, dest += 4) {
      pixels[dest] = source[src];
      pixels[dest + 1] = source[src + 1];
      pixels[dest + 2] = source[src + 2];
      pixels[dest + 3] = 255;
    }
  } else if (kind === pdfjsLib.ImageKind.GRAYSCALE_1BPP) {
    for (let i = 0; i < width * height; i += 1) {
      const byte = source[i >> 3] || 0;
      const bit = 7 - (i & 7);
      const value = byte & (1 << bit) ? 255 : 0;
      const dest = i * 4;
      pixels[dest] = value;
      pixels[dest + 1] = value;
      pixels[dest + 2] = value;
      pixels[dest + 3] = 255;
    }
  } else {
    return null;
  }

  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
};

const getPdfObject = (objects: any, objectId: string): Promise<PdfImageData> =>
  new Promise((resolve, reject) => {
    try {
      if (objects.has(objectId)) {
        resolve(objects.get(objectId) as PdfImageData);
        return;
      }
      objects.get(objectId, (value: PdfImageData) => resolve(value));
    } catch (error) {
      reject(error);
    }
  });

const multiplyMatrix = (left: Matrix, right: Matrix): Matrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5]
];

const applyMatrix = (matrix: Matrix, x: number, y: number) => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5]
});

const getImageBounds = (
  operatorList: { fnArray: number[]; argsArray: any[] }
) => {
  const bounds: Array<{ id: string; matrix: Matrix }> = [];
  const stack: Matrix[] = [];
  let current: Matrix = [1, 0, 0, 1, 0, 0];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] || [];
    if (fn === pdfjsLib.OPS.save) {
      stack.push([...current] as Matrix);
      continue;
    }
    if (fn === pdfjsLib.OPS.restore) {
      current = stack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === pdfjsLib.OPS.transform) {
      const matrix = args.slice(0, 6) as Matrix;
      current = multiplyMatrix(current, matrix);
      continue;
    }
    if (!IMAGE_OPERATORS.has(fn)) continue;
    const objectId = typeof args[0] === 'string' ? args[0] : '';
    if (objectId) {
      bounds.push({ id: objectId, matrix: [...current] as Matrix });
    }
  }

  return bounds;
};

const cropCanvasToPng = async (
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(width));
  crop.height = Math.max(1, Math.round(height));
  const ctx = crop.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, x, y, width, height, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
};

const extractPageImages = async (
  page: any,
  renderedCanvas: HTMLCanvasElement,
  viewport: any,
  operatorList: { fnArray: number[]; argsArray: any[] },
  pageNumber: number
) => {
  const images: PdfImage[] = [];
  const seen = new Set<string>();

  for (const bound of getImageBounds(operatorList)) {
    if (seen.has(bound.id)) continue;
    seen.add(bound.id);
    const corners = [
      applyMatrix(bound.matrix, 0, 0),
      applyMatrix(bound.matrix, 1, 0),
      applyMatrix(bound.matrix, 0, 1),
      applyMatrix(bound.matrix, 1, 1)
    ].map((point) => {
      const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
      return { x, y };
    });
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))));
    const maxX = Math.min(renderedCanvas.width, Math.ceil(Math.max(...corners.map((point) => point.x))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))));
    const maxY = Math.min(renderedCanvas.height, Math.ceil(Math.max(...corners.map((point) => point.y))));
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 || height <= 0) continue;
    const viewBoxWidth =
      Array.isArray(viewport.viewBox) && viewport.viewBox.length >= 4
        ? Math.abs(viewport.viewBox[2] - viewport.viewBox[0])
        : renderedCanvas.width;
    const pointScale = Math.max(1, renderedCanvas.width / Math.max(1, viewBoxWidth));
    const displayX = minX / pointScale;
    const displayY = minY / pointScale;
    const displayWidth = width / pointScale;
    const displayHeight = height / pointScale;
    try {
      const rawImage = await getPdfObject(page.objs, bound.id);
      const png = await imageDataToPng(rawImage);
      if (png) {
        images.push({
          id: bound.id,
          pageNumber,
          x: displayX,
          y: displayY,
          width: displayWidth,
          height: displayHeight,
          data: png
        });
        continue;
      }
    } catch {
      // Fall through to rendered-region extraction.
    }

    const png = await cropCanvasToPng(renderedCanvas, minX, minY, width, height);
    if (png) {
      images.push({
        id: bound.id,
        pageNumber,
        x: displayX,
        y: displayY,
        width: displayWidth,
        height: displayHeight,
        data: png
      });
    }
  }

  return images;
};

const renderPageForImageObjects = async (page: any) => {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) return null;
  await page.render({ canvasContext, viewport }).promise;
  return { canvas, viewport };
};

export async function parsePdfFile(file: File): Promise<PdfContext> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: PdfPageContext[] = [];
  const segments: PdfSegment[] = [];
  const images: PdfImage[] = [];
  let totalImages = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const operatorList = await page.getOperatorList();
    const imageCount = operatorList.fnArray.filter((fn) => IMAGE_OPERATORS.has(fn)).length;
    totalImages += imageCount;
    const rendered = imageCount > 0 ? await renderPageForImageObjects(page) : null;
    const pageImages = rendered
      ? await extractPageImages(page, rendered.canvas, rendered.viewport, operatorList, pageNumber)
      : [];
    images.push(...pageImages);

    const positionedSegments = getPositionedPageSegments(
      textContent.items as TextItemLike[],
      viewport,
      pageNumber
    );
    const pageSegments =
      positionedSegments.length > 0
        ? positionedSegments
        : splitPageText(textContent.items as TextItemLike[]).map((text, idx) => ({
            id: `pdf-page-${pageNumber}-segment-${idx}`,
            pageNumber,
            original: text,
            translated: '',
            x: 36,
            y: 72 + idx * 28,
            width: Math.max(1, viewport.width - 72),
            height: 18,
            fontSize: 11
          }));
    pageSegments.forEach((segment) => segments.push(segment));

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      segments: pageSegments,
      imageCount,
      images: pageImages
    });
  }

  if (!segments.length) {
    throw new Error('PDF 中没有可抽取的文本。扫描版 PDF 需要先做 OCR。');
  }

  const coverageWarnings: string[] = [];
  if (totalImages > 0) {
    coverageWarnings.push(
      `检测到 ${totalImages} 个图片对象，已回填 ${images.length} 个可提取图片；图片内文字暂不翻译`
    );
  }

  return {
    fileName: file.name,
    sourceData: data,
    pageCount: pdf.numPages,
    pages,
    segments,
    images,
    coverageWarnings
  };
}

export const getPdfSegmentText = (segment: PdfSegment) =>
  segment.translated || segment.original;

export const setPdfSegmentText = (segment: PdfSegment, text: string) => {
  segment.translated = text;
};

export async function exportPdfTranslationAsDocx(
  context: PdfContext,
  filename: string,
  targetLang: string
) {
  const children: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ text: `Translated PDF Review - ${targetLang}`, bold: true, size: 32 })
      ]
    }),
    new Paragraph({
      children: [new TextRun({ text: context.fileName, italics: true })]
    })
  ];

  context.pages.forEach((page) => {
    children.push(new Paragraph({ children: [new TextRun({ text: `Page ${page.pageNumber}`, bold: true, size: 26 })] }));
    page.segments.forEach((segment) => {
      const text = getPdfSegmentText(segment).trim();
      if (!text) return;
      children.push(
        new Paragraph({
          children: [new TextRun({ text })],
          spacing: { after: 120 }
        })
      );
    });

    if (page.images.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Source images', bold: true })] }));
    }
    page.images.forEach((image) => {
      const scale = image.width > PDF_IMAGE_MAX_WIDTH ? PDF_IMAGE_MAX_WIDTH / image.width : 1;
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: image.data,
              transformation: {
                width: toImagePixels(image.width, scale),
                height: toImagePixels(image.height, scale)
              }
            })
          ]
        })
      );
    });
  });

  const doc = new Document({
    creator: 'POCT Document Translator',
    description: `PDF translation review document for ${context.fileName} to ${targetLang}`,
    sections: [{ properties: {}, children }]
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const sanitizePdfText = (value: string) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });

const bytesToPngDataUrl = (data: Uint8Array) =>
  blobToDataUrl(new Blob([data], { type: "image/png" }));

const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) => {
  const output: string[] = [];
  const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
        return;
      }
      output.push(current);
      current = word;
    });
    if (current) output.push(current);
  });
  return output.length ? output : [text];
};

const measureTextBlock = (
  text: string,
  width: number,
  fontSize: number,
  horizontalPadding: number,
  verticalPadding: number
) => {
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) return null;
  measureCtx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
  const lines = wrapCanvasText(measureCtx, text, Math.max(8, width - horizontalPadding * 2));
  const lineHeight = fontSize * 1.18;
  const height = Math.max(
    Math.ceil(lines.length * lineHeight + verticalPadding * 2),
    Math.ceil(fontSize + verticalPadding * 2)
  );
  return { lines, lineHeight, height };
};

const fitTextFontSize = (
  text: string,
  width: number,
  requestedFontSize: number,
  maxHeight: number | undefined,
  horizontalPadding: number,
  verticalPadding: number
) => {
  const minFontSize = PDF_TEXT_MIN_FONT_SIZE * PDF_TEXT_CANVAS_SCALE;
  const maxFontSize = PDF_TEXT_MAX_FONT_SIZE * PDF_TEXT_CANVAS_SCALE;
  let fontSize = Math.min(maxFontSize, Math.max(minFontSize, requestedFontSize));
  let measured = measureTextBlock(text, width, fontSize, horizontalPadding, verticalPadding);
  if (!maxHeight || !measured) return { fontSize, measured };
  const targetHeight = Math.max(8, maxHeight * PDF_TEXT_CANVAS_SCALE);
  while (fontSize > minFontSize && measured.height > targetHeight) {
    fontSize = Math.max(minFontSize, fontSize - 0.5 * PDF_TEXT_CANVAS_SCALE);
    measured = measureTextBlock(text, width, fontSize, horizontalPadding, verticalPadding);
    if (!measured) break;
  }
  return { fontSize, measured };
};

const renderTextBlockToPng = async (
  text: string,
  widthPoints: number,
  fontSizePoints: number,
  maxHeightPoints?: number
) => {
  const width = Math.max(24, Math.ceil(widthPoints * PDF_TEXT_CANVAS_SCALE));
  const requestedFontSize = Math.max(PDF_TEXT_MIN_FONT_SIZE, fontSizePoints) * PDF_TEXT_CANVAS_SCALE;
  const horizontalPadding = 3 * PDF_TEXT_CANVAS_SCALE;
  const verticalPadding = 2 * PDF_TEXT_CANVAS_SCALE;
  const { fontSize, measured } = fitTextFontSize(
    text,
    width,
    requestedFontSize,
    maxHeightPoints,
    horizontalPadding,
    verticalPadding
  );
  if (!measured) return null;
  const { lines, lineHeight } = measured;
  const maxHeight = maxHeightPoints ? Math.ceil(maxHeightPoints * PDF_TEXT_CANVAS_SCALE) : 0;
  const height = maxHeight
    ? Math.max(Math.ceil(fontSize + verticalPadding * 2), Math.min(measured.height, maxHeight))
    : measured.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "#202430";
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    ctx.fillText(line, horizontalPadding, verticalPadding + index * lineHeight);
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthPoints: canvas.width / PDF_TEXT_CANVAS_SCALE,
    heightPoints: canvas.height / PDF_TEXT_CANVAS_SCALE
  };
};

export async function exportPdfTranslationAsPdf(
  context: PdfContext,
  filename: string
) {
  let output: jsPDF | null = null;

  for (const pageContext of context.pages) {
    const pageWidth = pageContext.width;
    const pageHeight = pageContext.height;

    if (!output) {
      output = new jsPDF({
        orientation: pageWidth > pageHeight ? "landscape" : "portrait",
        unit: "pt",
        format: [pageWidth, pageHeight],
        compress: true
      });
    } else {
      output.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? "landscape" : "portrait");
    }

    output.setFillColor(255, 255, 255);
    output.rect(0, 0, pageWidth, pageHeight, "F");

    for (const image of pageContext.images) {
      const dataUrl = await bytesToPngDataUrl(image.data);
      output.addImage(dataUrl, "PNG", image.x, image.y, image.width, image.height);
    }

    for (const segment of pageContext.segments) {
      const text = sanitizePdfText(getPdfSegmentText(segment));
      if (!text) continue;
      const fontSize = Math.min(PDF_TEXT_MAX_FONT_SIZE, Math.max(PDF_TEXT_MIN_FONT_SIZE, segment.fontSize || 10));
      const maxWidth = Math.max(24, Math.min(pageWidth - segment.x - 8, segment.width || pageWidth - segment.x - 8));
      const maxHeight = Math.max(fontSize * 1.15, segment.height ? segment.height * 1.08 : fontSize * 1.4);
      const textImage = await renderTextBlockToPng(text, maxWidth, fontSize, maxHeight);
      if (!textImage) continue;
      output.addImage(
        textImage.dataUrl,
        "PNG",
        Math.max(0, segment.x),
        Math.max(0, segment.y),
        Math.min(pageWidth - segment.x, textImage.widthPoints),
        Math.min(pageHeight - segment.y, textImage.heightPoints)
      );
    }
  }

  if (!output) {
    throw new Error("PDF 导出失败：没有可渲染的页面。");
  }
  output.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
