import type { POCTRecord, TargetLanguage } from "../../types";
import { parseModelJsonArray, sanitizeModelJson } from "../../utils/jsonRepair";
import {
  TRANSLATION_RECORD_ID_KEY,
  alignTranslationEnvelopes,
  isTranslationEnvelopeBatch
} from "../../utils/translationAlignment";
import {
  buildTranslationPrompt,
  buildTranslationSystemPrompt,
  type TranslationProfile
} from "../../utils/translationProfiles";
import { orderEngines, parseEngineOrder } from "../../utils/engineOrder";
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
  getCloudflareAiReasoningEffort,
  getCloudflareAiTimeoutMs,
  getDeepSeekKey
} from "../_shared/llmProviders";
import {
  getAllowedTranslationModels,
  getCloudflareAiFallbackModels,
  getCloudflareAiModels,
  getCloudflareAiPrimaryModels,
  getDeepSeekModels,
  isAllowedModel,
  isAllowedTargetLanguage
} from "../_shared/modelAllowlist";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_DEEPSEEK_PRO_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_DEEPSEEK_PRO_MAX_OUTPUT_TOKENS = 24576;
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

// The timeout covers the whole exchange, body included: a provider that sends headers and then
// stalls must not hold the request past its budget (the next model would never get a turn).
const fetchTextWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
) => {
  const controller = new AbortController();
  const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        return { response, text: await response.text() };
      })(),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * A reply must cover every record that was sent. Envelope batches (with record ids) must return
 * every id; plain batches must return the same number of records. Anything else counts as that
 * model's failure so the next model can serve the request.
 */
const describeIncompleteReply = (sent: POCTRecord[], received: unknown): string | null => {
  if (!Array.isArray(received)) return "reply is not a record list";
  if (isTranslationEnvelopeBatch(sent)) {
    try {
      alignTranslationEnvelopes(sent, received as POCTRecord[]);
      return null;
    } catch {
      const ids = new Set(
        (received as POCTRecord[]).map((record) => record?.[TRANSLATION_RECORD_ID_KEY]).filter(Number.isInteger)
      );
      const covered = sent.filter((record) => ids.has(record[TRANSLATION_RECORD_ID_KEY])).length;
      return `returned ${covered} of ${sent.length} records`;
    }
  }
  return received.length === sent.length ? null : `returned ${received.length} of ${sent.length} records`;
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

/** TRANSLATION_ENGINE_ORDER (e.g. "deepseek,cloudflare-ai") decides which engine "auto" tries first. */
const parseServerEngineOrder = (env: Record<string, unknown>) => parseEngineOrder(env.TRANSLATION_ENGINE_ORDER);

const parseEngineChain = (
  engine: string,
  hasCloudflareAi: boolean,
  hasDeepSeek: boolean,
  order = parseEngineOrder("")
): TranslationEngine[] => {
  if (engine === "auto") {
    return orderEngines<TranslationEngine>(
      [
        ...(hasCloudflareAi ? (["cloudflare-ai"] as const) : []),
        ...(hasDeepSeek ? (["deepseek"] as const) : [])
      ],
      order
    );
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
    if (!isAllowedTargetLanguage(targetLang)) {
      return jsonResponse({ error: "Unsupported target language." }, 400);
    }
    const modelListError = validateModelList([requestedModel].filter(Boolean));
    if (modelListError) return jsonResponse({ error: modelListError }, 400);
    const deepSeekKey = getDeepSeekKey(env);
    const hasDeepSeek = Boolean(deepSeekKey);
    const cloudflareAi = getCloudflareAiBinding(env);
    const hasCloudflareAi = Boolean(cloudflareAi);
    let engineChain = parseEngineChain(engine, hasCloudflareAi, hasDeepSeek, parseServerEngineOrder(env));
    if (requestedModel) {
      // A requested model is served only by its own engine, and only when the config names it.
      const allowed = getAllowedTranslationModels(env);
      engineChain = engineChain.filter((candidate) => isAllowedModel(allowed, `${candidate}:${requestedModel}`));
      if (engineChain.length === 0) {
        return jsonResponse({ error: "Model not available on this deployment." }, 400);
      }
    }
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
      const models = requestedModel ? [requestedModel] : modelsOverride ?? getCloudflareAiModels(env);
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
              timeoutMs: Math.min(getCloudflareAiTimeoutMs(env), remainingMs()),
              reasoningEffort: getCloudflareAiReasoningEffort(env)
            })
          );
          const parsed = parseModelJsonArray(text);
          const incomplete = describeIncompleteReply(records, parsed);
          if (incomplete) {
            allErrors.push(`${model}: ${incomplete}.`);
            allModelIssues.push({ model, message: `Model ${incomplete}.`, kind: "exception" });
            continue;
          }
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
      const models = requestedModel ? [requestedModel] : getDeepSeekModels(env);

      for (const model of models) {
        if (!hasBudgetForAnotherModel()) break;
        const requestTimeoutMs = Math.min(parseDeepSeekTimeoutMs(env, model), remainingMs());
        const maxTokens = parseDeepSeekMaxOutputTokens(env, model);
        try {
          const { response, text: responseText } = await fetchTextWithTimeout(
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
            let message = responseText.slice(0, 200);
            try {
              const parsed = JSON.parse(responseText);
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

          const result = JSON.parse(responseText);
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
          const incomplete = describeIncompleteReply(records, parsed);
          if (incomplete) {
            allErrors.push(`${model}: ${incomplete}.`);
            allModelIssues.push({ model, message: `Model ${incomplete}.`, kind: "exception" });
            continue;
          }
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
      // Engines in configured order; Cloudflare AI tries its primary models there and keeps its
      // fallback models for last. Default order: Cloudflare primary -> DeepSeek -> Cloudflare fallback.
      for (const candidate of engineChain) {
        const result =
          candidate === "cloudflare-ai"
            ? await translateWithCloudflareAi(getCloudflareAiPrimaryModels(env))
            : await translateWithDeepSeek();
        if (result) return result;
      }

      if (hasCloudflareAi) {
        const result = await translateWithCloudflareAi(getCloudflareAiFallbackModels(env));
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
