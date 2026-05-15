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

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
    const hasOpenRouter = Boolean(openRouterKey);

    let chosen = engine;
    if (engine === "auto") {
      chosen = hasOpenRouter ? "openrouter" : "none";
    }

    if (chosen === "openrouter") {
      if (!hasOpenRouter) return jsonResponse({ error: "OpenRouter key missing." }, 400);
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
          return jsonResponse({ engine: "openrouter", model, records: parsed });
        } catch (error) {
          errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return jsonResponse(
        {
          error: `All OpenRouter models failed. ${errors.join(" | ").slice(0, 1500)}`
        },
        500
      );
    }

    return jsonResponse({ error: "No available translation engine." }, 400);
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Unhandled error" }, 500);
  }
};
