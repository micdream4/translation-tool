import type { POCTRecord, TargetLanguage } from "../../types";
import {
  buildModelReviewRanking,
  normalizeModelReviewScores,
  type ModelReviewStyle,
  type ModelReviewCandidate,
  type ModelReviewJudgeResult,
  type ModelReviewSample
} from "../../utils/modelReview";
import { parseModelJsonArray, parseModelJsonObject } from "../../utils/jsonRepair";
import {
  buildTranslationPrompt,
  buildTranslationSystemPrompt,
  type TranslationProfile
} from "../../utils/translationProfiles";
import {
  getTargetLanguageLabel,
  getTargetLocaleInstruction,
  isTraditionalChineseTaiwanTarget
} from "../../utils/targetLanguage";
import { renderRetentionPolicyForReview } from "../../rules/policy";
import { enforceRequestAuth, jsonResponse } from "../_shared/auth";
import { getMaxRequestBytes, getMaxSamples, readJsonBodyWithLimit, validateModelList } from "../_shared/limits";
import { callRoutedChat, parseDelimitedModelList, parseRoutedModel } from "../_shared/llmProviders";
import {
  findDisallowedModel,
  getAllowedReviewModels,
  getReviewJudgeModels,
  getReviewTranslationModels,
  isAllowedTargetLanguage
} from "../_shared/modelAllowlist";
import { UNTRUSTED_DATA_RULE, wrapUntrustedJson } from "../../utils/promptIsolation";

// Translations and judging run inside one request, which Cloudflare closes after about 100 s.
const TOTAL_BUDGET_MS = 90_000;
const MIN_MODEL_ATTEMPT_MS = 4_000;

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

const callModel = async ({
  env,
  model,
  system,
  user,
  maxTokens = 5000,
  timeoutMs
}: {
  env: Record<string, unknown>;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}) => {
  if (timeoutMs !== undefined && timeoutMs < MIN_MODEL_ATTEMPT_MS) {
    throw new Error(`Skipped: the ${TOTAL_BUDGET_MS / 1000}s time budget is used up.`);
  }
  const result = await callRoutedChat({ env, model, system, user, maxTokens, json: true, timeoutMs });
  return sanitizeContent(result.text);
};

const translateWithModel = async ({
  env,
  model,
  samples,
  targetLang,
  profile,
  timeoutMs
}: {
  env: Record<string, unknown>;
  model: string;
  samples: ModelReviewSample[];
  targetLang: TargetLanguage;
  profile: TranslationProfile;
  timeoutMs?: number;
}): Promise<ModelReviewCandidate["translations"]> => {
  const records: POCTRecord[] = samples.map((sample) => ({
    id: sample.id,
    content: sample.sourceText,
    contextBefore: sample.contextBefore?.join("\n") || "",
    contextAfter: sample.contextAfter?.join("\n") || ""
  }));
  const content = await callModel({
    env,
    model,
    system: buildTranslationSystemPrompt(profile),
    user: buildTranslationPrompt(records, targetLang, profile),
    maxTokens: 7000,
    timeoutMs
  });
  return alignCandidateTranslations(samples, parseModelJsonArray<POCTRecord>(content));
};

/**
 * Candidate translations are matched to samples by id only; a record without a matching id is
 * not assigned by position (that silently paired the wrong texts). A reply with no usable
 * translation is the candidate's failure, not an empty success.
 */
export const alignCandidateTranslations = (samples: Array<{ id: string }>, parsed: POCTRecord[]) => {
  const byId = new Map(
    (Array.isArray(parsed) ? parsed : [])
      .filter((item) => item && String(item.id || ""))
      .map((item) => [String(item.id), String(item.content || "").trim()])
  );
  const translations = samples.map((sample) => ({ id: sample.id, translation: byId.get(sample.id) || "" }));
  if (!translations.some((item) => item.translation)) {
    throw new Error("Model returned no usable translations for the review samples.");
  }
  return translations;
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
${renderRetentionPolicyForReview()}
- Preserve clinical meaning, severity, conditions, units, symbols, placeholders, table headers, and UI labels.
- Penalize literal Chinese syntax, omitted meaning, unsafe interpretation changes, terminology drift, and placeholder/UI-label damage.
${localeInstruction}
${taiwanJudgingRule}
${styleGuidance.guidance}
${UNTRUSTED_DATA_RULE}

Score each candidate 1-10 on:
accuracy, fluency, manualStyle, terminology, formatSafety, avoidLiteral, avoidYou, overall.

Return only valid JSON:
{"scores":[{"alias":"Candidate A","accuracy":9,"fluency":9,"manualStyle":9,"terminology":9,"formatSafety":9,"avoidLiteral":9,"avoidYou":9,"overall":9,"notes":"concise Chinese notes"}]}

Samples:
${wrapUntrustedJson("samples", samples)}

Anonymous candidate outputs:
${wrapUntrustedJson("candidate_outputs", anonymousOutputs)}
`;
};

const parseConcurrencyLimit = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
};

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );
  return results;
};

export const onRequestPost = async (context: any) => {
  try {
    const env = (context.env || {}) as Record<string, unknown>;
    const authResult = await enforceRequestAuth(context.request, env);
    if (!authResult.ok) return authResult.response;
    const body = await readJsonBodyWithLimit(context.request, getMaxRequestBytes(env));
    if (body.response) return body.response;
    const payload = body.data;
    const samples = parseSamples(payload?.samples);
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const profile: TranslationProfile = payload?.profile === "docx-manual" ? "docx-manual" : "spreadsheet";
    const reviewStyle = parseReviewStyle(payload?.reviewStyle, profile);

    if (!samples.length || !targetLang) {
      return jsonResponse({ error: "Invalid payload." }, 400);
    }

    if (samples.length > getMaxSamples(env)) {
      return jsonResponse({ error: `Too many samples (max ${getMaxSamples(env)}).` }, 413);
    }
    if (!isAllowedTargetLanguage(targetLang)) {
      return jsonResponse({ error: "Unsupported target language." }, 400);
    }
    // The browser may narrow the lists, but only to models the deployment config names.
    const translationModels = parseDelimitedModelList(payload?.translationModels, getReviewTranslationModels(env));
    const judgeModels = parseDelimitedModelList(payload?.judgeModels, getReviewJudgeModels(env));
    const translationConcurrency = parseConcurrencyLimit(
      payload?.translationConcurrency ||
        env.MODEL_REVIEW_TRANSLATION_CONCURRENCY ||
        env.CLOUDFLARE_REVIEW_TRANSLATION_CONCURRENCY,
      2
    );
    const judgeConcurrency = parseConcurrencyLimit(
      payload?.judgeConcurrency ||
        env.MODEL_REVIEW_JUDGE_CONCURRENCY ||
        env.CLOUDFLARE_REVIEW_JUDGE_CONCURRENCY,
      1
    );

    const modelListError =
      validateModelList(translationModels) || validateModelList(judgeModels);
    if (modelListError) return jsonResponse({ error: modelListError }, 400);
    if (findDisallowedModel(getAllowedReviewModels(env), [...translationModels, ...judgeModels])) {
      return jsonResponse({ error: "Model not available on this deployment." }, 400);
    }
    const startedAt = Date.now();
    const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

    const aliases = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const candidates: ModelReviewCandidate[] = await runWithConcurrency(translationModels, translationConcurrency, async (model, index) => {
      const started = Date.now();
      const alias = `Candidate ${aliases[index] || index + 1}`;
      try {
        const translations = await translateWithModel({
          env,
          model,
          samples,
          targetLang,
          profile,
          timeoutMs: remainingMs()
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
    });

    const successfulCandidates = candidates.filter((candidate) => candidate.translations.length);
    if (!successfulCandidates.length) {
      return jsonResponse({ error: "All translation candidates failed.", candidates }, 500);
    }

    const aliasToModel = new Map(candidates.map((candidate) => [candidate.alias, candidate.model]));
    const judges: ModelReviewJudgeResult[] = await runWithConcurrency(judgeModels, judgeConcurrency, async (model) => {
      try {
        const content = await callModel({
          env,
          model,
          system: getReviewStyleGuidance(reviewStyle).system,
          user: buildJudgePrompt(samples, successfulCandidates, targetLang, reviewStyle),
          maxTokens: 7000,
          timeoutMs: remainingMs()
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
    });

    const ranking = buildModelReviewRanking(candidates, judges);
    return jsonResponse({
      createdAt: new Date().toISOString(),
      targetLang,
      profile,
      reviewStyle,
      engines: Array.from(
        new Set([...translationModels, ...judgeModels].map((model) => parseRoutedModel(model).engine))
      ),
      concurrency: {
        translation: translationConcurrency,
        judge: judgeConcurrency
      },
      samples,
      candidates,
      judges,
      ranking
    });
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Unhandled error" }, 500);
  }
};
