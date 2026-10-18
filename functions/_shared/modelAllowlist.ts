// The browser may ask for a specific model, but only models the deployment config names are
// served. Anything else is refused, so the API is not an open proxy to arbitrary (and expensive)
// models. Target languages are checked against the list the app offers.
import {
  DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS,
  DEFAULT_CLOUDFLARE_AI_MODELS,
  DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS,
  DEFAULT_DEEPSEEK_MODELS,
  DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
  DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
  DEFAULT_SAMPLE_REVIEW_MODELS
} from "../../utils/modelDefaults";
import { TARGET_LANGUAGE_OPTIONS } from "../../utils/targetLanguage";
import { parseDelimitedModelList, parseRoutedModel, type FunctionEnv } from "./llmProviders";

const routedKey = (model: string) => {
  const routed = parseRoutedModel(model);
  return `${routed.engine}:${routed.model}`;
};

export const getCloudflareAiModels = (env: FunctionEnv) =>
  parseDelimitedModelList(
    env.CLOUDFLARE_AI_MODELS || env.CLOUDFLARE_AI_MODEL || env.VITE_CLOUDFLARE_AI_MODELS,
    [...DEFAULT_CLOUDFLARE_AI_MODELS]
  );

export const getCloudflareAiPrimaryModels = (env: FunctionEnv) =>
  parseDelimitedModelList(
    env.CLOUDFLARE_AI_PRIMARY_MODELS || env.VITE_CLOUDFLARE_AI_PRIMARY_MODELS,
    env.CLOUDFLARE_AI_MODELS || env.CLOUDFLARE_AI_MODEL || env.VITE_CLOUDFLARE_AI_MODELS
      ? getCloudflareAiModels(env).slice(0, 1)
      : [...DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS]
  );

export const getCloudflareAiFallbackModels = (env: FunctionEnv) =>
  parseDelimitedModelList(
    env.CLOUDFLARE_AI_FALLBACK_MODELS || env.VITE_CLOUDFLARE_AI_FALLBACK_MODELS,
    env.CLOUDFLARE_AI_MODELS || env.CLOUDFLARE_AI_MODEL || env.VITE_CLOUDFLARE_AI_MODELS
      ? getCloudflareAiModels(env).slice(1)
      : [...DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS]
  );

export const getDeepSeekModels = (env: FunctionEnv) =>
  parseDelimitedModelList(env.DEEPSEEK_MODELS || env.DEEPSEEK_MODEL || env.VITE_DEEPSEEK_MODELS, [
    ...DEFAULT_DEEPSEEK_MODELS
  ]);

export const getReviewTranslationModels = (env: FunctionEnv) =>
  parseDelimitedModelList(
    env.MODEL_REVIEW_TRANSLATION_MODELS || env.CLOUDFLARE_REVIEW_TRANSLATION_MODELS,
    DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS
  );

export const getReviewJudgeModels = (env: FunctionEnv) =>
  parseDelimitedModelList(
    env.MODEL_REVIEW_JUDGE_MODELS || env.CLOUDFLARE_REVIEW_JUDGE_MODELS,
    DEFAULT_MODEL_REVIEW_JUDGE_MODELS
  );

export const getSampleReviewModels = (env: FunctionEnv) =>
  parseDelimitedModelList(env.SAMPLE_REVIEW_MODELS, DEFAULT_SAMPLE_REVIEW_MODELS);

/** Models /api/translate may use: the configured Cloudflare AI and DeepSeek translation models. */
export const getAllowedTranslationModels = (env: FunctionEnv) =>
  new Set([
    ...[...getCloudflareAiModels(env), ...getCloudflareAiPrimaryModels(env), ...getCloudflareAiFallbackModels(env)].map(
      (model) => `cloudflare-ai:${model}`
    ),
    ...getDeepSeekModels(env).map((model) => `deepseek:${model}`)
  ]);

/** Models the review endpoints may use: the translation models plus the configured review lists. */
export const getAllowedReviewModels = (env: FunctionEnv) =>
  new Set([
    ...getAllowedTranslationModels(env),
    ...[...getReviewTranslationModels(env), ...getReviewJudgeModels(env), ...getSampleReviewModels(env)].map(routedKey)
  ]);

export const isAllowedModel = (allowed: Set<string>, model: string) => allowed.has(routedKey(model));

/** The first model that is not configured for this deployment, if any. */
export const findDisallowedModel = (allowed: Set<string>, models: string[]) =>
  models.find((model) => !isAllowedModel(allowed, model));

export const isAllowedTargetLanguage = (value: unknown) =>
  typeof value === "string" && (TARGET_LANGUAGE_OPTIONS as string[]).includes(value);
