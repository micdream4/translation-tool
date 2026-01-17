
export interface POCTRecord {
  [key: string]: any;
}

export type TargetLanguage =
  | 'English'
  | 'Chinese'
  | 'Spanish'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Russian'
  | 'Portuguese'
  | string;

export interface ProcessingState {
  status: 'idle' | 'analyzing' | 'processing' | 'completed' | 'error';
  progress: number;
  total: number;
  currentBatch: number;
  error?: string;
}

export type WorkflowStageKey = 'ingest' | 'translate' | 'ruleCheck' | 'aiValidate';

export type WorkflowStageStatus = 'pending' | 'running' | 'completed' | 'error';

export interface WorkflowStageState {
  key: WorkflowStageKey;
  label: string;
  status: WorkflowStageStatus;
  message?: string;
}

export interface DocumentSheet {
  name: string;
  index: number;
  records: POCTRecord[];
}

export interface RuleCondition {
  indicator: string;
  operator: '>' | '<' | '=' | 'range' | 'status';
  value: string;
}

export interface ClinicalRule {
  id: string;
  sheet?: string;
  description?: string;
  conditions: RuleCondition[];
  explanation: string;
  severity?: 'normal' | 'warning' | 'critical';
  raw?: POCTRecord;
}

export interface CombinationTemplate {
  id: string;
  title: string;
  summary: string;
  severity: 'normal' | 'warning' | 'critical';
  indicators: Array<{
    indicator: string;
    aliases: string[];
    operator?: '>' | '<' | '=' | 'status';
  }>;
  keywords?: string[];
  evidence?: string[];
  status?: 'active' | 'discarded';
}

export interface MissingCombination {
  id: string;
  indicator: string;
  suggestion: string;
  severity?: 'normal' | 'warning' | 'critical';
  basis: string[];
  templateId?: string;
  status?: 'suggested' | 'discarded';
}

export type AIModelSource =
  | 'Gemini'
  | 'OpenAI'
  | 'Claude'
  | 'Rules'
  | 'Heuristic'
  | 'OpenRouter'
  | 'Deepseek';

export interface CrossCheckConclusion {
  model: AIModelSource;
  text: string;
  confidence: number;
}

export interface CrossCheckResult {
  ruleId: string;
  aggregatedSummary: string;
  finalRecommendation: string;
  conclusions: CrossCheckConclusion[];
  conflicts?: string[];
}

export const CORE_METRICS = ['WBC', 'RBC', 'HGB', 'PLT', 'HCT', 'MCV', 'MCH', 'MCHC'];

export interface UntranslatedSummary {
  cells: number;
  rows: number;
  rowIndices: number[];
  details?: UntranslatedCell[];
}
