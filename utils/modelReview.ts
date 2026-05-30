import type { TargetLanguage } from "../types";
import { type TranslationProfile } from "./translationProfiles";

export type ModelReviewStyle =
  | "auto"
  | "medical-report"
  | "ifu-manual"
  | "marketing-readable"
  | "terminology-faithful";

export interface ModelReviewSample {
  id: string;
  location: string;
  sourceText: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface ModelReviewCandidateTranslation {
  id: string;
  translation: string;
}

export interface ModelReviewCandidate {
  model: string;
  alias: string;
  translations: ModelReviewCandidateTranslation[];
  error?: string;
  elapsedMs?: number;
}

export interface ModelReviewScore {
  alias: string;
  model?: string;
  accuracy: number;
  fluency: number;
  manualStyle: number;
  terminology: number;
  formatSafety: number;
  avoidLiteral: number;
  avoidYou: number;
  overall: number;
  notes: string;
}

export interface ModelReviewJudgeResult {
  model: string;
  scores: ModelReviewScore[];
  error?: string;
}

export interface ModelReviewRankingRow {
  alias: string;
  model: string;
  accuracy: number;
  fluency: number;
  manualStyle: number;
  terminology: number;
  formatSafety: number;
  avoidLiteral: number;
  avoidYou: number;
  overall: number;
  judgeCount: number;
  elapsedMs?: number;
}

export interface ModelReviewResult {
  createdAt: string;
  targetLang: TargetLanguage;
  profile?: TranslationProfile;
  reviewStyle?: ModelReviewStyle;
  samples: ModelReviewSample[];
  candidates: ModelReviewCandidate[];
  judges: ModelReviewJudgeResult[];
  ranking: ModelReviewRankingRow[];
}

export const DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS = Array.from(
  new Set([
    "cloudflare-ai:google/gemini-3-flash",
    "deepseek:deepseek-v4-flash",
    "deepseek:deepseek-v4-pro",
    "cloudflare-ai:openai/gpt-5.4",
    "cloudflare-ai:anthropic/claude-sonnet-4.6"
  ])
);

export const DEFAULT_MODEL_REVIEW_JUDGE_MODELS = [
  "cloudflare-ai:openai/gpt-5.4",
  "cloudflare-ai:anthropic/claude-sonnet-4.6",
  "deepseek:deepseek-v4-pro"
];

export const DEFAULT_DOCX_REVIEW_MODEL_CHAIN = DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS;

export const MODEL_REVIEW_STYLE_LABELS: Record<ModelReviewStyle, string> = {
  auto: "Auto / General medical",
  "medical-report": "Medical report / Table interpretation",
  "ifu-manual": "Instructions for use / IFU",
  "marketing-readable": "Marketing / User-readable",
  "terminology-faithful": "Terminology-faithful / Low rewrite"
};

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(10, num)) : 0;
};

export const normalizeModelReviewScores = (
  scores: unknown,
  aliasToModel?: Map<string, string>
): ModelReviewScore[] => {
  if (!Array.isArray(scores)) return [];
  return scores
    .map<ModelReviewScore | null>((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const alias = String(row.alias || row.model || "").trim();
      if (!alias) return null;
      return {
        alias,
        model: aliasToModel?.get(alias),
        accuracy: toNumber(row.accuracy),
        fluency: toNumber(row.fluency),
        manualStyle: toNumber(row.manualStyle),
        terminology: toNumber(row.terminology),
        formatSafety: toNumber(row.formatSafety),
        avoidLiteral: toNumber(row.avoidLiteral),
        avoidYou: toNumber(row.avoidYou),
        overall: toNumber(row.overall),
        notes: String(row.notes || "").trim()
      } satisfies ModelReviewScore;
    })
    .filter((item): item is ModelReviewScore => item !== null);
};

export const buildModelReviewRanking = (
  candidates: ModelReviewCandidate[],
  judges: ModelReviewJudgeResult[]
): ModelReviewRankingRow[] => {
  const aggregate = new Map<string, ModelReviewRankingRow>();
  candidates.filter((candidate) => candidate.translations.length > 0).forEach((candidate) => {
    aggregate.set(candidate.alias, {
      alias: candidate.alias,
      model: candidate.model,
      accuracy: 0,
      fluency: 0,
      manualStyle: 0,
      terminology: 0,
      formatSafety: 0,
      avoidLiteral: 0,
      avoidYou: 0,
      overall: 0,
      judgeCount: 0,
      elapsedMs: candidate.elapsedMs
    });
  });

  judges.forEach((judge) => {
    judge.scores.forEach((score) => {
      const row = aggregate.get(score.alias);
      if (!row) return;
      row.accuracy += score.accuracy;
      row.fluency += score.fluency;
      row.manualStyle += score.manualStyle;
      row.terminology += score.terminology;
      row.formatSafety += score.formatSafety;
      row.avoidLiteral += score.avoidLiteral;
      row.avoidYou += score.avoidYou;
      row.overall += score.overall;
      row.judgeCount += 1;
    });
  });

  return Array.from(aggregate.values())
    .map((row) => {
      if (!row.judgeCount) return row;
      return {
        ...row,
        accuracy: row.accuracy / row.judgeCount,
        fluency: row.fluency / row.judgeCount,
        manualStyle: row.manualStyle / row.judgeCount,
        terminology: row.terminology / row.judgeCount,
        formatSafety: row.formatSafety / row.judgeCount,
        avoidLiteral: row.avoidLiteral / row.judgeCount,
        avoidYou: row.avoidYou / row.judgeCount,
        overall: row.overall / row.judgeCount
      };
    })
    .sort((a, b) => b.overall - a.overall || b.manualStyle - a.manualStyle);
};

export const formatModelReviewReport = (result: ModelReviewResult) => {
  const styleLabel =
    result.reviewStyle === "medical-report"
      ? "Cell Style"
      : result.reviewStyle === "marketing-readable"
        ? "Readability"
        : result.reviewStyle === "terminology-faithful"
          ? "Faithful"
          : "Manual";
  const avoidYouLabel = result.reviewStyle === "medical-report" ? "Concise" : "Avoid You";
  const lines: string[] = [
    "Multi-AI Model Review",
    `Created: ${result.createdAt}`,
    `Target: ${result.targetLang}`,
    `Profile: ${result.profile || "unknown"}`,
    `Review style: ${result.reviewStyle ? MODEL_REVIEW_STYLE_LABELS[result.reviewStyle] : "unknown"}`,
    "",
    "Ranking",
    `| Rank | Model | Overall | Accuracy | Fluency | ${styleLabel} | Term | Format | Avoid Literal | ${avoidYouLabel} |`,
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];
  result.ranking.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${row.model} | ${row.overall.toFixed(2)} | ${row.accuracy.toFixed(2)} | ${row.fluency.toFixed(2)} | ${row.manualStyle.toFixed(2)} | ${row.terminology.toFixed(2)} | ${row.formatSafety.toFixed(2)} | ${row.avoidLiteral.toFixed(2)} | ${row.avoidYou.toFixed(2)} |`
    );
  });

  lines.push("", "Samples");
  result.samples.forEach((sample) => {
    lines.push("", `## ${sample.id} ${sample.location}`, "", sample.sourceText);
    result.candidates.forEach((candidate) => {
      const translation = candidate.translations.find((item) => item.id === sample.id);
      lines.push("", `### ${candidate.model}`, translation?.translation || candidate.error || "(empty)");
    });
  });

  lines.push("", "Judge Notes");
  result.judges.forEach((judge) => {
    lines.push("", `## ${judge.model}`);
    if (judge.error) {
      lines.push(`Error: ${judge.error}`);
      return;
    }
    judge.scores.forEach((score) => {
      const model = result.candidates.find((candidate) => candidate.alias === score.alias)?.model || score.alias;
      lines.push(`- ${model}: ${score.overall.toFixed(2)} - ${score.notes || "No notes."}`);
    });
  });

  return lines.join("\n");
};
