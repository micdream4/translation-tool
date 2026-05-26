import { MedicalAIService } from "./geminiService";
import { DeepseekService } from "./deepseekService";
import { OpenRouterService } from "./openRouterService";
import { ProxyTranslationService, ProxyEngine, type ProxyModelIssue } from "./proxyService";
import { POCTRecord, TargetLanguage } from "../types";
import type { TranslationProfile } from "../utils/translationProfiles";

export interface TranslationRequest {
  records: POCTRecord[];
  targetLang: TargetLanguage;
  options?: {
    model?: "cloudflare-ai" | "deepseek" | "gemini" | "openrouter";
    openRouterModel?: string;
    openRouterModels?: string[];
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
    return { cloudflareAi: true, openrouter: true, deepseek: false, gemini: false };
  }
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return {
    cloudflareAi: items.includes("cloudflare-ai") || items.includes("cloudflare"),
    openrouter: items.includes("openrouter"),
    deepseek: items.includes("deepseek"),
    gemini: items.includes("gemini")
  };
};

export class TranslationHub {
  private readonly deepseek: DeepseekService;
  private readonly gemini: MedicalAIService;
  private readonly openRouter?: OpenRouterService;
  private readonly proxy?: ProxyTranslationService;
  private readonly cache = new Map<string, POCTRecord[]>();
  private readonly hasGeminiKey: boolean;
  private readonly hasOpenRouterKey: boolean;
  private readonly DEFAULT_RETRIES = 2;
  private readonly capabilities: {
    cloudflareAi: boolean;
    openrouter: boolean;
    deepseek: boolean;
    gemini: boolean;
  };
  private lastEngine: "cloudflare-ai" | "openrouter" | "deepseek" | "gemini" | "unknown" = "unknown";
  private lastModelIssues: ProxyModelIssue[] = [];

  constructor() {
    if (isProxyMode()) {
      this.deepseek = new DeepseekService();
      this.gemini = new MedicalAIService();
      this.hasGeminiKey = false;
      this.hasOpenRouterKey = false;
      this.proxy = new ProxyTranslationService();
      this.capabilities = parseProxyCapabilities();
    } else {
      this.deepseek = new DeepseekService();
      this.gemini = new MedicalAIService();
      this.hasGeminiKey = this.detectGeminiKey();
      this.hasOpenRouterKey = this.detectOpenRouterKey();
      this.openRouter = this.hasOpenRouterKey ? new OpenRouterService() : undefined;
      this.capabilities = {
        cloudflareAi: false,
        openrouter: !!this.openRouter,
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

  private detectOpenRouterKey() {
    const nodeKey =
      typeof process !== "undefined"
        ? process.env.OPENROUTER_API_KEY ||
          process.env.VITE_OPENROUTER_API_KEY ||
          process.env.Openrouter_API_KEY ||
          process.env.VITE_Openrouter_API_KEY
        : "";
    const browserKey =
      typeof import.meta !== "undefined"
        ? (import.meta as any).env?.OPENROUTER_API_KEY ||
          (import.meta as any).env?.VITE_OPENROUTER_API_KEY ||
          (import.meta as any).env?.Openrouter_API_KEY ||
          (import.meta as any).env?.VITE_Openrouter_API_KEY
        : "";
    const key = (nodeKey || browserKey || "").trim();
    return Boolean(key);
  }

  private isRecoverableBatchError(error: unknown) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
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
      message.includes("proxy translate network error") ||
      message.includes("failed to fetch") ||
      message.includes("fetch failed") ||
      message.includes("networkerror")
    );
  }

  private async translateWithRecovery(req: TranslationRequest): Promise<POCTRecord[]> {
    try {
      return await this.translateDirect(req);
    } catch (error) {
      if (!this.isRecoverableBatchError(error) || req.records.length <= 1) {
        throw error;
      }
      const mid = Math.ceil(req.records.length / 2);
      const leftRecords = req.records.slice(0, mid);
      const rightRecords = req.records.slice(mid);
      const left = await this.translateWithRecovery({
        ...req,
        records: leftRecords
      });
      const right = await this.translateWithRecovery({
        ...req,
        records: rightRecords
      });
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
          req.options?.openRouterModel,
          {
            models: req.options?.openRouterModels,
            profile: req.options?.profile
          }
        );
      } catch (error) {
        this.lastModelIssues = this.proxy.getLastModelIssues();
        throw error;
      }
      this.lastEngine = this.proxy.getLastEngine();
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
      for (let attempt = 0; attempt <= this.DEFAULT_RETRIES; attempt++) {
        try {
          return await this.deepseek.translateBatch(req.records, req.targetLang);
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
    const runOpenRouter = () => {
      if (!this.openRouter) {
        throw new Error("OpenRouter API key unavailable.");
      }
      return this.openRouter.translateBatch(req.records, req.targetLang, {
        model: req.options?.openRouterModel,
        models: req.options?.openRouterModels,
        profile: req.options?.profile
      });
    };

    let translated: POCTRecord[];
    if (preferred === "openrouter") {
      if (!this.openRouter) {
        throw new Error("OpenRouter API key unavailable.");
      }
      translated = await runOpenRouter();
      this.lastEngine = "openrouter";
    } else if (preferred === "gemini") {
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
      if (this.openRouter) {
        try {
          translated = await runOpenRouter();
          used = true;
          this.lastEngine = "openrouter";
        } catch (primaryError) {
          console.warn("OpenRouter translation failed, fall back to Deepseek.", primaryError);
        }
      }
      if (!used) {
        try {
          translated = await runDeepseek();
          this.lastEngine = "deepseek";
        } catch (primaryError) {
          if (this.hasGeminiKey) {
            console.warn(
              "Deepseek translation failed, trying Gemini fallback.",
              primaryError
            );
            translated = await runGemini();
            this.lastEngine = "gemini";
          } else {
            throw primaryError;
          }
        }
      }
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
      openRouterModel: req.options?.openRouterModel || "",
      openRouterModels: req.options?.openRouterModels || [],
      profile: req.options?.profile || "spreadsheet",
      mode: this.proxy ? "proxy" : "direct"
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const translated = await this.translateWithRecovery(req);
    this.cache.set(cacheKey, translated);
    return translated;
  }

  getCapabilities() {
    return this.capabilities;
  }

  getLastEngine() {
    return this.lastEngine;
  }

  getLastModelIssues() {
    return this.lastModelIssues;
  }
}
