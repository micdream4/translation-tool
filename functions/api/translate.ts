import type { POCTRecord, TargetLanguage } from "../../types";
import { parseModelJsonArray, sanitizeModelJson } from "../../utils/jsonRepair";
import {
  buildOpenRouterPrompt,
  buildOpenRouterSystemPrompt,
  DOCX_MANUAL_OPENROUTER_MODELS,
  normalizeOpenRouterModelId,
  type TranslationProfile
} from "../../utils/translationProfiles";
import { enforceRequestAuth, getOpenRouterKeyForUser, jsonResponse } from "../_shared/auth";
import {
  callCloudflareAiChat,
  extractChatText,
  getCloudflareAiBinding,
  getCloudflareAiGatewayId,
  getDeepSeekKey
} from "../_shared/llmProviders";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_OPENROUTER_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_DEEPSEEK_PRO_REQUEST_TIMEOUT_MS = 55000;
const DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_DEEPSEEK_PRO_MAX_OUTPUT_TOKENS = 24576;
const DEFAULT_DEEPSEEK_MODELS = "deepseek-v4-flash,deepseek-v4-pro";
const DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS = "google/gemini-3-flash";
const DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS = "openai/gpt-5.4,anthropic/claude-sonnet-4.6";
const DEFAULT_CLOUDFLARE_AI_MODELS = `${DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS},${DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS}`;
const DEFAULT_CLOUDFLARE_AI_MAX_OUTPUT_TOKENS = 8192;

const sanitizeResponse = (text: string) =>
  sanitizeModelJson(text.replace(/```json|```/gi, ""));

type TranslationModelIssue = {
  model: string;
  status?: number | string;
  message: string;
  kind: "http" | "empty" | "exception";
};

type TranslationEngine = "cloudflare-ai" | "deepseek" | "openrouter";

const parsePlainModelList = (rawList: string) =>
  Array.from(
    new Set(
      rawList
        .split(/[,\n;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const parseOpenRouterTimeoutMs = (env: Record<string, unknown>) => {
  const raw = Number(env.OPENROUTER_REQUEST_TIMEOUT_MS || env.VITE_OPENROUTER_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_OPENROUTER_REQUEST_TIMEOUT_MS;
  return Math.min(55000, Math.max(5000, Math.round(raw)));
};

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
  return Math.min(55000, Math.max(5000, Math.round(raw)));
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

const buildOpenRouterProviderRouting = (env: Record<string, unknown>) => {
  const sort = String(env.OPENROUTER_PROVIDER_SORT || "throughput").trim().toLowerCase();
  if (!sort || sort === "none" || sort === "off") {
    return { allow_fallbacks: true };
  }
  return {
    sort,
    allow_fallbacks: true
  };
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

const parseOpenRouterModels = (env: Record<string, unknown>) => {
  const rawList = String(
    env.OPENROUTER_MODELS ||
      env.VITE_OPENROUTER_MODELS ||
      env.OPENROUTER_MODEL ||
      env.VITE_OPENROUTER_MODEL ||
      ""
  );

  return Array.from(
    new Set(
      rawList
        .split(/[,\n;]+/)
        .map((item) => normalizeOpenRouterModelId(item))
        .filter(Boolean)
    )
  );
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

const parseRequestedModels = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOpenRouterModelId(String(item || ""))).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n;]+/)
    .map((item) => normalizeOpenRouterModelId(item))
    .filter(Boolean);
};

const parseTranslationProfile = (value: unknown): TranslationProfile =>
  String(value || "").trim() === "docx-manual" ? "docx-manual" : "spreadsheet";

const parseEngineChain = (
  engine: string,
  hasCloudflareAi: boolean,
  hasDeepSeek: boolean,
  hasOpenRouter: boolean
): TranslationEngine[] => {
  if (engine === "auto") {
    return [
      ...(hasCloudflareAi ? (["cloudflare-ai"] as const) : []),
      ...(hasDeepSeek ? (["deepseek"] as const) : []),
      ...(hasOpenRouter ? (["openrouter"] as const) : [])
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
  if (engine === "openrouter") {
    return hasOpenRouter ? ["openrouter"] : [];
  }
  return [];
};

export const onRequestPost = async (context: any) => {
  try {
    const payload = await context.request.json();
    const records = payload?.records as POCTRecord[] | undefined;
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const engine = String(payload?.engine || "auto").toLowerCase();
    const requestedModel = parseRequestedModel(payload?.model);
    const requestedModels = parseRequestedModels(payload?.models);
    const profile = parseTranslationProfile(payload?.profile);

    if (!Array.isArray(records) || !targetLang) {
      return jsonResponse({ error: "Invalid payload." }, 400);
    }

    const env = (context.env || {}) as Record<string, unknown>;
    const authResult = enforceRequestAuth(context.request, env);
    if (!authResult.ok) return authResult.response;
    const openRouterKey = getOpenRouterKeyForUser(env, authResult.auth.userEmail);
    const configuredOpenRouterModels = parseOpenRouterModels(env);
    const hasOpenRouter = Boolean(
      openRouterKey && (configuredOpenRouterModels.length || requestedModel || requestedModels.length)
    );
    const deepSeekKey = getDeepSeekKey(env);
    const hasDeepSeek = Boolean(deepSeekKey);
    const cloudflareAi = getCloudflareAiBinding(env);
    const hasCloudflareAi = Boolean(cloudflareAi);
    const engineChain = parseEngineChain(engine, hasCloudflareAi, hasDeepSeek, hasOpenRouter);
    const allErrors: string[] = [];
    const allModelIssues: TranslationModelIssue[] = [];

    if (engineChain.length === 0) {
      const missing =
        engine === "cloudflare-ai" || engine === "cloudflare" || engine === "cf" || engine === "gemini"
          ? "Cloudflare AI binding missing."
          : engine === "deepseek" || engine === "deepseek-direct"
            ? "DeepSeek API key missing."
          : engine === "openrouter"
            ? "OpenRouter key missing."
            : "No available translation engine.";
      return jsonResponse({ error: missing }, 400);
    }

    const prompt = buildOpenRouterPrompt(records, targetLang, profile);

    const translateWithCloudflareAi = async (modelsOverride?: string[]) => {
      if (!cloudflareAi) throw new Error("Cloudflare AI binding missing.");
      const models = requestedModel ? [requestedModel] : modelsOverride ?? parseCloudflareAiModels(env);
      if (models.length === 0) return null;
      const gatewayId = getCloudflareAiGatewayId(env);
      const maxOutputTokens = parseCloudflareAiMaxOutputTokens(env);

      for (const model of models) {
        try {
          const text = sanitizeResponse(
            await callCloudflareAiChat({
              ai: cloudflareAi,
              gatewayId,
              model,
              system: buildOpenRouterSystemPrompt(profile),
              user: prompt,
              maxTokens: maxOutputTokens,
              json: true
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
            status: "exception",
            message,
            kind: "exception"
          });
        }
      }
      return null;
    };

    const translateWithOpenRouter = async () => {
      if (!openRouterKey) throw new Error("OpenRouter key missing.");
      const models = requestedModel
        ? [requestedModel]
        : requestedModels.length
          ? requestedModels
          : profile === "docx-manual"
            ? parseRequestedModels(
                env.DOCX_OPENROUTER_MODELS ||
                  env.VITE_DOCX_OPENROUTER_MODELS ||
                  env.OPENROUTER_DOCX_MODELS
              )
                .concat(DOCX_MANUAL_OPENROUTER_MODELS)
                .filter((model, index, arr) => arr.indexOf(model) === index)
            : configuredOpenRouterModels;
      const referer =
        env.OPENROUTER_SITE ||
        context.request.headers.get("Origin") ||
        "https://poct-translator.local";
      const requestTimeoutMs = parseOpenRouterTimeoutMs(env);
      const provider = buildOpenRouterProviderRouting(env);

      for (const model of models) {
        try {
          const response = await fetchWithTimeout(
            OPENROUTER_API_URL,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openRouterKey}`,
                "HTTP-Referer": referer,
                "X-Title": String(env.OPENROUTER_APP_TITLE || "POCT Medical Translator")
              },
              body: JSON.stringify({
                model,
                temperature: 0,
                response_format: {
                  type: "json_object"
                },
                provider,
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
            const text = await response.text();
            let message = text.slice(0, 200);
            try {
              const parsed = JSON.parse(text);
              message = String(parsed?.error?.message || message);
            } catch {
              // Keep raw response preview.
            }
            allErrors.push(`${model}: OpenRouter error ${response.status}: ${message.slice(0, 200)}`);
            allModelIssues.push({
              model,
              status: response.status,
              message,
              kind: "http"
            });
            continue;
          }

          const result = await response.json();
          const text = sanitizeResponse(extractChatText(result));
          if (!text) {
            allErrors.push(`${model}: OpenRouter returned empty content.`);
            allModelIssues.push({
              model,
              message: "OpenRouter returned empty content.",
              kind: "empty"
            });
            continue;
          }
          const parsed = parseModelJsonArray(text);
          return jsonResponse({ engine: "openrouter", model, records: parsed, modelIssues: allModelIssues });
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

    const translateWithDeepSeek = async () => {
      if (!deepSeekKey) throw new Error("DeepSeek API key missing.");
      const models = requestedModel ? [requestedModel] : parseDeepSeekModels(env);

      for (const model of models) {
        const requestTimeoutMs = parseDeepSeekTimeoutMs(env, model);
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

      if (hasOpenRouter) {
        const result = await translateWithOpenRouter();
        if (result) return result;
      }

      return jsonResponse(
        {
          error: `All translation engines failed. ${allErrors.join(" | ").slice(0, 1500)}`,
          modelIssues: allModelIssues
        },
        500
      );
    }

    for (const candidate of engineChain) {
      const result =
        candidate === "cloudflare-ai"
          ? await translateWithCloudflareAi()
          : candidate === "deepseek"
            ? await translateWithDeepSeek()
            : await translateWithOpenRouter();
      if (result) return result;
    }

    return jsonResponse(
      {
        error: `All translation engines failed. ${allErrors.join(" | ").slice(0, 1500)}`,
        modelIssues: allModelIssues
      },
      500
    );
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Unhandled error" }, 500);
  }
};
