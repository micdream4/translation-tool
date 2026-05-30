import type {
  ReviewSample,
  SampleReviewAIResult,
  SampleReviewRisk,
  SampleReviewVerdict,
  TargetLanguage
} from "../../types";
import { parseModelJsonObject } from "../../utils/jsonRepair";
import { getTargetLanguageLabel, getTargetLocaleInstruction } from "../../utils/targetLanguage";
import { enforceRequestAuth, jsonResponse } from "../_shared/auth";
import { callRoutedChat, parseDelimitedModelList } from "../_shared/llmProviders";

const DEFAULT_REVIEW_MODELS = [
  "cloudflare-ai:openai/gpt-5.4",
  "cloudflare-ai:anthropic/claude-sonnet-4.6",
  "deepseek:deepseek-v4-flash"
];

const parseRequestedModel = (value: unknown) => String(value || "").trim();

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

const buildReviewPrompt = (samples: ReviewSample[], targetLang: TargetLanguage) => {
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

export const onRequestPost = async (context: any) => {
  try {
    const payload = await context.request.json();
    const samples = payload?.samples as ReviewSample[] | undefined;
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const requestedModel = parseRequestedModel(payload?.model);

    if (!Array.isArray(samples) || !targetLang) {
      return jsonResponse({ error: "Invalid payload." }, 400);
    }

    const env = (context.env || {}) as Record<string, unknown>;
    const authResult = enforceRequestAuth(context.request, env);
    if (!authResult.ok) return authResult.response;
    const models = requestedModel
      ? [requestedModel]
      : parseDelimitedModelList(
          env.SAMPLE_REVIEW_MODELS ||
            env.MODEL_REVIEW_JUDGE_MODELS ||
            env.CLOUDFLARE_REVIEW_JUDGE_MODELS,
          DEFAULT_REVIEW_MODELS
        );
    const prompt = buildReviewPrompt(samples, targetLang);
    const errors: string[] = [];

    for (const model of models) {
      try {
        const result = await callRoutedChat({
          env,
          model,
          system: "You review medical spreadsheet translations and return strict JSON only.",
          user: prompt,
          maxTokens: 7000,
          json: true
        });
        const parsed = parseModelJsonObject<{ reviews?: unknown }>(result.text);
        const reviews = normalizeReviewResults(parsed.reviews);
        return jsonResponse({ engine: result.engine, model, reviews });
      } catch (error) {
        errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return jsonResponse(
      {
        error: `All review models failed. ${errors.join(" | ").slice(0, 1500)}`
      },
      500
    );
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Unhandled error" }, 500);
  }
};
