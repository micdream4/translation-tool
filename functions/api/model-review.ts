import type { POCTRecord, TargetLanguage } from "../../types";
import {
  buildModelReviewRanking,
  DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
  DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
  normalizeModelReviewScores,
  type ModelReviewStyle,
  type ModelReviewCandidate,
  type ModelReviewJudgeResult,
  type ModelReviewSample
} from "../../utils/modelReview";
import { parseModelJsonArray, parseModelJsonObject } from "../../utils/jsonRepair";
import {
  buildOpenRouterPrompt,
  buildOpenRouterSystemPrompt,
  normalizeOpenRouterModelId,
  type TranslationProfile
} from "../../utils/translationProfiles";
import {
  getTargetLanguageLabel,
  getTargetLocaleInstruction,
  isTraditionalChineseTaiwanTarget
} from "../../utils/targetLanguage";
import { enforceRequestAuth, getOpenRouterKeyForUser, jsonResponse } from "../_shared/auth";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const parseModelList = (value: unknown, fallback: string[]) => {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\n;]+/);
  const parsed = raw
    .map((item) => normalizeOpenRouterModelId(String(item || "")))
    .filter(Boolean);
  return Array.from(new Set(parsed.length ? parsed : fallback.map(normalizeOpenRouterModelId)));
};

const MODEL_REVIEW_STYLES = new Set<ModelReviewStyle>([
  "auto",
  "medical-report",
  "ifu-manual",
  "marketing-readable",
  "terminology-faithful"
]);

const parseReviewStyle = (value: unknown, profile: TranslationProfile): ModelReviewStyle => {
  const raw = String(value || "").trim();
  if (MODEL_REVIEW_STYLES.has(raw as ModelReviewStyle)) return raw as ModelReviewStyle;
  return "auto";
};

const parseSamples = (value: unknown): ModelReviewSample[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map<ModelReviewSample | null>((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const sourceText = String(row.sourceText || "").trim();
      if (!sourceText) return null;
      return {
        id: String(row.id || `sample-${index + 1}`).trim(),
        location: String(row.location || `Segment ${index + 1}`).trim(),
        sourceText,
        contextBefore: Array.isArray(row.contextBefore)
          ? row.contextBefore.map((text) => String(text || "")).filter(Boolean).slice(-2)
          : [],
        contextAfter: Array.isArray(row.contextAfter)
          ? row.contextAfter.map((text) => String(text || "")).filter(Boolean).slice(0, 2)
          : []
      } satisfies ModelReviewSample;
    })
    .filter((item): item is ModelReviewSample => item !== null)
    .slice(0, 30);
};

const sanitizeContent = (content: unknown) => {
  if (Array.isArray(content)) {
    return content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
  }
  return typeof content === "string" ? content : "";
};

const callOpenRouter = async ({
  key,
  referer,
  model,
  system,
  user,
  maxTokens = 5000
}: {
  key: string;
  referer: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}) => {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": referer,
      "X-Title": "POCT Medical Translator"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${text.slice(0, 300)}`);
  }
  const payload = JSON.parse(text);
  const content = sanitizeContent(payload.choices?.[0]?.message?.content);
  if (!content.trim()) throw new Error("OpenRouter returned empty content.");
  return content;
};

const translateWithModel = async ({
  key,
  referer,
  model,
  samples,
  targetLang,
  profile
}: {
  key: string;
  referer: string;
  model: string;
  samples: ModelReviewSample[];
  targetLang: TargetLanguage;
  profile: TranslationProfile;
}): Promise<ModelReviewCandidate["translations"]> => {
  const records: POCTRecord[] = samples.map((sample) => ({
    id: sample.id,
    content: sample.sourceText,
    contextBefore: sample.contextBefore?.join("\n") || "",
    contextAfter: sample.contextAfter?.join("\n") || ""
  }));
  const content = await callOpenRouter({
    key,
    referer,
    model,
    system: buildOpenRouterSystemPrompt(profile),
    user: buildOpenRouterPrompt(records, targetLang, profile),
    maxTokens: 7000
  });
  const parsed = parseModelJsonArray<POCTRecord>(content);
  return samples.map((sample, index) => {
    const record = parsed.find((item) => String(item?.id || "") === sample.id) || parsed[index] || {};
    return {
      id: sample.id,
      translation: String(record.content || "").trim()
    };
  });
};

const getReviewStyleGuidance = (reviewStyle: ModelReviewStyle) => {
  const guidanceMap: Record<ModelReviewStyle, { scenario: string; guidance: string; system: string }> = {
    auto: {
      scenario: "medical/IVD content with an unspecified target style",
      guidance: `- First infer the source content type from samples, then apply the most appropriate professional medical translation standard.
- Do not force IFU/manual style onto spreadsheet cells, and do not force terse table style onto prose.
- Score "manualStyle" as fit for the inferred content type.`,
      system: "You are a strict anonymous translation quality judge for medical and IVD translations. Infer the appropriate style from the samples. Return JSON only."
    },
    "medical-report": {
      scenario: "clinical/POCT spreadsheet cells, AI interpretation tables, and report comments",
      guidance: `- Evaluate cell-level translation quality: concise, medically clear, suitable for spreadsheet/report interpretation, and not over-expanded.
- Do not require IFU/manual prose style for spreadsheet cells. Score "manualStyle" as "cell/report style fit".
- Score "avoidYou" as concise impersonal phrasing; there is usually no reason to introduce "you/your" in spreadsheet interpretations.`,
      system: "You are a strict anonymous translation quality judge for clinical spreadsheet and POCT report interpretation translations. Return JSON only."
    },
    "ifu-manual": {
      scenario: "IVD analyzer IFU/operator manuals",
      guidance: `- For English manual prose, penalize unnecessary direct "you/your"; prefer imperative, passive voice, "the user", "the operator", or "personnel" when natural.
- Score "manualStyle" as IFU/operator manual style fit.
- Score "avoidYou" as avoiding unnecessary direct address.`,
      system: "You are a strict anonymous translation quality judge for IVD operator manuals. Return JSON only."
    },
    "marketing-readable": {
      scenario: "medical product copy that should be user-readable without losing technical meaning",
      guidance: `- Reward natural, clear, user-readable language while preserving medical and product claims exactly.
- Penalize exaggerated claims, added benefits, unsafe simplification, or casual tone.
- Score "manualStyle" as audience readability and product-copy fit.`,
      system: "You are a strict anonymous translation quality judge for readable medical product translations. Return JSON only."
    },
    "terminology-faithful": {
      scenario: "regulated medical labels, parameters, terminology lists, and conservative technical text",
      guidance: `- Reward conservative, terminology-faithful translation with minimal rewriting.
- Penalize creative paraphrase, extra interpretation, changed term boundaries, and format drift.
- Score "manualStyle" as faithful technical/register fit.`,
      system: "You are a strict anonymous translation quality judge for conservative terminology-faithful medical translations. Return JSON only."
    }
  };
  return guidanceMap[reviewStyle] || guidanceMap.auto;
};

const buildJudgePrompt = (
  samples: ModelReviewSample[],
  candidates: ModelReviewCandidate[],
  targetLang: TargetLanguage,
  reviewStyle: ModelReviewStyle
) => {
  const anonymousOutputs = candidates.map((candidate) => ({
    alias: candidate.alias,
    outputs: candidate.translations
  }));
  const styleGuidance = getReviewStyleGuidance(reviewStyle);
  const targetLabel = getTargetLanguageLabel(targetLang);
  const localeInstruction = getTargetLocaleInstruction(targetLang);
  const taiwanJudgingRule = isTraditionalChineseTaiwanTarget(targetLang)
    ? "- For Traditional Chinese (Taiwan), penalize Simplified Chinese characters, Mainland phrasing, and non-Taiwan medical wording; reward natural Taiwanese Traditional Chinese usage."
    : "";
  return `
Evaluate anonymous Chinese-to-${targetLabel} translations for ${styleGuidance.scenario}.

Important:
- Do not infer or mention model names. Judge only Candidate aliases.
- Company-name romanization is not a scoring factor unless the source explicitly contains a protected company name and the candidate changes it incorrectly.
- Preserve clinical meaning, severity, conditions, units, symbols, placeholders, table headers, and UI labels.
- Penalize literal Chinese syntax, omitted meaning, unsafe interpretation changes, terminology drift, and placeholder/UI-label damage.
${localeInstruction}
${taiwanJudgingRule}
${styleGuidance.guidance}

Score each candidate 1-10 on:
accuracy, fluency, manualStyle, terminology, formatSafety, avoidLiteral, avoidYou, overall.

Return only valid JSON:
{"scores":[{"alias":"Candidate A","accuracy":9,"fluency":9,"manualStyle":9,"terminology":9,"formatSafety":9,"avoidLiteral":9,"avoidYou":9,"overall":9,"notes":"concise Chinese notes"}]}

Samples:
${JSON.stringify(samples)}

Anonymous candidate outputs:
${JSON.stringify(anonymousOutputs)}
`;
};

export const onRequestPost = async (context: any) => {
  try {
    const payload = await context.request.json();
    const samples = parseSamples(payload?.samples);
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const profile: TranslationProfile = payload?.profile === "docx-manual" ? "docx-manual" : "spreadsheet";
    const reviewStyle = parseReviewStyle(payload?.reviewStyle, profile);

    if (!samples.length || !targetLang) {
      return jsonResponse({ error: "Invalid payload." }, 400);
    }

    const env = (context.env || {}) as Record<string, unknown>;
    const authResult = enforceRequestAuth(context.request, env);
    if (!authResult.ok) return authResult.response;
    const openRouterKey = getOpenRouterKeyForUser(env, authResult.auth.userEmail);
    if (!openRouterKey) return jsonResponse({ error: "OpenRouter key missing." }, 400);

    const translationModels = parseModelList(
      payload?.translationModels || env.MODEL_REVIEW_TRANSLATION_MODELS,
      DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS
    );
    const judgeModels = parseModelList(
      payload?.judgeModels || env.MODEL_REVIEW_JUDGE_MODELS,
      DEFAULT_MODEL_REVIEW_JUDGE_MODELS
    );
    const referer =
      env.OPENROUTER_SITE ||
      context.request.headers.get("Origin") ||
      "https://poct-translator.local";

    const aliases = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const candidates: ModelReviewCandidate[] = await Promise.all(translationModels.map(async (model, index) => {
      const started = Date.now();
      const alias = `Candidate ${aliases[index] || index + 1}`;
      try {
        const translations = await translateWithModel({
          key: openRouterKey,
          referer,
          model,
          samples,
          targetLang,
          profile
        });
        return {
          model,
          alias,
          translations,
          elapsedMs: Date.now() - started
        };
      } catch (error) {
        return {
          model,
          alias,
          translations: [],
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - started
        };
      }
    }));

    const successfulCandidates = candidates.filter((candidate) => candidate.translations.length);
    if (!successfulCandidates.length) {
      return jsonResponse({ error: "All translation candidates failed.", candidates }, 500);
    }

    const aliasToModel = new Map(candidates.map((candidate) => [candidate.alias, candidate.model]));
    const judges: ModelReviewJudgeResult[] = await Promise.all(judgeModels.map(async (model) => {
      try {
        const content = await callOpenRouter({
          key: openRouterKey,
          referer,
          model,
          system: getReviewStyleGuidance(reviewStyle).system,
          user: buildJudgePrompt(samples, successfulCandidates, targetLang, reviewStyle),
          maxTokens: 7000
        });
        const parsed = parseModelJsonObject<{ scores?: unknown }>(content);
        return {
          model,
          scores: normalizeModelReviewScores(parsed.scores, aliasToModel)
        };
      } catch (error) {
        return {
          model,
          scores: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));

    const ranking = buildModelReviewRanking(candidates, judges);
    return jsonResponse({
      createdAt: new Date().toISOString(),
      targetLang,
      profile,
      reviewStyle,
      samples,
      candidates,
      judges,
      ranking
    });
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Unhandled error" }, 500);
  }
};
