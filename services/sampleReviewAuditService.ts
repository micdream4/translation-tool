import type {
  ReviewSample,
  SampleReviewAIResult,
  SampleReviewRisk,
  SampleReviewVerdict,
  TargetLanguage
} from "../types";
import { parseModelJsonObject } from "../utils/jsonRepair";
import { getTargetLanguageLabel, getTargetLocaleInstruction } from "../utils/targetLanguage";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const getEnvValue = (key: string): string | undefined => {
  if (typeof import.meta !== "undefined") {
    const metaEnv = (import.meta as any).env || {};
    const value = metaEnv[key];
    if (value !== undefined) return String(value);
  }
  if (typeof process !== "undefined") {
    const value = (process as any).env?.[key];
    if (value !== undefined) return String(value);
  }
  return undefined;
};

const isDevMode = () => (getEnvValue("DEV") || "").toLowerCase() === "true";

const shouldUseProxy = () => {
  const explicitMode = (getEnvValue("VITE_TRANSLATION_MODE") || "").toLowerCase().trim();
  if (explicitMode === "proxy") return true;
  if (explicitMode === "direct") return false;
  return !isDevMode();
};

const getProxyEndpoint = () =>
  (getEnvValue("VITE_TRANSLATION_REVIEW_PROXY_URL") || "/api/review-samples").trim();

const getOpenRouterKey = () =>
  (
    getEnvValue("OPENROUTER_API_KEY") ||
    getEnvValue("VITE_OPENROUTER_API_KEY") ||
    getEnvValue("Openrouter_API_KEY") ||
    getEnvValue("VITE_Openrouter_API_KEY") ||
    ""
  ).trim();

const normalizeVerdict = (value: unknown): SampleReviewVerdict => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "fail") return "fail";
  if (normalized === "warning") return "warning";
  return "pass";
};

const normalizeRisk = (value: unknown): SampleReviewRisk => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
};

const normalizeReviewResults = (items: unknown): SampleReviewAIResult[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map<SampleReviewAIResult | null>((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id || "").trim();
      if (!id) return null;
      const issueTypes = Array.isArray(row.issueTypes)
        ? row.issueTypes.map((issue) => String(issue || "").trim()).filter(Boolean)
        : [];
      return {
        id,
        verdict: normalizeVerdict(row.verdict),
        risk: normalizeRisk(row.risk),
        issueTypes,
        comment: String(row.comment || "").trim(),
        suggestion: String(row.suggestion || "").trim()
      } satisfies SampleReviewAIResult;
    })
    .filter((item): item is SampleReviewAIResult => item !== null);
};

const buildPrompt = (samples: ReviewSample[], targetLang: TargetLanguage) => {
  const targetLabel = getTargetLanguageLabel(targetLang);
  const localeInstruction = getTargetLocaleInstruction(targetLang);
  return `
You are a senior bilingual medical translation reviewer.
Review each translation pair from Chinese source into ${targetLabel}.

Goals:
- Detect genuinely risky translation problems.
- Be conservative for Latin-script languages. Do NOT flag a sentence only because it contains shared medical terms, abbreviations, or familiar Latin words.
- Focus on meaning accuracy, omission, mistranslation, leftover source language, placeholder leakage, terminology mistakes, and serious fluency issues.
${localeInstruction}

Output rules:
- Return only valid JSON object: {"reviews":[...]}
- reviews length must match input length.
- Keep each review id exactly as provided.
- verdict must be one of: pass, warning, fail
- risk must be one of: low, medium, high
- issueTypes should use short labels from: accuracy, omission, untranslated, placeholder, terminology, fluency, grammar, format
- comment must be concise Simplified Chinese, for operator reading.
- suggestion should be empty if the target sentence is acceptable; otherwise provide a corrected ${targetLabel} rewrite for the target cell only.

Judging standard:
- pass: acceptable for production, maybe minor style differences only.
- warning: understandable but has quality risk worth manual review.
- fail: clear mistranslation, omitted meaning, wrong language, placeholder leak, or unusable wording.

INPUT:
${JSON.stringify(samples)}
`;
};

export class SampleReviewAuditService {
  private readonly endpoint = getProxyEndpoint();
  private readonly openRouterKey = getOpenRouterKey();

  async reviewSamples(
    samples: ReviewSample[],
    targetLang: TargetLanguage,
    model?: string
  ): Promise<{ model?: string; engine?: string; reviews: SampleReviewAIResult[] }> {
    if (!samples.length) {
      return { reviews: [] };
    }

    if (shouldUseProxy()) {
      return this.reviewViaProxy(samples, targetLang, model);
    }

    return this.reviewDirect(samples, targetLang, model);
  }

  private async reviewViaProxy(
    samples: ReviewSample[],
    targetLang: TargetLanguage,
    model?: string
  ) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ samples, targetLang, model })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Proxy review error ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const reviews = normalizeReviewResults(payload?.reviews ?? payload?.data ?? payload?.result);
    return {
      engine: typeof payload?.engine === "string" ? payload.engine : undefined,
      model: typeof payload?.model === "string" ? payload.model : undefined,
      reviews
    };
  }

  private async reviewDirect(
    samples: ReviewSample[],
    targetLang: TargetLanguage,
    model?: string
  ) {
    if (!this.openRouterKey) {
      throw new Error("Missing OpenRouter API key for AI review.");
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openRouterKey}`,
        "HTTP-Referer":
          typeof window !== "undefined" ? window.location.origin : "http://localhost",
        "X-Title": "POCT Medical Translator"
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: "You review medical spreadsheet translations and return strict JSON only."
          },
          {
            role: "user",
            content: buildPrompt(samples, targetLang)
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter review error ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    let content = payload.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      content = content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
    }
    const parsed = parseModelJsonObject<{ reviews?: unknown }>(String(content || ""));
    return {
      engine: "openrouter",
      model: model || DEFAULT_MODEL,
      reviews: normalizeReviewResults(parsed.reviews)
    };
  }
}
