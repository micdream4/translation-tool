import { GLOSSARY_PROMPT } from "../../utils/glossary";
import type { POCTRecord, TargetLanguage } from "../../types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const buildOpenRouterPrompt = (records: POCTRecord[], targetLang: TargetLanguage) => `
You are a senior hematology-manual translator. Convert every string within the JSON array to ${targetLang} while maintaining fluent instructions.

Glossary (Chinese => preferred term):
${GLOSSARY_PROMPT}

Rules:
- Always use the preferred glossary wording verbatim when the source contains those concepts.
- Preserve numbers, IDs, measurement units, and codes exactly.
- If a cell mixes code + text, keep the code intact and only translate the descriptive part.
- Keep placeholder tokens such as "__TKN_0__", "__ID_0__", "__FMT_0__" exactly as provided; they mark UI strings, product UI terms, or format placeholders.
- Inline English UI terms (e.g., Login, admin, START) must remain unchanged even when surrounded by other languages.
- Optimize spacing between words/punctuation to read like native technical English (no missing spaces).
- Always return a valid JSON array with the same length/keys. No explanations outside JSON.

INPUT:
${JSON.stringify(records)}
`;

const sanitizeResponse = (text: string) => text.replace(/```json|```/gi, "").trim();

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

    const env = context.env || {};
    const openRouterKey = env.OPENROUTER_API_KEY || env.Openrouter_API_KEY || env.VITE_OPENROUTER_API_KEY;
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
          temperature: 0.2,
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
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return json({ error: "OpenRouter returned invalid JSON." }, 500);
      return json({ engine: "openrouter", records: parsed });
    }

    return json({ error: "No available translation engine." }, 400);
  } catch (error: any) {
    return json({ error: error?.message || "Unhandled error" }, 500);
  }
};
