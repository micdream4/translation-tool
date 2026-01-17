import { MedicalAIService } from "./geminiService";
import { DeepseekService } from "./deepseekService";
import { OpenRouterService } from "./openRouterService";
import { POCTRecord, TargetLanguage } from "../types";

export interface TranslationRequest {
  records: POCTRecord[];
  targetLang: TargetLanguage;
  options?: {
    model?: "deepseek" | "gemini" | "openrouter";
  };
}

export class TranslationHub {
  private readonly deepseek: DeepseekService;
  private readonly gemini: MedicalAIService;
  private readonly openRouter?: OpenRouterService;
  private readonly cache = new Map<string, POCTRecord[]>();
  private readonly hasGeminiKey: boolean;
  private readonly hasOpenRouterKey: boolean;
  private readonly DEFAULT_RETRIES = 2;
  private readonly capabilities: {
    openrouter: boolean;
    deepseek: boolean;
    gemini: boolean;
  };
  private lastEngine: "openrouter" | "deepseek" | "gemini" | "unknown" = "unknown";

  constructor() {
    this.deepseek = new DeepseekService();
    this.gemini = new MedicalAIService();
    this.hasGeminiKey = this.detectGeminiKey();
    this.hasOpenRouterKey = this.detectOpenRouterKey();
    this.openRouter = this.hasOpenRouterKey ? new OpenRouterService() : undefined;
    this.capabilities = {
      openrouter: !!this.openRouter,
      deepseek: true,
      gemini: this.hasGeminiKey
    };
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

  async translateBatch(req: TranslationRequest): Promise<POCTRecord[]> {
    const preferred = req.options?.model;
    const cacheKey = JSON.stringify({
      lang: req.targetLang,
      sample: req.records.slice(0, 2),
      model: preferred || "auto"
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

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
      return this.openRouter.translateBatch(req.records, req.targetLang);
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

    this.cache.set(cacheKey, translated);
    return translated;
  }

  getCapabilities() {
    return this.capabilities;
  }

  getLastEngine() {
    return this.lastEngine;
  }
}
