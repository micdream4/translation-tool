import { enforceGlossary } from "./glossary";

const LATIN_CHAR_REGEX = /[A-Za-z]/;
const NEWLINE_CAPTURE = /(\r?\n)/;
const LONG_FORM_THRESHOLD = 60;

const fixSegmentSpacing = (segment: string) => {
  let result = segment;
  result = result.replace(/\b([eE])\s*\.\s*g\s*\./g, (_match, initial) => {
    return `${initial}.g.`;
  });
  result = result.replace(/\s+([,.;:!?])/g, "$1");
  result = result.replace(/([,.;!?])(?![\s"')\]\}])/g, "$1 ");
  result = result.replace(/:(?!\/\/)(?![\s"')\]\}])/g, ": ");
  result = result.replace(/([.!?])([A-Z])/g, "$1 $2");
  result = result.replace(/([a-z])([A-Z][a-z])/g, "$1 $2");
  result = result.replace(/([0-9])([A-Za-z])/g, "$1 $2");
  result = result.replace(/([A-Za-z])([0-9])/g, "$1 $2");
  result = result.replace(/ {2,}/g, (match, offset) => (offset === 0 ? match : " "));
  return result;
};

export const fixSpacingArtifacts = (text: string) => {
  if (!text || !LATIN_CHAR_REGEX.test(text)) return text;
  const segments = text.split(NEWLINE_CAPTURE);
  return segments
    .map((segment) => {
      if (!segment || NEWLINE_CAPTURE.test(segment)) {
        return segment;
      }
      return fixSegmentSpacing(segment);
    })
    .join("");
};

const adjustLongFormStatus = (text: string) => {
  if (!text) return text;
  const isLongForm = text.length > LONG_FORM_THRESHOLD || /[.;:!?]/.test(text);
  if (!isLongForm) return text;
  let output = text;

  output = output.replace(/\bElevated fever\b/gi, "high fever");
  output = output.replace(/\bAn Elevated\b/gi, "An increase");
  output = output.replace(/\bA Decreased\b/gi, "A decrease");
  output = output.replace(/\bAn Decreased\b/gi, "A decrease");
  output = output.replace(/\b(slight|mild)\s+Elevated\b/gi, (_match, level) => {
    return `${level} increase`;
  });
  output = output.replace(/\b(slight|mild)\s+Decreased\b/gi, (_match, level) => {
    return `${level} decrease`;
  });

  output = output.replace(/\bElevated in\b/gi, (match) => {
    return match[0] === "E" ? "Increase in" : "increase in";
  });
  output = output.replace(/\bDecreased in\b/gi, (match) => {
    return match[0] === "D" ? "Decrease in" : "decrease in";
  });

  output = output.replace(
    /\bElevated total (spherocytes|ghost cells|reticulocytes)\s+is\b/gi,
    (_match, group) => `Elevated total ${group} are`
  );

  output = output.replace(/\bElevated in the number of\b/gi, (match) => {
    return match[0] === "E" ? "Increase in the number of" : "increase in the number of";
  });
  output = output.replace(/\bDecreased in the number of\b/gi, (match) => {
    return match[0] === "D" ? "Decrease in the number of" : "decrease in the number of";
  });

  return output;
};

export const polishTranslation = (original: string, translated: string) => {
  if (typeof translated !== "string") return translated;
  let refined = fixSpacingArtifacts(translated);
  refined = enforceGlossary(original || "", refined);
  refined = adjustLongFormStatus(refined);
  return refined;
};
