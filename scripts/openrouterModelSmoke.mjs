import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.3-chat",
  "qwen/qwen3.6-plus",
  "deepseek/deepseek-v4-pro"
];

const parseEnvFile = async () => {
  try {
    const raw = await fs.readFile(path.resolve(".env.local"), "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const [key, ...rest] = line.split("=");
          return [key.trim(), rest.join("=").trim().replace(/^['"]|['"]$/g, "")];
        })
    );
  } catch {
    return {};
  }
};

const parseModels = () => {
  const raw = process.env.OPENROUTER_SMOKE_MODELS || "";
  const models = raw
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return models.length ? Array.from(new Set(models)) : DEFAULT_MODELS;
};

const envFile = await parseEnvFile();
const apiKey =
  process.env.OPENROUTER_API_KEY ||
  process.env.VITE_OPENROUTER_API_KEY ||
  envFile.OPENROUTER_API_KEY ||
  envFile.VITE_OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in the shell or .env.local.");
  process.exit(1);
}

const timeoutMs = Math.max(5000, Number(process.env.OPENROUTER_SMOKE_TIMEOUT_MS || 45000));
const results = [];

for (const model of parseModels()) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://translation-tool-917.pages.dev",
        "X-Title": "POCT Medical Translator Smoke"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        provider: { sort: "throughput", allow_fallbacks: true },
        messages: [
          { role: "system", content: "Return only JSON." },
          { role: "user", content: "Return {\"ok\":true,\"translation\":\"Iniciar teste\"} as JSON." }
        ]
      })
    });
    const text = await response.text();
    let message = text.slice(0, 240);
    let content = "";
    try {
      const parsed = JSON.parse(text);
      message = String(parsed?.error?.message || parsed?.message || message).slice(0, 240);
      content = String(parsed?.choices?.[0]?.message?.content || "").slice(0, 120);
    } catch {
      // Keep raw response preview.
    }
    results.push({
      model,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      message: response.ok ? undefined : message,
      content: response.ok ? content : undefined
    });
  } catch (error) {
    results.push({
      model,
      ok: false,
      status: "exception",
      ms: Date.now() - started,
      message: String(error?.message || error).slice(0, 240)
    });
  } finally {
    clearTimeout(timer);
  }
}

console.log(
  JSON.stringify(
    {
      schema: "poct.openrouter_model_smoke.v1",
      createdAt: new Date().toISOString(),
      timeoutMs,
      results
    },
    null,
    2
  )
);
