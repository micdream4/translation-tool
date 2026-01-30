import { POCTRecord, TargetLanguage } from "../types";

export type ProxyEngine = "auto" | "openrouter" | "deepseek" | "gemini";

const getEnvValue = (key: string): string | undefined => {
  if (typeof import.meta !== "undefined") {
    const metaEnv = (import.meta as any).env || {};
    const value = metaEnv[key];
    if (value !== undefined) return String(value);
  }
  if (typeof process !== "undefined") {
    const value = (process as any).env?.[key];
    if (value !== undefined) return String(value);
  }
  return undefined;
};

export class ProxyTranslationService {
  private lastEngine: "openrouter" | "deepseek" | "gemini" | "unknown" = "unknown";
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      (endpoint || getEnvValue("VITE_TRANSLATION_PROXY_URL") || "/api/translate").trim();
  }

  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage,
    engine: ProxyEngine = "auto"
  ): Promise<POCTRecord[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records, targetLang, engine })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Proxy translate error ${response.status}: ${text.slice(0, 200)}`
      );
    }

    const payload = await response.json();
    if (Array.isArray(payload)) return payload;

    const engineUsed = payload?.engine;
    if (typeof engineUsed === "string") {
      if (engineUsed === "openrouter" || engineUsed === "deepseek" || engineUsed === "gemini") {
        this.lastEngine = engineUsed;
      }
    }

    const recordsOut = payload?.records ?? payload?.data ?? payload?.result;
    if (!Array.isArray(recordsOut)) {
      throw new Error("Proxy translate returned invalid payload.");
    }
    return recordsOut;
  }

  getLastEngine() {
    return this.lastEngine;
  }
}
