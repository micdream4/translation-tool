import type { TargetLanguage } from "../types";
import type { ModelReviewResult, ModelReviewSample, ModelReviewStyle } from "../utils/modelReview";

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

const getProxyEndpoint = () =>
  (getEnvValue("VITE_MODEL_REVIEW_PROXY_URL") || "/api/model-review").trim();

export class ModelReviewService {
  private readonly endpoint = getProxyEndpoint();

  async reviewModels({
    samples,
    targetLang,
    translationModels,
    judgeModels,
    reviewStyle,
    profile = "docx-manual"
  }: {
    samples: ModelReviewSample[];
    targetLang: TargetLanguage;
    translationModels?: string[];
    judgeModels?: string[];
    reviewStyle?: ModelReviewStyle;
    profile?: "spreadsheet" | "docx-manual";
  }): Promise<ModelReviewResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        samples,
        targetLang,
        translationModels,
        judgeModels,
        reviewStyle,
        profile
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Model review error ${response.status}: ${text.slice(0, 500)}`);
    }

    return response.json();
  }
}
