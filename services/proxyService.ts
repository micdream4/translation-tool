import { POCTRecord, TargetLanguage } from "../types";
import type { TranslationProfile } from "../utils/translationProfiles";

export type ProxyEngine = "auto" | "cloudflare-ai" | "openrouter" | "deepseek" | "gemini";

export type ProxyModelIssue = {
  model: string;
  status?: number | string;
  message: string;
  kind?: string;
};

const PROXY_NETWORK_RETRIES = 2;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableProxyStatus = (status: number) =>
  status === 408 || status === 429 || status === 502 || status === 503 || status === 504;

const isNetworkFetchError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(message);
};

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
  private lastEngine: "cloudflare-ai" | "openrouter" | "deepseek" | "gemini" | "unknown" = "unknown";
  private lastModelIssues: ProxyModelIssue[] = [];
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      (endpoint || getEnvValue("VITE_TRANSLATION_PROXY_URL") || "/api/translate").trim();
  }

  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage,
    engine: ProxyEngine = "auto",
    model?: string,
    options: {
      models?: string[];
      profile?: TranslationProfile;
    } = {}
  ): Promise<POCTRecord[]> {
    this.lastModelIssues = [];
    const body = JSON.stringify({
      records,
      targetLang,
      engine,
      model,
      models: options.models,
      profile: options.profile
    });
    let response: Response | null = null;
    let lastNetworkError: unknown = null;

    for (let attempt = 0; attempt <= PROXY_NETWORK_RETRIES; attempt += 1) {
      try {
        response = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body
        });

        if (
          response.ok ||
          !isRetryableProxyStatus(response.status) ||
          attempt >= PROXY_NETWORK_RETRIES
        ) {
          break;
        }
      } catch (error) {
        if (!isNetworkFetchError(error) || attempt >= PROXY_NETWORK_RETRIES) {
          throw new Error(
            `Proxy translate network error after ${attempt + 1} attempt(s): ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        lastNetworkError = error;
      }

      await wait(600 * (attempt + 1));
    }

    if (!response) {
      throw new Error(
        `Proxy translate network error after ${PROXY_NETWORK_RETRIES + 1} attempt(s): ${
          lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError)
        }`
      );
    }

    if (!response.ok) {
      const text = await response.text();
      let message = text.slice(0, 200);
      try {
        const payload = JSON.parse(text);
        message = String(payload?.error || message);
        this.lastModelIssues = Array.isArray(payload?.modelIssues) ? payload.modelIssues : [];
      } catch {
        this.lastModelIssues = [];
      }
      throw new Error(
        `Proxy translate error ${response.status}: ${message.slice(0, 200)}`
      );
    }

    const payload = await response.json();
    this.lastModelIssues = Array.isArray(payload?.modelIssues) ? payload.modelIssues : [];
    if (Array.isArray(payload)) return payload;

    const engineUsed = payload?.engine;
    if (typeof engineUsed === "string") {
      if (
        engineUsed === "cloudflare-ai" ||
        engineUsed === "openrouter" ||
        engineUsed === "deepseek" ||
        engineUsed === "gemini"
      ) {
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

  getLastModelIssues() {
    return this.lastModelIssues;
  }
}
