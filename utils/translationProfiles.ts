import type { POCTRecord, TargetLanguage } from "../types";
import { GLOSSARY_PROMPT, shouldUseEnglishGlossary } from "./glossary";
import { getSeedGlossaryPrompt } from "./seedTerminology";

export type TranslationProfile = "spreadsheet" | "docx-manual";

export const DOCX_MANUAL_OPENROUTER_MODELS = [
  "qwen/qwen3.6-plus",
  "deepseek/deepseek-v4-pro",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.3-chat",
  "google/gemini-3-flash-preview"
];

const joinGlossaryBlocks = (...blocks: Array<string | undefined>) =>
  Array.from(
    new Set(
      blocks
        .flatMap((block) => String(block || "").split("\n"))
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ).join("\n");

const buildGlossarySection = (records: POCTRecord[], targetLang: TargetLanguage) => {
  const useEnglishGlossary = shouldUseEnglishGlossary(targetLang);
  const sourceText = JSON.stringify(records);
  const seedGlossaryPrompt = getSeedGlossaryPrompt(targetLang, sourceText);
  const combinedGlossaryPrompt = joinGlossaryBlocks(
    useEnglishGlossary ? GLOSSARY_PROMPT : "",
    seedGlossaryPrompt
  );
  const glossarySection = combinedGlossaryPrompt
    ? `\nTerminology (Chinese => preferred target wording):\n${combinedGlossaryPrompt}\n`
    : "";
  const glossaryRule = combinedGlossaryPrompt
    ? "- Follow the terminology list exactly when the source contains those concepts."
    : `- Translate medical terminology fully into ${targetLang}. Keep only true codes, model numbers, and standard abbreviations (e.g., WBC, RBC, QC) unchanged.`;

  return { glossarySection, glossaryRule };
};

const buildSpreadsheetPrompt = (records: POCTRecord[], targetLang: TargetLanguage) => {
  const { glossarySection, glossaryRule } = buildGlossarySection(records, targetLang);
  return `
You are a senior hematology-manual translator. Convert every string within the JSON array to ${targetLang} while maintaining fluent instructions.
${glossarySection}

Rules:
${glossaryRule}
- Translate any non-${targetLang} natural-language text (including full English sentences) into ${targetLang}.
- Translate address/common nouns such as "Room", "Building", "Street", "District", "City", "Province" into ${targetLang}; keep only true proper names transliterated or unchanged.
- Preserve numbers, IDs, measurement units, and codes exactly.
- If a cell mixes code + text, keep the code intact and only translate the descriptive part.
- Keep placeholder tokens such as "__TKN_0__", "__ID_0__", "__FMT_0__" exactly as provided; they mark protected IDs, codes, or format placeholders.
- Do not invent or introduce new placeholder tokens; only preserve placeholders already present in input.
- Keep only true UI/code tokens unchanged (e.g., "Login", "admin", "START", button labels, product code literals). Do NOT keep full English prose unchanged when target is not English.
- Preserve original wrapper symbols around UI labels exactly (e.g., 『Next』, 『Back』, 【Home】); do not replace them with straight quotes.
- Optimize spacing and punctuation to read naturally in ${targetLang}.
- Always return a valid JSON object: {"records":[...]} where records keeps the same length/keys. No explanations outside JSON.

INPUT:
${JSON.stringify(records)}
`;
};

const buildDocxManualPrompt = (records: POCTRecord[], targetLang: TargetLanguage) => {
  const { glossarySection, glossaryRule } = buildGlossarySection(records, targetLang);
  const englishManualRule = shouldUseEnglishGlossary(targetLang)
    ? '- For English manual prose, avoid directly addressing the reader with "you" or "your" unless unavoidable; prefer imperative instructions, passive voice, "the user", "the operator", or "personnel" where natural.'
    : `- Use polished operator-manual style in ${targetLang}; avoid literal source-language word order and unnecessary expansion.`;

  return `
You are a senior localization translator for IVD analyzer Instructions for Use (IFU), operator manuals, and quality-control manuals. Convert every string within the JSON array to ${targetLang} with publication-ready manual language.
${glossarySection}

Rules:
${glossaryRule}
- Translate any non-${targetLang} natural-language text into ${targetLang}.
- Preserve warning severity, regulatory meaning, UI labels, model names, standards, numbers, units, IDs, and placeholder tokens exactly.
- Keep placeholder tokens such as "__TKN_0__", "__ID_0__", "__FMT_0__" exactly as provided; do not invent or rename placeholders.
- Preserve original wrapper symbols around UI labels exactly (e.g., 『Next』, 『Back』, 【Home】); do not replace them with straight quotes.
- Keep compact UI/table text compact; do not add explanations that are not present in the source.
- Use natural IFU/operator-manual wording instead of word-by-word Chinese syntax.
${englishManualRule}
- Always return a valid JSON object: {"records":[...]} where records keeps the same length/keys. No explanations outside JSON.

INPUT:
${JSON.stringify(records)}
`;
};

export const buildOpenRouterPrompt = (
  records: POCTRecord[],
  targetLang: TargetLanguage,
  profile: TranslationProfile = "spreadsheet"
) =>
  profile === "docx-manual"
    ? buildDocxManualPrompt(records, targetLang)
    : buildSpreadsheetPrompt(records, targetLang);

export const buildOpenRouterSystemPrompt = (
  profile: TranslationProfile = "spreadsheet"
) =>
  profile === "docx-manual"
    ? "You translate IVD analyzer IFU/operator manual text while preserving structure, terminology, UI labels, placeholders, and segment boundaries."
    : "You translate medical POCT spreadsheets to the requested language while keeping structure unchanged.";
