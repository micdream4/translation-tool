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
  if (/^deepseek-v/i.test(raw)) {
    return { raw, engine: "deepseek", model: raw };
  }
  return { raw, engine: "cloudflare-ai", model: raw };
};

export const extractChatText = (result: any) => {
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

export const callCloudflareAiChat = async ({
  ai,
  gatewayId,
  model,
  system,
  user,
  maxTokens = 8192,
  json = true
}: {
  ai: CloudflareAiBinding;
  gatewayId: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
}) => {
  const result = await ai.run(
    model,
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {})
    },
    {
      gateway: { id: gatewayId }
    }
  );
  const text = extractChatText(result);
  if (!text) {
    const finishReason = (result as any)?.candidates?.[0]?.finishReason;
    throw new Error(
      finishReason
        ? `Cloudflare AI returned empty content (${finishReason}).`
        : "Cloudflare AI returned empty content."
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
  json = true
}: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
}) => {
  const response = await fetch(DEEPSEEK_API_URL, {
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
  const text = await response.text();
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
  json = true
}: {
  env: FunctionEnv;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
}) => {
  const routed = parseRoutedModel(model);
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
        json
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
      json
    })
  };
};
