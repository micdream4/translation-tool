import { POCTRecord, TargetLanguage } from "../types";
import { GLOSSARY_PROMPT, shouldUseEnglishGlossary } from "../utils/glossary";
import { parseModelJsonArray, sanitizeModelJson } from "../utils/jsonRepair";
import { getSeedGlossaryPrompt } from "../utils/seedTerminology";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const getEnvModel = (): string | undefined => {
  if (typeof import.meta !== "undefined") {
    const metaEnv = (import.meta as any).env || {};
    return (
      metaEnv.OPENROUTER_MODEL ||
      metaEnv.VITE_OPENROUTER_MODEL ||
      metaEnv.Openrouter_MODEL ||
      metaEnv.VITE_Openrouter_MODEL
    );
  }
  if (typeof process !== "undefined") {
    return (
      process.env.OPENROUTER_MODEL ||
      process.env.VITE_OPENROUTER_MODEL ||
      process.env.Openrouter_MODEL ||
      process.env.VITE_Openrouter_MODEL
    );
  }
  return undefined;
};

const getEnvKey = (): string => {
  if (typeof import.meta !== "undefined") {
    const metaEnv = (import.meta as any).env || {};
    const metaKey =
      metaEnv.OPENROUTER_API_KEY ||
      metaEnv.VITE_OPENROUTER_API_KEY ||
      metaEnv.Openrouter_API_KEY ||
      metaEnv.VITE_Openrouter_API_KEY;
    if (metaKey) return metaKey;
  }
  if (typeof process !== "undefined") {
    return (
      process.env.OPENROUTER_API_KEY ||
      process.env.VITE_OPENROUTER_API_KEY ||
      process.env.Openrouter_API_KEY ||
      process.env.VITE_Openrouter_API_KEY ||
      ""
    );
  }
  return "";
};

const sanitizeResponse = (text: string) =>
  sanitizeModelJson(text.replace(/```json|```/gi, ""));

const joinGlossaryBlocks = (...blocks: Array<string | undefined>) =>
  Array.from(
    new Set(
      blocks
        .flatMap((block) => String(block || "").split("\n"))
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ).join("\n");

export class OpenRouterService {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(model?: string) {
    this.model = (model || getEnvModel() || DEFAULT_MODEL).trim();
    this.apiKey = getEnvKey().trim();
    if (!this.apiKey) {
      throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in .env.local.");
    }
  }

  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage
  ): Promise<POCTRecord[]> {
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

    const prompt = `
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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer":
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      "X-Title": "POCT Medical Translator"
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content:
              "You translate medical POCT spreadsheets to the requested language while keeping structure unchanged."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error ${response.status}: ${errorText.slice(0, 200)}`
      );
    }

    const result = await response.json();
    let content = result.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      content = content
        .map((chunk: any) => chunk?.text ?? chunk?.content ?? "")
        .join("\n");
    }
    const text =
      typeof content === "string" ? sanitizeResponse(content) : "";
    if (!text) {
      throw new Error("OpenRouter API returned empty content.");
    }

    return parseModelJsonArray(text);
  }
}
