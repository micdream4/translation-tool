import { POCTRecord, TargetLanguage } from "../types";
import { parseModelJsonArray, sanitizeModelJson } from "../utils/jsonRepair";
import {
  buildOpenRouterPrompt,
  buildOpenRouterSystemPrompt,
  normalizeOpenRouterModelId,
  type TranslationProfile
} from "../utils/translationProfiles";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "";
const DEFAULT_OPENROUTER_REQUEST_TIMEOUT_MS = 30000;

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

const getEnvNumber = (key: string): number | undefined => {
  const raw =
    typeof import.meta !== "undefined"
      ? (import.meta as any).env?.[key]
      : typeof process !== "undefined"
        ? (process as any).env?.[key]
        : undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

const getOpenRouterTimeoutMs = () =>
  Math.min(
    55000,
    Math.max(5000, Math.round(getEnvNumber("OPENROUTER_REQUEST_TIMEOUT_MS") || DEFAULT_OPENROUTER_REQUEST_TIMEOUT_MS))
  );

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
};

export class OpenRouterService {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(model?: string) {
    this.model = normalizeOpenRouterModelId(model || getEnvModel() || DEFAULT_MODEL);
    this.apiKey = getEnvKey().trim();
    if (!this.apiKey) {
      throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in .env.local.");
    }
  }

  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage,
    options: {
      model?: string;
      models?: string[];
      profile?: TranslationProfile;
    } = {}
  ): Promise<POCTRecord[]> {
    const profile = options.profile || "spreadsheet";
    const prompt = buildOpenRouterPrompt(records, targetLang, profile);
    const requestedModels = options.model ? [options.model] : options.models || [];
    const modelCandidates = requestedModels.length > 0 ? requestedModels : [this.model];
    const models = Array.from(
      new Set(
        modelCandidates
          .map((model) => normalizeOpenRouterModelId(model))
          .filter(Boolean)
      )
    );
    if (models.length === 0) {
      throw new Error("No OpenRouter model configured.");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer":
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      "X-Title": "POCT Medical Translator"
    };

    const errors: string[] = [];
    const requestTimeoutMs = getOpenRouterTimeoutMs();
    for (const model of models) {
      try {
        const response = await fetchWithTimeout(
          API_URL,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              temperature: 0,
              response_format: {
                type: "json_object"
              },
              provider: {
                sort: "throughput",
                allow_fallbacks: true
              },
              messages: [
                {
                  role: "system",
                  content: buildOpenRouterSystemPrompt(profile)
                },
                { role: "user", content: prompt }
              ]
            })
          },
          requestTimeoutMs,
          model
        );

        if (!response.ok) {
          const errorText = await response.text();
          errors.push(`OpenRouter API error ${response.status}: ${errorText.slice(0, 200)}`);
          continue;
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
          errors.push("OpenRouter API returned empty content.");
          continue;
        }

        return parseModelJsonArray(text);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(`All OpenRouter models failed. ${errors.join(" | ").slice(0, 1500)}`);
  }
}
