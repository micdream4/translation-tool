import { POCTRecord, TargetLanguage } from "../types";
import { parseModelJsonArray, sanitizeModelJson } from "../utils/jsonRepair";
import {
  buildOpenRouterPrompt,
  buildOpenRouterSystemPrompt,
  type TranslationProfile
} from "../utils/translationProfiles";

const API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";

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
    targetLang: TargetLanguage,
    profile: TranslationProfile = "spreadsheet"
  ): Promise<POCTRecord[]> {
    const apiKey = getEnvKey();
    if (!apiKey) {
      throw new Error("Deepseek API key is missing. Set VITE_DEEPSEEK_API_KEY or Deepseek_API_KEY in .env.local.");
    }

    const prompt = buildOpenRouterPrompt(records, targetLang, profile);

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        thinking: { type: "disabled" },
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: buildOpenRouterSystemPrompt(profile)
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
    let content = result.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      content = content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
    }
    const text = typeof content === "string" ? content.replace(/```json|```/g, "") : "";
    if (!text) {
      throw new Error("Deepseek API returned empty response.");
    }

    return parseModelJsonArray(sanitizeModelJson(text));
  }
}
