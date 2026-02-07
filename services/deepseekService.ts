import { POCTRecord, TargetLanguage } from "../types";
import { GLOSSARY_PROMPT } from "../utils/glossary";
import { parseModelJsonArray, sanitizeModelJson } from "../utils/jsonRepair";

const API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";

const getEnvKey = (): string => {
  const viteKey =
    typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_DEEPSEEK_API_KEY
      : "";
  const nodeKey =
    typeof process !== "undefined"
      ? process.env.VITE_DEEPSEEK_API_KEY ||
        process.env.Deepseek_API_KEY ||
        process.env.DEEPSEEK_API_KEY
      : "";
  return (viteKey || nodeKey || "").trim();
};

export class DeepseekService {
  private readonly model: string;

  constructor(model: string = DEFAULT_MODEL) {
    this.model = model;
  }

  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage
  ): Promise<POCTRecord[]> {
    const apiKey = getEnvKey();
    if (!apiKey) {
      throw new Error("Deepseek API key is missing. Set VITE_DEEPSEEK_API_KEY or Deepseek_API_KEY in .env.local.");
    }

    const prompt = `
You are a senior clinical documentation translator. Translate every string field in the JSON array to ${targetLang} with fluent, professional POCT wording.

Glossary (Chinese => preferred term):
${GLOSSARY_PROMPT}

Rules:
- Always map glossary terms to the preferred wording exactly.
- Preserve IDs, numeric values, and codes exactly.
- If a cell mixes codes with descriptive text, keep the code and only translate the descriptive part.
- Keep placeholder tokens such as "__TKN_0__", "__ID_0__", "__FMT_0__" exactly as provided; they mark UI literals, product names, inline English, or format placeholders that must stay untouched.
- Inline English UI terms (Login, admin, START, etc.) must remain unchanged even within Chinese sentences.
- Produce natural manual-style sentences instead of literal word-by-word output.
- Return a JSON array with the same length/keys as input. Respond with JSON only, no explanations.

INPUT:
${JSON.stringify(records)}
`;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You translate structured POCT/clinical spreadsheets while preserving grid layout."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepseek API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const text =
      result.choices?.[0]?.message?.content?.replace(/```json|```/g, "") ?? "";
    if (!text) {
      throw new Error("Deepseek API returned empty response.");
    }

    return parseModelJsonArray(sanitizeModelJson(text));
  }
}
