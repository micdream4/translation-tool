import type { POCTRecord, TargetLanguage } from "../../types";
import { parseModelJsonArray, sanitizeModelJson } from "../../utils/jsonRepair";
import {
  buildTranslationPrompt,
  buildTranslationSystemPrompt,
  type TranslationProfile
} from "../../utils/translationProfiles";
import { enforceRequestAuth, jsonResponse } from "../_shared/auth";
import {
  getMaxRecords,
  getMaxRequestBytes,
  readJsonBodyWithLimit,
  validateModelList
} from "../_shared/limits";
import {
  callCloudflareAiChat,
  extractChatText,
  getCloudflareAiBinding,
  getCloudflareAiGatewayId,
  getCloudflareAiTimeoutMs,
  getDeepSeekKey
} from "../_shared/llmProviders";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_DEEPSEEK_PRO_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_DEEPSEEK_PRO_MAX_OUTPUT_TOKENS = 24576;
const DEFAULT_DEEPSEEK_MODELS = "deepseek-v4-flash,deepseek-v4-pro";
const DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS = "google/gemini-3-flash";
const DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS = "openai/gpt-5.4,anthropic/claude-sonnet-4.6";
const DEFAULT_CLOUDFLARE_AI_MODELS = `${DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS},${DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS}`;
const DEFAULT_CLOUDFLARE_AI_MAX_OUTPUT_TOKENS = 8192;

const DEFAULT_TOTAL_BUDGET_MS = 90_000;
const MIN_MODEL_ATTEMPT_MS = 4_000;

// Cloudflare closes a proxied request after about 100 s, so the whole fallback chain has to
// finish inside one budget. Past it the client gets a clear error instead of a 524.
const parseTotalBudgetMs = (env: Record<string, unknown>) => {
  const raw = Number(env.TRANSLATE_TOTAL_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TOTAL_BUDGET_MS;
  return Math.min(95_000, Math.max(1_000, Math.round(raw)));
};

const sanitizeResponse = (text: string) =>
  sanitizeModelJson(text.replace(/```json|```/gi, ""));

type TranslationModelIssue = {
  model: string;
  status?: number | string;
  message: string;
  kind: "http" | "empty" | "exception";
};

type TranslationEngine = "cloudflare-ai" | "deepseek";

const parsePlainModelList = (rawList: string) =>
  Array.from(
    new Set(
      rawList
        .split(/[,\n;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const isDeepSeekProModel = (model: string) => /deepseek[-/]v4-pro/i.test(String(model || ""));

const parseDeepSeekTimeoutMs = (env: Record<string, unknown>, model = "") => {
  const raw = Number(
    isDeepSeekProModel(model)
      ? env.DEEPSEEK_PRO_REQUEST_TIMEOUT_MS ||
          env.VITE_DEEPSEEK_PRO_REQUEST_TIMEOUT_MS ||
          env.DEEPSEEK_REQUEST_TIMEOUT_MS ||
          env.VITE_DEEPSEEK_REQUEST_TIMEOUT_MS
      : env.DEEPSEEK_REQUEST_TIMEOUT_MS || env.VITE_DEEPSEEK_REQUEST_TIMEOUT_MS
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return isDeepSeekProModel(model)
      ? DEFAULT_DEEPSEEK_PRO_REQUEST_TIMEOUT_MS
      : DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS;
  }
  return Math.min(180000, Math.max(5000, Math.round(raw)));
};

const parseDeepSeekMaxOutputTokens = (env: Record<string, unknown>, model = "") => {
  const raw = Number(
    isDeepSeekProModel(model)
      ? env.DEEPSEEK_PRO_MAX_OUTPUT_TOKENS ||
          env.VITE_DEEPSEEK_PRO_MAX_OUTPUT_TOKENS ||
          env.DEEPSEEK_MAX_OUTPUT_TOKENS ||
          env.VITE_DEEPSEEK_MAX_OUTPUT_TOKENS
      : env.DEEPSEEK_MAX_OUTPUT_TOKENS || env.VITE_DEEPSEEK_MAX_OUTPUT_TOKENS
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return isDeepSeekProModel(model)
      ? DEFAULT_DEEPSEEK_PRO_MAX_OUTPUT_TOKENS
      : DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS;
  }
  return Math.min(65536, Math.max(1024, Math.round(raw)));
};

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

const parseCloudflareAiModels = (env: Record<string, unknown>) => {
  const rawList = String(
    env.CLOUDFLARE_AI_MODELS ||
      env.CLOUDFLARE_AI_MODEL ||
      env.VITE_CLOUDFLARE_AI_MODELS ||
      DEFAULT_CLOUDFLARE_AI_MODELS
  );

  return parsePlainModelList(rawList);
};

const parseCloudflareAiPrimaryModels = (env: Record<string, unknown>) => {
  const rawList = String(
    env.CLOUDFLARE_AI_PRIMARY_MODELS ||
      env.VITE_CLOUDFLARE_AI_PRIMARY_MODELS ||
      ""
  );
  const explicitModels = parsePlainModelList(rawList);
  if (explicitModels.length > 0) return explicitModels;
  return parseCloudflareAiModels(env).slice(0, 1);
};

const parseCloudflareAiFallbackModels = (env: Record<string, unknown>) => {
  const rawList = String(
    env.CLOUDFLARE_AI_FALLBACK_MODELS ||
      env.VITE_CLOUDFLARE_AI_FALLBACK_MODELS ||
      ""
  );
  const explicitModels = parsePlainModelList(rawList);
  if (explicitModels.length > 0) return explicitModels;
  return parseCloudflareAiModels(env).slice(1);
};

const parseDeepSeekModels = (env: Record<string, unknown>) => {
  const rawList = String(
    env.DEEPSEEK_MODELS ||
      env.DEEPSEEK_MODEL ||
      env.VITE_DEEPSEEK_MODELS ||
      DEFAULT_DEEPSEEK_MODELS
  );

  return parsePlainModelList(rawList);
};

const parseCloudflareAiMaxOutputTokens = (env: Record<string, unknown>) => {
  const raw = Number(
    env.CLOUDFLARE_AI_MAX_OUTPUT_TOKENS ||
      env.VITE_CLOUDFLARE_AI_MAX_OUTPUT_TOKENS
  );
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CLOUDFLARE_AI_MAX_OUTPUT_TOKENS;
  return Math.min(65536, Math.max(1024, Math.round(raw)));
};

const parseRequestedModel = (value: unknown) => String(value || "").trim();

const parseTranslationProfile = (value: unknown): TranslationProfile =>
  String(value || "").trim() === "docx-manual" ? "docx-manual" : "spreadsheet";

const parseEngineChain = (
  engine: string,
  hasCloudflareAi: boolean,
  hasDeepSeek: boolean
): TranslationEngine[] => {
  if (engine === "auto") {
    return [
      ...(hasCloudflareAi ? (["cloudflare-ai"] as const) : []),
      ...(hasDeepSeek ? (["deepseek"] as const) : [])
    ];
  }
  if (engine === "cloudflare-ai" || engine === "cloudflare" || engine === "cf") {
    return hasCloudflareAi ? ["cloudflare-ai"] : [];
  }
  if (engine === "gemini") {
    return hasCloudflareAi ? ["cloudflare-ai"] : [];
  }
  if (engine === "deepseek" || engine === "deepseek-direct") {
    return hasDeepSeek ? ["deepseek"] : [];
  }
  return [];
};

export const onRequestPost = async (context: any) => {
  try {
    const env = (context.env || {}) as Record<string, unknown>;
    const authResult = await enforceRequestAuth(context.request, env);
    if (!authResult.ok) return authResult.response;
    const body = await readJsonBodyWithLimit(context.request, getMaxRequestBytes(env));
    if (body.response) return body.response;
    const payload = body.data;
    const records = payload?.records as POCTRecord[] | undefined;
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const engine = String(payload?.engine || "auto").toLowerCase();
    const requestedModel = parseRequestedModel(payload?.model);
    const profile = parseTranslationProfile(payload?.profile);

    if (!Array.isArray(records) || !targetLang) {
      return jsonResponse({ error: "Invalid payload." }, 400);
    }

    if (records.length > getMaxRecords(env)) {
      return jsonResponse({ error: `Too many records (max ${getMaxRecords(env)}).` }, 413);
    }
    const modelListError = validateModelList([requestedModel].filter(Boolean));
    if (modelListError) return jsonResponse({ error: modelListError }, 400);
    const deepSeekKey = getDeepSeekKey(env);
    const hasDeepSeek = Boolean(deepSeekKey);
    const cloudflareAi = getCloudflareAiBinding(env);
    const hasCloudflareAi = Boolean(cloudflareAi);
    const engineChain = parseEngineChain(engine, hasCloudflareAi, hasDeepSeek);
    const allErrors: string[] = [];
    const allModelIssues: TranslationModelIssue[] = [];

    if (engineChain.length === 0) {
      const missing =
        engine === "cloudflare-ai" || engine === "cloudflare" || engine === "cf" || engine === "gemini"
          ? "Cloudflare AI binding missing."
          : engine === "deepseek" || engine === "deepseek-direct"
            ? "DeepSeek API key missing."
          : engine === "openrouter"
            ? "OpenRouter is no longer supported. Use cloudflare-ai, deepseek or auto."
            : "No available translation engine.";
      return jsonResponse({ error: missing }, 400);
    }

    const prompt = buildTranslationPrompt(records, targetLang, profile);
    const requestStartedAt = Date.now();
    const totalBudgetMs = parseTotalBudgetMs(env);
    const remainingMs = () => totalBudgetMs - (Date.now() - requestStartedAt);
    let budgetExceeded = false;
    const hasBudgetForAnotherModel = () => {
      if (remainingMs() >= MIN_MODEL_ATTEMPT_MS) return true;
      budgetExceeded = true;
      return false;
    };
    const buildFailureMessage = () =>
      `All translation engines failed.${
        budgetExceeded ? ` Request timed out after the ${Math.round(totalBudgetMs / 1000)}s time budget.` : ""
      } ${allErrors.join(" | ")}`.slice(0, 1500);

    const translateWithCloudflareAi = async (modelsOverride?: string[]) => {
      if (!cloudflareAi) throw new Error("Cloudflare AI binding missing.");
      const models = requestedModel ? [requestedModel] : modelsOverride ?? parseCloudflareAiModels(env);
      if (models.length === 0) return null;
      const gatewayId = getCloudflareAiGatewayId(env);
      const maxOutputTokens = parseCloudflareAiMaxOutputTokens(env);

      for (const model of models) {
        if (!hasBudgetForAnotherModel()) break;
        try {
          const text = sanitizeResponse(
            await callCloudflareAiChat({
              ai: cloudflareAi,
              gatewayId,
              model,
              system: buildTranslationSystemPrompt(profile),
              user: prompt,
              maxTokens: maxOutputTokens,
              json: true,
              timeoutMs: Math.min(getCloudflareAiTimeoutMs(env), remainingMs())
            })
          );
          const parsed = parseModelJsonArray(text);
          return jsonResponse({
            engine: "cloudflare-ai",
            model,
            records: parsed,
            modelIssues: allModelIssues
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          allErrors.push(`${model}: ${message}`);
          allModelIssues.push({
            model,
            status: /timed out/i.test(message) ? "timeout" : "exception",
            message,
            kind: "exception"
          });
        }
      }
      return null;
    };

    const translateWithDeepSeek = async () => {
      if (!deepSeekKey) throw new Error("DeepSeek API key missing.");
      const models = requestedModel ? [requestedModel] : parseDeepSeekModels(env);

      for (const model of models) {
        if (!hasBudgetForAnotherModel()) break;
        const requestTimeoutMs = Math.min(parseDeepSeekTimeoutMs(env, model), remainingMs());
        const maxTokens = parseDeepSeekMaxOutputTokens(env, model);
        try {
          const response = await fetchWithTimeout(
            DEEPSEEK_API_URL,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${deepSeekKey}`
              },
              body: JSON.stringify({
                model,
                temperature: 0,
                max_tokens: maxTokens,
                thinking: { type: "disabled" },
                response_format: {
                  type: "json_object"
                },
                messages: [
                  {
                    role: "system",
                    content: buildTranslationSystemPrompt(profile)
                  },
                  { role: "user", content: prompt }
                ]
              })
            },
            requestTimeoutMs,
            model
          );

          if (!response.ok) {
            const text = await response.text();
            let message = text.slice(0, 200);
            try {
              const parsed = JSON.parse(text);
              message = String(parsed?.error?.message || message);
            } catch {
              // Keep raw response preview.
            }
            allErrors.push(`${model}: DeepSeek error ${response.status}: ${message.slice(0, 200)}`);
            allModelIssues.push({
              model,
              status: response.status,
              message,
              kind: "http"
            });
            continue;
          }

          const result = await response.json();
          const finishReason = result?.choices?.[0]?.finish_reason;
          if (finishReason === "length") {
            allErrors.push(`${model}: DeepSeek output was truncated by max_tokens.`);
            allModelIssues.push({
              model,
              message: "DeepSeek output was truncated by max_tokens.",
              kind: "exception"
            });
            continue;
          }
          const text = sanitizeResponse(extractChatText(result));
          if (!text) {
            allErrors.push(`${model}: DeepSeek returned empty content.`);
            allModelIssues.push({
              model,
              message: "DeepSeek returned empty content.",
              kind: "empty"
            });
            continue;
          }
          const parsed = parseModelJsonArray(text);
          return jsonResponse({ engine: "deepseek", model, records: parsed, modelIssues: allModelIssues });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          allErrors.push(`${model}: ${message}`);
          allModelIssues.push({
            model,
            status: /timed out|aborted|abort/i.test(message) ? "timeout" : "exception",
            message,
            kind: "exception"
          });
        }
      }
      return null;
    };

    if (engine === "auto" && !requestedModel) {
      if (hasCloudflareAi) {
        const result = await translateWithCloudflareAi(parseCloudflareAiPrimaryModels(env));
        if (result) return result;
      }

      if (hasDeepSeek) {
        const result = await translateWithDeepSeek();
        if (result) return result;
      }

      if (hasCloudflareAi) {
        const result = await translateWithCloudflareAi(parseCloudflareAiFallbackModels(env));
        if (result) return result;
      }

      return jsonResponse(
        {
          error: buildFailureMessage(),
          modelIssues: allModelIssues
        },
        500
      );
    }

    for (const candidate of engineChain) {
      const result =
        candidate === "cloudflare-ai"
          ? await translateWithCloudflareAi()
          : await translateWithDeepSeek();
      if (result) return result;
    }

    return jsonResponse(
      {
        error: buildFailureMessage(),
        modelIssues: allModelIssues
      },
      500
    );
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Unhandled error" }, 500);
  }
};
