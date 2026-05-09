import * as pdfjsLib from 'pdfjs-dist';
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun
} from 'docx';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export interface PdfSegment {
  id: string;
  pageNumber: number;
  original: string;
  translated: string;
}

export interface PdfImage {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PdfPageContext {
  pageNumber: number;
  segments: PdfSegment[];
  imageCount: number;
  images: PdfImage[];
}

export interface PdfContext {
  fileName: string;
  pageCount: number;
  pages: PdfPageContext[];
  segments: PdfSegment[];
  images: PdfImage[];
  coverageWarnings: string[];
}

type TextItemLike = {
  str?: string;
  hasEOL?: boolean;
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
    try {
      const rawImage = await getPdfObject(page.objs, bound.id);
      const png = await imageDataToPng(rawImage);
      if (png) {
        images.push({
          id: bound.id,
          pageNumber,
          width: rawImage.width || 0,
          height: rawImage.height || 0,
          data: png
        });
        continue;
      }
    } catch {
      // Fall through to rendered-region extraction.
    }

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
    const png = await cropCanvasToPng(renderedCanvas, minX, minY, width, height);
    if (png) {
      images.push({
        id: bound.id,
        pageNumber,
        width,
        height,
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
    const textContent = await page.getTextContent();
    const operatorList = await page.getOperatorList();
    const imageCount = operatorList.fnArray.filter((fn) => IMAGE_OPERATORS.has(fn)).length;
    totalImages += imageCount;
    const rendered = imageCount > 0 ? await renderPageForImageObjects(page) : null;
    const pageImages = rendered
      ? await extractPageImages(page, rendered.canvas, rendered.viewport, operatorList, pageNumber)
      : [];
    images.push(...pageImages);

    const pageSegments = splitPageText(textContent.items as TextItemLike[]).map((text, idx) => {
      const segment: PdfSegment = {
        id: `pdf-page-${pageNumber}-segment-${idx}`,
        pageNumber,
        original: text,
        translated: ''
      };
      segments.push(segment);
      return segment;
    });

    pages.push({
      pageNumber,
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
      text: `Translated PDF - ${targetLang}`,
      heading: HeadingLevel.TITLE
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: context.fileName,
          italics: true
        })
      ]
    })
  ];

  context.pages.forEach((page) => {
    children.push(
      new Paragraph({
        text: `Page ${page.pageNumber}`,
        heading: HeadingLevel.HEADING_2
      })
    );

    page.segments.forEach((segment) => {
      const text = getPdfSegmentText(segment).trim();
      if (!text) return;
      text.split(/\n+/).forEach((line) => {
        const normalized = line.trim();
        if (normalized) {
          children.push(new Paragraph({ text: normalized }));
        }
      });
    });

    if (page.images.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Source images',
              bold: true
            })
          ]
        })
      );
    }

    page.images.forEach((image) => {
      const maxWidth = 420;
      const scale = image.width > maxWidth ? maxWidth / image.width : 1;
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: image.data,
              transformation: {
                width,
                height
              }
            })
          ]
        })
      );
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
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
