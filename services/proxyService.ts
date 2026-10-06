import { POCTRecord, TargetLanguage } from "../types";
import type { TranslationProfile } from "../utils/translationProfiles";

export type ProxyEngine = "auto" | "cloudflare-ai" | "deepseek" | "gemini";

export type ProxyModelIssue = {
  model: string;
  status?: number | string;
  message: string;
  kind?: string;
};

const PROXY_NETWORK_RETRIES = 2;
// The server stops trying models after about 90 s, so 120 s means the request is hung.
const DEFAULT_PROXY_REQUEST_TIMEOUT_MS = 120_000;

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
  private lastEngine: "cloudflare-ai" | "deepseek" | "gemini" | "unknown" = "unknown";
  private lastModelIssues: ProxyModelIssue[] = [];
  private lastModel = "";
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      (endpoint || getEnvValue("VITE_TRANSLATION_PROXY_URL") || "/api/translate").trim();
  }

  private getRequestTimeoutMs() {
    const raw = Number(getEnvValue("VITE_PROXY_REQUEST_TIMEOUT_MS"));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PROXY_REQUEST_TIMEOUT_MS;
    return Math.min(300_000, Math.max(1_000, Math.round(raw)));
  }

  async translateBatch(
    records: POCTRecord[],
    targetLang: TargetLanguage,
    engine: ProxyEngine = "auto",
    model?: string,
    options: {
      profile?: TranslationProfile;
    } = {}
  ): Promise<POCTRecord[]> {
    const timeoutMs = this.getRequestTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.translateBatchOnce(records, targetLang, engine, model, options, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Proxy translate timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async translateBatchOnce(
    records: POCTRecord[],
    targetLang: TargetLanguage,
    engine: ProxyEngine,
    model: string | undefined,
    options: {
      profile?: TranslationProfile;
    },
    signal: AbortSignal
  ): Promise<POCTRecord[]> {
    this.lastModelIssues = [];
    this.lastModel = "";
    const body = JSON.stringify({
      records,
      targetLang,
      engine,
      model,
      profile: options.profile
    });
    let response: Response | null = null;
    let lastNetworkError: unknown = null;

    for (let attempt = 0; attempt <= PROXY_NETWORK_RETRIES; attempt += 1) {
      try {
        response = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal
        });

        if (
          response.ok ||
          !isRetryableProxyStatus(response.status) ||
          attempt >= PROXY_NETWORK_RETRIES
        ) {
          break;
        }
      } catch (error) {
        if (signal.aborted) throw error;
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

    if (typeof payload?.model === "string") {
      this.lastModel = payload.model;
    }

    const engineUsed = payload?.engine;
    if (typeof engineUsed === "string") {
      if (
        engineUsed === "cloudflare-ai" ||
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

  getLastModel() {
    return this.lastModel;
  }
}
