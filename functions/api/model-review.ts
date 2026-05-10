import type { POCTRecord, TargetLanguage } from "../../types";
import {
  buildModelReviewRanking,
  DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
  DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
  normalizeModelReviewScores,
  type ModelReviewCandidate,
  type ModelReviewJudgeResult,
  type ModelReviewSample
} from "../../utils/modelReview";
import { parseModelJsonArray, parseModelJsonObject } from "../../utils/jsonRepair";
import {
  buildOpenRouterPrompt,
  buildOpenRouterSystemPrompt,
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
    return {};
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

const parseModelList = (value: unknown, fallback: string[]) => {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\n;]+/);
  const parsed = raw
    .map((item) => normalizeOpenRouterModelId(String(item || "")))
    .filter(Boolean);
  return Array.from(new Set(parsed.length ? parsed : fallback.map(normalizeOpenRouterModelId)));
};

const parseSamples = (value: unknown): ModelReviewSample[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const sourceText = String(row.sourceText || "").trim();
      if (!sourceText) return null;
      return {
        id: String(row.id || `sample-${index + 1}`).trim(),
        location: String(row.location || `Segment ${index + 1}`).trim(),
        sourceText,
        contextBefore: Array.isArray(row.contextBefore)
          ? row.contextBefore.map((text) => String(text || "")).filter(Boolean).slice(-2)
          : [],
        contextAfter: Array.isArray(row.contextAfter)
          ? row.contextAfter.map((text) => String(text || "")).filter(Boolean).slice(0, 2)
          : []
      } satisfies ModelReviewSample;
    })
    .filter((item): item is ModelReviewSample => Boolean(item))
    .slice(0, 30);
};

const sanitizeContent = (content: unknown) => {
  if (Array.isArray(content)) {
    return content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
  }
  return typeof content === "string" ? content : "";
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const callOpenRouter = async ({
  key,
  referer,
  model,
  system,
  user,
  maxTokens = 5000
}: {
  key: string;
  referer: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}) => {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": referer,
      "X-Title": "POCT Medical Translator"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${text.slice(0, 300)}`);
  }
  const payload = JSON.parse(text);
  const content = sanitizeContent(payload.choices?.[0]?.message?.content);
  if (!content.trim()) throw new Error("OpenRouter returned empty content.");
  return content;
};

const translateWithModel = async ({
  key,
  referer,
  model,
  samples,
  targetLang,
  profile
}: {
  key: string;
  referer: string;
  model: string;
  samples: ModelReviewSample[];
  targetLang: TargetLanguage;
  profile: TranslationProfile;
}): Promise<ModelReviewCandidate["translations"]> => {
  const records: POCTRecord[] = samples.map((sample) => ({
    id: sample.id,
    content: sample.sourceText,
    contextBefore: sample.contextBefore?.join("\n") || "",
    contextAfter: sample.contextAfter?.join("\n") || ""
  }));
  const content = await callOpenRouter({
    key,
    referer,
    model,
    system: buildOpenRouterSystemPrompt(profile),
    user: buildOpenRouterPrompt(records, targetLang, profile),
    maxTokens: 7000
  });
  const parsed = parseModelJsonArray<POCTRecord>(content);
  return samples.map((sample, index) => {
    const record = parsed.find((item) => String(item?.id || "") === sample.id) || parsed[index] || {};
    return {
      id: sample.id,
      translation: String(record.content || "").trim()
    };
  });
};

const buildJudgePrompt = (
  samples: ModelReviewSample[],
  candidates: ModelReviewCandidate[],
  targetLang: TargetLanguage,
  profile: TranslationProfile
) => {
  const anonymousOutputs = candidates.map((candidate) => ({
    alias: candidate.alias,
    outputs: candidate.translations
  }));
  const isSpreadsheet = profile === "spreadsheet";
  const scenario = isSpreadsheet
    ? `clinical/POCT spreadsheet cells and AI interpretation tables`
    : `IVD analyzer IFU/operator manuals`;
  const styleGuidance = isSpreadsheet
    ? `- Evaluate cell-level translation quality: concise, medically clear, suitable for spreadsheet/report interpretation, and not over-expanded.
- Do not require IFU/manual prose style for spreadsheet cells. Score "manualStyle" as "cell/report style fit".
- Score "avoidYou" as concise impersonal phrasing; there is usually no reason to introduce "you/your" in spreadsheet interpretations.`
    : `- For English manual prose, penalize unnecessary direct "you/your"; prefer imperative, passive voice, "the user", "the operator", or "personnel" when natural.
- Score "manualStyle" as IFU/operator manual style fit.
- Score "avoidYou" as avoiding unnecessary direct address.`;
  return `
Evaluate anonymous Chinese-to-${targetLang} translations for ${scenario}.

Important:
- Do not infer or mention model names. Judge only Candidate aliases.
- Company-name romanization is not a scoring factor unless the source explicitly contains a protected company name and the candidate changes it incorrectly.
- Preserve clinical meaning, severity, conditions, units, symbols, placeholders, table headers, and UI labels.
- Penalize literal Chinese syntax, omitted meaning, unsafe interpretation changes, terminology drift, and placeholder/UI-label damage.
${styleGuidance}

Score each candidate 1-10 on:
accuracy, fluency, manualStyle, terminology, formatSafety, avoidLiteral, avoidYou, overall.

Return only valid JSON:
{"scores":[{"alias":"Candidate A","accuracy":9,"fluency":9,"manualStyle":9,"terminology":9,"formatSafety":9,"avoidLiteral":9,"avoidYou":9,"overall":9,"notes":"concise Chinese notes"}]}

Samples:
${JSON.stringify(samples)}

Anonymous candidate outputs:
${JSON.stringify(anonymousOutputs)}
`;
};

export const onRequestPost = async (context: any) => {
  try {
    const payload = await context.request.json();
    const samples = parseSamples(payload?.samples);
    const targetLang = payload?.targetLang as TargetLanguage | undefined;
    const profile: TranslationProfile = payload?.profile === "docx-manual" ? "docx-manual" : "spreadsheet";

    if (!samples.length || !targetLang) {
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
      return json({ error: "Unauthorized: missing user email for whitelist check." }, 401);
    }
    if (!userEmail && requireAccessEmail) {
      return json({ error: "Unauthorized: missing Cloudflare Access user email." }, 401);
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

    const translationModels = parseModelList(
      payload?.translationModels || env.MODEL_REVIEW_TRANSLATION_MODELS,
      DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS
    );
    const judgeModels = parseModelList(
      payload?.judgeModels || env.MODEL_REVIEW_JUDGE_MODELS,
      DEFAULT_MODEL_REVIEW_JUDGE_MODELS
    );
    const referer =
      env.OPENROUTER_SITE ||
      context.request.headers.get("Origin") ||
      "https://poct-translator.local";

    const aliases = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const candidates: ModelReviewCandidate[] = await Promise.all(translationModels.map(async (model, index) => {
      const started = Date.now();
      const alias = `Candidate ${aliases[index] || index + 1}`;
      try {
        const translations = await translateWithModel({
          key: openRouterKey,
          referer,
          model,
          samples,
          targetLang,
          profile
        });
        return {
          model,
          alias,
          translations,
          elapsedMs: Date.now() - started
        };
      } catch (error) {
        return {
          model,
          alias,
          translations: [],
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - started
        };
      }
    }));

    const successfulCandidates = candidates.filter((candidate) => candidate.translations.length);
    if (!successfulCandidates.length) {
      return json({ error: "All translation candidates failed.", candidates }, 500);
    }

    const aliasToModel = new Map(candidates.map((candidate) => [candidate.alias, candidate.model]));
    const judges: ModelReviewJudgeResult[] = await Promise.all(judgeModels.map(async (model) => {
      try {
        const content = await callOpenRouter({
          key: openRouterKey,
          referer,
          model,
          system: profile === "spreadsheet"
            ? "You are a strict anonymous translation quality judge for clinical spreadsheet and POCT report interpretation translations. Return JSON only."
            : "You are a strict anonymous translation quality judge for IVD operator manuals. Return JSON only.",
          user: buildJudgePrompt(samples, successfulCandidates, targetLang, profile),
          maxTokens: 7000
        });
        const parsed = parseModelJsonObject<{ scores?: unknown }>(content);
        return {
          model,
          scores: normalizeModelReviewScores(parsed.scores, aliasToModel)
        };
      } catch (error) {
        return {
          model,
          scores: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));

    const ranking = buildModelReviewRanking(candidates, judges);
    return json({
      createdAt: new Date().toISOString(),
      targetLang,
      profile,
      samples,
      candidates,
      judges,
      ranking
    });
  } catch (error: any) {
    return json({ error: error?.message || "Unhandled error" }, 500);
  }
};
