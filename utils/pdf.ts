import * as pdfjsLib from 'pdfjs-dist';
import {
  Document,
  FrameAnchorType,
  FrameWrap,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom
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

const TWIPS_PER_POINT = 20;
const EMU_PER_POINT = 12700;
const PX_PER_POINT = 96 / 72;
const MAX_DOCX_PAGE_WIDTH_TWIPS = 12240;
const MAX_DOCX_PAGE_HEIGHT_TWIPS = 31680;
const PDF_TEXT_LINE_Y_TOLERANCE = 4;
const PDF_TEXT_SAME_LINE_MAX_GAP_MULTIPLIER = 3.5;
const PDF_BLOCK_X_TOLERANCE = 18;
const PDF_BLOCK_GAP_MULTIPLIER = 1.45;
const MIN_FRAME_WIDTH_TWIPS = 720;
const MIN_FRAME_HEIGHT_TWIPS = 220;

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

const getPageScale = (width: number, height: number) =>
  Math.min(
    MAX_DOCX_PAGE_WIDTH_TWIPS / Math.max(1, width * TWIPS_PER_POINT),
    MAX_DOCX_PAGE_HEIGHT_TWIPS / Math.max(1, height * TWIPS_PER_POINT),
    1
  );

const toTwips = (points: number, scale: number) =>
  Math.max(0, Math.round(points * TWIPS_PER_POINT * scale));

const toEmu = (points: number, scale: number) =>
  Math.max(0, Math.round(points * EMU_PER_POINT * scale));

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
    if (!sameColumn || !closeEnough) {
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
    current.fontSize = Math.max(current.fontSize, line.fontSize);
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

const renderPdfPageToCanvas = async (page: any, scale: number = 2) => {
  const viewport = page.getViewport({ scale });
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
  const sections = context.pages.map((page) => {
    const scale = getPageScale(page.width, page.height);
    const children: Paragraph[] = [];

    page.images.forEach((image) => {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: image.data,
              transformation: {
                width: toImagePixels(image.width, scale),
                height: toImagePixels(image.height, scale)
              },
              floating: {
                horizontalPosition: {
                  relative: HorizontalPositionRelativeFrom.PAGE,
                  offset: toEmu(image.x, scale)
                },
                verticalPosition: {
                  relative: VerticalPositionRelativeFrom.PAGE,
                  offset: toEmu(image.y, scale)
                },
                allowOverlap: true,
                behindDocument: false,
                wrap: {
                  type: TextWrappingType.NONE
                },
                zIndex: 1
              }
            })
          ]
        })
      );
    });

    page.segments.forEach((segment) => {
      const text = getPdfSegmentText(segment).trim();
      if (!text) return;
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const fontSize = Math.min(32, Math.max(10, Math.round(segment.fontSize * scale * 2)));
      const frameHeight = Math.max(
        MIN_FRAME_HEIGHT_TWIPS,
        toTwips(segment.height + segment.fontSize * lines.length * 1.4, scale)
      );
      children.push(
        new Paragraph({
          children: lines.map((line, index) =>
            new TextRun({
              text: line,
              size: fontSize,
              break: index === 0 ? 0 : 1
            })
          ),
          frame: {
            type: 'absolute',
            position: {
              x: toTwips(segment.x, scale),
              y: toTwips(segment.y, scale)
            },
            width: Math.max(MIN_FRAME_WIDTH_TWIPS, toTwips(segment.width, scale)),
            height: frameHeight,
            anchor: {
              horizontal: FrameAnchorType.PAGE,
              vertical: FrameAnchorType.PAGE
            },
            wrap: FrameWrap.NONE,
            rule: HeightRule.ATLEAST
          },
          spacing: {
            before: 0,
            after: 0,
            line: Math.max(120, Math.round(fontSize * 120)),
            lineRule: 'auto'
          }
        })
      );
    });

    if (!children.length) {
      children.push(new Paragraph({ text: '' }));
    }

    return {
      properties: {
        page: {
          size: {
            width: Math.max(1, toTwips(page.width, scale)),
            height: Math.max(1, toTwips(page.height, scale))
          },
          margin: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            header: 0,
            footer: 0,
            gutter: 0
          }
        }
      },
      children
    };
  });

  const doc = new Document({
    creator: 'POCT Document Translator',
    description: `PDF layout translation for ${context.fileName} to ${targetLang}`,
    sections
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

export async function exportPdfTranslationAsPdf(
  context: PdfContext,
  filename: string
) {
  const pdf = await pdfjsLib.getDocument({ data: context.sourceData.slice() }).promise;
  let output: jsPDF | null = null;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const sourcePage = await pdf.getPage(pageNumber);
    const viewport = sourcePage.getViewport({ scale: 1 });
    const rendered = await renderPdfPageToCanvas(sourcePage, 2);
    if (!rendered) continue;
    const imageData = rendered.canvas.toDataURL("image/jpeg", 0.92);
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

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

    output.addImage(imageData, "JPEG", 0, 0, pageWidth, pageHeight);
    const pageContext = context.pages.find((page) => page.pageNumber === pageNumber);
    if (!pageContext) continue;

    pageContext.segments.forEach((segment) => {
      const text = sanitizePdfText(getPdfSegmentText(segment));
      if (!text) return;
      const fontSize = Math.min(28, Math.max(6, segment.fontSize || 10));
      const lineHeight = fontSize * 1.22;
      const maxWidth = Math.max(24, Math.min(pageWidth - segment.x - 8, segment.width || pageWidth - segment.x - 8));
      output!.setFont("helvetica", "normal");
      output!.setFontSize(fontSize);
      const lines = output!.splitTextToSize(text, maxWidth) as string[];
      const boxHeight = Math.max(segment.height + 4, lines.length * lineHeight + 4);
      output!.setFillColor(255, 255, 255);
      output!.rect(
        Math.max(0, segment.x - 1),
        Math.max(0, segment.y - 1),
        Math.min(pageWidth - segment.x + 1, maxWidth + 3),
        Math.min(pageHeight - segment.y + 1, boxHeight),
        "F"
      );
      output!.setTextColor(32, 36, 48);
      output!.text(lines, segment.x, segment.y + fontSize, {
        baseline: "alphabetic",
        lineHeightFactor: 1.22,
        maxWidth
      });
    });
  }

  if (!output) {
    throw new Error("PDF 导出失败：没有可渲染的页面。");
  }
  output.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
