import type { PdfSegment } from './pdf';

// Kept apart from utils/pdf so code that only reads segment text does not pull in pdf.js,
// pdf-lib and docx. The heavy module is loaded when a PDF is parsed or exported.
export const getPdfSegmentText = (segment: PdfSegment) =>
  segment.translated || segment.original;

export const setPdfSegmentText = (segment: PdfSegment, text: string) => {
  segment.translated = text;
};
