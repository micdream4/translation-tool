import { GLOSSARY_PROMPT, shouldUseEnglishGlossary } from "../../utils/glossary";
import type { POCTRecord, TargetLanguage } from "../../types";
import { parseModelJsonArray, sanitizeModelJson } from "../../utils/jsonRepair";

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

const buildOpenRouterPrompt = (records: POCTRecord[], targetLang: TargetLanguage) => {
  const useEnglishGlossary = shouldUseEnglishGlossary(targetLang);
  const glossarySection = useEnglishGlossary
    ? `\nGlossary (Chinese => preferred term):\n${GLOSSARY_PROMPT}\n`
    : "";
  const glossaryRule = useEnglishGlossary
    ? "- Always use the preferred glossary wording verbatim when the source contains those concepts."
    : `- Translate medical terminology fully into ${targetLang}. Keep only true codes, model numbers, and standard abbreviations (e.g., WBC, RBC, QC) unchanged.`;

  return `
You are a senior hematology-manual translator. Convert every string within the JSON array to ${targetLang} while maintaining fluent instructions.
${glossarySection}

Rules:
${glossaryRule}
- Translate any non-${targetLang} natural-language text (including full English sentences) into ${targetLang}.
- Translate address/common nouns such as "Room", "Building", "Street", "District", "City", "Province" into ${targetLang}; keep only true proper names transliterated or unchanged.
- Preserve numbers, IDs, measurement units, and codes exactly.
- If a cell mixes code + text, keep the code intact and only translate the descriptive part.
- Keep placeholder tokens such as "__TKN_0__", "__ID_0__", "__FMT_0__" exactly as provided; they mark protected IDs, codes, or format placeholders.
- Do not invent or introduce new placeholder tokens; only preserve placeholders already present in input.
- Keep only true UI/code tokens unchanged (e.g., "Login", "admin", "START", button labels, product code literals). Do NOT keep full English prose unchanged when target is not English.
- Preserve original wrapper symbols around UI labels exactly (e.g., 『Next』, 『Back』, 【Home】); do not replace them with straight quotes.
- Optimize spacing and punctuation to read naturally in ${targetLang}.
- Always return a valid JSON object: {"records":[...]} where records keeps the same length/keys. No explanations outside JSON.

INPUT:
${JSON.stringify(records)}
`;
};

const sanitizeResponse = (text: string) =>
  sanitizeModelJson(text.replace(/```json|```/gi, ""));

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

    if (!Array.isArray(records) || !targetLang) {
      return json({ error: "Invalid payload." }, 400);
    }

    const env = (context.env || {}) as Record<string, unknown>;
    const allowLocalWithoutAccess = TRUTHY.has(
      String(env.ALLOW_LOCAL_WITHOUT_ACCESS || "").trim().toLowerCase()
    );
    const accessEmail = getAccessEmail(context.request);
    const userEmail = accessEmail || (allowLocalWithoutAccess ? getLocalBypassEmail(context.request, env) : "");

    if (!userEmail) {
      const hint = allowLocalWithoutAccess
        ? " Set LOCAL_DEV_EMAIL or send x-user-email for local testing."
        : "";
      return json({ error: `Unauthorized: missing Cloudflare Access user email.${hint}` }, 401);
    }

    const allowedEmails = parseAllowedEmails(env.ALLOWED_USER_EMAILS || env.ALLOWED_EMAILS);
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
      const model = (env.OPENROUTER_MODEL || env.VITE_OPENROUTER_MODEL || "google/gemini-3.0-flash-preview").trim();
      const referer =
        env.OPENROUTER_SITE ||
        context.request.headers.get("Origin") ||
        "https://poct-translator.local";
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
              content:
                "You translate medical POCT spreadsheets to the requested language while keeping structure unchanged."
            },
            { role: "user", content: buildOpenRouterPrompt(records, targetLang) }
          ]
        })
      });

      if (!response.ok) {
        const text = await response.text();
        return json({ error: `OpenRouter error ${response.status}: ${text.slice(0, 200)}` }, 500);
      }

      const result = await response.json();
      let content = result.choices?.[0]?.message?.content;
      if (Array.isArray(content)) {
        content = content.map((chunk: any) => chunk?.text ?? chunk?.content ?? "").join("\n");
      }
      const text = typeof content === "string" ? sanitizeResponse(content) : "";
      if (!text) return json({ error: "OpenRouter returned empty content." }, 500);
      const parsed = parseModelJsonArray(text);
      return json({ engine: "openrouter", records: parsed });
    }

    return json({ error: "No available translation engine." }, 400);
  } catch (error: any) {
    return json({ error: error?.message || "Unhandled error" }, 500);
  }
};
