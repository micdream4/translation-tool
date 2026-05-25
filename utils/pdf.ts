import * as pdfjsLib from 'pdfjs-dist';
import {
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun
} from 'docx';
import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  hasUsefulPdfTextLayer,
  normalizePdfTextLayerText,
  PDF_TEXT_LAYER_SAFE_REGEX
} from './pdfTextLayer';

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
  backgroundColor?: [number, number, number];
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
  backgroundImage?: PdfImage;
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

const canvasToPng = async (source: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
};

const sampleCanvasBackgroundColor = (
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): [number, number, number] => {
  const ctx = source.getContext('2d');
  if (!ctx) return [255, 255, 255];
  const samplePoints = [
    [x + width * 0.5, y + height * 0.5],
    [x + width * 0.08, y + height * 0.08],
    [x + width * 0.92, y + height * 0.08],
    [x + width * 0.08, y + height * 0.92],
    [x + width * 0.92, y + height * 0.92]
  ];
  const samples = samplePoints.map(([sampleX, sampleY]) => {
    const px = Math.max(0, Math.min(source.width - 1, Math.round(sampleX)));
    const py = Math.max(0, Math.min(source.height - 1, Math.round(sampleY)));
    const data = ctx.getImageData(px, py, 1, 1).data;
    return [data[0], data[1], data[2]];
  });
  const channels = [0, 1, 2].map((channel) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 255;
  });
  return [channels[0], channels[1], channels[2]];
};

const attachSegmentBackgroundColors = (
  segments: PdfSegment[],
  renderedCanvas: HTMLCanvasElement,
  renderedViewport: any,
  pageViewport: any
) => {
  const scaleX = renderedViewport.width / Math.max(1, pageViewport.width);
  const scaleY = renderedViewport.height / Math.max(1, pageViewport.height);
  segments.forEach((segment) => {
    const padding = Math.max(2, segment.fontSize * 0.2);
    const x = Math.max(0, (segment.x - padding) * scaleX);
    const y = Math.max(0, (segment.y - padding) * scaleY);
    const width = Math.min(
      renderedCanvas.width - x,
      Math.max(1, (segment.width + padding * 2) * scaleX)
    );
    const height = Math.min(
      renderedCanvas.height - y,
      Math.max(1, (segment.height + padding * 2) * scaleY)
    );
    segment.backgroundColor = sampleCanvasBackgroundColor(renderedCanvas, x, y, width, height);
  });
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

const getPageBackgroundImage = async (
  renderedCanvas: HTMLCanvasElement,
  pageNumber: number,
  pageViewport: any
): Promise<PdfImage | null> => {
  const png = await canvasToPng(renderedCanvas);
  if (!png) return null;
  return {
    id: `pdf-page-${pageNumber}-background`,
    pageNumber,
    x: 0,
    y: 0,
    width: pageViewport.width,
    height: pageViewport.height,
    data: png
  };
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
    const rendered = await renderPageForImageObjects(page);
    const pageImages = rendered
      ? await extractPageImages(page, rendered.canvas, rendered.viewport, operatorList, pageNumber)
      : [];
    const backgroundImage = rendered
      ? await getPageBackgroundImage(rendered.canvas, pageNumber, viewport)
      : undefined;
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
    if (rendered) {
      attachSegmentBackgroundColors(pageSegments, rendered.canvas, rendered.viewport, viewport);
    }
    pageSegments.forEach((segment) => segments.push(segment));

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      segments: pageSegments,
      imageCount,
      images: pageImages,
      backgroundImage: backgroundImage || undefined
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

let pdfFontBytesPromise: Promise<ArrayBuffer> | null = null;

const loadPdfMultilingualFontBytes = () => {
  if (!pdfFontBytesPromise) {
    pdfFontBytesPromise = fetch("/fonts/NotoSansHans-Regular.otf").then((response) => {
      if (!response.ok) {
        throw new Error(`PDF 字体加载失败：${response.status}`);
      }
      return response.arrayBuffer();
    });
  }
  return pdfFontBytesPromise;
};

const getStandardPdfTextLayerText = (text: string) => {
  const textLayerText = normalizePdfTextLayerText(text);
  if (!PDF_TEXT_LAYER_SAFE_REGEX.test(textLayerText)) return "";
  if (!hasUsefulPdfTextLayer(text, textLayerText)) return "";
  return textLayerText;
};

const wrapPdfText = (
  font: PDFFont,
  text: string,
  maxWidth: number,
  fontSize: number
) => {
  const output: string[] = [];
  const pushToken = (token: string, current: string) => {
    let line = current;
    Array.from(token).forEach((char) => {
      const candidate = line ? `${line}${char}` : char;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !line) {
        line = candidate;
        return;
      }
      output.push(line);
      line = char;
    });
    return line;
  };

  const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !current) {
        current = font.widthOfTextAtSize(candidate, fontSize) <= maxWidth
          ? candidate
          : pushToken(word, "");
        return;
      }
      output.push(current);
      current = font.widthOfTextAtSize(word, fontSize) <= maxWidth ? word : pushToken(word, "");
    });
    if (current) output.push(current);
  });
  return output.length ? output : [text];
};

const measurePdfTextBlock = (
  font: PDFFont,
  text: string,
  width: number,
  fontSize: number,
  horizontalPadding: number,
  verticalPadding: number
) => {
  const lines = wrapPdfText(font, text, Math.max(8, width - horizontalPadding * 2), fontSize);
  const lineHeight = fontSize * 1.18;
  const height = Math.max(
    lines.length * lineHeight + verticalPadding * 2,
    fontSize + verticalPadding * 2
  );
  return { lines, lineHeight, height };
};

export const getPdfTextLayerStats = (context: PdfContext) => {
  const textSegments = context.segments.filter((segment) => sanitizePdfText(getPdfSegmentText(segment)));
  return {
    totalSegments: textSegments.length,
    selectableSegments: textSegments.length,
    imageFallbackSegments: 0
  };
};

const drawEmbeddedPdfText = (
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  x: number,
  topY: number,
  maxWidth: number,
  maxHeight: number,
  fontSizePoints: number,
  font: PDFFont,
  pageHeight: number,
  backgroundColor: [number, number, number] = [255, 255, 255]
) => {
  const horizontalPadding = 3;
  const verticalPadding = 2;
  const availableWidth = Math.max(8, maxWidth - horizontalPadding * 2);
  let fontSize = Math.min(PDF_TEXT_MAX_FONT_SIZE, Math.max(PDF_TEXT_MIN_FONT_SIZE, fontSizePoints));

  let measured = measurePdfTextBlock(font, text, maxWidth, fontSize, horizontalPadding, verticalPadding);
  while (fontSize >= PDF_TEXT_MIN_FONT_SIZE) {
    measured = measurePdfTextBlock(font, text, maxWidth, fontSize, horizontalPadding, verticalPadding);
    if (measured.height <= maxHeight || fontSize <= PDF_TEXT_MIN_FONT_SIZE) {
      break;
    }
    fontSize = Math.max(PDF_TEXT_MIN_FONT_SIZE, fontSize - 0.5);
  }

  const lines = measured.lines;
  const lineHeight = measured.lineHeight;
  const maxLines = Math.max(1, Math.floor((maxHeight - verticalPadding * 2) / lineHeight));
  const visibleLines = lines.slice(0, maxLines);
  if (!visibleLines.length) return false;

  page.drawRectangle({
    x,
    y: pageHeight - topY - maxHeight,
    width: maxWidth,
    height: maxHeight,
    color: rgb(backgroundColor[0] / 255, backgroundColor[1] / 255, backgroundColor[2] / 255)
  });

  visibleLines.forEach((line, index) => {
    page.drawText(line, {
      x: x + horizontalPadding,
      y: pageHeight - topY - verticalPadding - fontSize - index * lineHeight,
      size: fontSize,
      font,
      color: rgb(32 / 255, 36 / 255, 48 / 255),
      maxWidth: availableWidth,
      lineHeight
    });
  });
  return true;
};

export async function exportPdfTranslationAsPdf(
  context: PdfContext,
  filename: string
) {
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const latinFont = await output.embedFont(StandardFonts.Helvetica);
  let multilingualFontPromise: Promise<PDFFont> | null = null;
  const getMultilingualFont = () => {
    if (!multilingualFontPromise) {
      multilingualFontPromise = loadPdfMultilingualFontBytes().then((fontBytes) =>
        output.embedFont(fontBytes, { subset: true })
      );
    }
    return multilingualFontPromise;
  };

  for (const pageContext of context.pages) {
    const pageWidth = pageContext.width;
    const pageHeight = pageContext.height;
    const page = output.addPage([pageWidth, pageHeight]);

    if (pageContext.backgroundImage) {
      const background = await output.embedPng(pageContext.backgroundImage.data);
      page.drawImage(background, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    } else {
      page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });
      for (const image of pageContext.images) {
        const png = await output.embedPng(image.data);
        page.drawImage(png, {
          x: image.x,
          y: pageHeight - image.y - image.height,
          width: image.width,
          height: image.height
        });
      }
    }

    for (const segment of pageContext.segments) {
      const text = sanitizePdfText(getPdfSegmentText(segment));
      if (!text) continue;
      const standardText = getStandardPdfTextLayerText(text);
      const textToDraw = standardText || text;
      const fontSize = Math.min(PDF_TEXT_MAX_FONT_SIZE, Math.max(PDF_TEXT_MIN_FONT_SIZE, segment.fontSize || 10));
      const maxWidth = Math.max(24, Math.min(pageWidth - segment.x - 8, segment.width || pageWidth - segment.x - 8));
      const maxHeight = Math.max(fontSize * 1.4, segment.height ? segment.height * 1.25 : fontSize * 1.8);
      const x = Math.max(0, segment.x);
      const topY = Math.max(0, segment.y);
      const width = Math.min(pageWidth - segment.x, maxWidth);
      const height = Math.min(pageHeight - segment.y, maxHeight);
      const backgroundColor = segment.backgroundColor || [255, 255, 255];
      const font = standardText ? latinFont : await getMultilingualFont();
      drawEmbeddedPdfText(
        page,
        textToDraw,
        x,
        topY,
        width,
        height,
        fontSize,
        font,
        pageHeight,
        backgroundColor
      );
    }
  }

  const bytes = await output.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
