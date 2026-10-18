export type FunctionEnv = Record<string, unknown>;

export type RoutedModelEngine = "cloudflare-ai" | "deepseek";

export type RoutedModel = {
  raw: string;
  engine: RoutedModelEngine;
  model: string;
};

export type CloudflareAiBinding = {
  run: (model: string, input: unknown, options?: unknown) => Promise<unknown>;
};

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

export const DEFAULT_CLOUDFLARE_AI_TIMEOUT_MS = 60_000;
export const DEFAULT_DEEPSEEK_CHAT_TIMEOUT_MS = 90_000;

const clampTimeout = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(180_000, Math.max(200, Math.round(parsed)));
};

export const getCloudflareAiTimeoutMs = (env: FunctionEnv) =>
  clampTimeout(env.CLOUDFLARE_AI_REQUEST_TIMEOUT_MS, DEFAULT_CLOUDFLARE_AI_TIMEOUT_MS);

/**
 * Rejects when the work does not settle in time so the caller can move on to the next model.
 * The underlying request is aborted when the runtime supports it, but the race alone is what
 * guarantees that a hung provider cannot hold the whole fallback chain.
 */
export const raceWithTimeout = async <T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the timeout, not the abort it triggers, is what the caller sees.
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([start(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Reasoning models (Gemini 3.x, GPT-6) think before answering and the thinking counts against
 * max_tokens, so a translation batch can be cut off mid-JSON. CLOUDFLARE_AI_REASONING_EFFORT
 * (e.g. "low") is passed as reasoning_effort to Google and OpenAI models; unset keeps the
 * provider default.
 */
export const getCloudflareAiReasoningEffort = (env: FunctionEnv) =>
  String(env.CLOUDFLARE_AI_REASONING_EFFORT || "").trim().toLowerCase() || undefined;

const usesReasoningEffort = (model: string) => /^(google|openai)\//i.test(String(model || ""));

export const getDeepSeekKey = (env: FunctionEnv) =>
  String(env.DEEPSEEK_API_KEY || env.Deepseek_API_KEY || "").trim();

export const getCloudflareAiBinding = (env: FunctionEnv) => {
  const binding = env.AI as CloudflareAiBinding | undefined;
  return binding && typeof binding.run === "function" ? binding : null;
};

export const hasCloudflareAiBinding = (env: FunctionEnv) => Boolean(getCloudflareAiBinding(env));

export const getCloudflareAiGatewayId = (env: FunctionEnv) =>
  String(env.CLOUDFLARE_AI_GATEWAY_ID || env.VITE_CLOUDFLARE_AI_GATEWAY_ID || "default").trim() ||
  "default";

export const parseDelimitedModelList = (value: unknown, fallback: string[] = []) => {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\n;]+/);
  const parsed = raw.map((item) => String(item || "").trim()).filter(Boolean);
  return Array.from(new Set(parsed.length ? parsed : fallback));
};

export const parseRoutedModel = (rawModel: string): RoutedModel => {
  const raw = String(rawModel || "").trim();
  if (raw.startsWith("cloudflare-ai:")) {
    return { raw, engine: "cloudflare-ai", model: raw.slice("cloudflare-ai:".length) };
  }
  if (raw.startsWith("cloudflare:")) {
    return { raw, engine: "cloudflare-ai", model: raw.slice("cloudflare:".length) };
  }
  if (raw.startsWith("deepseek:")) {
    return { raw, engine: "deepseek", model: raw.slice("deepseek:".length) };
  }
  if (/^deepseek-/i.test(raw)) {
    return { raw, engine: "deepseek", model: raw };
  }
  return { raw, engine: "cloudflare-ai", model: raw };
};

export const extractChatText = (result: any) => {
  const directContent = result?.content;
  if (Array.isArray(directContent)) {
    const text = directContent
      .map((chunk: any) => chunk?.text ?? chunk?.content ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  if (typeof directContent === "string") return directContent.trim();

  let content = result?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    content = content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
  }
  if (typeof content === "string") return content.trim();
  if (typeof result?.response === "string") return result.response.trim();
  if (typeof result?.text === "string") return result.text.trim();
  if (typeof result?.result?.response === "string") return result.result.response.trim();
  if (typeof result?.result?.text === "string") return result.result.text.trim();

  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  return candidates
    .flatMap((candidate: any) =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    )
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
};

const isThirdPartyCloudflareModel = (model: string) => /^[a-z0-9-]+\//i.test(String(model || ""));
const isOpenAiCloudflareModel = (model: string) => /^openai\//i.test(String(model || ""));
const isAnthropicCloudflareModel = (model: string) => /^anthropic\//i.test(String(model || ""));

const buildCloudflareAiInput = ({
  model,
  system,
  user,
  maxTokens,
  json,
  reasoningEffort
}: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  json: boolean;
  reasoningEffort?: string;
}) => {
  const anthropic = isAnthropicCloudflareModel(model);
  const input: Record<string, unknown> = {
    messages: anthropic
      ? [{ role: "user", content: user }]
      : [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
  };

  if (anthropic) {
    input.system = system;
  }

  if (isOpenAiCloudflareModel(model)) {
    input.max_completion_tokens = maxTokens;
  } else {
    input.max_tokens = maxTokens;
  }

  if (!isOpenAiCloudflareModel(model) && !anthropic) {
    input.temperature = 0;
  }

  if (reasoningEffort && usesReasoningEffort(model)) {
    input.reasoning_effort = reasoningEffort;
  }

  if (json && !isThirdPartyCloudflareModel(model)) {
    input.response_format = { type: "json_object" };
  }

  return input;
};

export const callCloudflareAiChat = async ({
  ai,
  gatewayId,
  model,
  system,
  user,
  maxTokens = 8192,
  json = true,
  timeoutMs = DEFAULT_CLOUDFLARE_AI_TIMEOUT_MS,
  reasoningEffort
}: {
  ai: CloudflareAiBinding;
  gatewayId: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
  reasoningEffort?: string;
}) => {
  const result = await raceWithTimeout(
    (signal) =>
      ai.run(model, buildCloudflareAiInput({ model, system, user, maxTokens, json, reasoningEffort }), {
        gateway: { id: gatewayId },
        signal
      }),
    timeoutMs,
    `Cloudflare AI ${model}`
  );
  const text = extractChatText(result);
  if (!text) {
    const raw = result as any;
    const finishReason =
      raw?.candidates?.[0]?.finishReason ??
      raw?.choices?.[0]?.finish_reason ??
      raw?.stop_reason ??
      raw?.result?.stop_reason;
    // The shape is logged so a provider-specific response format can be recognised later.
    const shape = raw && typeof raw === "object" ? Object.keys(raw).slice(0, 8).join(",") : typeof raw;
    throw new Error(
      `Cloudflare AI returned empty content${finishReason ? ` (${finishReason})` : ""} [keys: ${shape}].`
    );
  }
  return text;
};

export const callDeepSeekChat = async ({
  apiKey,
  model,
  system,
  user,
  maxTokens = 8192,
  json = true,
  timeoutMs = DEFAULT_DEEPSEEK_CHAT_TIMEOUT_MS
}: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
}) => {
  const { response, text } = await raceWithTimeout(
    async (signal) => {
      const res = await fetch(DEEPSEEK_API_URL, {
        signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });
      return { response: res, text: await res.text() };
    },
    timeoutMs,
    `DeepSeek ${model}`
  );
  if (!response.ok) {
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      message = String(parsed?.error?.message || message);
    } catch {
      // Keep raw response preview.
    }
    throw new Error(`DeepSeek error ${response.status}: ${message.slice(0, 300)}`);
  }
  const payload = JSON.parse(text);
  const content = extractChatText(payload);
  if (!content) throw new Error("DeepSeek returned empty content.");
  return content;
};

export const callRoutedChat = async ({
  env,
  model,
  system,
  user,
  maxTokens,
  json = true,
  timeoutMs
}: {
  env: FunctionEnv;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  /** Upper bound for this call, e.g. what is left of the request's time budget. */
  timeoutMs?: number;
}) => {
  const routed = parseRoutedModel(model);
  const capTimeout = (fallback: number) =>
    timeoutMs !== undefined && Number.isFinite(timeoutMs) ? Math.max(200, Math.min(fallback, timeoutMs)) : fallback;
  if (routed.engine === "cloudflare-ai") {
    const ai = getCloudflareAiBinding(env);
    if (!ai) throw new Error("Cloudflare AI binding missing.");
    return {
      engine: "cloudflare-ai" as const,
      model: routed.raw,
      text: await callCloudflareAiChat({
        ai,
        gatewayId: getCloudflareAiGatewayId(env),
        model: routed.model,
        system,
        user,
        maxTokens,
        json,
        timeoutMs: capTimeout(getCloudflareAiTimeoutMs(env)),
        reasoningEffort: getCloudflareAiReasoningEffort(env)
      })
    };
  }

  const apiKey = getDeepSeekKey(env);
  if (!apiKey) throw new Error("DeepSeek API key missing.");
  return {
    engine: "deepseek" as const,
    model: routed.raw,
    text: await callDeepSeekChat({
      apiKey,
      model: routed.model,
      system,
      user,
      maxTokens,
      json,
      timeoutMs: capTimeout(DEFAULT_DEEPSEEK_CHAT_TIMEOUT_MS)
    })
  };
};
