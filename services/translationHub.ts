import { MedicalAIService } from "./geminiService";
import { DeepseekService } from "./deepseekService";
import { ProxyTranslationService, ProxyEngine, type ProxyModelIssue } from "./proxyService";
import { POCTRecord, TargetLanguage } from "../types";
import type { TranslationProfile } from "../utils/translationProfiles";
import {
  alignTranslationEnvelopes,
  isTranslationEnvelopeBatch,
  unwrapTranslationEnvelopes,
  wrapTranslationRecords
} from "../utils/translationAlignment";

export interface TranslationRequest {
  records: POCTRecord[];
  targetLang: TargetLanguage;
    options?: {
      model?: "cloudflare-ai" | "deepseek" | "gemini";
      providerModel?: string;
      profile?: TranslationProfile;
  };
}

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

const isProxyMode = () => {
  const explicitMode = (getEnvValue("VITE_TRANSLATION_MODE") || "").toLowerCase().trim();
  if (explicitMode === "proxy") return true;
  if (explicitMode === "direct") return false;

  const isDev = (getEnvValue("DEV") || "").toLowerCase() === "true";
  return !isDev;
};

const parseProxyCapabilities = () => {
  const raw = (getEnvValue("VITE_PROXY_ENGINES") || "").toLowerCase();
  if (!raw) {
    return { cloudflareAi: true, deepseek: false, gemini: false };
  }
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return {
    cloudflareAi: items.includes("cloudflare-ai") || items.includes("cloudflare"),
    deepseek: items.includes("deepseek"),
    gemini: items.includes("gemini")
  };
};

// Stop splitting after this many provider failures in a row without a single success.
const MAX_CONSECUTIVE_AVAILABILITY_FAILURES = 4;

export class TranslationHub {
  private readonly deepseek: DeepseekService;
  private readonly gemini: MedicalAIService;
  private readonly proxy?: ProxyTranslationService;
  private readonly cache = new Map<string, POCTRecord[]>();
  private readonly hasGeminiKey: boolean;
  private readonly DEFAULT_RETRIES = 2;
  private readonly capabilities: {
    cloudflareAi: boolean;
    deepseek: boolean;
    gemini: boolean;
  };
  private lastEngine: "cloudflare-ai" | "deepseek" | "gemini" | "unknown" = "unknown";
  private lastModelIssues: ProxyModelIssue[] = [];
  private lastModel = "";

  constructor() {
    if (isProxyMode()) {
      this.deepseek = new DeepseekService();
      this.gemini = new MedicalAIService();
      this.hasGeminiKey = false;
      this.proxy = new ProxyTranslationService();
      this.capabilities = parseProxyCapabilities();
    } else {
      this.deepseek = new DeepseekService();
      this.gemini = new MedicalAIService();
      this.hasGeminiKey = this.detectGeminiKey();
      this.capabilities = {
        cloudflareAi: false,
        deepseek: true,
        gemini: this.hasGeminiKey
      };
    }
  }

  private detectGeminiKey() {
    const nodeKey =
      typeof process !== "undefined"
        ? process.env.GEMINI_API_KEY || process.env.API_KEY
        : "";
    const browserKey =
      typeof import.meta !== "undefined"
        ? (import.meta as any).env?.GEMINI_API_KEY ||
          (import.meta as any).env?.API_KEY
        : "";
    const key = (nodeKey || browserKey || "").trim();
    if (!key) return false;
    return !/^placehol/i.test(key);
  }

  // Failures caused by the model output (bad JSON, wrong length, misaligned ids) are fixed by
  // translating smaller pieces, so splitting is always worth trying.
  private isStructuralBatchError(message: string) {
    return (
      message.includes("failed to parse model json") ||
      message.includes("expected ':' after property name") ||
      message.includes("invalid json") ||
      message.includes("did not return a json array") ||
      message.includes("returned invalid json") ||
      message.includes("translation returned") ||
      message.includes("length mismatch") ||
      message.includes("invalid payload") ||
      message.includes("invalid record data") ||
      message.includes("translation alignment mismatch")
    );
  }

  // Failures caused by the provider (overload, timeouts, network, rate limits) may be size
  // related, so a few splits are allowed, but a provider outage must not fan out into
  // one request per record.
  private isAvailabilityBatchError(message: string) {
    return (
      message.includes("proxy translate network error") ||
      message.includes("proxy translate error 500") ||
      message.includes("deepseek error 429") ||
      message.includes("deepseek error 503") ||
      message.includes("rate limit") ||
      message.includes("server overloaded") ||
      message.includes("overloaded") ||
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("failed to fetch") ||
      message.includes("fetch failed") ||
      message.includes("networkerror")
    );
  }

  private classifyBatchError(error: unknown): "structural" | "availability" | "fatal" {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (this.isStructuralBatchError(message)) return "structural";
    if (this.isAvailabilityBatchError(message)) return "availability";
    return "fatal";
  }

  private async translateWithRecovery(
    req: TranslationRequest,
    state: { availabilityFailures: number } = { availabilityFailures: 0 }
  ): Promise<POCTRecord[]> {
    try {
      const translated = await this.translateDirect(req);
      const aligned = isTranslationEnvelopeBatch(req.records)
        ? alignTranslationEnvelopes(req.records, translated)
        : translated;
      state.availabilityFailures = 0;
      return aligned;
    } catch (error) {
      if (req.records.length <= 1) throw error;
      const kind = this.classifyBatchError(error);
      if (kind === "fatal") throw error;
      if (kind === "availability") {
        state.availabilityFailures += 1;
        if (state.availabilityFailures >= MAX_CONSECUTIVE_AVAILABILITY_FAILURES) {
          throw error;
        }
      }
      const mid = Math.ceil(req.records.length / 2);
      const left = await this.translateWithRecovery({ ...req, records: req.records.slice(0, mid) }, state);
      const right = await this.translateWithRecovery({ ...req, records: req.records.slice(mid) }, state);
      return [...left, ...right];
    }
  }

  private async translateDirect(req: TranslationRequest): Promise<POCTRecord[]> {
    const preferred = req.options?.model;

    if (this.proxy) {
      const engine = (req.options?.model || "auto") as ProxyEngine;
      let translated: POCTRecord[];
      try {
        translated = await this.proxy.translateBatch(
          req.records,
          req.targetLang,
          engine,
          req.options?.providerModel,
          {
            profile: req.options?.profile
          }
        );
      } catch (error) {
        this.lastModelIssues = this.proxy.getLastModelIssues();
        throw error;
      }
      this.lastEngine = this.proxy.getLastEngine();
      this.lastModel = this.proxy.getLastModel();
      this.lastModelIssues = this.proxy.getLastModelIssues();
      if (!Array.isArray(translated) || translated.length !== req.records.length) {
        throw new Error(
          `Translation returned ${Array.isArray(translated) ? translated.length : 0} records (expected ${req.records.length}).`
        );
      }
      const hasInvalidRecord = translated.some(
        (record) => !record || typeof record !== "object"
      );
      if (hasInvalidRecord) {
        throw new Error("Translation returned invalid record data.");
      }
      return translated;
    }
    this.lastModelIssues = [];

    const runDeepseek = async () => {
      let lastError;
      const deepseek = req.options?.providerModel
        ? new DeepseekService(req.options.providerModel)
        : this.deepseek;
      for (let attempt = 0; attempt <= this.DEFAULT_RETRIES; attempt++) {
        try {
          return await deepseek.translateBatch(
            req.records,
            req.targetLang,
            req.options?.profile
          );
        } catch (err) {
          lastError = err;
          if (attempt < this.DEFAULT_RETRIES) {
            const delay = 500 * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw lastError;
        }
      }
      throw lastError;
    };
    const runGemini = () =>
      this.gemini.translateBatch(req.records, req.targetLang);
    let translated: POCTRecord[];
    if (preferred === "gemini") {
      if (!this.hasGeminiKey) {
        throw new Error("Gemini API Key unavailable,无法使用该模型。");
      }
      translated = await runGemini();
      this.lastEngine = "gemini";
    } else if (preferred === "deepseek") {
      translated = await runDeepseek();
      this.lastEngine = "deepseek";
    } else {
      let used = false;
      try {
        translated = await runDeepseek();
        used = true;
        this.lastEngine = "deepseek";
      } catch (deepseekError) {
        console.warn("Deepseek translation failed, trying Gemini fallback.", deepseekError);
      }
      if (!used && this.hasGeminiKey) {
        try {
          translated = await runGemini();
          used = true;
          this.lastEngine = "gemini";
        } catch (geminiError) {
          console.warn("Gemini translation failed.", geminiError);
        }
      }
      if (!used) throw new Error("No direct translation engine succeeded.");
    }

    if (!Array.isArray(translated) || translated.length !== req.records.length) {
      throw new Error(
        `Translation returned ${Array.isArray(translated) ? translated.length : 0} records (expected ${req.records.length}).`
      );
    }
    const hasInvalidRecord = translated.some(
      (record) => !record || typeof record !== "object"
    );
    if (hasInvalidRecord) {
      throw new Error("Translation returned invalid record data.");
    }

    return translated;
  }

  async translateBatch(req: TranslationRequest): Promise<POCTRecord[]> {
    const preferred = req.options?.model;
    const cacheKey = JSON.stringify({
      lang: req.targetLang,
      records: req.records,
      model: preferred || "auto",
      providerModel: req.options?.providerModel || "",
      profile: req.options?.profile || "spreadsheet",
      mode: this.proxy ? "proxy" : "direct"
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const translatedEnvelopes = await this.translateWithRecovery({
      ...req,
      records: wrapTranslationRecords(req.records)
    });
    const translated = unwrapTranslationEnvelopes(translatedEnvelopes);
    this.cache.set(cacheKey, translated);
    return translated;
  }

  getCapabilities() {
    return this.capabilities;
  }

  getLastEngine() {
    return this.lastEngine;
  }

  getLastModel() {
    return this.lastModel;
  }

  getLastModelIssues() {
    return this.lastModelIssues;
  }
}
