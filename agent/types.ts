import type { POCTRecord, TargetLanguage } from "../types";
import type { TranslationProfile } from "../utils/translationProfiles";

export type AgentTaskStatus =
  | "COMPLETED"
  | "COMPLETED_WITH_WARNINGS"
  | "BLOCKED"
  | "FAILED";

export type AgentDocumentKind =
  | "excel"
  | "docx"
  | "pdf"
  | "string-resource"
  | "unsupported";

export interface AgentIssueCounts {
  critical: number;
  medium: number;
  minor: number;
}

export interface AgentStructureCheck {
  name: string;
  passed: boolean;
  severity: keyof AgentIssueCounts;
  detail: string;
}

export interface AgentFileResult {
  inputPath: string;
  relativePath: string;
  kind: AgentDocumentKind;
  targetLanguage: TargetLanguage;
  model: string;
  engine: string | null;
  status: AgentTaskStatus;
  outputPath: string | null;
  qualityReportPath: string;
  issueCounts: AgentIssueCounts;
  checks: AgentStructureCheck[];
  message: string;
}

export interface AgentTaskResult {
  schema: "poct.agent.translation-task.v1";
  taskId: string;
  status: AgentTaskStatus;
  startedAt: string;
  completedAt: string;
  inputPath: string;
  inputFiles: string[];
  outputDir: string;
  reportDir: string;
  outputFiles: string[];
  model: string;
  targetLanguages: TargetLanguage[];
  files: AgentFileResult[];
  issueCounts: AgentIssueCounts;
  qualityReportPath: string;
  logPath: string;
  readyForHumanReview: boolean;
  deliveryStatus: "AWAITING_HUMAN_ACCEPTANCE" | "BLOCKED";
  message: string;
}

export interface AgentTaskOptions {
  inputPath: string;
  outputDir: string;
  reportDir: string;
  taskId: string;
  targets: TargetLanguage[];
  model: string;
}

export interface AgentTranslateRequest {
  records: POCTRecord[];
  targetLanguage: TargetLanguage;
  model: string;
  profile: TranslationProfile;
}

export interface AgentTranslateResponse {
  records: POCTRecord[];
  engine: string;
}

export interface AgentTranslationProvider {
  translate(request: AgentTranslateRequest): Promise<AgentTranslateResponse>;
}

export interface AgentTaskDependencies {
  translationProvider?: AgentTranslationProvider;
  now?: () => Date;
}
