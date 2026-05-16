const PDF_TEXT_LAYER_SAFE_REGEX = /^[\u0009\u000A\u000D\u0020-\u00FF]+$/;

const sanitizePdfTextLayerSource = (value: string) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();

export const normalizePdfTextLayerText = (value: string) =>
  sanitizePdfTextLayerSource(value)
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/\u0153/g, "oe")
    .replace(/\u0152/g, "OE")
    .replace(/\u00B5/g, "u")
    .replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

export const hasUsefulPdfTextLayer = (sourceText: string, textLayerText: string) => {
  const sourceComparable = sanitizePdfTextLayerSource(sourceText).replace(/\s+/g, "");
  const layerComparable = textLayerText.replace(/\s+/g, "");
  if (!layerComparable) return false;
  if (!/[A-Za-z0-9\u00C0-\u00FF]/.test(layerComparable)) return false;
  return layerComparable.length >= Math.max(1, Math.floor(sourceComparable.length * 0.6));
};

export const canDrawSelectablePdfText = (text: string) => {
  const textLayerText = normalizePdfTextLayerText(text);
  return PDF_TEXT_LAYER_SAFE_REGEX.test(textLayerText) && hasUsefulPdfTextLayer(text, textLayerText);
};

export { PDF_TEXT_LAYER_SAFE_REGEX };
