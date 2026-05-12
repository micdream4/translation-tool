import type { POCTRecord, TargetLanguage } from "../../types";
import { parseModelJsonArray, sanitizeModelJson } from "../../utils/jsonRepair";
import {
  buildOpenRouterPrompt,
  buildOpenRouterSystemPrompt,
  DOCX_MANUAL_OPENROUTER_MODELS,
  normalizeOpenRouterModelId,
  type TranslationProfile
} from "../../utils/translationProfiles";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();

const parseAllowedEmails = (raw: unknown) =>
  new Set(
    String(raw || "")
      .split(/[,\n;]+/)
      .map((item) => normalizeEmail(item))
      .filter(Boolean)
  );

const parseUserKeyMap = (raw: unknown) => {
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object") return {} as Record<string, string>;
    const out: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([email, key]) => {
      const normalizedEmail = normalizeEmail(email);
      const normalizedKey = String(key || "").trim();
      if (!normalizedEmail || !normalizedKey) return;
      out[normalizedEmail] = normalizedKey;
    });
    return out;
  } catch (error) {
    console.warn("Failed to parse OPENROUTER_KEYS_BY_EMAIL JSON.", error);
    return {} as Record<string, string>;
  }
};

const getAccessEmail = (request: Request) =>
  normalizeEmail(
    request.headers.get("CF-Access-Authenticated-User-Email") ||
      request.headers.get("Cf-Access-Authenticated-User-Email") ||
      request.headers.get("cf-access-authenticated-user-email")
  );

const getLocalBypassEmail = (request: Request, env: Record<string, unknown>) =>
  normalizeEmail(request.headers.get("x-user-email") || env.LOCAL_DEV_EMAIL);

const sanitizeResponse = (text: string) =>
  sanitizeModelJson(text.replace(/```json|```/gi, ""));

const parseOpenRouterModels = (env: Record<string, unknown>) => {
  const rawList = String(
    env.OPENROUTER_MODELS ||
      env.VITE_OPENROUTER_MODELS ||
      env.OPENROUTER_MODEL ||
      env.VITE_OPENROUTER_MODEL ||
      "google/gemini-3-flash-preview"
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

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

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
      return json({ error: "Invalid payload." }, 400);
    }

    const env = (context.env || {}) as Record<string, unknown>;
    const allowLocalWithoutAccess = TRUTHY.has(
      String(env.ALLOW_LOCAL_WITHOUT_ACCESS || "").trim().toLowerCase()
    );
    const requireAccessEmail = TRUTHY.has(
      String(env.REQUIRE_CF_ACCESS_EMAIL || "").trim().toLowerCase()
    );
    const accessEmail = getAccessEmail(context.request);
    const localBypassEmail = allowLocalWithoutAccess ? getLocalBypassEmail(context.request, env) : "";
    const userEmail = accessEmail || localBypassEmail;

    const allowedEmails = parseAllowedEmails(env.ALLOWED_USER_EMAILS || env.ALLOWED_EMAILS);

    if (allowedEmails.size > 0 && !userEmail) {
      const hint = allowLocalWithoutAccess
        ? " Set LOCAL_DEV_EMAIL or send x-user-email for local testing."
        : "";
      return json(
        {
          error: `Unauthorized: missing user email for whitelist check.${hint}`
        },
        401
      );
    }

    if (!userEmail && requireAccessEmail) {
      const hint = allowLocalWithoutAccess
        ? " Set LOCAL_DEV_EMAIL or send x-user-email for local testing."
        : "";
      return json({ error: `Unauthorized: missing Cloudflare Access user email.${hint}` }, 401);
    }

    if (allowedEmails.size > 0 && !allowedEmails.has(userEmail)) {
      return json({ error: "Forbidden: user not in whitelist." }, 403);
    }

    const userKeyMap = parseUserKeyMap(
      env.OPENROUTER_KEYS_BY_EMAIL || env.OPENROUTER_KEY_BY_EMAIL
    );
    const defaultOpenRouterKey = String(
      env.OPENROUTER_API_KEY || env.Openrouter_API_KEY || env.VITE_OPENROUTER_API_KEY || ""
    ).trim();
    const openRouterKey = String(userKeyMap[userEmail] || defaultOpenRouterKey || "").trim();
    const hasOpenRouter = Boolean(openRouterKey);

    let chosen = engine;
    if (engine === "auto") {
      chosen = hasOpenRouter ? "openrouter" : "none";
    }

    if (chosen === "openrouter") {
      if (!hasOpenRouter) return json({ error: "OpenRouter key missing." }, 400);
      const models = requestedModel
        ? [requestedModel]
        : requestedModels.length
          ? requestedModels
          : profile === "docx-manual"
            ? parseRequestedModels(
                env.DOCX_OPENROUTER_MODELS ||
                  env.VITE_DOCX_OPENROUTER_MODELS ||
                  env.OPENROUTER_DOCX_MODELS
              ).concat(DOCX_MANUAL_OPENROUTER_MODELS).filter((model, index, arr) => arr.indexOf(model) === index)
            : parseOpenRouterModels(env);
      const referer =
        env.OPENROUTER_SITE ||
        context.request.headers.get("Origin") ||
        "https://poct-translator.local";
      const prompt = buildOpenRouterPrompt(records, targetLang, profile);
      const errors: string[] = [];

      for (const model of models) {
        try {
          const response = await fetch(OPENROUTER_API_URL, {
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
              messages: [
                {
                  role: "system",
                  content: buildOpenRouterSystemPrompt(profile)
                },
                { role: "user", content: prompt }
              ]
            })
          });

          if (!response.ok) {
            const text = await response.text();
            errors.push(`${model}: OpenRouter error ${response.status}: ${text.slice(0, 200)}`);
            continue;
          }

          const result = await response.json();
          let content = result.choices?.[0]?.message?.content;
          if (Array.isArray(content)) {
            content = content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
          }
          const text = typeof content === "string" ? sanitizeResponse(content) : "";
          if (!text) {
            errors.push(`${model}: OpenRouter returned empty content.`);
            continue;
          }
          const parsed = parseModelJsonArray(text);
          return json({ engine: "openrouter", model, records: parsed });
        } catch (error) {
          errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return json(
        {
          error: `All OpenRouter models failed. ${errors.join(" | ").slice(0, 1500)}`
        },
        500
      );
    }

    return json({ error: "No available translation engine." }, 400);
  } catch (error: any) {
    return json({ error: error?.message || "Unhandled error" }, 500);
  }
};
