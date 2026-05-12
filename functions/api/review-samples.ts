import type {
  ReviewSample,
  SampleReviewAIResult,
  SampleReviewRisk,
  SampleReviewVerdict,
  TargetLanguage
} from "../../types";
import { parseModelJsonObject } from "../../utils/jsonRepair";
import { getTargetLanguageLabel, getTargetLocaleInstruction } from "../../utils/targetLanguage";

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
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const parseRequestedModel = (value: unknown) => String(value || "").trim();

const normalizeVerdict = (value: unknown): SampleReviewVerdict => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "fail") return "fail";
  if (normalized === "warning") return "warning";
  return "pass";
};

const normalizeRisk = (value: unknown): SampleReviewRisk => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
};

const normalizeReviewResults = (items: unknown): SampleReviewAIResult[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id || "").trim();
      if (!id) return null;
      const issueTypes = Array.isArray(row.issueTypes)
        ? row.issueTypes.map((issue) => String(issue || "").trim()).filter(Boolean)
        : [];
      return {
        id,
        verdict: normalizeVerdict(row.verdict),
        risk: normalizeRisk(row.risk),
        issueTypes,
        comment: String(row.comment || "").trim(),
        suggestion: String(row.suggestion || "").trim()
      } satisfies SampleReviewAIResult;
    })
    .filter((item): item is SampleReviewAIResult => Boolean(item));
};

const buildReviewPrompt = (samples: ReviewSample[], targetLang: TargetLanguage) => {
  const targetLabel = getTargetLanguageLabel(targetLang);
  const localeInstruction = getTargetLocaleInstruction(targetLang);
  return `
You are a senior bilingual medical translation reviewer.
Review each translation pair from Chinese source into ${targetLabel}.

Goals:
- Detect genuinely risky translation problems.
- Be conservative for Latin-script languages. Do NOT flag a sentence only because it contains shared medical terms, abbreviations, or familiar Latin words.
- Focus on meaning accuracy, omission, mistranslation, leftover source language, placeholder leakage, terminology mistakes, and serious fluency issues.
${localeInstruction}

Output rules:
- Return only valid JSON object: {"reviews":[...]}
- reviews length must match input length.
- Keep each review id exactly as provided.
- verdict must be one of: pass, warning, fail
- risk must be one of: low, medium, high
- issueTypes should use short labels from: accuracy, omission, untranslated, placeholder, terminology, fluency, grammar, format
- comment must be concise Simplified Chinese, for operator reading.
- suggestion should be empty if the target sentence is acceptable; otherwise provide a corrected ${targetLabel} rewrite for the target cell only.

Judging standard:
- pass: acceptable for production, maybe minor style differences only.
- warning: understandable but has quality risk worth manual review.
- fail: clear mistranslation, omitted meaning, wrong language, placeholder leak, or unusable wording.

INPUT:
${JSON.stringify(samples)}
`;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

export const onRequestPost = async (context: any) => {
  try {
    const payload = await context.request.json();
    const samples = payload?.samples as ReviewSample[] | undefined;
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const requestedModel = parseRequestedModel(payload?.model);

    if (!Array.isArray(samples) || !targetLang) {
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
    if (!openRouterKey) return json({ error: "OpenRouter key missing." }, 400);

    const models = requestedModel ? [requestedModel] : parseOpenRouterModels(env);
    const referer =
      env.OPENROUTER_SITE ||
      context.request.headers.get("Origin") ||
      "https://poct-translator.local";
    const prompt = buildReviewPrompt(samples, targetLang);
    const errors: string[] = [];

    for (const model of models) {
      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openRouterKey}`,
            "HTTP-Referer": referer,
            "X-Title": env.OPENROUTER_APP_TITLE || "POCT Medical Translator"
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
                content: "You review medical spreadsheet translations and return strict JSON only."
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
        const parsed = parseModelJsonObject<{ reviews?: unknown }>(String(content || ""));
        const reviews = normalizeReviewResults(parsed.reviews);
        return json({ engine: "openrouter", model, reviews });
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
  } catch (error: any) {
    return json({ error: error?.message || "Unhandled error" }, 500);
  }
};
