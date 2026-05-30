
import React, { useEffect, useMemo, useRef, useState } from 'react';
import packageJson from './package.json';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import QualityReportPanel from './components/QualityReportPanel';
import { useAuth } from './hooks/useAuth';
import { useQualityWorkflow } from './hooks/useQualityWorkflow';
import { parseExcelFile, exportToExcel } from './utils/excel';
import type { ExcelContext } from './utils/excel';
import {
  parseDocxFile,
  exportDocxFile,
  formatDocxCoverageSummary,
  getDocxSegmentText,
  setDocxSegmentText,
  type DocxContext,
  type DocxSegment
} from './utils/docx';
import {
  buildAdaptiveTextBatches,
  formatElapsedSeconds,
  sumBatchTextChars
} from './utils/translationBatching';
import {
  parsePdfFile,
  exportPdfTranslationAsDocx,
  exportPdfTranslationAsPdf,
  getPdfSegmentText,
  getPdfTextLayerStats,
  setPdfSegmentText,
  type PdfContext,
  type PdfSegment
} from './utils/pdf';
import { TranslationHub } from './services/translationHub';
import { ModelReviewService } from './services/modelReviewService';
import { runPdfTranslationWorkflow } from './workflows/pdfTranslationWorkflow';
import { segmentsToQualityRows, segmentsToQualityUnits } from './quality/adapters';
import { detectUntranslatedCells, isLikelyTargetLanguage, isNeutralToken } from './utils/language';
import type { UntranslatedCell } from './utils/language';
import { summarizeUntranslated } from './utils/untranslated';
import {
  buildExcelRetryTargets,
  buildRetryableExcelSummary,
  buildTextSegmentRetryPlan,
  shouldTranslateCellValue
} from './quality/retryTargets';
import {
  loadTranslationProgress,
  saveTranslationProgress,
  clearTranslationProgress,
  type TranslationProgressSnapshot
} from './utils/storage';
import {
  buildTranslationMemoryKey,
  clearTranslationMemory,
  countTranslationMemoryEntries,
  lookupTranslationMemoryBatch,
  normalizeMemorySource,
  saveTranslationMemoryPairs,
  type TranslationMemoryPair
} from './utils/translationMemory';
import { normalizeTerminology } from './utils/terminology';
import { polishTranslation, fixSpacingArtifacts } from './utils/postprocess';
import {
  guardTranslationTokens,
  restoreTranslationTokens,
  isLikelyIdentifier,
  containsProtectedTerm,
  setRuntimeProtectedTerms,
  stripProtectedTerms,
  stripPreservedUiLabels
} from './utils/translationTokens';
import {
  extractStructuredStringContent,
  guardMarkupTags,
  guardStringResourceTokens,
  INTERNAL_STRING_PLACEHOLDER_REGEX,
  isLikelyDateFormatPattern,
  isXmlCommentLine,
  localizeDateFormatPattern,
  parseStringResourceLine,
  restoreMarkupTags,
  validateStringResourceXml,
  restoreStringResourceTokens
} from './utils/stringResources';
import { appendStringHistory, clearStringHistory, loadStringHistory, type StringTranslationHistoryEntry } from './utils/stringHistory';
import {
  DEEPSEEK_OPENROUTER_MODEL,
  DOCX_MANUAL_OPENROUTER_MODELS,
  normalizeOpenRouterModelId
} from './utils/translationProfiles';
import {
  STRING_RESOURCE_TARGET_LANGS,
  TARGET_LANGUAGE_OPTIONS,
  getTargetLanguageLabel
} from './utils/targetLanguage';
import {
  DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
  DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
  MODEL_REVIEW_STYLE_LABELS,
  formatModelReviewReport,
  type ModelReviewResult,
  type ModelReviewSample,
  type ModelReviewStyle
} from './utils/modelReview';
import {
  collectPlaceholderIssues,
  hasSpacingIssue,
  runQualityChecks,
  runQualityChecksOnUnits,
  PLACEHOLDER_REGEX,
  type QualitySeverity
} from './utils/quality';
import {
  POCTRecord,
  ProcessingState,
  SampleReviewAIResult,
  TargetLanguage,
  WorkflowStageKey,
  WorkflowStageState
} from './types';

// Batch size kept small for reliability with large column counts
const BATCH_SIZE = 5;
const DOCX_BATCH_SIZE = 20;
const DOCX_BATCH_CHAR_LIMIT = 12000;
const RETRY_BATCH_SIZE = 5;
const STRING_BATCH_SIZE = 40;
const SOURCE_LANG_REGEX = /[\u4e00-\u9fff]/;
const STRING_TARGET_LANGS: TargetLanguage[] = STRING_RESOURCE_TARGET_LANGS;
const ALL_STRING_TARGETS = '__ALL_STRING_TARGETS__';
const PROTECTED_TERMS_STORAGE_KEY = 'poct.protected_terms';
const UI_THEME_STORAGE_KEY = 'poct.ui_theme';
const TRANSLATION_MEMORY_ENABLED_STORAGE_KEY = 'poct.translation_memory_enabled';
const PACKAGE_VERSION = String((packageJson as { version?: string }).version || '').trim();
const APP_VERSION = String((import.meta as any)?.env?.VITE_APP_VERSION || PACKAGE_VERSION).trim();
const DEFAULT_CLOUDFLARE_AI_MODELS = [
  'google/gemini-3-flash',
  'openai/gpt-5.4',
  'anthropic/claude-sonnet-4.6'
] as const;
const DEFAULT_OPENROUTER_MODELS: string[] = [];
const DEFAULT_OPENROUTER_AUTO_MODELS: string[] = [];
const AUTO_OPENROUTER_MODEL = '__AUTO_OPENROUTER__';
const OPENROUTER_MODEL_COOLDOWN_MS = 30 * 60 * 1000;
const MODEL_LABELS: Record<string, string> = {
  'cloudflare-ai:google/gemini-3-flash': 'Cloudflare Gemini 3 Flash',
  'cloudflare-ai:openai/gpt-5.4': 'Cloudflare OpenAI GPT-5.4',
  'cloudflare-ai:anthropic/claude-sonnet-4.6': 'Cloudflare Claude 4.6 Sonnet',
  'deepseek:deepseek-v4-flash': 'DeepSeek Direct v4 Flash',
  'deepseek:deepseek-v4-pro': 'DeepSeek Direct v4 Pro',
  'google/gemini-3-flash': 'Cloudflare Gemini 3 Flash',
  'openai/gpt-5.4': 'Cloudflare OpenAI GPT-5.4',
  'anthropic/claude-sonnet-4.6': 'Cloudflare Claude 4.6 Sonnet',
  'google/gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
  'deepseek/deepseek-v4-pro': 'DeepSeek V4 Pro',
  'openai/gpt-5.3-chat': 'OpenAI GPT-5.3 Chat'
};
const DEEPSEEK_DIRECT_MODEL = '__DEEPSEEK_DIRECT_FLASH__';
const DEEPSEEK_DIRECT_PRO_MODEL = '__DEEPSEEK_DIRECT_PRO__';
const DEEPSEEK_DIRECT_MODEL_LABEL = 'DeepSeek Direct v4 Flash';
const DEEPSEEK_DIRECT_PRO_MODEL_LABEL = 'DeepSeek Direct v4 Pro';
const DEEPSEEK_DIRECT_MODEL_PROVIDER_IDS: Record<string, string> = {
  [DEEPSEEK_DIRECT_MODEL]: 'deepseek-v4-flash',
  [DEEPSEEK_DIRECT_PRO_MODEL]: 'deepseek-v4-pro'
};
const DEEPSEEK_DIRECT_MODEL_LABELS: Record<string, string> = {
  [DEEPSEEK_DIRECT_MODEL]: DEEPSEEK_DIRECT_MODEL_LABEL,
  [DEEPSEEK_DIRECT_PRO_MODEL]: DEEPSEEK_DIRECT_PRO_MODEL_LABEL
};
const CLOUDFLARE_AI_MODEL_VALUE_PREFIX = '__CLOUDFLARE_AI__:';
const toCloudflareAiModelValue = (model: string) => `${CLOUDFLARE_AI_MODEL_VALUE_PREFIX}${model}`;
const isCloudflareAiModelValue = (model: string) => model.startsWith(CLOUDFLARE_AI_MODEL_VALUE_PREFIX);
const getCloudflareAiProviderModel = (model: string) =>
  model.slice(CLOUDFLARE_AI_MODEL_VALUE_PREFIX.length);
const getModelLabel = (model: string) => MODEL_LABELS[model] || model;
const getDeepSeekDirectModelLabel = (model: string) => DEEPSEEK_DIRECT_MODEL_LABELS[model] || model;
const getDeepSeekDirectProviderModel = (model: string) => DEEPSEEK_DIRECT_MODEL_PROVIDER_IDS[model];
const isDeepSeekDirectModel = (model: string) =>
  Object.prototype.hasOwnProperty.call(DEEPSEEK_DIRECT_MODEL_PROVIDER_IDS, model);
const getTranslationModelLabel = (model: string) => {
  if (isDeepSeekDirectModel(model)) return getDeepSeekDirectModelLabel(model);
  if (isCloudflareAiModelValue(model)) return getModelLabel(getCloudflareAiProviderModel(model));
  return getModelLabel(model);
};
const formatModelChainLabel = (models: readonly string[]) =>
  models.map(getModelLabel).join(' -> ');
const formatAutoModelChainLabel = (
  cloudflareModels: readonly string[],
  openRouterModels: readonly string[],
  includeDeepSeekDirect: boolean
) =>
  [
    ...cloudflareModels.map(getModelLabel),
    ...(includeDeepSeekDirect ? [DEEPSEEK_DIRECT_MODEL_LABEL] : []),
    ...openRouterModels.map(getModelLabel)
  ].join(' -> ');
type TranslationEngine = 'cloudflare-ai' | 'openrouter' | 'deepseek' | 'gemini';
type ThemeMode = 'light' | 'dark';
type AppView = 'translator' | 'modelReview';
type ModelReviewStyleSelection = 'recommended' | ModelReviewStyle;
type TranslationMemoryStats = {
  hits: number;
  deduped: number;
  stored: number;
};
type OpenRouterModelCooldown = {
  until: number;
  reason: string;
};
type OpenRouterModelIssue = {
  model?: string;
  status?: number | string;
  message?: string;
  kind?: string;
};
type StageResult = 'paused' | 'completed' | void;

const parseOpenRouterModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_OPENROUTER_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => normalizeOpenRouterModelId(item)).filter(Boolean)
    : [...DEFAULT_OPENROUTER_MODELS];
  return Array.from(new Set(values));
};

const parseCloudflareAiModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_CLOUDFLARE_AI_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => item.trim()).filter(Boolean)
    : [...DEFAULT_CLOUDFLARE_AI_MODELS];
  return Array.from(new Set(values));
};

const parseOpenRouterAutoModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_OPENROUTER_AUTO_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => normalizeOpenRouterModelId(item)).filter(Boolean)
    : [...DEFAULT_OPENROUTER_AUTO_MODELS];
  return Array.from(new Set(values));
};

const parseRuntimeProtectedTerms = (raw: string) =>
  Array.from(
    new Set(
      String(raw || '')
        .split(/[\n;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const formatStringHistoryText = (history: StringTranslationHistoryEntry[]) => {
  const separator = '\n' + '='.repeat(80) + '\n';
  return history
    .map((entry, index) => {
      const availableLangs = STRING_TARGET_LANGS.filter((lang) =>
        Object.prototype.hasOwnProperty.call(entry.outputs || {}, lang)
      );
      const langs = availableLangs.length > 0 ? availableLangs : STRING_TARGET_LANGS;
      const lines: string[] = [
        `Record ${index + 1}`,
        `Timestamp: ${new Date(entry.createdAt).toLocaleString()}`,
        '',
        '[Original]',
        entry.source || ''
      ];
      langs.forEach((lang) => {
        lines.push('', `[${lang}]`, entry.outputs[lang] || '');
      });
      return lines.join('\n');
    })
    .join(separator);
};

const formatCurrentStringOutputText = (
  source: string,
  outputs: Record<string, string>
) => {
  const langs = STRING_TARGET_LANGS.filter((lang) =>
    Boolean(outputs[lang] && outputs[lang].trim())
  );
  const lines: string[] = [
    `Timestamp: ${new Date().toLocaleString()}`,
    '',
    '[Original]',
    source || ''
  ];
  langs.forEach((lang) => {
    lines.push('', `[${lang}]`, outputs[lang] || '');
  });
  return lines.join('\n');
};

type IssueSummaryState = {
  cells: number;
  rows: number;
  rowIndices: number[];
  missingRows: number[];
  details: UntranslatedCell[];
};

type DocxIssueDetail = {
  index: number;
  id: string;
  locationLabel?: string;
  text: string;
  snippet: string;
  chineseChars: number;
  lowPriority: boolean;
  issueType: 'source' | 'placeholder' | 'glue';
};

type StringOutputDiagnostic = {
  lang: TargetLanguage;
  untranslated: number;
  placeholderLeaks: number;
  spacingIssues: number;
  invalidXml: boolean;
  xmlError: string | null;
};

const isSevereDocxIssue = (issue: DocxIssueDetail) => {
  if (issue.issueType === 'placeholder') return true;
  if (issue.issueType === 'source' && issue.chineseChars >= 2) return true;
  return false;
};

const createIssueSummary = (): IssueSummaryState => ({
  cells: 0,
  rows: 0,
  rowIndices: [],
  missingRows: [],
  details: []
});

const DOCX_CHINESE_CHAR_REGEX = /[\u4e00-\u9fff]/g;
const DOCX_TEXT_CLEANUP_REGEX = /\s+/g;
const DOCX_WORD_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿÇĞİÖŞÜçğıöşü][A-Za-zÀ-ÖØ-öø-ÿÇĞİÖŞÜçğıöşü0-9-]{0,32}$/;
const DOCX_PLACEHOLDER_VARIANT_REGEX = /(?:_+)?(?:TKN|ID|FMT)_\d+_+/i;

const countChineseChars = (text: string) => (text.match(DOCX_CHINESE_CHAR_REGEX) || []).length;

const toDocxSnippet = (text: string, limit: number = 36) => {
  const normalized = text.replace(DOCX_TEXT_CLEANUP_REGEX, ' ').trim();
  if (!normalized) return '(empty)';
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};

const dedupeLeadingRepeat = (source: string, translated: string) => {
  const sourceTrimmed = source.trim();
  const targetTrimmed = translated.trim();
  if (!sourceTrimmed || targetTrimmed.length < 2) return translated;
  const first = targetTrimmed[0];
  const second = targetTrimmed[1];
  if (first.toLowerCase() !== second.toLowerCase()) return translated;
  const sourceFirst = sourceTrimmed[0];
  const sourceSecond = sourceTrimmed[1] || '';
  if (sourceFirst.toLowerCase() !== first.toLowerCase()) return translated;
  if (sourceSecond && sourceSecond.toLowerCase() === sourceFirst.toLowerCase()) return translated;
  const prefixLength = translated.length - translated.trimStart().length;
  const prefix = translated.slice(0, prefixLength);
  return `${prefix}${targetTrimmed.slice(1)}`;
};

const formatRowRanges = (indices: number[], limit: number = 3) => {
  if (!indices.length) return '';
  const sorted = [...indices].sort((a, b) => a - b);
  const segments: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    segments.push([start, prev]);
    start = current;
    prev = current;
  }
  segments.push([start, prev]);

  const displayed = segments.slice(0, limit).map(([s, e]) => {
    if (s === e) return `${s + 1}`;
    return `${s + 1}-${e + 1}`;
  });
  return displayed.join(', ') + (segments.length > limit ? '...' : '');
};

const cellNeedsTranslation = (
  key: string,
  value: unknown,
  targetLang: TargetLanguage
) => {
  return shouldTranslateCellValue(key, value, targetLang, { shouldLockCell });
};

const rowNeedsTranslation = (row: POCTRecord, targetLang: TargetLanguage) => {
  return Object.entries(row).some(([key, value]) => cellNeedsTranslation(key, value, targetLang));
};

const valueNeedsTranslation = (value: unknown, target: TargetLanguage) => {
  return shouldTranslateCellValue('', value, target, { ignoreLock: true });
};

const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

const shouldLockCell = (key: string, value: unknown) => {
  if (typeof value !== 'string') return false;
  if (!value.trim()) return false;
  if (SOURCE_LANG_REGEX.test(value)) return false;
  if (LOCKED_KEY_REGEX.test(key)) return true;
  return isLikelyIdentifier(value);
};

const applyPostprocessRow = (
  original: POCTRecord | undefined,
  translated: POCTRecord,
  lang: TargetLanguage
) => {
  const output: POCTRecord = { ...translated };
  Object.entries(translated).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    const originalValue = original?.[key];
    const lockValue =
      typeof originalValue === 'string' ? originalValue : value;
    if (shouldLockCell(key, lockValue)) return;
    const sourceText = typeof originalValue === 'string' ? originalValue : '';
    output[key] = polishTranslation(sourceText, value, lang);
  });
  return normalizeTerminology(output, lang, original);
};

const createInitialStages = (): WorkflowStageState[] => ([
  { key: 'ingest', label: '导入文档', status: 'pending' },
  { key: 'translate', label: '全局翻译', status: 'pending' }
]);

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<POCTRecord[]>([]); // Original Data
  const [processedData, setProcessedData] = useState<POCTRecord[]>([]); // Translated Data
  const [documentKind, setDocumentKind] = useState<'excel' | 'docx' | 'pdf'>('excel');
  const [activeView, setActiveView] = useState<AppView>('translator');
  const [excelContext, setExcelContext] = useState<ExcelContext | null>(null);
  const [targetLang, setTargetLang] = useState<TargetLanguage>('English');
  const authState = useAuth();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.localStorage.getItem(UI_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState<boolean>(false); // New State for Comparison View
  const [workflowStages, setWorkflowStages] = useState<WorkflowStageState[]>(createInitialStages);
  const [translationIssues, setTranslationIssues] = useState<IssueSummaryState>(createIssueSummary());
  const [previewFocus, setPreviewFocus] = useState<{ rowIndex: number; columnKey: string } | null>(null);
  const [modelReviewCount, setModelReviewCount] = useState<number>(10);
  const [modelReviewStyleSelection, setModelReviewStyleSelection] = useState<ModelReviewStyleSelection>('recommended');
  const [modelReviewResult, setModelReviewResult] = useState<ModelReviewResult | null>(null);
  const [isRunningModelReview, setIsRunningModelReview] = useState(false);
  const [modelReviewStatus, setModelReviewStatus] = useState<{
    stage: 'idle' | 'sampling' | 'translating' | 'judging' | 'completed' | 'error';
    message: string;
  }>({ stage: 'idle', message: 'Ready to run.' });
  const [activeStage, setActiveStage] = useState<WorkflowStageKey | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'running' | 'paused' | 'completed'>('idle');
  const [isRetryingMissing, setIsRetryingMissing] = useState(false);
  const [translatedFlags, setTranslatedFlags] = useState<boolean[]>([]);
  const [missingRowIndices, setMissingRowIndices] = useState<number[]>([]);
  const [writeFailedRowIndices, setWriteFailedRowIndices] = useState<number[]>([]);
  const [translationMode, setTranslationMode] = useState<'full' | 'selective'>('full');
  const [savedSnapshot, setSavedSnapshot] = useState<TranslationProgressSnapshot | null>(null);
  const [stringInput, setStringInput] = useState<string>('');
  const [stringOutputs, setStringOutputs] = useState<Record<string, string>>({});
  const [stringOutputTarget, setStringOutputTarget] = useState<string>(ALL_STRING_TARGETS);
  const [stringStatus, setStringStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [stringError, setStringError] = useState<string | null>(null);
  const [stringQualitySummary, setStringQualitySummary] = useState<string | null>(null);
  const [stringErrorDetails, setStringErrorDetails] = useState<string | null>(null);
  const [stringAutoFix, setStringAutoFix] = useState<boolean>(true);
  const [runtimeProtectedTermsRaw, setRuntimeProtectedTermsRaw] = useState<string>('');
  const [stringHistoryCount, setStringHistoryCount] = useState<number>(0);
  const [translationMemoryCount, setTranslationMemoryCount] = useState<number>(0);
  const [translationMemoryEnabled, setTranslationMemoryEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(TRANSLATION_MEMORY_ENABLED_STORAGE_KEY) !== 'false';
  });
  const [processingState, setProcessingState] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    total: 0,
    currentBatch: 0
  });
  const docxContextRef = useRef<DocxContext | null>(null);
  const pdfContextRef = useRef<PdfContext | null>(null);
  const docxPlaceholderStore = useRef<Map<string, Record<string, string>>>(new Map());
  const previewDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const previewSectionRef = useRef<HTMLElement | null>(null);
  const [docxIssueIndices, setDocxIssueIndices] = useState<number[]>([]);
  const [docxIssueDetails, setDocxIssueDetails] = useState<DocxIssueDetail[]>([]);
  const [pdfIssueIndices, setPdfIssueIndices] = useState<number[]>([]);
  const [pdfIssueDetails, setPdfIssueDetails] = useState<DocxIssueDetail[]>([]);
  const [docxStats, setDocxStats] = useState<{ total: number; translated: number }>({ total: 0, translated: 0 });
  const [pdfStats, setPdfStats] = useState<{ pages: number; total: number; translated: number }>({ pages: 0, total: 0, translated: 0 });
  const pauseRequestedRef = useRef(false);
  const snapshotPromptKeyRef = useRef<string>('');
  const translationMemorySessionRef = useRef<Map<string, string>>(new Map());
  const openRouterModelCooldownsRef = useRef<Map<string, OpenRouterModelCooldown>>(new Map());
  const [openRouterModelCooldownVersion, setOpenRouterModelCooldownVersion] = useState(0);

  const translationHub = useMemo(() => new TranslationHub(), []);
  const hubCapabilities = useMemo(() => translationHub.getCapabilities(), [translationHub]);
  const capabilities = useMemo(
    () => ({
      ...hubCapabilities,
      ...(authState.translationCapabilities || {})
    }),
    [authState.translationCapabilities, hubCapabilities]
  );
  const openRouterModels = useMemo(() => parseOpenRouterModelOptions(), []);
  const openRouterAutoModels = useMemo(() => parseOpenRouterAutoModelOptions(), []);
  const cloudflareAiModels = useMemo(() => parseCloudflareAiModelOptions(), []);
  const allOpenRouterModels = useMemo(
    () => Array.from(new Set([...openRouterModels, ...openRouterAutoModels, ...DOCX_MANUAL_OPENROUTER_MODELS])),
    [openRouterModels, openRouterAutoModels]
  );
  const activeOpenRouterModels = useMemo(() => {
    const now = Date.now();
    openRouterModelCooldownsRef.current.forEach((cooldown, model) => {
      if (cooldown.until <= now) {
        openRouterModelCooldownsRef.current.delete(model);
      }
    });
    const active = openRouterAutoModels.filter((model) => {
      const cooldown = openRouterModelCooldownsRef.current.get(model);
      return !cooldown || cooldown.until <= now;
    });
    return active.length > 0 ? active : openRouterAutoModels;
  }, [openRouterAutoModels, openRouterModelCooldownVersion]);
  const activeDocumentQualityOpenRouterModels = useMemo(() => {
    const now = Date.now();
    const active = DOCX_MANUAL_OPENROUTER_MODELS.filter((model) => {
      const cooldown = openRouterModelCooldownsRef.current.get(model);
      return !cooldown || cooldown.until <= now;
    });
    return active.length > 0 ? active : DOCX_MANUAL_OPENROUTER_MODELS;
  }, [openRouterModelCooldownVersion]);
  const usesDocumentQualityModels = documentKind === 'docx' || documentKind === 'pdf';
  const currentSkippedOpenRouterModels = useMemo(() => {
    const models = usesDocumentQualityModels ? DOCX_MANUAL_OPENROUTER_MODELS : openRouterAutoModels;
    return models.filter((model) =>
      Boolean(openRouterModelCooldownsRef.current.get(model)?.until > Date.now())
    );
  }, [usesDocumentQualityModels, openRouterAutoModels, openRouterModelCooldownVersion]);
  const availableOpenRouterModels = useMemo(
    () =>
      usesDocumentQualityModels
        ? Array.from(new Set([...DOCX_MANUAL_OPENROUTER_MODELS, ...openRouterModels]))
        : openRouterModels,
    [usesDocumentQualityModels, openRouterModels]
  );
  const availableTranslationModels = useMemo(
    () => [
      ...(capabilities.cloudflareAi ? cloudflareAiModels.map(toCloudflareAiModelValue) : []),
      ...(capabilities.deepseek ? [DEEPSEEK_DIRECT_MODEL, DEEPSEEK_DIRECT_PRO_MODEL] : []),
      ...availableOpenRouterModels
    ],
    [availableOpenRouterModels, capabilities.cloudflareAi, capabilities.deepseek, cloudflareAiModels]
  );
  const [translationModelPreference, setTranslationModelPreference] = useState<string>(
    AUTO_OPENROUTER_MODEL
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.title = APP_VERSION
      ? `POCT Document Translator v${APP_VERSION}`
      : 'POCT Document Translator';
    if (!APP_VERSION) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('v') === APP_VERSION) return;
    url.searchParams.set('v', APP_VERSION);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    if (
      translationModelPreference !== AUTO_OPENROUTER_MODEL &&
      !availableTranslationModels.includes(translationModelPreference)
    ) {
      setTranslationModelPreference(AUTO_OPENROUTER_MODEL);
    }
  }, [availableTranslationModels, translationModelPreference]);
  const modelReviewService = useMemo(() => new ModelReviewService(), []);
  const selectedStringTargetLangs = useMemo<TargetLanguage[]>(
    () =>
      stringOutputTarget === ALL_STRING_TARGETS
        ? STRING_TARGET_LANGS
        : [stringOutputTarget],
    [stringOutputTarget]
  );

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg]);
  };

  const shouldCooldownOpenRouterModel = (issue: OpenRouterModelIssue) => {
    const status = String(issue.status || '').toLowerCase();
    const message = String(issue.message || '').toLowerCase();
    return (
      status === '403' ||
      status === 'timeout' ||
      message.includes('terms of service') ||
      message.includes('timed out') ||
      message.includes('timeout')
    );
  };

  const applyOpenRouterModelCooldowns = (
    issues: OpenRouterModelIssue[],
    contextLabel: string
  ) => {
    if (translationModelPreference !== AUTO_OPENROUTER_MODEL || issues.length === 0) return;
    const now = Date.now();
    let changed = false;
    issues.forEach((issue) => {
      const model = normalizeOpenRouterModelId(String(issue.model || ''));
      if (!model || !allOpenRouterModels.includes(model)) return;
      if (!shouldCooldownOpenRouterModel(issue)) return;
      const reason = issue.status === 403 || String(issue.status) === '403'
        ? '403 TOS/permission block'
        : String(issue.status || issue.message || 'temporary failure');
      const existing = openRouterModelCooldownsRef.current.get(model);
      const until = now + OPENROUTER_MODEL_COOLDOWN_MS;
      if (existing && existing.until >= until - 1000) return;
      openRouterModelCooldownsRef.current.set(model, { until, reason });
      changed = true;
      addLog(
        `${contextLabel}: ${getModelLabel(model)} ${reason}，Auto 将跳过 30 分钟。`
      );
    });
    if (changed) {
      setOpenRouterModelCooldownVersion((version) => version + 1);
    }
  };

  const applyLatestOpenRouterModelCooldowns = (contextLabel: string) => {
    const issues = translationHub.getLastModelIssues?.() || [];
    applyOpenRouterModelCooldowns(issues as OpenRouterModelIssue[], contextLabel);
  };

  const resetModelReviewState = () => {
    setModelReviewResult(null);
    setIsRunningModelReview(false);
    setModelReviewStatus({ stage: 'idle', message: 'Ready to run.' });
  };

  const getFallbackPriority = (
    respectSelectedEngine: boolean = false
  ): TranslationEngine[] => {
    const engines: TranslationEngine[] = [];
    if (capabilities.cloudflareAi) engines.push('cloudflare-ai');
    if (capabilities.deepseek) engines.push('deepseek');
    if (capabilities.openrouter) engines.push('openrouter');
    if (capabilities.gemini) engines.push('gemini');

    if (respectSelectedEngine && translationModelPreference !== AUTO_OPENROUTER_MODEL) {
      if (isCloudflareAiModelValue(translationModelPreference) && capabilities.cloudflareAi) {
        return ['cloudflare-ai'];
      }
      if (isDeepSeekDirectModel(translationModelPreference) && capabilities.deepseek) {
        return ['deepseek'];
      }
      if (capabilities.openrouter) return ['openrouter'];
    }

    return engines.length > 0 ? engines : ['openrouter'];
  };

  const getTranslationOptions = () => {
    if (translationModelPreference === AUTO_OPENROUTER_MODEL) {
      return {
        openRouterModels: activeOpenRouterModels
      };
    }
    if (isCloudflareAiModelValue(translationModelPreference)) {
      return {
        model: 'cloudflare-ai' as const,
        providerModel: getCloudflareAiProviderModel(translationModelPreference)
      };
    }
    if (isDeepSeekDirectModel(translationModelPreference)) {
      return {
        model: 'deepseek' as const,
        providerModel: getDeepSeekDirectProviderModel(translationModelPreference)
      };
    }
    return {
      model: 'openrouter' as const,
      openRouterModel: translationModelPreference
    };
  };

  const getDocumentQualityTranslationOptions = () => {
    if (translationModelPreference !== AUTO_OPENROUTER_MODEL) {
      if (isCloudflareAiModelValue(translationModelPreference)) {
        return {
          model: 'cloudflare-ai' as const,
          providerModel: getCloudflareAiProviderModel(translationModelPreference),
          profile: 'docx-manual' as const
        };
      }
      if (isDeepSeekDirectModel(translationModelPreference)) {
        return {
          model: 'deepseek' as const,
          providerModel: getDeepSeekDirectProviderModel(translationModelPreference),
          profile: 'docx-manual' as const
        };
      }
      return {
        model: 'openrouter' as const,
        openRouterModel: translationModelPreference,
        profile: 'docx-manual' as const
      };
    }
    return {
      profile: 'docx-manual' as const,
      openRouterModels: activeDocumentQualityOpenRouterModels
    };
  };

  const createTranslationMemoryStats = (): TranslationMemoryStats => ({
    hits: 0,
    deduped: 0,
    stored: 0
  });

  const getTranslationMemoryKey = (sourceText: string, lang: TargetLanguage = targetLang) =>
    buildTranslationMemoryKey(sourceText, lang);

  const isUsableMemoryTarget = (targetText: string, lang: TargetLanguage = targetLang) => {
    const trimmed = String(targetText || '').trim();
    return Boolean(trimmed) && !valueNeedsTranslation(trimmed, lang);
  };

  const lookupReusableTranslations = async (
    sourceTexts: string[],
    lang: TargetLanguage = targetLang
  ) => {
    const output = new Map<string, string>();
    if (!translationMemoryEnabled) return output;
    const lookupItems = new Map<string, string>();

    sourceTexts.forEach((sourceText) => {
      const normalized = normalizeMemorySource(sourceText);
      if (!normalized) return;
      const key = getTranslationMemoryKey(sourceText, lang);
      const sessionValue = translationMemorySessionRef.current.get(key);
      if (sessionValue && isUsableMemoryTarget(sessionValue, lang)) {
        output.set(key, sessionValue);
        return;
      }
      lookupItems.set(key, sourceText);
    });

    if (lookupItems.size > 0) {
      const entries = await lookupTranslationMemoryBatch(
        Array.from(lookupItems.values()).map((sourceText) => ({
          sourceText,
          targetLang: lang
        }))
      );
      entries.forEach((entry, key) => {
        if (!isUsableMemoryTarget(entry.targetText, lang)) return;
        translationMemorySessionRef.current.set(key, entry.targetText);
        output.set(key, entry.targetText);
      });
    }

    return output;
  };

  const rememberTranslationPairs = async (
    pairs: TranslationMemoryPair[],
    stats?: TranslationMemoryStats
  ) => {
    if (!translationMemoryEnabled) return;
    const uniquePairs = new Map<string, TranslationMemoryPair>();
    pairs.forEach((pair) => {
      if (!isUsableMemoryTarget(pair.targetText, pair.targetLang)) return;
      const key = buildTranslationMemoryKey(pair.sourceText, pair.targetLang, pair.sourceLang);
      translationMemorySessionRef.current.set(key, pair.targetText);
      uniquePairs.set(key, pair);
    });
    if (uniquePairs.size === 0) return;
    const saved = await saveTranslationMemoryPairs(Array.from(uniquePairs.values()));
    if (stats) {
      stats.stored += saved;
    }
    if (saved > 0) {
      await refreshTranslationMemoryCount();
    }
  };

  const logTranslationMemoryStats = (label: string, stats: TranslationMemoryStats) => {
    if (stats.hits === 0 && stats.deduped === 0 && stats.stored === 0) return;
    addLog(
      `${label} Translation Memory: 复用 ${stats.hits} 条，批内去重 ${stats.deduped} 条，新写入 ${stats.stored} 条。`
    );
  };

  const clearTranslationMemoryData = async () => {
    await clearTranslationMemory();
    translationMemorySessionRef.current.clear();
    await refreshTranslationMemoryCount();
    addLog('已清空本地翻译记忆。');
  };

  const applyStringAutoFix = (text: string) => {
    const base = fixSpacingArtifacts(text);
    return base.replace(/\b([A-Za-z])\s+(\d{1,3})\b/g, '$1$2');
  };

  const collectStringOutputDiagnostics = (
    sourceEntries: ReturnType<typeof parseStringResourceLine>[],
    output: string,
    lang: TargetLanguage
  ): StringOutputDiagnostic => {
    const outputLines = output.split(/\r?\n/);
    const outputEntries = outputLines.map(parseStringResourceLine);
    const contents = sourceEntries
      .map((sourceEntry, index) => {
        if (isXmlCommentLine(sourceEntry.original)) return null;
        const sourceStructured = extractStructuredStringContent(sourceEntry.content);
        if (!sourceEntry.needsTranslation) return null;
        if (isLikelyDateFormatPattern(sourceStructured.translatableContent)) return null;
        const translatedEntry = outputEntries[index];
        const translatedStructured = extractStructuredStringContent(
          translatedEntry?.content || ''
        );
        return translatedStructured.translatableContent ?? '';
      })
      .filter((content): content is string => content !== null);

    const untranslated = summarizeUntranslated(
      contents.map((content) => ({ content })),
      lang
    ).cells;
    const placeholderLeaks = contents.filter((content) =>
      INTERNAL_STRING_PLACEHOLDER_REGEX.test(content) || PLACEHOLDER_REGEX.test(content)
    ).length;
    const spacingIssues = contents.filter((content) => hasSpacingIssue(content)).length;
    const xmlValidation = validateStringResourceXml(output);

    return {
      lang,
      untranslated,
      placeholderLeaks,
      spacingIssues,
      invalidXml: !xmlValidation.valid,
      xmlError: xmlValidation.error
    };
  };

  const getCurrentStringOutputDiagnostics = (
    outputs: Record<string, string>
  ): StringOutputDiagnostic[] => {
    const sourceEntries = stringInput.split(/\r?\n/).map(parseStringResourceLine);
    return STRING_TARGET_LANGS
      .filter((lang) => Boolean(outputs[lang] && outputs[lang].trim()))
      .map((lang) => collectStringOutputDiagnostics(sourceEntries, outputs[lang] || '', lang));
  };

  const shouldTranslateValue = (value: unknown, key?: string) => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (isNeutralToken(trimmed)) return false;
    if (translationMode === 'full') return true;
    if (key) {
      return cellNeedsTranslation(key, value, targetLang);
    }
    return valueNeedsTranslation(value, targetLang);
  };

  const updateStageStatus = (key: WorkflowStageKey, status: WorkflowStageState['status'], message?: string) => {
    setWorkflowStages(prev => prev.map(stage => stage.key === key ? { ...stage, status, message } : stage));
  };

  const resetStages = () => {
    setWorkflowStages(createInitialStages());
    setActiveStage(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    const extension = uploadedFile.name.split('.').pop()?.toLowerCase();
    if (extension !== 'xlsx' && extension !== 'docx' && extension !== 'pdf') {
      e.target.value = '';
      addLog('Error: 目前仅支持上传 .xlsx Excel、.docx Word 或 .pdf 文档。');
      return;
    }

    setFile(uploadedFile);
    setSavedSnapshot(null);
    snapshotPromptKeyRef.current = '';
    setPreviewFocus(null);
    resetSampleReviewState();
    resetModelReviewState();
    const identifier = `${uploadedFile.name}-${uploadedFile.size}-${uploadedFile.lastModified || Date.now()}`;
    setFileId(identifier);
    setQualityReport(null);
    resetStages();
    setTranslationStatus('idle');
    pauseRequestedRef.current = false;
    updateStageStatus('ingest', 'running', '解析中...');
    addLog(`Importing: ${uploadedFile.name}`);

    if (extension === 'docx') {
      setDocumentKind('docx');
      setExcelContext(null);
      pdfContextRef.current = null;
      docxContextRef.current = null;
      docxPlaceholderStore.current.clear();
      setDocxIssueIndices([]);
      setDocxIssueDetails([]);
      setPdfIssueIndices([]);
      setPdfIssueDetails([]);
      setData([]);
      setProcessedData([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags([]);
      setMissingRowIndices([]);
      setWriteFailedRowIndices([]);
      setDocxStats({ total: 0, translated: 0 });
      setPdfStats({ pages: 0, total: 0, translated: 0 });
      setSavedSnapshot(null);
      try {
        const context = await parseDocxFile(uploadedFile);
        docxContextRef.current = context;
        setDocxStats({ total: context.segments.length, translated: 0 });
        setDocxIssueIndices([]);
        setDocxIssueDetails([]);
        setPdfIssueIndices([]);
        setPdfIssueDetails([]);
        setProcessingState({
          status: 'idle',
          progress: 0,
          total: context.segments.length,
          currentBatch: 0
        });
        updateStageStatus('ingest', 'completed', `DOCX: 检测到 ${context.segments.length} 个语义段`);
        addLog(`Success: Loaded DOCX with ${context.segments.length} semantic segments.`);
        addLog(`DOCX coverage: ${formatDocxCoverageSummary(context.coverage)}。`);
        if (context.coverageWarnings.length) {
          addLog(`DOCX scope note: ${context.coverageWarnings.join('；')}。`);
        }
      } catch (err) {
        addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setProcessingState(prev => ({ ...prev, status: 'error' }));
        updateStageStatus('ingest', 'error', '解析失败');
      }
      return;
    }

    if (extension === 'pdf') {
      setDocumentKind('pdf');
      setExcelContext(null);
      docxContextRef.current = null;
      pdfContextRef.current = null;
      docxPlaceholderStore.current.clear();
      setDocxIssueIndices([]);
      setDocxIssueDetails([]);
      setPdfIssueIndices([]);
      setPdfIssueDetails([]);
      setData([]);
      setProcessedData([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags([]);
      setMissingRowIndices([]);
      setWriteFailedRowIndices([]);
      setDocxStats({ total: 0, translated: 0 });
      setPdfStats({ pages: 0, total: 0, translated: 0 });
      setSavedSnapshot(null);
      try {
        const context = await parsePdfFile(uploadedFile);
        pdfContextRef.current = context;
        setPdfStats({ pages: context.pageCount, total: context.segments.length, translated: 0 });
        setPdfIssueIndices([]);
        setPdfIssueDetails([]);
        setProcessingState({
          status: 'idle',
          progress: 0,
          total: context.segments.length,
          currentBatch: 0
        });
        updateStageStatus('ingest', 'completed', `PDF: ${context.pageCount} 页 / ${context.segments.length} 段文本`);
        addLog(`Success: Loaded PDF with ${context.pageCount} page(s) and ${context.segments.length} text segments.`);
        if (context.coverageWarnings.length) {
          addLog(`PDF scope note: ${context.coverageWarnings.join('；')}。`);
        }
      } catch (err) {
        addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setProcessingState(prev => ({ ...prev, status: 'error' }));
        updateStageStatus('ingest', 'error', '解析失败');
      }
      return;
    }

    setDocumentKind('excel');
    docxContextRef.current = null;
    pdfContextRef.current = null;
    setDocxIssueIndices([]);
    setDocxIssueDetails([]);
    setPdfIssueIndices([]);
    setPdfIssueDetails([]);
    setExcelContext(null);
      setDocxStats({ total: 0, translated: 0 });
      setPdfStats({ pages: 0, total: 0, translated: 0 });
      setSavedSnapshot(null);
      try {
      const { records, context } = await parseExcelFile(uploadedFile);
      setData(records);
      setExcelContext(context);
      setProcessedData([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags(Array(records.length).fill(false));
      setMissingRowIndices([]);
      setWriteFailedRowIndices([]);
      setProcessingState({
        status: 'analyzing',
        progress: 0,
        total: records.length,
        currentBatch: 0
      });
      const sheetCount = context.sheets?.length || 1;
      updateStageStatus('ingest', 'completed', `已载入 ${records.length} 行 / ${sheetCount} 个工作表`);
      addLog(
        `Success: Detected ${records.length} records across ${sheetCount} sheet(s); first row has ${Object.keys(records[0] || {}).length} columns.`
      );
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setProcessingState(prev => ({ ...prev, status: 'error' }));
      updateStageStatus('ingest', 'error', '解析失败');
    }
  };

  useEffect(() => {
    if (documentKind !== 'excel') return;
    if (!fileId || data.length === 0 || processedData.length > 0) return;
    const snapshot = loadTranslationProgress(fileId, targetLang);
    if (snapshot && snapshot.records?.length) {
      setSavedSnapshot(snapshot);
      const promptKey = `${fileId}_${targetLang}_${snapshot.updatedAt}`;
      if (snapshotPromptKeyRef.current !== promptKey) {
        const flags =
          snapshot.translatedFlags && snapshot.translatedFlags.length === data.length
            ? snapshot.translatedFlags
            : Array.from({ length: data.length }, (_, idx) => idx < snapshot.records.length);
        const missing = snapshot.missingRows ?? [];
        const writeFailed = snapshot.writeFailedRows ?? [];
        const translatedCount = flags.filter(Boolean).length;
        const remaining = Math.max(0, data.length - translatedCount);
        addLog(
          `检测到本地进度：已翻译 ${translatedCount}/${data.length} 行，剩余 ${remaining} 行；未写入 ${writeFailed.length} 行。点击 Load Saved Progress 可恢复，或直接 Run Global Translation 重新开始。`
        );
        snapshotPromptKeyRef.current = promptKey;
      }
    } else {
      setSavedSnapshot(null);
      snapshotPromptKeyRef.current = '';
    }
  }, [fileId, targetLang, data.length, processedData.length, documentKind]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(PROTECTED_TERMS_STORAGE_KEY) || '';
    setRuntimeProtectedTermsRaw(saved);
    setRuntimeProtectedTerms(parseRuntimeProtectedTerms(saved));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const parsed = parseRuntimeProtectedTerms(runtimeProtectedTermsRaw);
    setRuntimeProtectedTerms(parsed);
    if (typeof window !== 'undefined') {
      if (runtimeProtectedTermsRaw.trim()) {
        window.localStorage.setItem(PROTECTED_TERMS_STORAGE_KEY, runtimeProtectedTermsRaw);
      } else {
        window.localStorage.removeItem(PROTECTED_TERMS_STORAGE_KEY);
      }
    }
  }, [runtimeProtectedTermsRaw]);

  const applySavedProgress = () => {
    if (!savedSnapshot || data.length === 0) return;
    const normalized =
      savedSnapshot.records.length === data.length
        ? savedSnapshot.records.map(rec => ({ ...rec }))
        : data.map((row, idx) => ({ ...(savedSnapshot.records[idx] || row) }));

    const flags =
      savedSnapshot.translatedFlags && savedSnapshot.translatedFlags.length === data.length
        ? savedSnapshot.translatedFlags
        : Array.from({ length: data.length }, (_, idx) => idx < savedSnapshot.records.length);

    const missing = savedSnapshot.missingRows ?? [];
    const writeFailed = savedSnapshot.writeFailedRows ?? [];
    const translatedCount = flags.filter(Boolean).length;
    const progress = Math.round((translatedCount / data.length) * 100);

    setProcessedData(normalized);
    setTranslatedFlags(flags);
    setMissingRowIndices(missing);
    setWriteFailedRowIndices(writeFailed);
    setProcessingState(prev => ({
      ...prev,
      status: 'idle',
      progress,
      total: data.length,
      currentBatch: Math.ceil(translatedCount / BATCH_SIZE)
    }));
    setTranslationStatus('paused');
    addLog(`已恢复本地进度：${translatedCount}/${data.length} 行。`);
    setSavedSnapshot(null);
  };

  const discardSavedProgress = () => {
    if (!fileId) return;
    clearTranslationProgress(fileId, targetLang);
    setSavedSnapshot(null);
    snapshotPromptKeyRef.current = '';
    setMissingRowIndices([]);
    setWriteFailedRowIndices([]);
    addLog('已清除当前语言的本地进度，将从头翻译。');
  };

  useEffect(() => {
    setStringHistoryCount(loadStringHistory().length);
  }, []);

  const refreshTranslationMemoryCount = async () => {
    const count = await countTranslationMemoryEntries();
    setTranslationMemoryCount(count);
  };

  useEffect(() => {
    void refreshTranslationMemoryCount();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        TRANSLATION_MEMORY_ENABLED_STORAGE_KEY,
        translationMemoryEnabled ? 'true' : 'false'
      );
    }
    if (!translationMemoryEnabled) {
      translationMemorySessionRef.current.clear();
    }
  }, [translationMemoryEnabled]);

  const persistProgress = (
    records: POCTRecord[],
    flags: boolean[],
    missingRows: number[],
    writeFailedRows: number[] = writeFailedRowIndices
  ) => {
    if (!fileId) return;
    saveTranslationProgress(fileId, targetLang, {
      records,
      translatedFlags: flags,
      missingRows,
      writeFailedRows
    });
  };

  const refreshTranslationIssues = (records: POCTRecord[]) => {
    const summary = summarizeUntranslated(records, targetLang);
    const refreshedMissing: number[] = [...summary.rowIndices];
    const summaryRows = new Set<number>(refreshedMissing);
    const mergedRowIndices = [...refreshedMissing];
    const refreshedWriteFailed = Array.from(new Set<number>(writeFailedRowIndices))
      .filter((idx) => idx >= 0 && idx < records.length && summaryRows.has(idx))
      .sort((a, b) => a - b);
    setMissingRowIndices(refreshedMissing);
    setWriteFailedRowIndices(refreshedWriteFailed);
    setTranslationIssues({
      ...summary,
      rowIndices: mergedRowIndices,
      missingRows: refreshedWriteFailed,
      details: summary.details || []
    });
    return {
      summary,
      refreshedMissing,
      refreshedWriteFailed,
      mergedRowIndices
    };
  };

  const getExcelSheetForRow = (rowIndex: number) => {
    if (!excelContext) return null;
    return (
      excelContext.sheets?.find(
        (sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount
      ) || excelContext
    );
  };

  const formatExcelRowNumber = (rowIndex: number) => {
    const sheetContext = getExcelSheetForRow(rowIndex);
    if (!sheetContext) return rowIndex + 1;
    const startRow =
      Number.isFinite(sheetContext.dataStartRow)
        ? sheetContext.dataStartRow
        : sheetContext.headerRow + 1;
    return startRow + (rowIndex - sheetContext.startIndex) + 1;
  };

  const encodeExcelColumn = (index: number) => {
    let value = index + 1;
    let output = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      output = String.fromCharCode(65 + remainder) + output;
      value = Math.floor((value - 1) / 26);
    }
    return output;
  };

  const getColumnLocationMeta = (columnKey: string, rowIndex?: number) => {
    const sheetContext =
      typeof rowIndex === 'number' ? getExcelSheetForRow(rowIndex) : excelContext;
    if (!sheetContext || columnKey === '__ROW__') {
      return {
        columnKey,
        columnLetter: '',
        headerName: columnKey,
        occurrence: null as number | null,
        sheetName: sheetContext?.sheetName || ''
      };
    }

    const columnIndex = sheetContext.headerKeys.indexOf(columnKey);
    if (columnIndex === -1) {
      return {
        columnKey,
        columnLetter: '',
        headerName: columnKey,
        occurrence: null as number | null,
        sheetName: sheetContext.sheetName
      };
    }

    const sheetColumn = sheetContext.range.s.c + columnIndex;
    const headerAddress = `${encodeExcelColumn(sheetColumn)}${sheetContext.headerRow + 1}`;
    const rawHeader = sheetContext.worksheet[headerAddress]?.v ?? columnKey;
    const headerName = String(rawHeader || columnKey);
    const sameHeaderCount = sheetContext.headerKeys.reduce((count, key, idx) => {
      const addr = `${encodeExcelColumn(sheetContext.range.s.c + idx)}${sheetContext.headerRow + 1}`;
      const value = String(sheetContext.worksheet[addr]?.v ?? key);
      return value === headerName ? count + 1 : count;
    }, 0);
    const occurrence =
      sameHeaderCount > 1
        ? sheetContext.headerKeys.slice(0, columnIndex + 1).reduce((count, key, idx) => {
            const addr = `${encodeExcelColumn(sheetContext.range.s.c + idx)}${sheetContext.headerRow + 1}`;
            const value = String(sheetContext.worksheet[addr]?.v ?? key);
            return value === headerName ? count + 1 : count;
          }, 0)
        : null;

    return {
      columnKey,
      columnLetter: encodeExcelColumn(sheetColumn),
      headerName,
      occurrence,
      sheetName: sheetContext.sheetName
    };
  };

  const formatIssueLocationPreview = (details: UntranslatedCell[], limit: number = 5) => {
    if (!details.length) return '';
    const seen = new Set<string>();
    const picked: string[] = [];
    details.forEach((issue) => {
      const location = issue.locationLabel || formatLocationLabel(issue.rowIndex, issue.columnKey);
      if (seen.has(location)) return;
      seen.add(location);
      picked.push(location);
    });
    if (!picked.length) return '';
    const displayed = picked.slice(0, limit);
    return displayed.join(', ') + (picked.length > limit ? ', ...' : '');
  };

  const formatLocationLabel = (rowIndex: number, columnKey: string) => {
    const rowNo = formatExcelRowNumber(rowIndex);
    const sheetName =
      excelContext && (excelContext.sheets?.length || 0) > 1
        ? `${getExcelSheetForRow(rowIndex)?.sheetName || excelContext.sheetName}!`
        : '';
    if (columnKey === '__ROW__') return `${sheetName}R${rowNo}`;
    const meta = getColumnLocationMeta(columnKey, rowIndex);
    if (!meta.columnLetter) return `R${rowNo}/${columnKey}`;
    const duplicateLabel = meta.occurrence ? `（第${meta.occurrence}列）` : '';
    return `${sheetName}R${rowNo} / ${meta.columnLetter}列 / ${meta.headerName}${duplicateLabel}`;
  };

  const autoRepairExcelPlaceholders = (
    records: POCTRecord[],
    options?: { mutateState?: boolean; logLabel?: string }
  ) => {
    if (documentKind !== 'excel' || !records.length) {
      return { records, fixedCells: 0, remainingCells: 0, changed: false };
    }

    let fixedCells = 0;
    let remainingCells = 0;
    let changed = false;

    const repaired = records.map((row, rowIndex) => {
      const originalRow = data[rowIndex] || {};
      let rowChanged = false;
      const nextRow: POCTRecord = { ...row };

      Object.entries(nextRow).forEach(([key, value]) => {
        if (typeof value !== 'string' || !PLACEHOLDER_REGEX.test(value)) return;
        const originalValue = originalRow[key];
        if (typeof originalValue !== 'string' || !originalValue.trim()) {
          remainingCells += 1;
          return;
        }

        const { placeholders } = guardTranslationTokens(originalValue);
        if (!placeholders) {
          remainingCells += 1;
          return;
        }

        const restored = restoreTranslationTokens(value, placeholders);
        if (restored !== value) {
          nextRow[key] = polishTranslation(originalValue, restored, targetLang);
          fixedCells += 1;
          rowChanged = true;
          changed = true;
        }

        if (typeof nextRow[key] === 'string' && PLACEHOLDER_REGEX.test(nextRow[key] as string)) {
          remainingCells += 1;
        }
      });

      return rowChanged ? normalizeTerminology(nextRow, targetLang, originalRow) : nextRow;
    });

    if (changed && options?.mutateState) {
      setProcessedData(repaired);
      if (translatedFlags.length === repaired.length) {
        persistProgress(repaired, [...translatedFlags], missingRowIndices, writeFailedRowIndices);
      }
      if (options.logLabel) {
        addLog(`${options.logLabel}: 已自动修复 ${fixedCells} 个占位符单元格。`);
      }
    }

    return { records: repaired, fixedCells, remainingCells, changed };
  };

  const jumpToPreviewCell = (rowIndex: number, columnKey: string) => {
    if (previewDetailsRef.current) {
      previewDetailsRef.current.open = true;
    }
    setPreviewFocus({ rowIndex, columnKey });
    window.requestAnimationFrame(() => {
      previewDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.requestAnimationFrame(() => {
        previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  };

  const applyQualityFixes = () => {
    if (documentKind !== 'excel') {
      addLog('Quality Fix: 当前仅支持 Excel 文档。');
      return;
    }
    if (!processedData.length) {
      addLog('Quality Fix: 没有可修复的翻译数据。');
      return;
    }
    const fixed = processedData.map((row, idx) => {
      const original = data[idx] || {};
      const polished = applyPostprocessRow(original, row, targetLang);
      const output: POCTRecord = { ...polished };
      Object.entries(polished).forEach(([key, value]) => {
        const originalValue = original[key];
        if (shouldLockCell(key, originalValue) && typeof originalValue === 'string') {
          output[key] = originalValue;
          return;
        }
        if (typeof value === 'string' && hasSpacingIssue(value)) {
          output[key] = polishTranslation(
            typeof originalValue === 'string' ? originalValue : '',
            value,
            targetLang
          );
        }
      });
      return output;
    });
    const flags =
      translatedFlags.length === fixed.length
        ? translatedFlags
        : Array(fixed.length).fill(true);
    const {
      refreshedMissing,
      refreshedWriteFailed
    } = refreshTranslationIssues(fixed);
    setProcessedData(fixed);
    setTranslatedFlags(flags);
    persistProgress(fixed, flags, refreshedMissing, refreshedWriteFailed);
    setQualityReport(runQualityChecks(data, fixed, { targetLang }));
    resetSampleReviewState();
    addLog('Quality Fix: 已应用常见格式与 ID 修复。');
  };

  const shouldTranslateDocxText = (text: string) => {
    return shouldTranslateValue(text);
  };

  const isLowPriorityDocxIssue = (text: string) => {
    if (containsProtectedTerm(text)) {
      const stripped = stripProtectedTerms(text).trim();
      if (!stripped) return true;
    }
    const trimmed = stripProtectedTerms(stripPreservedUiLabels(text)).trim();
    if (!trimmed) return true;
    if (isNeutralToken(trimmed) || isLikelyIdentifier(trimmed)) return true;
    if (DOCX_WORD_REGEX.test(trimmed)) return true;
    const chineseChars = countChineseChars(trimmed);
    if (chineseChars <= 1 && trimmed.length <= 12) return true;
    return false;
  };

  const buildDocumentIssueDetailsFromQuality = <T extends { id: string; original: string }>({
    segments,
    kind,
    getText,
    getOriginal,
    getLocationLabel,
    includeEmptyTranslations = false
  }: {
    segments: T[];
    kind: 'docx' | 'pdf';
    getText: (segment: T, index: number) => string;
    getOriginal: (segment: T, index: number) => string;
    getLocationLabel: (segment: T, index: number) => string;
    includeEmptyTranslations?: boolean;
  }) => {
    const report = runQualityChecksOnUnits(
      segmentsToQualityUnits<T>(
        segments,
        kind,
        getText,
        getOriginal,
        getLocationLabel
      ),
      { targetLang }
    );
    const byIndex = new Map<number, DocxIssueDetail>();
    const priorities = new Map<number, number>();
    const priorityFor = (issueType: DocxIssueDetail['issueType']) =>
      issueType === 'placeholder' ? 3 : issueType === 'glue' ? 2 : 1;
    const addIssue = (
      rowIndex: number,
      issueType: DocxIssueDetail['issueType'],
      lowPriority: boolean,
      issueText?: string,
      locationLabel?: string
    ) => {
      const segment = segments[rowIndex];
      if (!segment) return;
      const text = String(issueText || getText(segment, rowIndex) || getOriginal(segment, rowIndex) || '').trim();
      if (!text) return;
      const nextPriority = priorityFor(issueType);
      const existingPriority = priorities.get(rowIndex) || 0;
      if (existingPriority > nextPriority) return;
      priorities.set(rowIndex, nextPriority);
      byIndex.set(rowIndex, {
        index: rowIndex,
        id: segment.id,
        locationLabel: locationLabel || getLocationLabel(segment, rowIndex),
        text,
        snippet: toDocxSnippet(text),
        chineseChars: countChineseChars(text),
        lowPriority,
        issueType
      });
    };

    report.issues.nonTargetLanguage.forEach((issue) => {
      const text = issue.value || getText(segments[issue.rowIndex], issue.rowIndex);
      addIssue(
        issue.rowIndex,
        'source',
        issue.severity === 'low' || isLowPriorityDocxIssue(text),
        text,
        issue.locationLabel
      );
    });
    report.issues.placeholders.forEach((issue) => {
      addIssue(issue.rowIndex, 'placeholder', false, issue.value, issue.locationLabel);
    });
    report.issues.spacing
      .filter((issue) => issue.severity === 'high')
      .forEach((issue) => {
        addIssue(issue.rowIndex, 'glue', false, issue.value, issue.locationLabel);
      });
    if (includeEmptyTranslations) {
      segments.forEach((segment, index) => {
        const original = String(getOriginal(segment, index) || '').trim();
        const translated = String(getText(segment, index) || '').trim();
        if (original && !translated) {
          addIssue(index, 'source', false, original, getLocationLabel(segment, index));
        }
      });
    }

    const details = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
    return {
      pending: details.map((item) => item.index),
      details,
      qualityReport: report
    };
  };

  const buildDocxIssueDetails = (context: DocxContext) => {
    return buildDocumentIssueDetailsFromQuality<DocxSegment>({
      segments: context.segments,
      kind: 'docx',
      getText: (segment) => getDocxSegmentText(segment),
      getOriginal: (segment) => segment.original,
      getLocationLabel: (segment, index) => `${segment.partLabel || 'DOCX'} segment ${index + 1}`
    });
  };

  const getModelReviewSourceLabel = () => {
    if (documentKind === 'excel') return 'Excel cells';
    if (documentKind === 'docx') return 'DOCX segments';
    if (documentKind === 'pdf') return 'PDF text segments';
    return 'current document';
  };

  const buildTextSegmentModelReviewSamples = (
    segments: Array<{ id: string; original: string }>,
    readText: (segment: any) => string,
    sourceLabel: string,
    limit: number
  ): ModelReviewSample[] => {
    const candidates = segments
      .map((segment, index) => ({
        segment,
        index,
        text: (readText(segment) || segment.original || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((item) => item.text && shouldTranslateDocxText(item.text));
    const selected: typeof candidates = [];
    const need = Math.min(limit, candidates.length);
    if (need <= 0) return [];
    const step = Math.max(1, Math.floor(candidates.length / need));
    for (let i = 0; i < candidates.length && selected.length < need; i += step) {
      selected.push(candidates[i]);
    }
    for (const item of candidates) {
      if (selected.length >= need) break;
      if (!selected.some((selectedItem) => selectedItem.index === item.index)) {
        selected.push(item);
      }
    }
    return selected.map((item) => {
      const contextBefore = segments
        .slice(Math.max(0, item.index - 2), item.index)
        .map((segment) => (readText(segment) || segment.original || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const contextAfter = segments
        .slice(item.index + 1, item.index + 3)
        .map((segment) => (readText(segment) || segment.original || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return {
        id: item.segment.id,
        location: `${sourceLabel} #${item.index + 1}`,
        sourceText: item.text,
        contextBefore,
        contextAfter
      };
    });
  };

  const buildExcelModelReviewSamples = (limit: number): ModelReviewSample[] => {
    const cells: ModelReviewSample[] = [];
    const seen = new Set<string>();
    data.forEach((row, rowIndex) => {
      Object.entries(row).forEach(([key, value]) => {
        if (typeof value !== 'string') return;
        const text = value.replace(/\s+/g, ' ').trim();
        if (!text || shouldLockCell(key, value) || !shouldTranslateValue(value, key)) return;
        const memoryKey = `${key}\u0000${normalizeMemorySource(text)}`;
        if (seen.has(memoryKey)) return;
        seen.add(memoryKey);
        cells.push({
          id: `excel-${rowIndex}-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`,
          location: `Excel row ${rowIndex + 1} · ${key}`,
          sourceText: text
        });
      });
    });
    if (cells.length <= limit) return cells;
    const selected: ModelReviewSample[] = [];
    const step = Math.max(1, Math.floor(cells.length / limit));
    for (let i = 0; i < cells.length && selected.length < limit; i += step) {
      selected.push(cells[i]);
    }
    return selected;
  };

  const buildModelReviewSamples = (limit: number = modelReviewCount): ModelReviewSample[] => {
    if (documentKind === 'excel') {
      return buildExcelModelReviewSamples(limit);
    }
    if (documentKind === 'docx' && docxContextRef.current) {
      return buildTextSegmentModelReviewSamples(
        docxContextRef.current.segments,
        (segment) => getDocxSegmentText(segment),
        'DOCX Segment',
        limit
      );
    }
    if (documentKind === 'pdf' && pdfContextRef.current) {
      return buildTextSegmentModelReviewSamples(
        pdfContextRef.current.segments,
        (segment) => getPdfSegmentText(segment),
        'PDF Segment',
        limit
      );
    }
    return [];
  };

  const canRunModelReview = () => {
    if (documentKind === 'excel') return data.length > 0;
    if (documentKind === 'docx') return docxContextRef.current !== null;
    if (documentKind === 'pdf') return pdfContextRef.current !== null;
    return false;
  };

  const getRecommendedModelReviewStyle = (): ModelReviewStyle => {
    if (documentKind === 'excel') return 'medical-report';
    if (documentKind === 'docx') return 'ifu-manual';
    return 'auto';
  };

  const getEffectiveModelReviewStyle = (): ModelReviewStyle =>
    modelReviewStyleSelection === 'recommended'
      ? getRecommendedModelReviewStyle()
      : modelReviewStyleSelection;

  const runModelReview = async () => {
    if (!canRunModelReview()) {
      addLog('Multi-AI Review: 请先上传可抽样的 Excel、DOCX 或 PDF 文档。');
      setModelReviewStatus({ stage: 'error', message: '请先在 Translator 页面上传并解析文件。' });
      return;
    }
    if (isRunningModelReview || translationStatus === 'running') {
      addLog('Multi-AI Review: 当前有任务正在运行，请稍后再试。');
      setModelReviewStatus({ stage: 'error', message: '当前有任务正在运行，请稍后再试。' });
      return;
    }
    setModelReviewStatus({ stage: 'sampling', message: `Sampling ${getModelReviewSourceLabel()}...` });
    const samples = buildModelReviewSamples(modelReviewCount);
    if (!samples.length) {
      addLog('Multi-AI Review: 当前文档中没有可抽样的源语言文本。');
      setModelReviewStatus({ stage: 'error', message: '当前文档中没有可抽样的源语言文本。' });
      return;
    }
    setIsRunningModelReview(true);
    setModelReviewResult(null);
    const reviewStyle = getEffectiveModelReviewStyle();
    setModelReviewStatus({
      stage: 'translating',
      message: `Translating ${samples.length} samples with ${DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.length} candidate models...`
    });
	    addLog(
	      `Multi-AI Review: 抽取 ${samples.length} 个 ${getModelReviewSourceLabel()}，评审风格 ${MODEL_REVIEW_STYLE_LABELS[reviewStyle]}，并发调用 ${DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.length} 个候选模型和 ${DEFAULT_MODEL_REVIEW_JUDGE_MODELS.length} 个匿名评审模型。`
	    );
    try {
      window.setTimeout(() => {
        setModelReviewStatus((current) =>
          current.stage === 'translating'
            ? {
                stage: 'judging',
                message: `Anonymous judges are scoring candidate translations...`
              }
            : current
        );
      }, 1200);
      const result = await modelReviewService.reviewModels({
        samples,
        targetLang,
        translationModels: DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
        judgeModels: DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
        reviewStyle,
        profile: documentKind === 'excel' ? 'spreadsheet' : 'docx-manual'
      });
      setModelReviewResult(result);
      const successfulCandidates = result.candidates.filter((candidate) => candidate.translations.length > 0);
      const failedCandidates = result.candidates.filter((candidate) => candidate.error);
      const failedJudges = result.judges.filter((judge) => judge.error || judge.scores.length === 0);
      failedCandidates.forEach((candidate) => {
        addLog(`Multi-AI Review: 候选模型失败 ${candidate.model} - ${candidate.error || 'no translations returned'}`);
      });
      failedJudges.forEach((judge) => {
        addLog(`Multi-AI Review: 匿名评审失败 ${judge.model} - ${judge.error || 'no scores returned'}`);
      });
      const top = result.ranking[0];
      if (top && top.judgeCount > 0) {
        addLog(`Multi-AI Review: 完成，当前最高分 ${top.model} (${top.overall.toFixed(2)})。`);
        setModelReviewStatus({
          stage: 'completed',
          message: `Completed. Top model: ${getModelLabel(top.model)} (${top.overall.toFixed(2)}).`
        });
      } else if (successfulCandidates.length) {
        addLog(
          `Multi-AI Review: 候选翻译完成 ${successfulCandidates.length}/${result.candidates.length}，但匿名评审没有返回有效分数。`
        );
        setModelReviewStatus({
          stage: 'completed',
          message: `Translations completed for ${successfulCandidates.length}/${result.candidates.length} candidate models, but judges returned no usable scores.`
        });
      } else {
        addLog('Multi-AI Review: 完成，但评审模型未返回有效排名。');
        setModelReviewStatus({
          stage: 'completed',
          message: 'Completed, but no valid ranking was returned by the judges.'
        });
      }
    } catch (error) {
      addLog(`Multi-AI Review: ${error instanceof Error ? error.message : String(error)}`);
      setModelReviewStatus({
        stage: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsRunningModelReview(false);
    }
  };

  const exportModelReviewReport = () => {
    if (!modelReviewResult) {
      addLog('Multi-AI Review: 当前没有可导出的评审报告。');
      return;
    }
    const safeStamp = modelReviewResult.createdAt.replace(/[:.]/g, '-');
    downloadTextFile(
      `Multi_AI_Review_${documentKind}_${targetLang}_${safeStamp}.md`,
      formatModelReviewReport(modelReviewResult)
    );
    addLog('Multi-AI Review: 已导出 Markdown 评审报告。');
  };

  const auditDocxTranslation = () => {
    const context = docxContextRef.current;
    if (!context) return;
    const { pending, details } = buildDocxIssueDetails(context);
    setDocxIssueIndices(pending);
    setDocxIssueDetails(details);
    syncDocumentIssueSummary(details);
    if (pending.length === 0) {
      addLog('Docx audit: 所有段落均已通过源语言/占位符/粘词检查。');
    } else {
      const retryable = details.filter((item) => !item.lowPriority).length;
      const lowPriority = details.length - retryable;
      const placeholderCount = details.filter((item) => item.issueType === 'placeholder').length;
      const glueCount = details.filter((item) => item.issueType === 'glue').length;
      const sourceCount = details.filter((item) => item.issueType === 'source').length;
      addLog(
        `Docx audit: 检测到 ${pending.length} 段异常文本；源语言 ${sourceCount}，占位符 ${placeholderCount}，粘词 ${glueCount}。建议重译/修复 ${retryable} 段，低优先级 ${lowPriority} 段。`
      );
      const preview = details
        .slice(0, 6)
        .map((item) => `#${item.index + 1}[${item.issueType}]: ${item.snippet}`)
        .join(' | ');
      if (preview) {
        addLog(`Docx audit: 示例 -> ${preview}`);
      }
    }
  };

  const buildPdfIssueDetails = (context: PdfContext) => {
    return buildDocumentIssueDetailsFromQuality<PdfSegment>({
      segments: context.segments,
      kind: 'pdf',
      getText: (segment) => getPdfSegmentText(segment),
      getOriginal: (segment) => segment.original,
      getLocationLabel: (segment, index) => `PDF page ${segment.pageNumber}, segment ${index + 1}`,
      includeEmptyTranslations: true
    });
  };

  const auditPdfTranslation = () => {
    const context = pdfContextRef.current;
    if (!context) return;
    const { pending, details } = buildPdfIssueDetails(context);
    setPdfIssueIndices(pending);
    setPdfIssueDetails(details);
    syncDocumentIssueSummary(details);
    if (pending.length === 0) {
      addLog('PDF audit: 所有文本段均已通过源语言/占位符/粘词检查。');
      return;
    }
    const retryable = details.filter((item) => !item.lowPriority).length;
    const lowPriority = details.length - retryable;
    const placeholderCount = details.filter((item) => item.issueType === 'placeholder').length;
    const glueCount = details.filter((item) => item.issueType === 'glue').length;
    const sourceCount = details.filter((item) => item.issueType === 'source').length;
    addLog(
      `PDF audit: 检测到 ${pending.length} 段异常文本；源语言/空译文 ${sourceCount}，占位符 ${placeholderCount}，粘词 ${glueCount}。建议重译/修复 ${retryable} 段，低优先级 ${lowPriority} 段。`
    );
    const preview = details
      .slice(0, 6)
      .map((item) => `#${item.index + 1}[${item.issueType}]: ${item.snippet}`)
      .join(' | ');
    if (preview) {
      addLog(`PDF audit: 示例 -> ${preview}`);
    }
  };

  const syncDocumentIssueSummary = (details: DocxIssueDetail[]) => {
    const rowIndices = details.map((item) => item.index);
    setTranslationIssues({
      cells: details.length,
      rows: new Set(rowIndices).size,
      rowIndices,
      missingRows: [],
      details: details.map((item) => ({
        rowIndex: item.index,
        columnKey: 'content',
        locationLabel: item.locationLabel || `${documentKind.toUpperCase()} segment ${item.index + 1}`,
        value: item.text
      }))
    });
  };

  const buildDocumentQualityRows = () => {
    if (documentKind === 'docx' && docxContextRef.current) {
      return segmentsToQualityRows<DocxSegment>(
        docxContextRef.current.segments,
        (segment) => getDocxSegmentText(segment)
      );
    }
    if (documentKind === 'pdf' && pdfContextRef.current) {
      return segmentsToQualityRows<PdfSegment>(
        pdfContextRef.current.segments,
        (segment) => getPdfSegmentText(segment)
      );
    }
    return null;
  };

  const buildDocumentQualityInput = () => {
    if (documentKind === 'docx' && docxContextRef.current) {
      return segmentsToQualityUnits<DocxSegment>(
        docxContextRef.current.segments,
        'docx',
        (segment) => getDocxSegmentText(segment),
        (segment) => segment.original,
        (segment, index) => `${segment.partLabel || 'DOCX'} segment ${index + 1}`
      );
    }
    if (documentKind === 'pdf' && pdfContextRef.current) {
      return segmentsToQualityUnits<PdfSegment>(
        pdfContextRef.current.segments,
        'pdf',
        (segment) => getPdfSegmentText(segment),
        (segment) => segment.original,
        (segment, index) => `PDF page ${segment.pageNumber}, segment ${index + 1}`
      );
    }
    return null;
  };

  const runDocxTranslation = async (mode: 'fresh' | 'resume' = 'fresh') => {
    const context = docxContextRef.current;
    if (!context) {
      addLog('Docx: 未检测到可翻译的内容。');
      return;
    }
    const segments = context.segments;
    if (!segments.length) {
      addLog('Docx: 文档中没有可翻译的语义段。');
      return;
    }
    const candidates = segments.filter((segment) =>
      shouldTranslateDocxText(getDocxSegmentText(segment) || segment.original)
    );
    if (!candidates.length) {
      addLog('Docx: 当前文档已经是目标语言或没有可翻译的文本。');
      return;
    }

    pauseRequestedRef.current = false;
    const alreadyTranslated = Math.max(0, segments.length - candidates.length);
    setDocxStats({ total: segments.length, translated: alreadyTranslated });
    setDocxIssueIndices([]);
    setDocxIssueDetails([]);
    setTranslationStatus('running');
    if (mode === 'resume') {
      addLog(
        `Docx Resume: 已处理 ${alreadyTranslated}/${segments.length}，继续处理剩余 ${candidates.length} 个语义段。`
      );
    }
    setProcessingState({
      status: 'processing',
      progress: 0,
      total: candidates.length,
      currentBatch: 0
    });
    const batches = buildAdaptiveTextBatches<DocxSegment>({
      items: candidates,
      getText: (segment) => getDocxSegmentText(segment) || segment.original,
      maxItems: DOCX_BATCH_SIZE,
      maxChars: DOCX_BATCH_CHAR_LIMIT
    });
    addLog(
      `Docx: 使用 ${currentModelDisplayLabel}，按 ${batches.length} 批处理；每批最多 ${DOCX_BATCH_SIZE} 段 / ${DOCX_BATCH_CHAR_LIMIT} 字符。`
    );

    try {
      const result = await runStage('translate', async () => {
        let completed = 0;
        let paused = false;
        const totalBatches = batches.length;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Docx translation paused before batch ${batchIndex + 1}.`);
            break;
          }
          const chunk = batches[batchIndex];
          const batchNum = batchIndex + 1;
          const chunkChars = sumBatchTextChars(
            chunk,
            (segment) => getDocxSegmentText(segment) || segment.original
          );
          addLog(`Docx Batch ${batchNum}/${totalBatches}: ${chunk.length} 个语义段，约 ${chunkChars} 字符`);
          const memoryStats = createTranslationMemoryStats();
          const memoryHits = await lookupReusableTranslations(
            chunk.map((segment) => getDocxSegmentText(segment) || segment.original)
          );
          const leaders: Array<{
            segment: typeof chunk[number];
            rawText: string;
            sanitized: string;
            placeholders: Record<string, string> | null;
            memoryKey: string;
          }> = [];
          const followers = new Map<string, typeof chunk>();
          const seenInBatch = new Set<string>();

          chunk.forEach((segment) => {
            const rawText = getDocxSegmentText(segment) || segment.original;
            const memoryKey = getTranslationMemoryKey(rawText);
            const memoryTarget = memoryHits.get(memoryKey);
            if (memoryTarget) {
              setDocxSegmentText(segment, memoryTarget);
              memoryStats.hits += 1;
              return;
            }
            if (seenInBatch.has(memoryKey)) {
              const existing = followers.get(memoryKey) || [];
              existing.push(segment);
              followers.set(memoryKey, existing);
              memoryStats.deduped += 1;
              return;
            }
            seenInBatch.add(memoryKey);
            const { sanitized, placeholders } = guardTranslationTokens(rawText);
            if (placeholders) {
              docxPlaceholderStore.current.set(segment.id, placeholders);
            }
            leaders.push({
              segment,
              rawText,
              sanitized,
              placeholders,
              memoryKey
            });
          });

          let translatedBatch: POCTRecord[] = [];
          const batchStartedAt = Date.now();
          try {
            if (leaders.length > 0) {
              translatedBatch = await translationHub.translateBatch({
                records: leaders.map((leader) => ({ content: leader.sanitized })),
                targetLang,
                options: getDocumentQualityTranslationOptions()
              });
              applyLatestOpenRouterModelCooldowns(`Docx Batch ${batchNum}`);
              addLog(
                `Docx Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}，用时 ${formatElapsedSeconds(
                  Date.now() - batchStartedAt
                )}`
              );
            } else {
              addLog(`Docx Batch ${batchNum}: 全部命中本地翻译记忆。`);
            }
          } catch (err) {
            applyLatestOpenRouterModelCooldowns(`Docx Batch ${batchNum}`);
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(
              `Docx Batch ${batchNum} 翻译失败，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}：${errMsg}`
            );
            continue;
          }

          const memoryPairs: TranslationMemoryPair[] = [];
          leaders.forEach((leader, index) => {
            const segment = leader.segment;
            const translatedRecord = translatedBatch[index] || {};
            const rawText = leader.rawText;
            const placeholders = leader.placeholders || docxPlaceholderStore.current.get(segment.id);
            const sanitizedResult =
              typeof translatedRecord.content === 'string'
                ? translatedRecord.content
                : rawText;
            const restored = restoreTranslationTokens(sanitizedResult, placeholders);
            const polished = dedupeLeadingRepeat(
              rawText || '',
              polishTranslation(rawText || '', restored, targetLang)
            );
            setDocxSegmentText(segment, polished);
            (followers.get(leader.memoryKey) || []).forEach((follower) => {
              setDocxSegmentText(follower, polished);
            });
            memoryPairs.push({
              sourceText: rawText,
              targetText: polished,
              targetLang,
              model: translationHub.getLastEngine(),
              documentKind,
              fileName: file?.name
            });
          });
          await rememberTranslationPairs(memoryPairs, memoryStats);
          logTranslationMemoryStats(`Docx Batch ${batchNum}`, memoryStats);

          completed += chunk.length;
          setDocxStats({
            total: segments.length,
            translated: Math.min(alreadyTranslated + completed, segments.length)
          });
          const progress = Math.round((completed / candidates.length) * 100);
          setProcessingState((prev) => ({
            ...prev,
            progress,
            currentBatch: batchNum
          }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Docx translation paused after batch ${batchNum}.`);
            break;
          }
        }

        if (paused) {
          setProcessingState((prev) => ({ ...prev, status: 'idle' }));
          setTranslationStatus('paused');
          return 'paused';
        }

        setProcessingState((prev) => ({
          ...prev,
          status: 'completed',
          progress: 100
        }));
        addLog(`DOCX Translation Completed: ${completed}/${candidates.length} 个语义段处理完成。`);
        return 'completed';
      });

      if (result !== 'paused') {
        setTranslationStatus('completed');
      }
      auditDocxTranslation();
    } catch (error) {
      setTranslationStatus('idle');
      addLog(
        `Docx Translation Failed: ${error instanceof Error ? error.message : String(error)}`
      );
      setProcessingState((prev) => ({ ...prev, status: 'error' }));
    }
  };

  const runPdfTranslation = async (mode: 'fresh' | 'resume' = 'fresh') => {
    const context = pdfContextRef.current;
    if (!context) {
      addLog('PDF: 未检测到可翻译的内容。');
      return;
    }
    addLog(
      `PDF: 使用 ${currentModelDisplayLabel}，每批最多 ${DOCX_BATCH_SIZE} 段 / ${DOCX_BATCH_CHAR_LIMIT} 字符。`
    );

    await runPdfTranslationWorkflow({
      context,
      mode,
      batchSize: DOCX_BATCH_SIZE,
      batchCharLimit: DOCX_BATCH_CHAR_LIMIT,
      targetLang,
      documentKind,
      fileName: file?.name,
      translationHub,
      placeholderStore: docxPlaceholderStore.current,
      pauseRequestedRef,
      addLog,
      shouldTranslateText: shouldTranslateDocxText,
      dedupeLeadingRepeat,
      getTranslationOptions: getDocumentQualityTranslationOptions,
      applyLatestModelCooldowns: applyLatestOpenRouterModelCooldowns,
      createTranslationMemoryStats,
      lookupReusableTranslations,
      getTranslationMemoryKey,
      rememberTranslationPairs,
      logTranslationMemoryStats,
      runStage,
      setPdfStats,
      setTranslationStatus,
      setProcessingState
    });
    auditPdfTranslation();
  };

  const retryDocxSegments = async () => {
    const context = docxContextRef.current;
    if (!context) return;
    let pendingIndices = docxIssueIndices;
    if (pendingIndices.length === 0) {
      const { pending, details } = buildDocxIssueDetails(context);
      setDocxIssueIndices(pending);
      setDocxIssueDetails(details);
      pendingIndices = pending;
    }
    if (pendingIndices.length === 0) {
      addLog('Docx: 当前没有需要重译的段落。');
      return;
    }
    const retryPlan = buildTextSegmentRetryPlan(docxIssueDetails, pendingIndices);
    const targetIndices = retryPlan.targetIndices;
    if (retryPlan.fallbackToLowPriority) {
      addLog('Docx Retry: 当前剩余问题均为低优先级短文本，将尝试全量重译。');
    } else if (retryPlan.skippedLowPriority > 0) {
      addLog(
        `Docx Retry: 已自动聚焦 ${retryPlan.recommendedIndices.length} 段高优先级文本，跳过 ${retryPlan.skippedLowPriority} 段低优先级项。`
      );
    }
    const detailByIndex = new Map<number, DocxIssueDetail>(
      docxIssueDetails.map((item) => [item.index, item])
    );
    let targets = targetIndices
      .map(index => context.segments[index])
      .filter(Boolean);
    if (!targets.length) return;

    let locallyFixed = 0;
    targets.forEach((segment) => {
      const rawText = getDocxSegmentText(segment) || segment.original;
      const detail = detailByIndex.get(
        Number(segment.id.replace('docx-segment-', ''))
      );
      if (!detail || detail.issueType !== 'placeholder') return;
      const placeholders = docxPlaceholderStore.current.get(segment.id);
      if (!placeholders) return;
      const restored = restoreTranslationTokens(rawText, placeholders);
      if (restored === rawText) return;
      const polished = dedupeLeadingRepeat(
        rawText || '',
        polishTranslation(rawText || '', restored, targetLang)
      );
      setDocxSegmentText(segment, polished);
      locallyFixed += 1;
    });

    if (locallyFixed > 0) {
      addLog(`Docx Retry: 已本地修复 ${locallyFixed} 段占位符问题（无需调用模型）。`);
      const { pending, details } = buildDocxIssueDetails(context);
      setDocxIssueIndices(pending);
      setDocxIssueDetails(details);
      const remaining = new Set(details.map((item) => item.index));
      targets = targetIndices
        .filter((index) => remaining.has(index))
        .map(index => context.segments[index])
        .filter(Boolean);
      if (targets.length === 0) {
        addLog('Docx Retry: 占位符问题已清零。');
        setTranslationStatus('completed');
        auditDocxTranslation();
        return;
      }
    }

    pauseRequestedRef.current = false;
    setTranslationStatus('running');
    setProcessingState({
      status: 'processing',
      progress: 0,
      total: targets.length,
      currentBatch: 0
    });

    try {
      const result = await runStage('translate', async () => {
        let completed = 0;
        let paused = false;
        const batches = buildAdaptiveTextBatches<DocxSegment>({
          items: targets,
          getText: (segment) => segment.original || getDocxSegmentText(segment),
          maxItems: DOCX_BATCH_SIZE,
          maxChars: DOCX_BATCH_CHAR_LIMIT
        });
        const totalBatches = batches.length;
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Docx retry paused before batch ${batchIndex + 1}.`);
            break;
          }
          const chunk = batches[batchIndex];
          const batchNum = batchIndex + 1;
          const chunkChars = sumBatchTextChars(
            chunk,
            (segment) => segment.original || getDocxSegmentText(segment)
          );
          addLog(`Docx Retry Batch ${batchNum}/${totalBatches}: ${chunk.length} 个语义段，约 ${chunkChars} 字符`);
          let translatedBatch: POCTRecord[];
          const batchStartedAt = Date.now();
          try {
            const payload = chunk.map((segment) => {
              const rawText = segment.original || getDocxSegmentText(segment);
              const { sanitized, placeholders } = guardTranslationTokens(rawText);
              if (placeholders) {
                docxPlaceholderStore.current.set(segment.id, placeholders);
              }
              return {
                content: sanitized
              };
            });
            translatedBatch = await translationHub.translateBatch({
              records: payload,
              targetLang,
              options: getDocumentQualityTranslationOptions()
            });
            applyLatestOpenRouterModelCooldowns(`Docx Retry Batch ${batchNum}`);
          } catch (err) {
            applyLatestOpenRouterModelCooldowns(`Docx Retry Batch ${batchNum}`);
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(
              `Docx Retry Batch ${batchNum} 失败，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}：${errMsg}`
            );
            continue;
          }
          addLog(
            `Docx Retry Batch ${batchNum} 完成，用时 ${formatElapsedSeconds(
              Date.now() - batchStartedAt
            )}`
          );

          chunk.forEach((segment, index) => {
            const translatedRecord = translatedBatch[index] || {};
            const rawText = segment.original || getDocxSegmentText(segment);
            const placeholders = docxPlaceholderStore.current.get(segment.id);
            const sanitizedResult =
              typeof translatedRecord.content === 'string'
                ? translatedRecord.content
                : rawText;
            const restored = restoreTranslationTokens(sanitizedResult, placeholders);
            const polished = dedupeLeadingRepeat(
              rawText || '',
              polishTranslation(rawText || '', restored, targetLang)
            );
            setDocxSegmentText(segment, polished);
          });

          completed += chunk.length;
          setDocxStats(prev => ({
            total: prev.total || context.segments.length,
            translated: Math.min((prev.translated || 0) + chunk.length, prev.total || context.segments.length)
          }));
          const progress = Math.round((completed / targets.length) * 100);
          setProcessingState(prev => ({
            ...prev,
            progress,
            currentBatch: batchNum
          }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Docx retry paused after batch ${batchNum}.`);
            break;
          }
        }

        if (paused) {
          setProcessingState(prev => ({ ...prev, status: 'idle' }));
          setTranslationStatus('paused');
          return 'paused';
        }

        setProcessingState(prev => ({
          ...prev,
          status: 'completed',
          progress: 100
        }));
        addLog(`Docx 重译完成：${completed}/${targets.length} 个语义段。`);
        return 'completed';
      });
      if (result !== 'paused') {
        setTranslationStatus('completed');
      }
      auditDocxTranslation();
    } catch (error) {
      setTranslationStatus('idle');
      addLog(
        `Docx Retry Failed: ${error instanceof Error ? error.message : String(error)}`
      );
      setProcessingState(prev => ({ ...prev, status: 'error' }));
    }
  };

  const retryPdfSegments = async () => {
    const context = pdfContextRef.current;
    if (!context) return;
    let pendingIndices = pdfIssueIndices;
    let detailsSnapshot = pdfIssueDetails;
    if (pendingIndices.length === 0) {
      const { pending, details } = buildPdfIssueDetails(context);
      setPdfIssueIndices(pending);
      setPdfIssueDetails(details);
      pendingIndices = pending;
      detailsSnapshot = details;
    }
    if (pendingIndices.length === 0) {
      addLog('PDF: 当前没有需要重译的文本段。');
      return;
    }
    const retryPlan = buildTextSegmentRetryPlan(detailsSnapshot, pendingIndices);
    const targetIndices = retryPlan.targetIndices;
    if (retryPlan.fallbackToLowPriority) {
      addLog('PDF Retry: 当前剩余问题均为低优先级短文本，将尝试重译全部剩余问题段。');
    } else if (retryPlan.skippedLowPriority > 0) {
      addLog(
        `PDF Retry: 已自动聚焦 ${retryPlan.recommendedIndices.length} 段高优先级文本，跳过 ${retryPlan.skippedLowPriority} 段低优先级项。`
      );
    }

    let targets = targetIndices
      .map(index => context.segments[index])
      .filter(Boolean);
    if (!targets.length) return;

    let locallyFixed = 0;
    targets.forEach((segment) => {
      const rawText = getPdfSegmentText(segment) || segment.original;
      if (!PLACEHOLDER_REGEX.test(rawText) && !DOCX_PLACEHOLDER_VARIANT_REGEX.test(rawText)) return;
      const placeholders = docxPlaceholderStore.current.get(segment.id);
      if (!placeholders) return;
      const restored = restoreTranslationTokens(rawText, placeholders);
      if (restored === rawText) return;
      const polished = dedupeLeadingRepeat(
        rawText || '',
        polishTranslation(rawText || '', restored, targetLang)
      );
      setPdfSegmentText(segment, polished);
      locallyFixed += 1;
    });

    if (locallyFixed > 0) {
      addLog(`PDF Retry: 已本地修复 ${locallyFixed} 段占位符问题（无需调用模型）。`);
      const { pending, details } = buildPdfIssueDetails(context);
      setPdfIssueIndices(pending);
      setPdfIssueDetails(details);
      const remaining = new Set(details.map((item) => item.index));
      targets = targetIndices
        .filter((index) => remaining.has(index))
        .map(index => context.segments[index])
        .filter(Boolean);
      if (targets.length === 0) {
        addLog('PDF Retry: 占位符问题已清零。');
        setPdfStats({
          pages: context.pageCount,
          total: context.segments.length,
          translated: context.segments.filter((segment) => segment.translated.trim()).length
        });
        setTranslationStatus('completed');
        auditPdfTranslation();
        return;
      }
    }

    pauseRequestedRef.current = false;
    setTranslationStatus('running');
    setProcessingState({
      status: 'processing',
      progress: 0,
      total: targets.length,
      currentBatch: 0
    });

    try {
      const result = await runStage('translate', async () => {
        let completed = 0;
        let paused = false;
        const batches = buildAdaptiveTextBatches<PdfSegment>({
          items: targets,
          getText: (segment) => getPdfSegmentText(segment) || segment.original,
          maxItems: DOCX_BATCH_SIZE,
          maxChars: DOCX_BATCH_CHAR_LIMIT
        });
        const totalBatches = batches.length;
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`PDF retry paused before batch ${batchIndex + 1}.`);
            break;
          }
          const chunk = batches[batchIndex];
          const batchNum = batchIndex + 1;
          const chunkChars = sumBatchTextChars(
            chunk,
            (segment) => getPdfSegmentText(segment) || segment.original
          );
          addLog(`PDF Retry Batch ${batchNum}/${totalBatches}: ${chunk.length} 个文本段，约 ${chunkChars} 字符`);
          let translatedBatch: POCTRecord[];
          const batchStartedAt = Date.now();
          try {
            const payload = chunk.map((segment) => {
              const rawText = getPdfSegmentText(segment) || segment.original;
              const { sanitized, placeholders } = guardTranslationTokens(rawText);
              if (placeholders) {
                docxPlaceholderStore.current.set(segment.id, placeholders);
              }
              return {
                content: sanitized
              };
            });
            translatedBatch = await translationHub.translateBatch({
              records: payload,
              targetLang,
              options: getDocumentQualityTranslationOptions()
            });
            applyLatestOpenRouterModelCooldowns(`PDF Retry Batch ${batchNum}`);
          } catch (err) {
            applyLatestOpenRouterModelCooldowns(`PDF Retry Batch ${batchNum}`);
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(
              `PDF Retry Batch ${batchNum} 失败，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}：${errMsg}`
            );
            continue;
          }
          addLog(
            `PDF Retry Batch ${batchNum} 完成，用时 ${formatElapsedSeconds(Date.now() - batchStartedAt)}`
          );

          chunk.forEach((segment, index) => {
            const translatedRecord = translatedBatch[index] || {};
            const rawText = getPdfSegmentText(segment) || segment.original;
            const placeholders = docxPlaceholderStore.current.get(segment.id);
            const sanitizedResult =
              typeof translatedRecord.content === 'string'
                ? translatedRecord.content
                : rawText;
            const restored = restoreTranslationTokens(sanitizedResult, placeholders);
            const polished = dedupeLeadingRepeat(
              rawText || '',
              polishTranslation(rawText || '', restored, targetLang)
            );
            setPdfSegmentText(segment, polished);
          });

          completed += chunk.length;
          setPdfStats({
            pages: context.pageCount,
            total: context.segments.length,
            translated: context.segments.filter((segment) => segment.translated.trim()).length
          });
          const progress = Math.round((completed / targets.length) * 100);
          setProcessingState(prev => ({
            ...prev,
            progress,
            currentBatch: batchNum
          }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`PDF retry paused after batch ${batchNum}.`);
            break;
          }
        }

        if (paused) {
          setProcessingState(prev => ({ ...prev, status: 'idle' }));
          setTranslationStatus('paused');
          return 'paused';
        }

        setProcessingState(prev => ({
          ...prev,
          status: 'completed',
          progress: 100
        }));
        addLog(`PDF 重译完成：${completed}/${targets.length} 个文本段。`);
        return 'completed';
      });
      if (result !== 'paused') {
        setTranslationStatus('completed');
      }
      auditPdfTranslation();
    } catch (error) {
      setTranslationStatus('idle');
      addLog(`PDF Retry Failed: ${error instanceof Error ? error.message : String(error)}`);
      setProcessingState(prev => ({ ...prev, status: 'error' }));
    }
  };

  const translateStringResources = async () => {
    const input = stringInput;
    const targetLangs = selectedStringTargetLangs;
    if (!input.trim()) {
      setStringOutputs({});
      setStringStatus('idle');
      setStringError(null);
      setStringQualitySummary(null);
      setStringErrorDetails(null);
      return;
    }

    const lineBreak = input.includes('\r\n') ? '\r\n' : '\n';
    const hasTrailingNewline = input.endsWith('\n');
    const lines = input.split(/\r?\n/);
    const entries = lines.map(parseStringResourceLine);
    const hasTranslatableEntries = entries.some(
      (entry, index) => !isXmlCommentLine(lines[index] || '') && entry.needsTranslation
    );
    const localPatternCount = entries.filter(
      (entry, index) =>
        !isXmlCommentLine(lines[index] || '') &&
        entry.needsTranslation &&
        isLikelyDateFormatPattern(
          extractStructuredStringContent(entry.content).translatableContent
        )
    ).length;
    const placeholderStore = new Map<number, Record<string, string> | null>();
    const markupStore = new Map<number, Record<string, string> | null>();
    const indexMap = new Map<number, number>();
    const payload: POCTRecord[] = [];

    entries.forEach((entry, index) => {
      if (isXmlCommentLine(lines[index] || '')) return;
      if (!entry.needsTranslation) return;
      const structured = extractStructuredStringContent(entry.content);
      if (isLikelyDateFormatPattern(structured.translatableContent)) return;
      const { sanitized: markupSanitized, placeholders: markupPlaceholders } =
        guardMarkupTags(structured.translatableContent);
      const { sanitized, placeholders } = guardStringResourceTokens(markupSanitized);
      placeholderStore.set(index, placeholders || null);
      markupStore.set(index, markupPlaceholders || null);
      indexMap.set(index, payload.length);
      payload.push({ content: sanitized });
    });

    const buildOutput = (translatedBatch: POCTRecord[], lang: TargetLanguage) => {
      const mergedLines = entries.map((entry, index) => {
        if (isXmlCommentLine(lines[index] || '')) {
          return entry.original;
        }
        if (!entry.needsTranslation) {
          return entry.original;
        }
        const structured = extractStructuredStringContent(entry.content);
        if (isLikelyDateFormatPattern(structured.translatableContent)) {
          return `${entry.prefix}${structured.outerPrefix}${localizeDateFormatPattern(
            structured.translatableContent,
            lang
          )}${structured.outerSuffix}${entry.suffix}`;
        }
        const batchIndex = indexMap.get(index);
        const translatedRecord =
          typeof batchIndex === 'number' ? translatedBatch[batchIndex] || {} : {};
        const candidate =
          typeof translatedRecord.content === 'string'
            ? translatedRecord.content
            : structured.translatableContent;
        const placeholders = placeholderStore.get(index);
        const markupPlaceholders = markupStore.get(index);
        const restored = restoreStringResourceTokens(candidate, placeholders);
        const restoredMarkup = restoreMarkupTags(restored, markupPlaceholders);
        const polished = polishTranslation(
          structured.translatableContent || '',
          stringAutoFix ? applyStringAutoFix(restoredMarkup) : restoredMarkup,
          lang
        );
        const normalized = normalizeTerminology(
          { content: polished },
          lang,
          { content: structured.translatableContent }
        );
        const normalizedContent =
          typeof normalized.content === 'string' ? normalized.content : polished;
        return `${entry.prefix}${structured.outerPrefix}${normalizedContent}${structured.outerSuffix}${entry.suffix}`;
      });
      return mergedLines.join(lineBreak) + (hasTrailingNewline ? lineBreak : '');
    };

    if (!hasTranslatableEntries) {
      addLog(
        `String Resource: 未检测到需要翻译的中文词条，直接输出 ${targetLangs.length} 个目标结果。`
      );
      const outputs: Record<string, string> = {};
      targetLangs.forEach((lang) => {
        outputs[lang] = input;
      });
      setStringOutputs(outputs);
      const entry = {
        id: `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        source: input,
        outputs
      };
      const updated = appendStringHistory(entry);
      setStringHistoryCount(updated.length);
      setStringStatus('completed');
      setStringError(null);
      return;
    }

    setStringStatus('running');
    setStringOutputs({});
    setStringError(null);
    setStringQualitySummary(null);
    setStringErrorDetails(null);
    addLog(
      `String Resource: 开始处理 ${entries.length} 行，输出 ${targetLangs.length} 个目标语言（${targetLangs.join(', ')}）。`
    );
    addLog(`String Resource: 使用左侧 Translation Model - ${currentModelDisplayLabel}。`);
    if (translationModelPreference === AUTO_OPENROUTER_MODEL && currentSkippedOpenRouterModels.length > 0) {
      addLog(
        `String Resource: Auto 当前跳过冷却模型 ${currentSkippedOpenRouterModels.map(getModelLabel).join(', ')}。`
      );
    }
    if (payload.length > 0) {
      addLog(
        `String Resource: ${payload.length} 行送模型翻译，按 ${Math.ceil(
          payload.length / STRING_BATCH_SIZE
        )} 批执行。`
      );
    }
    if (localPatternCount > 0) {
      addLog(`String Resource: ${localPatternCount} 行日期/时间格式模板走本地转换。`);
    }

    let completedLangCount = 0;
    const totalLangCount = targetLangs.length;
    const results: Array<PromiseSettledResult<string>> = [];
    for (const lang of targetLangs) {
      addLog(`String Resource: ${lang} 开始处理...`);
      try {
        if (payload.length === 0) {
          const output = buildOutput([], lang);
          setStringOutputs((prev) => ({ ...prev, [lang]: output }));
          completedLangCount += 1;
          addLog(`String Resource: ${lang} 已完成（${completedLangCount}/${totalLangCount}）。`);
          results.push({ status: 'fulfilled', value: output });
          continue;
        }
        const translatedBatch = Array.from({ length: payload.length }, () => ({ content: '' }));
        const totalBatches = Math.ceil(payload.length / STRING_BATCH_SIZE);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const start = batchIndex * STRING_BATCH_SIZE;
          const end = Math.min(payload.length, start + STRING_BATCH_SIZE);
          addLog(
            `String Resource: ${lang} Batch ${batchIndex + 1}/${totalBatches}（第 ${start + 1}-${end} 行）...`
          );
          const batchRecords = payload.slice(start, end);
          const batchResult = await translationHub.translateBatch({
            records: batchRecords,
            targetLang: lang,
            options: getTranslationOptions()
          });
          applyLatestOpenRouterModelCooldowns(`String Resource: ${lang} Batch ${batchIndex + 1}`);
          batchResult.forEach((record, offset) => {
            translatedBatch[start + offset] = record;
          });
          const partialOutput = buildOutput(translatedBatch, lang);
          setStringOutputs((prev) => ({ ...prev, [lang]: partialOutput }));
          addLog(
            `String Resource: ${lang} Batch ${batchIndex + 1}/${totalBatches} 已完成（${end}/${payload.length} 行）。`
          );
        }

        const output = buildOutput(translatedBatch, lang);
        completedLangCount += 1;
        addLog(`String Resource: ${lang} 已完成（${completedLangCount}/${totalLangCount}）。`);
        results.push({ status: 'fulfilled', value: output });
      } catch (error) {
        applyLatestOpenRouterModelCooldowns(`String Resource: ${lang}`);
        completedLangCount += 1;
        const reason = error instanceof Error ? error.message : String(error);
        addLog(`String Resource: ${lang} 失败（${completedLangCount}/${totalLangCount}）：${reason}`);
        results.push({ status: 'rejected', reason: error });
      }
    }

    const outputs: Record<string, string> = {};
    const failed: string[] = [];
    const failureDetails: string[] = [];
    results.forEach((result, index) => {
      const lang = targetLangs[index];
      if (result.status === 'fulfilled') {
        outputs[lang] = result.value;
      } else {
        failed.push(lang);
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failureDetails.push(`${lang}: ${reason}`);
      }
    });
    targetLangs.forEach((lang) => {
      if (outputs[lang] === undefined) {
        outputs[lang] = '';
      }
    });

    setStringOutputs(outputs);
    const diagnostics = targetLangs
      .map((lang) => {
        const output = outputs[lang] || '';
        if (!output.trim()) return null;
        return collectStringOutputDiagnostics(entries, output, lang);
      })
      .filter((item): item is StringOutputDiagnostic => Boolean(item));
    const qualityIssues: string[] = [];
    const blockingDiagnostics = diagnostics.filter(
      (item) => item.placeholderLeaks > 0 || item.invalidXml
    );

    diagnostics.forEach(({ lang, untranslated, placeholderLeaks, spacingIssues, invalidXml }) => {
      const parts: string[] = [];
      if (untranslated > 0) parts.push(`未翻译 ${untranslated}`);
      if (placeholderLeaks > 0) parts.push(`占位符 ${placeholderLeaks}`);
      if (spacingIssues > 0) parts.push(`空格异常 ${spacingIssues}`);
      if (invalidXml) parts.push('XML 非法');
      if (parts.length > 0) {
        qualityIssues.push(`${lang}: ${parts.join('，')}`);
      }
    });
    if (qualityIssues.length > 0) {
      const summaryText = `质量检查：${qualityIssues.join('；')}。`;
      setStringQualitySummary(summaryText);
      addLog(summaryText);
    }

    const hasContent = Object.values(outputs).some((value) => value && value.trim());
    if (hasContent && blockingDiagnostics.length === 0 && failed.length === 0) {
      const entry = {
        id: `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        source: input,
        outputs
      };
      const updated = appendStringHistory(entry);
      setStringHistoryCount(updated.length);
    }

    if (failed.length > 0) {
      setStringStatus('error');
      setStringError(`翻译失败：${failed.join(', ')}`);
      if (failureDetails.length > 0) {
        setStringErrorDetails(failureDetails.slice(0, 4).join(' | '));
      }
      addLog(`String Resource: 处理结束，失败语言 ${failed.join(', ')}。`);
    } else if (blockingDiagnostics.length > 0) {
      setStringStatus('error');
      setStringError('字符串结果存在结构风险，已禁止导出。');
      setStringErrorDetails(
        blockingDiagnostics
          .slice(0, 3)
          .map((item) =>
            item.invalidXml
              ? `${item.lang}: XML 校验失败`
              : `${item.lang}: 内部占位符未恢复`
          )
          .join(' | ')
      );
      blockingDiagnostics.forEach((item) => {
        if (item.invalidXml && item.xmlError) {
          addLog(`String Resource: ${item.lang} XML 校验失败 - ${item.xmlError}`);
        } else if (item.placeholderLeaks > 0) {
          addLog(`String Resource: ${item.lang} 检测到 ${item.placeholderLeaks} 个内部占位符残留。`);
        }
      });
    } else {
      setStringStatus('completed');
      setStringError(null);
      setStringErrorDetails(null);
      addLog(`String Resource: 全部 ${targetLangs.length} 个目标语言处理完成。`);
    }
  };

  const clearStringResources = () => {
    setStringInput('');
    setStringOutputs({});
    setStringStatus('idle');
    setStringError(null);
    setStringQualitySummary(null);
    setStringErrorDetails(null);
  };

  const copyStringOutput = async (lang: TargetLanguage) => {
    const text = stringOutputs[lang] || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      addLog(`已复制 ${lang} 翻译结果到剪贴板。`);
    } catch (err) {
      addLog(`复制失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const exportStringHistory = () => {
    const history = loadStringHistory();
    if (history.length === 0) {
      addLog('暂无字符串翻译记录可导出。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = formatStringHistoryText(history);
    downloadTextFile(`String_Translation_History_${stamp}.txt`, content);
    addLog(`已导出字符串翻译记录（TXT）：${history.length} 条。`);
  };

  const exportCurrentStringOutput = () => {
    const availableOutputs: Record<string, string> = Object.fromEntries(
      Object.entries(stringOutputs).filter(([, value]) => String(value || '').trim())
    ) as Record<string, string>;
    if (!Object.keys(availableOutputs).length) {
      addLog('当前没有字符串翻译结果可导出。');
      return;
    }
    const diagnostics = getCurrentStringOutputDiagnostics(availableOutputs);
    const blockingDiagnostics = diagnostics.filter(
      (item) => item.placeholderLeaks > 0 || item.invalidXml
    );
    if (blockingDiagnostics.length > 0) {
      setStringStatus('error');
      setStringError('当前字符串结果未通过结构校验，已禁止导出。');
      setStringErrorDetails(
        blockingDiagnostics
          .slice(0, 3)
          .map((item) =>
            item.invalidXml
              ? `${item.lang}: XML 校验失败`
              : `${item.lang}: 内部占位符未恢复`
          )
          .join(' | ')
      );
      blockingDiagnostics.forEach((item) => {
        if (item.invalidXml && item.xmlError) {
          addLog(`String Resource: ${item.lang} 导出前 XML 校验失败 - ${item.xmlError}`);
        } else if (item.placeholderLeaks > 0) {
          addLog(`String Resource: ${item.lang} 导出前检测到 ${item.placeholderLeaks} 个内部占位符残留。`);
        }
      });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = formatCurrentStringOutputText(stringInput, availableOutputs);
    downloadTextFile(`String_Translation_Current_${stamp}.txt`, content);
    addLog(`已导出当前字符串翻译结果（TXT）：${Object.keys(availableOutputs).join(', ')}。`);
  };

  const clearStringHistoryData = () => {
    clearStringHistory();
    setStringHistoryCount(0);
    addLog('已清空字符串翻译记录。');
  };

  const runTranslation = async (mode: 'fresh' | 'resume' = 'fresh') => {
    if (documentKind === 'docx') {
      await runDocxTranslation(mode);
      return;
    }
    if (documentKind === 'pdf') {
      await runPdfTranslation(mode);
      return;
    }
    if (data.length === 0) return;

    const shouldResume = mode === 'resume' && processedData.length === data.length;
    const baseResults = data.map(row => ({ ...row }));
    const workingResults = shouldResume ? [...processedData] : baseResults;
    const initialFlags =
      translationMode === 'selective'
        ? data.map(row => (rowNeedsTranslation(row, targetLang) ? false : true))
        : Array(data.length).fill(false);
    const workingFlags =
      shouldResume && translatedFlags.length === data.length
        ? [...translatedFlags]
        : [...initialFlags];
    const resumeMissing = shouldResume ? summarizeUntranslated(workingResults, targetLang).rowIndices : [];
    const workingMissing = new Set<number>(resumeMissing);

    if (!shouldResume) {
      clearTranslationProgress(fileId, targetLang);
      setSavedSnapshot(null);
      snapshotPromptKeyRef.current = '';
      setProcessedData([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags([...initialFlags]);
      setMissingRowIndices([]);
      setWriteFailedRowIndices([]);
      setProcessingState(prev => ({ ...prev, status: 'processing', progress: 0, currentBatch: 0, total: data.length }));
      addLog(`Stage[translate]: 准备将 ${data.length} 行翻译为 [${targetLang}]`);
      if (translationMode === 'selective') {
        const skipped = initialFlags.filter(Boolean).length;
        if (skipped > 0) {
          addLog(`Selective mode: 检测到 ${skipped} 行已为目标语言，将跳过这些行的模型调用。`);
        }
      }
    } else {
      const resumeFrom = workingFlags.findIndex(flag => !flag);
      const resumeRow = resumeFrom === -1 ? data.length : resumeFrom + 1;
      addLog(`Stage[translate]: 从第 ${resumeRow} 行继续翻译...`);
      setProcessingState(prev => ({
        ...prev,
        status: 'processing',
        total: data.length,
        currentBatch: Math.max(1, Math.ceil(resumeRow / BATCH_SIZE))
      }));
    }

    const firstPendingIndex = shouldResume
      ? workingFlags.findIndex(flag => !flag)
      : 0;
    const startIndex = firstPendingIndex === -1 ? data.length : firstPendingIndex;

    if (startIndex >= data.length && shouldResume) {
      addLog('所有行均已翻译，如需重新翻译请使用 Run Global Translation。');
      setTranslationStatus('completed');
      return;
    }

    pauseRequestedRef.current = false;
    setTranslationStatus('running');

    let latestResults: POCTRecord[] = [...workingResults];
    let result: 'paused' | 'completed' | void;

    try {
      result = await runStage('translate', async () => {
        const finalResults = [...workingResults];
        const flags = [...workingFlags];
        const missingRows = new Set<number>(workingMissing);
        const writeFailedRows = new Set<number>(
          (shouldResume ? writeFailedRowIndices : []).filter((idx) => missingRows.has(idx))
        );
        const totalBatches = Math.ceil(data.length / BATCH_SIZE);
        let paused = false;

        for (let i = startIndex; i < data.length; i += BATCH_SIZE) {
          const chunkIndices: number[] = [];
          for (let offset = 0; offset < BATCH_SIZE && i + offset < data.length; offset++) {
            chunkIndices.push(i + offset);
          }
          const pendingIndices = chunkIndices.filter(idx => !flags[idx]);
          if (pendingIndices.length === 0) continue;

          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const rowLabel = formatRowRanges(pendingIndices, 1);
          addLog(`Translating Batch ${batchNum}/${totalBatches} (${pendingIndices.length} records，行 ${rowLabel})...`);

          let translatedBatch: POCTRecord[] = [];
          const memoryStats = createTranslationMemoryStats();
          const translatableCells: Array<{ rowIdx: number; key: string; value: string }> = [];
          pendingIndices.forEach((rowIdx) => {
            Object.entries(data[rowIdx]).forEach(([key, value]) => {
              if (
                typeof value === 'string' &&
                value.trim() &&
                !shouldLockCell(key, value) &&
                shouldTranslateValue(value, key)
              ) {
                translatableCells.push({ rowIdx, key, value });
              }
            });
          });
          const memoryHits = await lookupReusableTranslations(
            translatableCells.map((cell) => cell.value)
          );
          const callRows: Array<{
            rowIdx: number;
            sanitizedRow: POCTRecord;
            placeholders: Record<string, Record<string, string> | null>;
          }> = [];
          const leaderByCell = new Map<
            string,
            {
              rowIdx: number;
              key: string;
              sourceText: string;
              placeholders: Record<string, string> | null;
              memoryKey: string;
            }
          >();
          const followers = new Map<string, Array<{ rowIdx: number; key: string }>>();
          const seenInBatch = new Set<string>();

          pendingIndices.forEach((rowIdx) => {
            const row = data[rowIdx];
            const sanitizedRow: POCTRecord = {};
            const placeholdersForRow: Record<string, Record<string, string> | null> = {};

            Object.entries(row).forEach(([key, value]) => {
              if (typeof value !== 'string') {
                return;
              }
              if (!value.trim() || shouldLockCell(key, value) || !shouldTranslateValue(value, key)) {
                return;
              }

              const memoryKey = getTranslationMemoryKey(value);
              const memoryTarget = memoryHits.get(memoryKey);
              if (memoryTarget) {
                finalResults[rowIdx] = {
                  ...(finalResults[rowIdx] || data[rowIdx]),
                  [key]: memoryTarget
                };
                memoryStats.hits += 1;
                return;
              }

              if (seenInBatch.has(memoryKey)) {
                const existing = followers.get(memoryKey) || [];
                existing.push({ rowIdx, key });
                followers.set(memoryKey, existing);
                memoryStats.deduped += 1;
                return;
              }

              seenInBatch.add(memoryKey);
              const { sanitized, placeholders } = guardTranslationTokens(value);
              if (placeholders) {
                placeholdersForRow[key] = placeholders;
              }
              sanitizedRow[key] = sanitized;
              leaderByCell.set(`${rowIdx}\u0000${key}`, {
                rowIdx,
                key,
                sourceText: value,
                placeholders,
                memoryKey
              });
            });

            if (Object.keys(sanitizedRow).length > 0) {
              callRows.push({
                rowIdx,
                sanitizedRow,
                placeholders: placeholdersForRow
              });
            }
          });

          try {
            if (callRows.length > 0) {
              translatedBatch = await translationHub.translateBatch({
                records: callRows.map((item) => item.sanitizedRow),
                targetLang,
                options: getTranslationOptions()
              });
              addLog(`Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}`);
            } else {
              addLog(`Batch ${batchNum}: 全部命中本地翻译记忆或无需模型翻译。`);
            }
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            addLog(`Translation warning: 批次 ${batchNum} 行 ${rowLabel} 失败 (${errMsg})，将跳过该批继续。`);
            pendingIndices.forEach(idx => writeFailedRows.add(idx));
            const missingSnapshot = Array.from(missingRows).sort((a, b) => a - b);
            const writeFailedSnapshot = Array.from(writeFailedRows).sort((a, b) => a - b);
            persistProgress(finalResults, flags, missingSnapshot, writeFailedSnapshot);
            setWriteFailedRowIndices(writeFailedSnapshot);
            setMissingRowIndices(missingSnapshot);
            continue;
          }

          const incompleteRows: number[] = [];
          const memoryPairs: TranslationMemoryPair[] = [];
          callRows.forEach((item, index) => {
            const translated = translatedBatch[index];
            const original = data[item.rowIdx];
            const merged: POCTRecord = { ...(finalResults[item.rowIdx] || original) };
            const placeholdersForRow = item.placeholders || {};

            Object.keys(item.sanitizedRow).forEach(key => {
              if (!translated || translated[key] === undefined) return;
              const leader = leaderByCell.get(`${item.rowIdx}\u0000${key}`);
              if (!leader) return;
              const originalValue = original[key];
              if (shouldLockCell(key, originalValue) || !shouldTranslateValue(originalValue, key)) {
                merged[key] = originalValue;
                return;
              }
              const candidate = translated[key];
              merged[key] =
                typeof candidate === 'string'
                  ? polishTranslation(
                      typeof originalValue === 'string' ? (originalValue as string) : '',
                      candidate,
                      targetLang
                    )
                  : candidate;
              if (typeof merged[key] === 'string' && placeholdersForRow[key]) {
                merged[key] = restoreTranslationTokens(
                  merged[key] as string,
                  placeholdersForRow[key]
                );
              }
              (followers.get(leader.memoryKey) || []).forEach((follower) => {
                finalResults[follower.rowIdx] = {
                  ...(finalResults[follower.rowIdx] || data[follower.rowIdx]),
                  [follower.key]: merged[key]
                };
              });
              memoryPairs.push({
                sourceText: leader.sourceText,
                targetText: String(merged[key] || ''),
                targetLang,
                model: translationHub.getLastEngine(),
                documentKind,
                fileName: file?.name
              });
            });

            finalResults[item.rowIdx] = normalizeTerminology(merged, targetLang, data[item.rowIdx]);
          });
          await rememberTranslationPairs(memoryPairs, memoryStats);
          logTranslationMemoryStats(`Batch ${batchNum}`, memoryStats);

          pendingIndices.forEach((rowIdx) => {
            finalResults[rowIdx] = normalizeTerminology(
              finalResults[rowIdx] || data[rowIdx],
              targetLang,
              data[rowIdx]
            );
            const stillUntranslated =
              detectUntranslatedCells([finalResults[rowIdx]], targetLang).length > 0;
            if (stillUntranslated) {
              incompleteRows.push(rowIdx);
              missingRows.add(rowIdx);
              flags[rowIdx] = false;
            } else {
              flags[rowIdx] = true;
              missingRows.delete(rowIdx);
            }
            writeFailedRows.delete(rowIdx);
          });
          if (incompleteRows.length > 0) {
            addLog(
              `Translation warning: 批次 ${batchNum} 有 ${incompleteRows.length} 行返回不完整，已标记为待重译。`
            );
          }

          const snapshot = finalResults.map(row => ({ ...row }));
          const flagsSnapshot = [...flags];
          const summarySnapshot = summarizeUntranslated(snapshot, targetLang);
          const missingSnapshot = summarySnapshot.rowIndices;
          const writeFailedSnapshot = Array.from(writeFailedRows).sort((a, b) => a - b);
          persistProgress(snapshot, flagsSnapshot, missingSnapshot, writeFailedSnapshot);
          setProcessedData(snapshot);
          setTranslatedFlags(flagsSnapshot);
          setMissingRowIndices(missingSnapshot);
          setWriteFailedRowIndices(writeFailedSnapshot);

          const completedCount = flagsSnapshot.filter(Boolean).length;
          const progress = Math.round((completedCount / data.length) * 100);
          setProcessingState(prev => ({
            ...prev,
            progress,
            currentBatch: batchNum,
            total: data.length
          }));

          await new Promise(r => setTimeout(r, 100));
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Translation paused after batch ${batchNum}.`);
            break;
          }
        }

        const completedCount = flags.filter(Boolean).length;
        const finalSummary = summarizeUntranslated(finalResults, targetLang);
        const missingSnapshot = finalSummary.rowIndices;
        const writeFailedSnapshot = Array.from(writeFailedRows).sort((a, b) => a - b);
        setMissingRowIndices(missingSnapshot);
        setWriteFailedRowIndices(writeFailedSnapshot);
        setTranslatedFlags([...flags]);
        const rawSnapshot = finalResults.map(row => ({ ...row }));
        const { records: snapshot, fixedCells: autoFixedCells } = autoRepairExcelPlaceholders(rawSnapshot);
        if (autoFixedCells > 0) {
          addLog(`Translation auto-repair: 已自动恢复 ${autoFixedCells} 个坏 token。`);
        }
        setProcessedData(snapshot);
        persistProgress(snapshot, [...flags], missingSnapshot, writeFailedSnapshot);
        latestResults = snapshot;

        if (paused) {
          setProcessingState(prev => ({ ...prev, status: 'idle' }));
          setTranslationStatus('paused');
          return 'paused';
        }

        const completionMsg = `Translation Completed: ${completedCount}/${data.length} 行。`;
        const statusSuffix =
          missingSnapshot.length > 0
            ? ` 尚有 ${missingSnapshot.length} 行未翻译。`
            : '';
        const writeSuffix =
          writeFailedSnapshot.length > 0
            ? ` 未写入 ${writeFailedSnapshot.length} 行，可使用 Retry Missing Cells。`
            : '';
        addLog(`${completionMsg}${statusSuffix}${writeSuffix}`.trim());
        setProcessingState(prev => ({
          ...prev,
          status: 'completed',
          progress: Math.round((completedCount / data.length) * 100),
          currentBatch: totalBatches
        }));
        return 'completed';
      });
    } catch (error) {
      setTranslationStatus('idle');
      addLog(`Translation Failed: ${error instanceof Error ? error.message : String(error)}`);
      setProcessingState(prev => ({ ...prev, status: 'error' }));
      return;
    }

    if (result !== 'paused') {
      setTranslationStatus('completed');
      await auditTranslation(latestResults);
    }
  };

  const auditTranslation = async (records: POCTRecord[]) => {
    const summary = summarizeUntranslated(records, targetLang);
    const mergedRowIndices = [...summary.rowIndices];
    const filteredWriteFailed = writeFailedRowIndices.filter((idx) => mergedRowIndices.includes(idx));
    const mergedSummary: IssueSummaryState = {
      ...summary,
      rowIndices: mergedRowIndices,
      missingRows: filteredWriteFailed,
      details: summary.details || []
    };
    setTranslationIssues(mergedSummary);
    setWriteFailedRowIndices(filteredWriteFailed);

    if (mergedSummary.cells === 0 && mergedSummary.missingRows.length === 0) {
      addLog('Translation audit: 所有单元格均为目标语言。');
      return;
    }

    if (mergedRowIndices.length === 0) {
      addLog('Translation audit: 检测到异常但无可定位的行，请手动核查。');
      return;
    }

    addLog(
      `Translation audit: 检测到 ${summary.cells} 个未翻译单元格，涉及 ${summary.rowIndices.length} 行；未写入 ${filteredWriteFailed.length} 行。`
    );

    await retryMissingRows(mergedRowIndices, records);
  };

  const retryMissingRows = async (
    rowIndices: number[],
    baseSnapshot?: POCTRecord[]
  ) => {
    if (isRetryingMissing) {
      addLog('Retry Missing Cells: 正在处理中，请等待当前重译完成。');
      return;
    }
    setIsRetryingMissing(true);
    try {
      const uniqueIndices = Array.from(new Set(rowIndices))
      .filter(idx => idx >= 0 && idx < data.length)
      .sort((a, b) => a - b);
    if (uniqueIndices.length === 0) {
      addLog('Retry Missing Cells: 无待重译的行。');
      return;
    }
    addLog(`Retry Missing Cells: 针对 ${uniqueIndices.length} 行重新翻译...`);

    const fallbackPriority = getFallbackPriority(
      translationModelPreference !== AUTO_OPENROUTER_MODEL
    );

    const sourceRecords =
      baseSnapshot && baseSnapshot.length === data.length
        ? baseSnapshot
        : processedData.length === data.length
          ? processedData
          : data;
    const missingSummary = summarizeUntranslated(sourceRecords, targetLang);
    const retryItems = buildExcelRetryTargets({
      rowIndices: uniqueIndices,
      details: missingSummary.details || [],
      originalRows: data,
      sourceRows: sourceRecords,
      isRetryableCell: ({ columnKey, value, originalValue }) => {
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        return Boolean(value.trim()) && !shouldLockCell(columnKey, lockBasis) && !isNeutralToken(value.trim());
      },
      guardTranslationTokens
    });

    if (retryItems.length === 0) {
      const synced =
        sourceRecords.length === data.length
          ? sourceRecords.map(row => ({ ...row }))
          : data.map(row => ({ ...row }));
      const flagsSnapshot =
        translatedFlags.length === data.length
          ? [...translatedFlags]
          : Array(data.length).fill(false);
      const { summary: refreshedSummary, refreshedMissing, refreshedWriteFailed, mergedRowIndices } = refreshTranslationIssues(
        synced
      );
      setProcessedData(synced);
      setTranslatedFlags(flagsSnapshot);
      setWriteFailedRowIndices(refreshedWriteFailed);
      persistProgress(synced, flagsSnapshot, refreshedMissing, refreshedWriteFailed);
      addLog('Retry Missing Cells: 当前没有可重译的单元格。');
      if (mergedRowIndices.length === 0) {
        addLog('Retry Missing Cells: 状态已刷新，当前无待补译内容。');
      } else {
        addLog('Retry Missing Cells: 剩余项可能是锁定字段或纯符号单元格，请先执行 Quality Check / Apply Cleanup 后再试。');
        const preview = formatIssueLocationPreview(refreshedSummary.details || [], 6);
        if (preview) {
          addLog(`Retry Missing Cells: 残留位置示例 -> ${preview}`);
        }
      }
      return;
    }

    const baseProcessed =
      sourceRecords.length === data.length
        ? sourceRecords.map(row => ({ ...row }))
        : data.map(row => ({ ...row }));
    const updatedFlags =
      translatedFlags.length === data.length
        ? [...translatedFlags]
        : Array(data.length).fill(false);
    const missingSet = new Set<number>(missingSummary.rowIndices);
    const writeFailedSet = new Set<number>(
      writeFailedRowIndices.filter((idx) => missingSummary.rowIndices.includes(idx))
    );

    const totalBatches = Math.ceil(retryItems.length / RETRY_BATCH_SIZE);
    for (let i = 0; i < retryItems.length; i += RETRY_BATCH_SIZE) {
      const chunk = retryItems.slice(i, i + RETRY_BATCH_SIZE);
      const batchNum = Math.floor(i / RETRY_BATCH_SIZE) + 1;
      addLog(`Retry Missing Cells: Batch ${batchNum}/${totalBatches} 重译 ${chunk.length} 行...`);

      let translatedBatch: POCTRecord[] | null = null;
      for (const model of fallbackPriority) {
        try {
          translatedBatch = await translationHub.translateBatch({
            records: chunk.map(item => item.sanitizedRow),
            targetLang,
            options: {
              model,
              providerModel:
                model === 'cloudflare-ai' && isCloudflareAiModelValue(translationModelPreference)
                  ? getCloudflareAiProviderModel(translationModelPreference)
                  : model === 'deepseek' && isDeepSeekDirectModel(translationModelPreference)
                    ? getDeepSeekDirectProviderModel(translationModelPreference)
                    : undefined,
              openRouterModel:
                model === 'openrouter' && translationModelPreference !== AUTO_OPENROUTER_MODEL
                  ? translationModelPreference
                  : undefined
            }
          });
          addLog(`Retry Missing Cells: Batch ${batchNum} 使用 ${model} 成功。`);
          break;
        } catch (err) {
          addLog(`Retry Missing Cells: Batch ${batchNum} ${model} 失败 - ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (!translatedBatch) {
        addLog(`Retry Missing Cells: Batch ${batchNum} 所有备用模型失败，已跳过。`);
        chunk.forEach((item) => writeFailedSet.add(item.rowIdx));
        continue;
      }

      chunk.forEach((item, index) => {
        const updated = translatedBatch?.[index];
        if (!updated) return;
        const rowIdx = item.rowIdx;
        const original = data[rowIdx];
        const sourceRow = sourceRecords[rowIdx] || original;
        const merged: POCTRecord = { ...(baseProcessed[rowIdx] || original) };
        const placeholdersForRow = item.placeholders || {};
        item.keys.forEach((key) => {
          const originalValue = original[key];
          const sourceValue = sourceRow?.[key];
          const lockBasis =
            typeof originalValue === 'string'
              ? originalValue
              : typeof sourceValue === 'string'
                ? sourceValue
                : '';
          if (shouldLockCell(key, lockBasis)) {
            return;
          }
          if (updated[key] === undefined) return;
          const candidate = updated[key];
          merged[key] =
            typeof candidate === 'string'
              ? polishTranslation(
                  typeof sourceValue === 'string'
                    ? sourceValue
                    : typeof originalValue === 'string'
                      ? originalValue
                      : '',
                  candidate,
                  targetLang
                )
              : candidate;
          if (typeof merged[key] === 'string' && placeholdersForRow[key]) {
            merged[key] = restoreTranslationTokens(
              merged[key] as string,
              placeholdersForRow[key]
            );
          }
        });

        baseProcessed[rowIdx] = normalizeTerminology(merged, targetLang, data[rowIdx]);
        const stillUntranslated =
          detectUntranslatedCells([baseProcessed[rowIdx]], targetLang).length > 0;
        const isComplete = !stillUntranslated;
        updatedFlags[rowIdx] = isComplete;
        if (isComplete) {
          missingSet.delete(rowIdx);
        } else {
          missingSet.add(rowIdx);
        }
        writeFailedSet.delete(rowIdx);
      });

      const synced = baseProcessed.map(row => ({ ...row }));
      const flagsSnapshot = [...updatedFlags];
      const summarySnapshot = summarizeUntranslated(synced, targetLang);
      const missingSnapshot = summarySnapshot.rowIndices;
      const writeFailedSnapshot = Array.from(writeFailedSet).sort((a, b) => a - b);
      setProcessedData(synced);
      setTranslatedFlags(flagsSnapshot);
      setMissingRowIndices(missingSnapshot);
      setWriteFailedRowIndices(writeFailedSnapshot);
      persistProgress(synced, flagsSnapshot, missingSnapshot, writeFailedSnapshot);
    }

    const rawSynced = baseProcessed.map(row => ({ ...row }));
    const { records: synced, fixedCells: retryAutoFixed } = autoRepairExcelPlaceholders(rawSynced);
    const flagsSnapshot = [...updatedFlags];
    const summary = summarizeUntranslated(synced, targetLang);
    const missingSnapshot = summary.rowIndices;
    const writeFailedSnapshot = Array.from(writeFailedSet).sort((a, b) => a - b);
    setProcessedData(synced);
    setTranslatedFlags(flagsSnapshot);
    setMissingRowIndices(missingSnapshot);
    setWriteFailedRowIndices(writeFailedSnapshot);
    persistProgress(synced, flagsSnapshot, missingSnapshot, writeFailedSnapshot);
    if (retryAutoFixed > 0) {
      addLog(`Retry Missing Cells: 已自动恢复 ${retryAutoFixed} 个坏 token。`);
    }

    const mergedRowIndices = Array.from(
      new Set([...summary.rowIndices, ...missingSnapshot])
    ).sort((a, b) => a - b);
    setTranslationIssues({
      ...summary,
      rowIndices: mergedRowIndices,
      missingRows: writeFailedSnapshot,
      details: summary.details || []
    });

    if (mergedRowIndices.length === 0) {
      addLog('Retry Missing Cells: 重译后所有单元格均为目标语言。');
    } else {
      addLog(
        `Retry Missing Cells: 仍有 ${summary.cells} 个单元格或 ${missingSnapshot.length} 行未完全翻译，可继续重试。`
      );
    }
    } finally {
      setIsRetryingMissing(false);
    }
  };

  const retryCellsByKeys = async (
    items: Array<{ rowIdx: number; keys: Set<string> }>,
    label: string,
    options?: { forceTranslate?: boolean }
  ) => {
    const retryItems: Array<{
      rowIdx: number;
      keys: Set<string>;
      sanitizedRow: POCTRecord;
      placeholders: Record<string, Record<string, string> | null>;
    }> = [];

    items.forEach(({ rowIdx, keys }) => {
      if (rowIdx < 0 || rowIdx >= data.length) return;
      const row = data[rowIdx];
      const sanitizedRow: POCTRecord = {};
      const placeholdersForRow: Record<string, Record<string, string> | null> = {};
      keys.forEach((key) => {
        const value = row?.[key];
        if (typeof value !== 'string') {
          sanitizedRow[key] = value;
          return;
        }
        if (
          !value.trim() ||
          shouldLockCell(key, value) ||
          (!options?.forceTranslate && !shouldTranslateValue(value, key))
        ) {
          return;
        }
        const { sanitized, placeholders } = guardTranslationTokens(value);
        if (placeholders) {
          placeholdersForRow[key] = placeholders;
        }
        sanitizedRow[key] = sanitized;
      });
      if (Object.keys(sanitizedRow).length === 0) return;
      retryItems.push({
        rowIdx,
        keys,
        sanitizedRow,
        placeholders: placeholdersForRow
      });
    });

    if (retryItems.length === 0) {
      addLog(`${label}: 当前没有可重译的单元格。`);
      return;
    }

    addLog(`${label}: 针对 ${retryItems.length} 行重新翻译...`);

    const fallbackPriority = getFallbackPriority(
      translationModelPreference !== AUTO_OPENROUTER_MODEL
    );

    const baseProcessed =
      processedData.length === data.length
        ? [...processedData]
        : data.map(row => ({ ...row }));
    const updatedFlags =
      translatedFlags.length === data.length
        ? [...translatedFlags]
        : Array(data.length).fill(false);

    const totalBatches = Math.ceil(retryItems.length / RETRY_BATCH_SIZE);
    for (let i = 0; i < retryItems.length; i += RETRY_BATCH_SIZE) {
      const chunk = retryItems.slice(i, i + RETRY_BATCH_SIZE);
      const batchNum = Math.floor(i / RETRY_BATCH_SIZE) + 1;
      addLog(`${label}: Batch ${batchNum}/${totalBatches} 重译 ${chunk.length} 行...`);

      let translatedBatch: POCTRecord[] | null = null;
      for (const model of fallbackPriority) {
        try {
          translatedBatch = await translationHub.translateBatch({
            records: chunk.map(item => item.sanitizedRow),
            targetLang,
            options: {
              model,
              providerModel:
                model === 'cloudflare-ai' && isCloudflareAiModelValue(translationModelPreference)
                  ? getCloudflareAiProviderModel(translationModelPreference)
                  : model === 'deepseek' && isDeepSeekDirectModel(translationModelPreference)
                    ? getDeepSeekDirectProviderModel(translationModelPreference)
                    : undefined,
              openRouterModel:
                model === 'openrouter' && translationModelPreference !== AUTO_OPENROUTER_MODEL
                  ? translationModelPreference
                  : undefined
            }
          });
          addLog(`${label}: Batch ${batchNum} 使用 ${model} 成功。`);
          break;
        } catch (err) {
          addLog(`${label}: Batch ${batchNum} ${model} 失败 - ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (!translatedBatch) {
        addLog(`${label}: Batch ${batchNum} 所有备用模型失败，已跳过。`);
        continue;
      }

      chunk.forEach((item, index) => {
        const updated = translatedBatch?.[index];
        if (!updated) return;
        const rowIdx = item.rowIdx;
        const original = data[rowIdx];
        const merged: POCTRecord = { ...(baseProcessed[rowIdx] || original) };
        const placeholdersForRow = item.placeholders || {};

        item.keys.forEach((key) => {
          const originalValue = original[key];
          if (
            shouldLockCell(key, originalValue) ||
            (!options?.forceTranslate && !shouldTranslateValue(originalValue, key))
          ) {
            return;
          }
          if (updated[key] === undefined) return;
          const candidate = updated[key];
          merged[key] =
            typeof candidate === 'string'
              ? polishTranslation(
                  typeof originalValue === 'string' ? (originalValue as string) : '',
                  candidate,
                  targetLang
                )
              : candidate;
          if (typeof merged[key] === 'string' && placeholdersForRow[key]) {
            merged[key] = restoreTranslationTokens(
              merged[key] as string,
              placeholdersForRow[key]
            );
          }
        });

        baseProcessed[rowIdx] = normalizeTerminology(merged, targetLang, data[rowIdx]);
        updatedFlags[rowIdx] = true;
      });

      const synced = baseProcessed.map(row => ({ ...row }));
      setProcessedData(synced);
      setTranslatedFlags([...updatedFlags]);
      persistProgress(synced, [...updatedFlags], missingRowIndices, writeFailedRowIndices);
    }

    const rawSynced = baseProcessed.map(row => ({ ...row }));
    const { records: synced, fixedCells: keyedRetryAutoFixed } = autoRepairExcelPlaceholders(rawSynced);
    setProcessedData(synced);
    setTranslatedFlags([...updatedFlags]);
    const { refreshedMissing, refreshedWriteFailed, mergedRowIndices } = refreshTranslationIssues(synced);
    persistProgress(synced, [...updatedFlags], refreshedMissing, refreshedWriteFailed);
    setQualityReport(runQualityChecks(data, synced, { targetLang }));
    resetSampleReviewState();
    if (keyedRetryAutoFixed > 0) {
      addLog(`${label}: 已自动恢复 ${keyedRetryAutoFixed} 个坏 token。`);
    }
    if (mergedRowIndices.length === 0) {
      addLog(`${label}: 完成重译，当前无待补译内容。`);
    } else {
      addLog(`${label}: 完成重译，仍有 ${mergedRowIndices.length} 行待处理。`);
    }
  };

  const retryPlaceholderCells = async () => {
    const rawTarget =
      documentKind === 'excel' && processedData.length > 0 ? processedData : data;
    const { records: target, fixedCells, remainingCells } = autoRepairExcelPlaceholders(rawTarget, {
      mutateState: processedData.length > 0,
      logLabel: 'Retry Placeholder Cells'
    });
    if (!target.length) {
      addLog('Retry Placeholder Cells: 当前没有可扫描的数据。');
      return;
    }
    const issues = collectPlaceholderIssues(data, target);
    if (fixedCells > 0 && issues.length === 0) {
      addLog('Retry Placeholder Cells: 坏 token 已自动恢复，无需重翻。');
      return;
    }
    if (!issues.length) {
      addLog('Retry Placeholder Cells: 未检测到占位符残留。');
      return;
    }
    const rowMap = new Map<number, Set<string>>();
    issues.forEach((issue) => {
      if (!rowMap.has(issue.rowIndex)) {
        rowMap.set(issue.rowIndex, new Set());
      }
      rowMap.get(issue.rowIndex)!.add(issue.columnKey);
    });
    const items = Array.from(rowMap.entries()).map(([rowIdx, keys]) => ({
      rowIdx,
      keys
    }));
    addLog(`Retry Placeholder Cells: 实时检测到 ${issues.length} 个占位符异常单元格。`);
    if (fixedCells > 0) {
      addLog(`Retry Placeholder Cells: 已先自动修复 ${fixedCells} 个，仅对剩余 ${remainingCells} 个执行重翻。`);
    }
    await retryCellsByKeys(items, 'Retry Placeholder Cells', { forceTranslate: true });
  };

  const runStage = async (
    key: WorkflowStageKey,
    task: () => Promise<StageResult>
  ) => {
    if (activeStage) {
      addLog(`Stage[${activeStage}] 正在执行，请稍候...`);
      return;
    }
    setActiveStage(key);
    updateStageStatus(key, 'running');
    try {
      const result = await task();
      if (result === 'paused') {
        updateStageStatus(key, 'pending', '流程已暂停，可继续');
      } else {
        updateStageStatus(key, 'completed');
      }
      return result;
    } catch (error) {
      updateStageStatus(key, 'error', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setActiveStage(null);
    }
  };

  const handleDownload = () => {
    if (translationStatus === 'running') {
      addLog('当前仍在翻译中，请先暂停或等待完成再导出。');
      return;
    }

    if (documentKind === 'docx') {
      const context = docxContextRef.current;
      if (!context) return;
      const { pending, details } = buildDocxIssueDetails(context);
      setDocxIssueIndices(pending);
      setDocxIssueDetails(details);
      const blockingCount = details.filter((item) => isSevereDocxIssue(item)).length;
      const highPriorityCount = details.filter((item) => !item.lowPriority).length;
      if (details.length > 0) {
        addLog(
          `Docx download warning: 仍有 ${details.length} 段待优化问题（高优先级 ${highPriorityCount} 段，严重问题 ${blockingCount} 段），建议先 Retry Missing Segments 再导出。`
        );
      } else {
        addLog('Docx download gate: 审计通过，可导出。');
      }
      addLog(`Docx coverage: 导出覆盖 ${formatDocxCoverageSummary(context.coverage)}。`);
      const filename = `Translated_${targetLang}_${file?.name || 'Result.docx'}`;
      addLog(`Generating file: ${filename}`);
      exportDocxFile(context, filename);
      return;
    }

    if (documentKind === 'pdf') {
      const context = pdfContextRef.current;
      if (!context) return;
      const translatedCount = context.segments.filter((segment) => segment.translated.trim()).length;
      const untranslatedCount = context.segments.filter((segment) => {
        const source = String(segment.original || '').trim();
        const translated = String(segment.translated || '').trim();
        return Boolean(source) && !translated;
      }).length;
      if (translatedCount === 0) {
        addLog('PDF download blocked: 当前 PDF 还没有译文，请先运行翻译。');
        return;
      }
      if (untranslatedCount > 0) {
        addLog(`PDF download warning: 仍有 ${untranslatedCount} 个文本段没有译文，将先用原文占位导出。`);
      }
      const baseName = file?.name?.replace(/\.pdf$/i, '') || 'Result';
      const filename = `Translated_${targetLang}_${baseName}.pdf`;
      const textLayerStats = getPdfTextLayerStats(context);
      addLog(
        `PDF text layer: ${textLayerStats.selectableSegments}/${textLayerStats.totalSegments} 段将写入可复制文本层，${textLayerStats.imageFallbackSegments} 段回退为图片文本。`
      );
      addLog(`Generating file: ${filename}`);
      void exportPdfTranslationAsPdf(context, filename)
        .then(() => addLog(`PDF export completed: ${filename}`))
        .catch((error) => {
          addLog(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      return;
    }

    if (processedData.length === 0) return;
    const filename = `Translated_${targetLang}_${file?.name || 'Result.xlsx'}`;
    addLog(`Generating file: ${filename}`);
    const outputRows = processedData.map((row, idx) =>
      applyPostprocessRow(data[idx], row, targetLang)
    );
    const stats = exportToExcel(outputRows, filename, excelContext || undefined, {
      overwriteFormulas: true
    });
    if (stats?.overwrittenFormulas) {
      addLog(`已覆盖 ${stats.overwrittenFormulas} 个公式单元格以写入翻译结果。`);
    }
  };

  const handleDownloadPdfDocx = () => {
    if (translationStatus === 'running') {
      addLog('当前仍在翻译中，请先暂停或等待完成再导出。');
      return;
    }
    const context = pdfContextRef.current;
    if (!context) return;
    const translatedCount = context.segments.filter((segment) => segment.translated.trim()).length;
    if (translatedCount === 0) {
      addLog('PDF review DOCX blocked: 当前 PDF 还没有译文，请先运行翻译。');
      return;
    }
    const baseName = file?.name?.replace(/\.pdf$/i, '') || 'Result';
    const filename = `Translated_${targetLang}_${baseName}_review.docx`;
    addLog(`Generating review DOCX: ${filename}`);
    void exportPdfTranslationAsDocx(context, filename, targetLang)
      .then(() => addLog(`PDF review DOCX export completed: ${filename}`))
      .catch((error) => {
        addLog(`PDF review DOCX export failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const handlePause = () => {
    if (translationStatus !== 'running' || activeStage !== 'translate') return;
    pauseRequestedRef.current = true;
  };

  // Helper to determine if a value differs significantly (for highlighting)
  const hasChanged = (orig: any, trans: any) => {
    return String(orig).trim() !== String(trans).trim();
  };

  const isTranslating = translationStatus === 'running';
  const canResume =
    (documentKind === 'excel' || documentKind === 'docx' || documentKind === 'pdf') &&
    translationStatus === 'paused' &&
    activeStage === null;
  const showPauseResume = isTranslating || canResume;
  const pauseResumeLabel = isTranslating ? 'Pause' : 'Resume';
  const pauseResumeDisabled = isTranslating ? activeStage !== 'translate' : !canResume;
  const pauseResumeHandler = isTranslating ? handlePause : () => runTranslation('resume');
  const docxLowPriorityCount = useMemo(
    () => docxIssueDetails.filter((item) => item.lowPriority).length,
    [docxIssueDetails]
  );
  const docxHighPriorityCount = useMemo(
    () => docxIssueDetails.filter((item) => !item.lowPriority).length,
    [docxIssueDetails]
  );
  const docxBlockingIssueCount = useMemo(
    () => docxIssueDetails.filter((item) => isSevereDocxIssue(item)).length,
    [docxIssueDetails]
  );
  const pdfLowPriorityCount = useMemo(
    () => pdfIssueDetails.filter((item) => item.lowPriority).length,
    [pdfIssueDetails]
  );
  const pdfHighPriorityCount = useMemo(
    () => pdfIssueDetails.filter((item) => !item.lowPriority).length,
    [pdfIssueDetails]
  );
  const pdfHasTranslatedContent = documentKind === 'pdf' && pdfStats.translated > 0;
  const canDownload =
    documentKind === 'docx'
      ? docxContextRef.current !== null && translationStatus !== 'running'
      : documentKind === 'pdf'
      ? pdfContextRef.current !== null && translationStatus !== 'running' && pdfHasTranslatedContent
      : processedData.length > 0 && translationStatus !== 'running';
  const canRunTranslation =
    documentKind === 'docx'
      ? docxContextRef.current !== null
      : documentKind === 'pdf'
      ? pdfContextRef.current !== null
      : data.length > 0;
  const canRunQualityCheck =
    documentKind === 'docx'
      ? docxContextRef.current !== null
      : documentKind === 'pdf'
      ? pdfContextRef.current !== null
      : data.length > 0;
  const currentRowsForRetry =
    processedData.length === data.length && processedData.length > 0 ? processedData : data;
  const currentIssueSummary = useMemo(
    () => (documentKind === 'excel' ? summarizeUntranslated(currentRowsForRetry, targetLang) : translationIssues),
    [documentKind, currentRowsForRetry, targetLang, translationIssues]
  );
  const retryableRowsFromDetails = useMemo(() => {
    return buildRetryableExcelSummary({
      details: currentIssueSummary.details,
      originalRows: data,
      sourceRows: currentRowsForRetry,
      isRetryableCell: ({ columnKey, value, originalValue }) => {
        if (!value.trim()) return false;
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        return !shouldLockCell(columnKey, lockBasis) && !isNeutralToken(value.trim());
      }
    }).rowIndices;
  }, [currentIssueSummary.details, currentRowsForRetry, data]);
  const retryableCellCount = useMemo(() => {
    return buildRetryableExcelSummary({
      details: currentIssueSummary.details,
      originalRows: data,
      sourceRows: currentRowsForRetry,
      isRetryableCell: ({ columnKey, value, originalValue }) => {
        if (!value.trim()) return false;
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        return !shouldLockCell(columnKey, lockBasis) && !isNeutralToken(value.trim());
      }
    }).cellCount;
  }, [currentIssueSummary.details, currentRowsForRetry, data]);
  const untranslatedLocationPreview = useMemo(
    () => formatIssueLocationPreview(currentIssueSummary.details, 6),
    [currentIssueSummary.details, excelContext]
  );
  const docxIssuePreview = useMemo(
    () =>
      docxIssueDetails
        .slice(0, 5)
        .map((item) => `#${item.index + 1}: ${item.snippet}`)
        .join(' | '),
    [docxIssueDetails]
  );
  const pdfIssuePreview = useMemo(
    () =>
      pdfIssueDetails
        .slice(0, 5)
        .map((item) => `#${item.index + 1}: ${item.snippet}`)
        .join(' | '),
    [pdfIssueDetails]
  );
  const runtimeProtectedTermsCount = useMemo(
    () => parseRuntimeProtectedTerms(runtimeProtectedTermsRaw).length,
    [runtimeProtectedTermsRaw]
  );
  const docxRetryableCount = docxHighPriorityCount;
  const retryCandidates = [...retryableRowsFromDetails];
  const hasTranslationAlerts = (currentIssueSummary.rows > 0 || writeFailedRowIndices.length > 0) && documentKind === 'excel';
  const hasDocxIssues = documentKind === 'docx' && docxIssueDetails.length > 0;
  const hasPdfIssues = documentKind === 'pdf' && pdfIssueDetails.length > 0;
  const writeFailedRowPreview = formatRowRanges(writeFailedRowIndices);
  const isStringTranslating = stringStatus === 'running';
  const hasStringOutputs = Object.keys(stringOutputs).length > 0;
  const livePlaceholderIssues = useMemo(() => {
    if (documentKind !== 'excel') return [];
    const target = processedData.length > 0 ? processedData : data;
    if (!target.length) return [];
    return collectPlaceholderIssues(data, target);
  }, [documentKind, data, processedData]);
  const placeholderIssueCount = livePlaceholderIssues.length;
  const formatSnapshot = excelContext
    ? {
        sheetName:
          (excelContext.sheets?.length || 0) > 1
            ? `${excelContext.sheets.length} sheets`
            : excelContext.sheetName,
        rows: data.length,
        cols: Math.max(...(excelContext.sheets || [excelContext]).map((sheet) => sheet.headerKeys.length)),
        merges: (excelContext.sheets || [excelContext]).reduce(
          (count, sheet) => count + ((sheet.worksheet['!merges'] || []).length),
          0
        )
      }
    : null;
  const qualityRowsForDisplay = useMemo(() => {
    if (documentKind === 'docx' && docxContextRef.current) {
      return segmentsToQualityRows<DocxSegment>(
        docxContextRef.current.segments,
        (segment) => getDocxSegmentText(segment)
      );
    }
    if (documentKind === 'pdf' && pdfContextRef.current) {
      return segmentsToQualityRows<PdfSegment>(
        pdfContextRef.current.segments,
        (segment) => getPdfSegmentText(segment)
      );
    }
    return {
      sourceRows: data,
      targetRows: currentRowsForRetry
    };
  }, [documentKind, data, currentRowsForRetry, docxStats, pdfStats, docxIssueDetails, pdfIssueDetails]);
  const currentModelLabel =
    translationModelPreference === AUTO_OPENROUTER_MODEL
      ? 'Auto'
      : getTranslationModelLabel(translationModelPreference);
  const currentModelChainLabel =
    translationModelPreference === AUTO_OPENROUTER_MODEL
      ? usesDocumentQualityModels
        ? formatAutoModelChainLabel(
            capabilities.cloudflareAi ? cloudflareAiModels : [],
            activeDocumentQualityOpenRouterModels,
            capabilities.deepseek
          )
        : formatAutoModelChainLabel(
            capabilities.cloudflareAi ? cloudflareAiModels : [],
            activeOpenRouterModels,
            capabilities.deepseek
          )
      : currentModelLabel;
  const currentModelDisplayLabel =
    translationModelPreference === AUTO_OPENROUTER_MODEL
      ? `Auto (${currentModelChainLabel})`
      : currentModelLabel;
  const {
    qualityReport,
    setQualityReport,
    hasQualityReport,
    issueCaseCount,
    qualityFindings,
    sampleReviewCount,
    setSampleReviewCount,
    sampleReviewItems,
    sampleReviewAiSummary,
    sampleReviewAiMeta,
    sampleReviewAiResults,
    isRunningSampleReviewAi,
    resetSampleReviewState,
    runQualityCheck,
    clearQualityReport,
    exportQualityReport,
    exportDebugPackage,
    exportIssueDraft,
    exportIssueCases,
    exportRegressionCases,
    exportIssueAssetCandidates,
    promoteIssueCasesToTranslationMemory,
    clearIssueCases,
    saveQualityFindingCorrection,
    generateSampleReview,
    runAiSampleReview
  } = useQualityWorkflow({
    appVersion: APP_VERSION || PACKAGE_VERSION || 'unknown',
    documentKind,
    targetLang,
    data,
    processedData,
    translatedFlags,
    currentRowsForRetry,
    currentIssueSummary,
    qualityRowsForDisplay,
    formatSnapshot,
    currentModelLabel,
    fileName: file?.name,
    translationModelPreference,
    autoModelValue: AUTO_OPENROUTER_MODEL,
    addLog,
    setPreviewFocus,
    formatLocationLabel,
    formatIssueLocationPreview,
    formatExcelRowNumber,
    getDocxContext: () => docxContextRef.current,
    getPdfContext: () => pdfContextRef.current,
    buildDocxIssueDetails,
    buildPdfIssueDetails,
    syncDocumentIssueSummary,
    setDocxIssueIndices,
    setDocxIssueDetails,
    setPdfIssueIndices,
    setPdfIssueDetails,
    buildDocumentQualityRows,
    buildDocumentQualityInput,
    autoRepairExcelPlaceholders,
    refreshTranslationIssues,
    persistProgress,
    rememberTranslationPairs,
    downloadTextFile
  });
  const previewSourceRows =
    documentKind === 'docx' || documentKind === 'pdf'
      ? qualityRowsForDisplay.sourceRows
      : data;
  const previewData =
    documentKind === 'docx' || documentKind === 'pdf'
      ? qualityRowsForDisplay.targetRows
      : processedData.length > 0 ? processedData : data;
  const previewRowIndices = useMemo(() => {
    if (!previewData.length) return [];
    if (previewFocus) {
      const start = Math.max(0, previewFocus.rowIndex - 2);
      const end = Math.min(previewData.length - 1, previewFocus.rowIndex + 2);
      return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
    }
    const count = Math.min(10, previewData.length);
    return Array.from({ length: count }, (_, idx) => previewData.length - 1 - idx);
  }, [previewData, previewFocus]);
  const previewColumnKeys = useMemo(() => {
    if (!previewData.length) return [];
    const rowIndex = previewFocus?.rowIndex ?? previewRowIndices[0] ?? 0;
    const mergedKeys = Object.keys({ ...(previewSourceRows[rowIndex] || {}), ...(previewData[rowIndex] || {}) });
    if (!previewFocus) return mergedKeys.slice(0, 6);
    const base = mergedKeys.slice(0, 5);
    return Array.from(new Set([...base, previewFocus.columnKey])).slice(0, 6);
  }, [previewData, previewFocus, previewRowIndices, previewSourceRows]);
  const focusedPreviewCell = useMemo(() => {
    if (!previewFocus) return null;
    const translatedRecord = previewData[previewFocus.rowIndex] || {};
    const originalRecord = previewSourceRows[previewFocus.rowIndex] || {};
    const translatedValue = translatedRecord?.[previewFocus.columnKey];
    const originalValue = originalRecord?.[previewFocus.columnKey];
    return {
      locationLabel: formatLocationLabel(previewFocus.rowIndex, previewFocus.columnKey),
      translated:
        translatedValue === undefined || translatedValue === null ? '' : String(translatedValue),
      original:
        originalValue === undefined || originalValue === null ? '' : String(originalValue),
      changed: hasChanged(originalValue, translatedValue)
    };
  }, [previewFocus, previewData, previewSourceRows]);
  const severityBadgeClass = (severity?: QualitySeverity) => {
    switch (severity) {
      case 'high':
        return 'text-rose-300 border border-rose-500/30 bg-rose-500/10';
      case 'medium':
        return 'text-amber-300 border border-amber-500/30 bg-amber-500/10';
      case 'low':
        return 'text-sky-300 border border-sky-500/30 bg-sky-500/10';
      default:
        return 'text-slate-400 border border-slate-700 bg-slate-900/40';
    }
  };
  const reviewRiskBadgeClass = (risk?: SampleReviewAIResult['risk']) => {
    switch (risk) {
      case 'high':
        return 'text-rose-300 border border-rose-500/30 bg-rose-500/10';
      case 'medium':
        return 'text-amber-300 border border-amber-500/30 bg-amber-500/10';
      case 'low':
        return 'text-emerald-300 border border-emerald-500/30 bg-emerald-500/10';
      default:
        return 'text-slate-400 border border-slate-700 bg-slate-900/40';
    }
  };
  const reviewVerdictBadgeClass = (verdict?: SampleReviewAIResult['verdict']) => {
    switch (verdict) {
      case 'fail':
        return 'text-rose-300 border border-rose-500/30 bg-rose-500/10';
      case 'warning':
        return 'text-amber-300 border border-amber-500/30 bg-amber-500/10';
      case 'pass':
        return 'text-emerald-300 border border-emerald-500/30 bg-emerald-500/10';
      default:
        return 'text-slate-400 border border-slate-700 bg-slate-900/40';
    }
  };
  const modelReviewStageClass = (stage: typeof modelReviewStatus.stage) => {
    switch (stage) {
      case 'completed':
        return isLight
          ? 'text-emerald-700 border border-emerald-200 bg-emerald-50'
          : 'text-emerald-300 border border-emerald-500/30 bg-emerald-500/10';
      case 'error':
        return isLight
          ? 'text-rose-700 border border-rose-200 bg-rose-50'
          : 'text-rose-300 border border-rose-500/30 bg-rose-500/10';
      case 'sampling':
      case 'translating':
      case 'judging':
        return isLight
          ? 'text-indigo-700 border border-indigo-200 bg-indigo-50'
          : 'text-indigo-300 border border-indigo-500/30 bg-indigo-500/10';
      default:
        return isLight
          ? 'text-slate-600 border border-slate-200 bg-slate-50'
          : 'text-slate-400 border border-slate-700 bg-slate-900/40';
    }
  };
  const runStatusLabel =
    translationStatus === 'running'
      ? 'Running'
      : translationStatus === 'paused'
        ? 'Paused'
        : processingState.status === 'completed'
          ? 'Completed'
          : processingState.status === 'error'
            ? 'Error'
            : 'Idle';
  const isLight = theme === 'light';
  const pageClass = isLight
    ? 'min-h-screen flex flex-col bg-[radial-gradient(circle_at_84%_4%,rgba(99,102,241,0.12)_0,rgba(99,102,241,0.04)_28%,transparent_58%),linear-gradient(180deg,#f8fafc_0%,#f5f7fb_46%,#eef2f7_100%)] text-slate-900'
    : 'min-h-screen flex flex-col bg-[radial-gradient(circle_at_82%_0%,rgba(79,70,229,0.20)_0,rgba(15,23,42,0.18)_32%,transparent_62%),linear-gradient(180deg,#020617_0%,#070b16_48%,#0b1120_100%)] text-slate-200';
  const panelClass = isLight
    ? 'bg-white/92 border border-white/80 rounded-2xl p-6 shadow-[0_20px_54px_rgba(15,23,42,0.09)] ring-1 ring-slate-900/[0.035]'
    : 'bg-slate-900/82 border border-white/[0.07] rounded-2xl p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)] ring-1 ring-white/[0.03]';
  const detailsCardClass = isLight
    ? 'bg-white/92 border border-white/80 rounded-2xl shadow-[0_16px_42px_rgba(15,23,42,0.075)] ring-1 ring-slate-900/[0.035]'
    : 'bg-slate-900/82 border border-white/[0.07] rounded-2xl shadow-[0_20px_58px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.03]';
  const sectionDividerClass = isLight ? 'border-slate-200/80' : 'border-white/[0.07]';
  const headingMutedClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const mutedTextClass = isLight ? 'text-slate-500' : 'text-slate-500';
  const fieldClass = isLight
    ? 'w-full bg-white/90 border border-slate-200/80 rounded-xl px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 outline-none transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] [color-scheme:light]'
    : 'w-full bg-slate-950/70 border border-white/[0.16] rounded-xl px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500/35 focus:border-indigo-400/60 outline-none transition-all cursor-pointer [color-scheme:dark]';
  const textareaClass = isLight
    ? 'w-full min-h-[86px] bg-white/90 border border-slate-200/80 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 outline-none transition-all shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
    : 'w-full min-h-[86px] bg-white/[0.055] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400/40 outline-none transition-all';
  const disabledButtonClass = isLight
    ? 'bg-slate-100/90 text-slate-400 border border-slate-200/80 cursor-not-allowed'
    : 'bg-white/[0.06] text-slate-500 border border-white/[0.06] cursor-not-allowed';
  const neutralButtonClass = isLight
    ? 'bg-white/90 hover:bg-slate-50 text-slate-700 border border-slate-200/80 shadow-sm'
    : 'bg-white/[0.06] hover:bg-white/[0.09] text-slate-200 border border-white/[0.07]';
  const primaryInlineButtonClass = isLight
    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white border border-indigo-400/40 shadow-[0_12px_26px_rgba(79,70,229,0.20)]'
    : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white border border-indigo-400/25 shadow-[0_12px_26px_rgba(79,70,229,0.22)]';
  const metricCardClass = isLight
    ? 'bg-gradient-to-br from-white to-slate-50/90 rounded-xl p-3 border border-slate-200/75 shadow-[0_8px_22px_rgba(15,23,42,0.045)]'
    : 'bg-white/[0.035] rounded-xl p-3 border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]';
  const subCardClass = isLight
    ? 'rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm'
    : 'rounded-xl border border-white/[0.07] bg-white/[0.035] p-3';
  const nestedPanelClass = isLight
    ? 'rounded-xl border border-slate-200/80 bg-slate-50/80 p-3'
    : 'rounded-xl border border-white/[0.07] bg-slate-950/35 p-3';
  const modelReviewSamplesPreview =
    activeView === 'modelReview' ? buildModelReviewSamples(modelReviewCount).slice(0, 5) : [];
  const modelReviewSuccessfulCandidates =
    modelReviewResult?.candidates.filter((candidate) => candidate.translations.length > 0) || [];
  const modelReviewFailedCandidates =
    modelReviewResult?.candidates.filter((candidate) => candidate.error || candidate.translations.length === 0) || [];
  const modelReviewFailedJudges =
    modelReviewResult?.judges.filter((judge) => judge.error || judge.scores.length === 0) || [];
  const modelReviewScoredRows =
    modelReviewResult?.ranking.filter((row) => row.judgeCount > 0) || [];
  const hasModelReviewJudgeScores = modelReviewScoredRows.length > 0;
  const effectiveModelReviewStyle = getEffectiveModelReviewStyle();
  const modelReviewStyleMetricLabel =
    effectiveModelReviewStyle === 'medical-report'
      ? 'Cell'
      : effectiveModelReviewStyle === 'marketing-readable'
        ? 'Readable'
        : effectiveModelReviewStyle === 'terminology-faithful'
          ? 'Faithful'
          : effectiveModelReviewStyle === 'auto'
            ? 'Style'
            : 'Manual';

  return (
    <div className={pageClass} data-theme={theme}>
      <Header
        theme={theme}
        activeView={activeView}
        onNavigate={setActiveView}
        version={APP_VERSION}
        authStatus={authState.status}
        userEmail={authState.email}
        onThemeToggle={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
      />

      {activeView === 'modelReview' ? (
      <main className="flex-1 max-w-[1480px] mx-auto w-full p-4 lg:px-8 lg:py-8 space-y-6">
        <section className={`${panelClass} space-y-5`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Independent Workspace</p>
              <h2 className={`text-2xl font-semibold mt-2 ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>
                Multi-AI Review Lab
              </h2>
              <p className={`text-sm mt-2 max-w-3xl ${mutedTextClass}`}>
                从当前 Excel、DOCX 或 PDF 中抽样，分别调用多个翻译模型，再由高质量模型匿名评分。该流程只读，不会改写正文译文。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveView('translator')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
              >
                Back to Translator
              </button>
              <button
                type="button"
                onClick={exportModelReviewReport}
                disabled={!modelReviewResult || isRunningModelReview}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  !modelReviewResult || isRunningModelReview ? disabledButtonClass : primaryInlineButtonClass
                }`}
              >
                Export Markdown
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Source</p>
              <p className={`text-sm font-semibold mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {file?.name || 'No file uploaded'}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>{getModelReviewSourceLabel()}</p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Target</p>
	              <p className={`text-sm font-semibold mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{getTargetLanguageLabel(targetLang)}</p>
	              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
	                {MODEL_REVIEW_STYLE_LABELS[effectiveModelReviewStyle]}
	              </p>
	            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Candidates</p>
              <p className={`text-sm font-semibold mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.length} translation models
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {DEFAULT_MODEL_REVIEW_JUDGE_MODELS.length} anonymous judges
              </p>
            </div>
	            <div className={metricCardClass}>
	              <p className={`text-[11px] ${mutedTextClass}`}>Status</p>
	              <p className={`text-sm font-semibold mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
	                {isRunningModelReview ? 'Running' : modelReviewResult ? (hasModelReviewJudgeScores ? 'Completed' : 'No judge score') : 'Idle'}
	              </p>
	              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
	                {modelReviewResult
                    ? `${modelReviewSuccessfulCandidates.length}/${modelReviewResult.candidates.length} candidates translated`
                    : `${modelReviewCount} planned samples`}
	              </p>
	            </div>
          </div>
        </section>

        <section className={`${panelClass} space-y-5`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Run Review</h3>
              <p className={`text-xs mt-2 ${mutedTextClass}`}>
                先抽样，再翻译，再匿名评分。建议先从 5 条样本开始验证费用和速度。
              </p>
	            </div>
	            <div className="flex flex-wrap items-center gap-2">
	              <select
	                className={fieldClass}
	                value={modelReviewStyleSelection}
	                onChange={(e) => setModelReviewStyleSelection(e.target.value as ModelReviewStyleSelection)}
	                disabled={isRunningModelReview}
	                title="Review style"
	              >
	                <option value="recommended">
	                  Recommended ({MODEL_REVIEW_STYLE_LABELS[getRecommendedModelReviewStyle()]})
	                </option>
	                <option value="auto">{MODEL_REVIEW_STYLE_LABELS.auto}</option>
	                <option value="medical-report">{MODEL_REVIEW_STYLE_LABELS['medical-report']}</option>
	                <option value="ifu-manual">{MODEL_REVIEW_STYLE_LABELS['ifu-manual']}</option>
	                <option value="marketing-readable">{MODEL_REVIEW_STYLE_LABELS['marketing-readable']}</option>
	                <option value="terminology-faithful">{MODEL_REVIEW_STYLE_LABELS['terminology-faithful']}</option>
	              </select>
	              <select
	                className={fieldClass}
	                value={modelReviewCount}
                onChange={(e) => setModelReviewCount(Number(e.target.value))}
                disabled={isRunningModelReview}
              >
                {[5, 10, 20].map((value) => (
                  <option key={value} value={value}>{value} samples</option>
                ))}
              </select>
              <button
                onClick={runModelReview}
                disabled={!canRunModelReview() || isTranslating || isRunningModelReview}
                className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  !canRunModelReview() || isTranslating || isRunningModelReview
                    ? disabledButtonClass
                    : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-[0_12px_26px_rgba(109,40,217,0.20)]'
                }`}
              >
                {isRunningModelReview ? 'Running Translation + Anonymous Review...' : 'Run Translation + Anonymous Review'}
              </button>
            </div>
          </div>

	          <div className={`rounded-xl px-4 py-3 text-xs ${modelReviewStageClass(modelReviewStatus.stage)}`}>
	            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	              <div className="flex items-center gap-2">
	                {isRunningModelReview && (
	                  <span className="h-2 w-2 rounded-full bg-current animate-pulse"></span>
                )}
                <span className="font-semibold uppercase tracking-wider">{modelReviewStatus.stage}</span>
              </div>
              <span className="text-left sm:text-right">{modelReviewStatus.message}</span>
            </div>
            {isRunningModelReview && (
              <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${isLight ? 'bg-white/80' : 'bg-slate-950/60'}`}>
                <div className="h-full w-2/3 rounded-full bg-current opacity-60 animate-pulse"></div>
	              </div>
	            )}
	          </div>

		          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className={subCardClass}>
              <p className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Sample Preview</p>
              {modelReviewSamplesPreview.length === 0 ? (
                <p className={`text-xs mt-3 ${mutedTextClass}`}>上传文件后会在这里显示抽样预览。</p>
              ) : (
                <div className="space-y-2 mt-3 max-h-[280px] overflow-auto pr-1">
                  {modelReviewSamplesPreview.map((sample) => (
                    <div key={sample.id} className={nestedPanelClass}>
                      <p className={`text-[11px] font-semibold ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{sample.location}</p>
                      <p className={`text-[11px] mt-1 line-clamp-3 ${mutedTextClass}`}>{sample.sourceText}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
	            <div className={subCardClass}>
	              <p className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Model Set</p>
	              <div className="grid grid-cols-1 gap-2 mt-3">
	                {DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.map((model) => {
	                  const candidate = modelReviewResult?.candidates.find((item) => item.model === model);
	                  const statusLabel = candidate
	                    ? candidate.translations.length > 0
	                      ? 'Translated'
	                      : 'Failed'
	                    : isRunningModelReview
	                      ? 'Running'
	                      : 'Planned';
	                  return (
	                    <div key={model} className={nestedPanelClass}>
	                      <div className="flex items-center justify-between gap-3">
	                        <p className={`text-[11px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
	                          {getModelLabel(model)}
	                        </p>
	                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
	                          statusLabel === 'Translated'
	                            ? isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-300'
	                            : statusLabel === 'Failed'
	                              ? isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/10 text-rose-300'
	                              : isLight ? 'bg-slate-100 text-slate-500' : 'bg-white/[0.05] text-slate-400'
	                        }`}>
	                          {statusLabel}
	                        </span>
	                      </div>
	                    </div>
	                  );
	                })}
	              </div>
	            </div>
          </div>
        </section>

        {modelReviewResult && (
          <section className={`${panelClass} space-y-5`}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
	                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Review Results</h3>
	                <p className={`text-xs mt-2 ${mutedTextClass}`}>
	                  {modelReviewResult.samples.length} samples · {modelReviewSuccessfulCandidates.length}/{modelReviewResult.candidates.length} candidates translated · {modelReviewScoredRows.length} scored rows
	                </p>
	              </div>
              <button
                onClick={exportModelReviewReport}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${primaryInlineButtonClass}`}
              >
                Export Markdown
	              </button>
	            </div>

	            {(modelReviewFailedCandidates.length > 0 || modelReviewFailedJudges.length > 0 || !hasModelReviewJudgeScores) && (
	              <div className={`rounded-xl border px-4 py-3 text-xs ${
	                isLight
	                  ? 'border-amber-200 bg-amber-50/85 text-amber-800'
	                  : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
	              }`}>
	                <p className="font-semibold">
	                  {hasModelReviewJudgeScores ? 'Partial model availability issue' : 'Candidate translations completed, but anonymous scoring is unavailable'}
	                </p>
	                <p className="mt-1">
	                  {modelReviewFailedCandidates.length > 0 && `${modelReviewFailedCandidates.length} candidate model(s) failed. `}
	                  {modelReviewFailedJudges.length > 0 && `${modelReviewFailedJudges.length} judge model(s) returned no usable score. `}
	                  常见原因是 Cloudflare AI Gateway 模型未启用、当前节点不可用或模型临时不可用。
	                </p>
	              </div>
	            )}

	            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
	              {modelReviewResult.ranking.slice(0, 6).map((row, index) => (
	                <div key={row.model} className={metricCardClass}>
	                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-[11px] ${mutedTextClass}`}>#{index + 1}</p>
                      <p className={`text-sm font-semibold truncate ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
	                        {getModelLabel(row.model)}
	                      </p>
	                    </div>
	                    <p className={`text-lg font-semibold ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>
	                      {row.judgeCount > 0 ? row.overall.toFixed(2) : 'Not scored'}
	                    </p>
	                  </div>
	                  <p className={`text-[11px] mt-2 ${mutedTextClass}`}>
		                    {row.judgeCount > 0
		                      ? `Acc ${row.accuracy.toFixed(1)} · Fluency ${row.fluency.toFixed(1)} · ${modelReviewStyleMetricLabel} ${row.manualStyle.toFixed(1)} · Term ${row.terminology.toFixed(1)}`
		                      : '译文已生成，但匿名评审模型没有返回分数。'}
	                  </p>
	                </div>
	              ))}
	            </div>

	            {(modelReviewFailedCandidates.length > 0 || modelReviewFailedJudges.length > 0) && (
	              <details className={`rounded-xl border p-3 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-white/[0.07] bg-slate-950/30'}`}>
	                <summary className={`cursor-pointer list-none flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>
	                  <span>Call Diagnostics</span>
	                  <span>{modelReviewFailedCandidates.length + modelReviewFailedJudges.length} issue(s)</span>
	                </summary>
	                <div className="mt-3 space-y-2">
	                  {modelReviewFailedCandidates.map((candidate) => (
	                    <div key={`candidate-${candidate.model}`} className={nestedPanelClass}>
	                      <p className={`text-[11px] font-semibold ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
	                        Candidate · {getModelLabel(candidate.model)}
	                      </p>
	                      <p className={`text-[11px] mt-1 whitespace-pre-wrap break-words ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
	                        {candidate.error || 'No translations returned.'}
	                      </p>
	                    </div>
	                  ))}
	                  {modelReviewFailedJudges.map((judge) => (
	                    <div key={`judge-${judge.model}`} className={nestedPanelClass}>
	                      <p className={`text-[11px] font-semibold ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
	                        Judge · {getModelLabel(judge.model)}
	                      </p>
	                      <p className={`text-[11px] mt-1 whitespace-pre-wrap break-words ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
	                        {judge.error || 'No scores returned.'}
	                      </p>
	                    </div>
	                  ))}
	                </div>
	              </details>
	            )}

	            <details className={`rounded-xl border p-3 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-white/[0.07] bg-slate-950/30'}`}>
              <summary className={`cursor-pointer list-none flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>
                <span>Per-Sample Translation Comparison</span>
                <span>{modelReviewResult.samples.length} samples</span>
              </summary>
              <div className="space-y-4 mt-4 max-h-[620px] overflow-auto pr-1">
                {modelReviewResult.samples.map((sample) => (
                  <div key={sample.id} className={`${subCardClass} space-y-3`}>
                    <div>
                      <p className={`text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{sample.location}</p>
                      <p className={`text-[11px] mt-1 whitespace-pre-wrap break-words ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                        {sample.sourceText}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {modelReviewResult.candidates.map((candidate) => {
                        const translation = candidate.translations.find((item) => item.id === sample.id);
                        return (
                          <div key={`${sample.id}-${candidate.model}`} className={nestedPanelClass}>
                            <p className="text-slate-500 uppercase tracking-wider mb-2 text-[10px]">
                              {getModelLabel(candidate.model)}
                            </p>
                            <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words text-[11px]`}>
                              {translation?.translation || candidate.error || '(empty)'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </section>
        )}
      </main>
      ) : (
      <main className="flex-1 max-w-[1680px] mx-auto w-full p-4 lg:px-8 lg:py-8 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        <div className="lg:col-span-4 space-y-6">
          <section className={panelClass}>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
              Translation Settings
            </h2>
            
            <div className="space-y-4">
              <div className="space-y-4">
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Basics</h3>
              <label className="block">
                <div className={`mt-1 flex justify-center px-6 pt-6 pb-7 border-2 border-dashed rounded-2xl transition-colors group cursor-pointer relative ${
                  isLight
                    ? 'border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50/70 hover:border-indigo-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]'
                    : 'border-white/[0.08] bg-white/[0.025] hover:border-indigo-500/45'
                }`}>
                  <input
                    type="file"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".xlsx,.docx,.pdf"
                    onChange={handleFileUpload}
                    disabled={processingState.status === 'processing'}
                  />
                  <div className="space-y-1 text-center">
                    <svg className={`mx-auto h-12 w-12 transition-colors ${isLight ? 'text-indigo-300 group-hover:text-indigo-500' : 'text-slate-500 group-hover:text-indigo-400'}`} stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="text-sm font-medium text-indigo-500">
                      {file ? file.name : "Upload Source Document"}
                    </div>
                    <p className={`text-xs ${mutedTextClass}`}>
                      Supports Excel (.xlsx), Word (.docx), and text-based PDF documents
                    </p>
                  </div>
                </div>
              </label>

              <div>
                <label className={`block text-sm font-medium mb-2 ${headingMutedClass}`}>Target Language</label>
                <select 
                  className={fieldClass}
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value as TargetLanguage)}
                  disabled={processingState.status === 'processing'}
                >
                  {TARGET_LANGUAGE_OPTIONS.map((lang) => (
                    <option key={lang} value={lang}>
                      {getTargetLanguageLabel(lang)}
                    </option>
                  ))}
                </select>
              </div>
              {documentKind === 'docx' && docxContextRef.current && (
                <div className={`text-xs text-center space-y-1 ${mutedTextClass}`}>
                  <p>DOCX 语义段：{docxStats.total}，本次已翻译 {docxStats.translated}</p>
                  <p>覆盖范围：{formatDocxCoverageSummary(docxContextRef.current.coverage)}。</p>
                  {docxContextRef.current.coverageWarnings.length > 0 && (
                    <p>范围提示：{docxContextRef.current.coverageWarnings.join('；')}。</p>
                  )}
                </div>
              )}
              {documentKind === 'pdf' && pdfContextRef.current && (
                <div className={`text-xs text-center space-y-1 ${mutedTextClass}`}>
                  <p>PDF 页数：{pdfStats.pages}，文本段：{pdfStats.total}，本次已翻译 {pdfStats.translated}</p>
                  {pdfContextRef.current.coverageWarnings.length > 0 && (
                    <p>范围提示：{pdfContextRef.current.coverageWarnings.join('；')}。</p>
                  )}
                </div>
              )}

              <div>
                <label className={`block text-sm font-medium mb-2 ${headingMutedClass}`}>Translation Strategy</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTranslationMode('full')}
                    disabled={isTranslating}
                    className={`py-2.5 rounded-xl font-semibold border text-sm transition-all ${
                      translationMode === 'full'
                        ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-indigo-400/70 shadow-[0_10px_24px_rgba(79,70,229,0.22)]'
                        : isLight
                          ? 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 shadow-sm'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    Full Translation
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranslationMode('selective')}
                    disabled={isTranslating}
                    className={`py-2.5 rounded-xl font-semibold border text-sm transition-all ${
                      translationMode === 'selective'
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400/70 shadow-[0_10px_24px_rgba(5,150,105,0.20)]'
                        : isLight
                          ? 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300 shadow-sm'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    Smart Fill
                  </button>
                </div>
                <p className={`text-xs mt-1 ${mutedTextClass}`}>
                  全量翻译会重写所有行；智能补译仅对检测到非目标语言内容的行调用模型。
                </p>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${headingMutedClass}`}>Translation Model</label>
                <select
                  className={fieldClass}
                  value={translationModelPreference}
                  onChange={(e) => setTranslationModelPreference(e.target.value)}
                  disabled={isTranslating || isStringTranslating}
                >
                  <option value={AUTO_OPENROUTER_MODEL}>
                    {usesDocumentQualityModels
                      ? `Auto ${documentKind.toUpperCase()} Quality (${formatAutoModelChainLabel(capabilities.cloudflareAi ? cloudflareAiModels : [], activeDocumentQualityOpenRouterModels, capabilities.deepseek)})`
                      : `Auto (${formatAutoModelChainLabel(capabilities.cloudflareAi ? cloudflareAiModels : [], activeOpenRouterModels, capabilities.deepseek)})`}
                  </option>
                  {availableTranslationModels.map((model) => (
                    <option key={model} value={model}>
                      {getTranslationModelLabel(model)}
                    </option>
                  ))}
                </select>
                <p className={`text-xs mt-1 ${mutedTextClass}`}>
                  {usesDocumentQualityModels
                    ? `${documentKind.toUpperCase()} Auto 顺序：${formatAutoModelChainLabel(capabilities.cloudflareAi ? cloudflareAiModels : [], activeDocumentQualityOpenRouterModels, capabilities.deepseek)}；手工选择时只使用当前模型。`
                    : `Auto 会按 ${formatAutoModelChainLabel(capabilities.cloudflareAi ? cloudflareAiModels : [], activeOpenRouterModels, capabilities.deepseek)} 顺序自动切换；手工选择时只使用当前模型。String Resource 共用此处选择。`}
                  {currentSkippedOpenRouterModels.length > 0
                    ? ` 当前跳过：${currentSkippedOpenRouterModels.map(getModelLabel).join(', ')}。`
                    : ''}
                </p>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${headingMutedClass}`}>
                  Protected Terms (Do Not Translate)
                </label>
                <textarea
                  className={textareaClass}
                  value={runtimeProtectedTermsRaw}
                  onChange={(e) => setRuntimeProtectedTermsRaw(e.target.value)}
                  disabled={isTranslating}
                  placeholder={'One term per line. e.g.\nEhome Health Technology Co., Ltd.\nEHVT-75'}
                />
                <p className={`text-xs mt-1 ${mutedTextClass}`}>
                  本次生效 {runtimeProtectedTermsCount} 个自定义保护词；会自动保存到本地，下次继续使用。
                </p>
              </div>

              <div className={`space-y-2 text-xs ${mutedTextClass}`}>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={translationMemoryEnabled}
                      onChange={(e) => setTranslationMemoryEnabled(e.target.checked)}
                      disabled={isTranslating}
                      className="h-4 w-4 accent-indigo-500"
                    />
                    <span>Use Translation Memory</span>
                  </label>
                  <button
                    type="button"
                    onClick={clearTranslationMemoryData}
                    disabled={isTranslating || translationMemoryCount === 0}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                      isTranslating || translationMemoryCount === 0
                        ? disabledButtonClass
                        : neutralButtonClass
                    }`}
                  >
                    Clear TM
                  </button>
                </div>
                <p>
                  Translation Memory: {translationMemoryCount} 条本地记忆；关闭后本次翻译不会复用，也不会写入新记忆。
                </p>
              </div>
              </div>

              <div className={`space-y-3 pt-4 border-t ${sectionDividerClass}`}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Primary Actions</h3>
                {savedSnapshot && processedData.length === 0 && (
                  <div className={`space-y-2 rounded-xl border p-3 ${isLight ? 'border-amber-200 bg-amber-50' : 'border-amber-500/30 bg-amber-500/10'}`}>
                    <p className={`text-xs ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                      Found saved translation progress for this file. You can restore it or ignore it and start over.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={applySavedProgress}
                        className="w-full py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white text-sm font-semibold shadow-[0_10px_22px_rgba(217,119,6,0.18)]"
                      >
                        Restore Progress
                      </button>
                      <button
                        type="button"
                        onClick={discardSavedProgress}
                        className={`w-full py-2 rounded-xl text-sm font-semibold ${isLight ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200' : 'bg-white/[0.06] hover:bg-white/[0.09] text-slate-100 border border-white/[0.08]'}`}
                      >
                        Start Over
                      </button>
                    </div>
                  </div>
                )}
                <button 
                  onClick={() => runTranslation('fresh')}
                  disabled={!canRunTranslation || isTranslating}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all shadow-lg ${
                    !canRunTranslation || isTranslating
                    ? disabledButtonClass
                    : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-[0_14px_28px_rgba(79,70,229,0.24)] active:scale-[0.99]'
                  }`}
                  >
                    {isTranslating ? 'Translating...' : 'Run Global Translation'}
                  </button>

                {showPauseResume && (
                  <button
                    onClick={pauseResumeHandler}
                    disabled={pauseResumeDisabled}
                    className={`w-full py-3 rounded-xl font-semibold transition-all shadow-lg ${
                      pauseResumeDisabled
                        ? disabledButtonClass
                        : isTranslating
                          ? isLight ? 'bg-slate-900 hover:bg-slate-800 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
                          : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    }`}
                  >
                    {pauseResumeLabel}
                  </button>
                )}

                {(
                  documentKind === 'docx'
                    ? docxContextRef.current !== null
                    : documentKind === 'pdf'
                    ? pdfContextRef.current !== null
                    : processedData.length > 0
                ) && (
                  <>
                    <button
                      onClick={handleDownload}
                      disabled={!canDownload}
                      className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all shadow-lg ${
                        !canDownload
                          ? disabledButtonClass
                          : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white active:scale-[0.99] shadow-[0_14px_28px_rgba(5,150,105,0.20)]'
                      }`}
                    >
                      {translationStatus === 'running'
                        ? 'Wait for Translation...'
                        : documentKind === 'pdf'
                          ? 'Download Translated PDF'
                          : 'Download Translated Document'}
                    </button>
                    {documentKind === 'pdf' && (
                      <button
                        onClick={handleDownloadPdfDocx}
                        disabled={!canDownload}
                        className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                          !canDownload
                            ? disabledButtonClass
                            : isLight
                              ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600'
                        }`}
                      >
                        Download Review DOCX
                      </button>
                    )}
                    {documentKind === 'docx' && docxBlockingIssueCount > 0 && translationStatus !== 'running' && (
                      <p className={`text-[11px] text-center ${isLight ? 'text-rose-600' : 'text-rose-300'}`}>
                        检测到 {docxBlockingIssueCount} 段严重问题（源语言残留/占位符），建议先重译后再下载。
                      </p>
                    )}
                  </>
                )}
              </div>

              {hasTranslationAlerts && (
                <div className={`text-xs text-center space-y-1 ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                  {currentIssueSummary.cells > 0 && (
                    <p>检测到 {currentIssueSummary.cells} 个非目标语言单元格（{currentIssueSummary.rows} 行）。</p>
                  )}
                  {currentIssueSummary.cells > 0 && (
                    <p>
                      可自动重译 {retryableCellCount} 个单元格（{retryCandidates.length} 行）。
                    </p>
                  )}
                  {currentIssueSummary.cells > 0 && untranslatedLocationPreview && (
                    <p className={`text-[11px] ${headingMutedClass}`}>
                      定位示例：{untranslatedLocationPreview}
                    </p>
                  )}
                  {writeFailedRowIndices.length > 0 && (
                    <p>有 {writeFailedRowIndices.length} 行未写入（示例行：{writeFailedRowPreview || 'N/A'}）。</p>
                  )}
                  <button
                    onClick={() => retryMissingRows(currentIssueSummary.rowIndices)}
                    className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white rounded-xl font-semibold text-sm transition-all shadow-[0_12px_26px_rgba(217,119,6,0.18)]"
                    disabled={translationStatus === 'running' || isRetryingMissing}
                  >
                    {isRetryingMissing ? 'Retrying...' : 'Retry Missing Cells'}
                  </button>
                  {retryCandidates.length === 0 && currentIssueSummary.cells > 0 && (
                    <p className={`text-[11px] ${mutedTextClass}`}>当前缺失项多为锁定字段或符号列，无法自动重译。</p>
                  )}
                </div>
              )}
              {hasDocxIssues && (
                <div className={`text-xs text-center space-y-1 ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                  <p>DOCX 审计：仍有 {docxIssueDetails.length} 个语义段存在异常。</p>
                  <p className={`text-[11px] ${headingMutedClass}`}>
                    建议重译 {docxRetryableCount} 段；低优先级短文本 {docxLowPriorityCount} 段。
                  </p>
                  {docxIssuePreview && (
                    <p className={`text-[11px] ${headingMutedClass}`}>
                      示例：{docxIssuePreview}
                    </p>
                  )}
                  <button
                    onClick={retryDocxSegments}
                    className="w-full py-2 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white rounded-xl font-semibold transition-all shadow-[0_12px_26px_rgba(217,119,6,0.18)]"
                    disabled={translationStatus === 'running'}
                  >
                    Retry Missing Segments
                  </button>
                </div>
              )}
              {hasPdfIssues && (
                <div className={`text-xs text-center space-y-1 ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                  <p>PDF 审计：仍有 {pdfIssueDetails.length} 个文本段存在异常。</p>
                  <p className={`text-[11px] ${headingMutedClass}`}>
                    建议重译 {pdfHighPriorityCount} 段；低优先级短文本 {pdfLowPriorityCount} 段。
                  </p>
                  {pdfIssuePreview && (
                    <p className={`text-[11px] ${headingMutedClass}`}>
                      示例：{pdfIssuePreview}
                    </p>
                  )}
                  <button
                    onClick={retryPdfSegments}
                    className="w-full py-2 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white rounded-xl font-semibold transition-all shadow-[0_12px_26px_rgba(217,119,6,0.18)]"
                    disabled={translationStatus === 'running'}
                  >
                    Retry Missing PDF Segments
                  </button>
                </div>
              )}

              <div className={`space-y-2 pt-3 border-t ${sectionDividerClass}`}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Quality Check</h3>
                {documentKind === 'docx' && (
                  <p className={`text-[11px] ${mutedTextClass}`}>
                    DOCX 可运行质量检查并显示 Retry Missing Segments。
                  </p>
                )}
                {documentKind === 'pdf' && (
                  <p className={`text-[11px] ${mutedTextClass}`}>
                    PDF 可运行质量检查并显示 Retry Missing PDF Segments。
                  </p>
                )}
                <button
                  onClick={runQualityCheck}
                  disabled={!canRunQualityCheck}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                    !canRunQualityCheck
                      ? disabledButtonClass
                      : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-[0_12px_26px_rgba(79,70,229,0.22)]'
                  }`}
                >
                  Run Quality Check
                </button>
                {documentKind === 'excel' && (
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={applyQualityFixes}
                    disabled={processedData.length === 0}
                    className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                      processedData.length === 0
                        ? disabledButtonClass
                        : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_12px_26px_rgba(5,150,105,0.18)]'
                    }`}
                  >
                    Apply Cleanup
                  </button>
                  <button
                    onClick={retryPlaceholderCells}
                    disabled={!placeholderIssueCount || translationStatus === 'running'}
                    className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                      !placeholderIssueCount || translationStatus === 'running'
                        ? disabledButtonClass
                        : 'bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white shadow-[0_12px_26px_rgba(217,119,6,0.18)]'
                    }`}
                  >
                    Retry Placeholder Cells
                  </button>
                  {documentKind === 'excel' && placeholderIssueCount > 0 && (
                    <p className={`text-[11px] text-center ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                      当前结果中实时检测到 {placeholderIssueCount} 个占位符异常单元格，可直接重译，无需先运行 Quality Check。
                    </p>
                  )}
                </div>
                )}
              </div>
            </div>
          </section>

        </div>

        <div className="lg:col-span-8 space-y-6">
          <section className={`${panelClass} space-y-4`}>
             <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
               <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-emerald-500 rounded-full"></span>
                  Run Monitor
                </h2>
                <p className={`text-xs mt-1 ${mutedTextClass}`}>Current status, batch progress, and live translation logs.</p>
               </div>
              <button onClick={() => setLogs([])} className={`text-xs ${isLight ? 'text-indigo-600 hover:text-indigo-800' : 'text-slate-500 hover:text-slate-300'}`}>Clear Logs</button>
             </div>
             <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
              <div className={metricCardClass}>
                <p className={`text-[11px] ${mutedTextClass}`}>Status</p>
                <p className={`text-lg font-semibold mt-1 ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>{runStatusLabel}</p>
              </div>
              <div className={metricCardClass}>
                <p className={`text-[11px] ${mutedTextClass}`}>Batch</p>
                <p className={`text-lg font-semibold mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{processingState.currentBatch}</p>
              </div>
              <div className={metricCardClass}>
                <p className={`text-[11px] ${mutedTextClass}`}>Processed</p>
                <p className={`text-lg font-semibold mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{processingState.progress}%</p>
              </div>
              <div className={metricCardClass}>
                <p className={`text-[11px] ${mutedTextClass}`}>Model</p>
                <p className={`text-lg font-semibold mt-1 truncate ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{currentModelDisplayLabel}</p>
             </div>
             </div>
             <LogConsole logs={logs} theme={theme} />
          </section>

          <QualityReportPanel
            qualityReport={qualityReport}
            hasQualityReport={hasQualityReport}
            formatSnapshot={formatSnapshot}
            currentIssueSummary={currentIssueSummary}
            issueCaseCount={issueCaseCount}
            qualityFindings={qualityFindings}
            sampleReviewCount={sampleReviewCount}
            sampleReviewItems={sampleReviewItems}
            sampleReviewAiSummary={sampleReviewAiSummary}
            sampleReviewAiMeta={sampleReviewAiMeta}
            sampleReviewAiResults={sampleReviewAiResults}
            processedDataLength={processedData.length}
            isRunningSampleReviewAi={isRunningSampleReviewAi}
            isLight={isLight}
            panelClass={panelClass}
            metricCardClass={metricCardClass}
            nestedPanelClass={nestedPanelClass}
            subCardClass={subCardClass}
            headingMutedClass={headingMutedClass}
            mutedTextClass={mutedTextClass}
            disabledButtonClass={disabledButtonClass}
            neutralButtonClass={neutralButtonClass}
            primaryInlineButtonClass={primaryInlineButtonClass}
            sectionDividerClass={sectionDividerClass}
            clearQualityReport={clearQualityReport}
            exportQualityReport={exportQualityReport}
            exportDebugPackage={exportDebugPackage}
            exportIssueDraft={exportIssueDraft}
            exportIssueCases={exportIssueCases}
            exportRegressionCases={exportRegressionCases}
            exportIssueAssetCandidates={exportIssueAssetCandidates}
            promoteIssueCasesToTranslationMemory={promoteIssueCasesToTranslationMemory}
            clearIssueCases={clearIssueCases}
            saveQualityFindingCorrection={saveQualityFindingCorrection}
            jumpToPreviewCell={jumpToPreviewCell}
            setSampleReviewCount={setSampleReviewCount}
            generateSampleReview={generateSampleReview}
            runAiSampleReview={runAiSampleReview}
            severityBadgeClass={severityBadgeClass}
            reviewRiskBadgeClass={reviewRiskBadgeClass}
            reviewVerdictBadgeClass={reviewVerdictBadgeClass}
          />

          <details ref={previewDetailsRef} className={detailsCardClass}>
            <summary className={`cursor-pointer list-none px-6 py-4 flex items-center justify-between text-sm font-semibold uppercase ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
              <span>String Resource Translator</span>
              <span className="text-[10px] text-slate-500">Optional</span>
            </summary>
            <div className={`px-6 pb-6 pt-2 border-t space-y-3 ${sectionDividerClass}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 pr-3">
                  仅翻译中文说明，保留占位符、缩写、型号与符号（如 %s / LIS / EHBT-75 / {0}）；`translatable="false"` 属性会保留，但中文内容仍会翻译。
                </p>
              </div>
              <textarea
                className={isLight ? 'w-full bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[140px] shadow-sm' : 'w-full bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[140px]'}
                placeholder="粘贴 <string name=...>中文</string> 文本；可输出全部语言，或只输出一个目标语言。"
                value={stringInput}
                onChange={(e) => setStringInput(e.target.value)}
                disabled={isStringTranslating}
              />
              <div className="flex flex-col gap-2">
                <label className="text-xs text-slate-400">字符串输出语言</label>
                <select
                  className={isLight ? 'bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 shadow-sm' : 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200'}
                  value={stringOutputTarget}
                  onChange={(e) => setStringOutputTarget(e.target.value)}
                  disabled={isStringTranslating}
                >
                  <option value={ALL_STRING_TARGETS}>全部语言（{STRING_TARGET_LANGS.length} 种）</option>
                  {STRING_TARGET_LANGS.map((lang) => (
                    <option key={lang} value={lang}>
                      仅输出 {getTargetLanguageLabel(lang)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  日期/时间格式模板（如 `M月d日E`、`yyyy年M月d日`）会按规则本地转换，不走模型。
                </p>
                <p className="text-[11px] text-slate-500">
                  使用左侧 Translation Model：{currentModelDisplayLabel}；这里只单独选择输出语言。
                </p>
              </div>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={translateStringResources}
                    disabled={!stringInput.trim() || isStringTranslating}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all shadow-lg ${
                      !stringInput.trim() || isStringTranslating
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 active:scale-95'
                    }`}
                  >
                    {isStringTranslating
                      ? 'Translating...'
                      : stringOutputTarget === ALL_STRING_TARGETS
                        ? `输出全部语言（${STRING_TARGET_LANGS.length} 种）`
                        : `输出 ${stringOutputTarget}`}
                  </button>
                  <button
                    onClick={clearStringResources}
                    disabled={isStringTranslating || (!stringInput.trim() && !hasStringOutputs)}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                      isStringTranslating || (!stringInput.trim() && !hasStringOutputs)
                        ? disabledButtonClass
                        : 'bg-rose-600/90 hover:bg-rose-500 text-white border border-rose-400/20'
                    }`}
                  >
                    清空输入与结果
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={stringAutoFix}
                    onChange={(e) => setStringAutoFix(e.target.checked)}
                    disabled={isStringTranslating}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                  />
                  自动修复空格
                </label>
              </div>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                <span className="text-xs text-slate-500">
                  本地历史：{stringHistoryCount} 条
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={exportCurrentStringOutput}
                    disabled={!hasStringOutputs || isStringTranslating}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      !hasStringOutputs || isStringTranslating
                        ? disabledButtonClass
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    导出当前结果
                  </button>
                  <button
                    onClick={exportStringHistory}
                    disabled={stringHistoryCount === 0 || isStringTranslating}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      stringHistoryCount === 0 || isStringTranslating
                        ? disabledButtonClass
                        : neutralButtonClass
                    }`}
                  >
                    导出历史记录
                  </button>
                  <button
                    onClick={clearStringHistoryData}
                    disabled={stringHistoryCount === 0 || isStringTranslating}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      stringHistoryCount === 0 || isStringTranslating
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-rose-600/80 hover:bg-rose-500 text-white'
                    }`}
                  >
                    清空历史
                  </button>
                </div>
              </div>
              {stringQualitySummary && (
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
                  {stringQualitySummary}
                </div>
              )}
              {stringError && (
                <div className="text-xs text-rose-300 space-y-1">
                  <p>{stringError}</p>
                  {stringErrorDetails && (
                    <p className="text-rose-200/80">{stringErrorDetails}</p>
                  )}
                </div>
              )}
              {hasStringOutputs && (
                <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t ${sectionDividerClass}`}>
                  {selectedStringTargetLangs.map((lang) => (
                    <div
                      key={lang}
                      className={isLight ? 'bg-slate-50 border border-slate-200 rounded-lg p-3' : 'bg-slate-950/50 border border-slate-800 rounded-lg p-3'}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400 uppercase">
                          {lang}
                        </span>
                        <button
                          onClick={() => copyStringOutput(lang)}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                          disabled={!stringOutputs[lang]}
                        >
                          Copy
                        </button>
                      </div>
                      <textarea
                        readOnly
                        className={isLight ? 'w-full bg-white border border-slate-200 rounded-md p-2 text-xs text-slate-900 min-h-[120px] resize-vertical' : 'w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-xs text-slate-200 min-h-[120px] resize-vertical'}
                        value={stringOutputs[lang] || ''}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          <details className={detailsCardClass}>
            <summary className={`cursor-pointer list-none px-6 py-4 flex items-center justify-between text-sm font-semibold uppercase ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
              <span>Live Data Preview</span>
              <span className="text-[10px] text-slate-500">
                {previewData.length > 0 ? `${previewData.length} rows` : 'No data'}
              </span>
            </summary>
          <section
            ref={previewSectionRef}
            className={`border-t overflow-hidden flex-1 max-h-[460px] ${sectionDividerClass}`}
          >
            <div className={`p-4 border-b flex justify-between items-center ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-900/50'}`}>
              <div className="flex items-center gap-4">
                <h2 className={`text-sm font-semibold uppercase ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>Live Data Preview</h2>
                {previewData.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={showComparison}
                        onChange={() => setShowComparison(!showComparison)}
                      />
                      <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      <span className={`ml-2 text-xs font-medium ${headingMutedClass}`}>Verify Mode (Show Original)</span>
                    </label>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {previewFocus && (
                  <div className={`flex items-center gap-2 text-[10px] ${isLight ? 'text-indigo-600' : 'text-indigo-300'}`}>
                    <span>Focused: {formatLocationLabel(previewFocus.rowIndex, previewFocus.columnKey)}</span>
                    <button
                      onClick={() => setPreviewFocus(null)}
                      className={isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-300'}
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className={`text-[10px] ${mutedTextClass}`}>
                  {previewData.length > 0
                    ? previewFocus
                      ? `Showing ${previewRowIndices.length} focused rows`
                      : `Showing last ${Math.min(10, previewData.length)} of ${previewData.length} rows`
                    : 'No data'}
                </div>
              </div>
            </div>

            {focusedPreviewCell && (
              <div className={`px-4 py-3 border-b ${isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/40'}`}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className={`text-[11px] font-semibold uppercase tracking-wider ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>
                      Focused Cell
                    </p>
                    <p className={`text-xs mt-1 ${headingMutedClass}`}>{focusedPreviewCell.locationLabel}</p>
                  </div>
                  <span className={`text-[10px] ${mutedTextClass}`}>
                    {focusedPreviewCell.changed ? 'Showing translated value' : 'Original and translated are identical'}
                  </span>
                </div>
                <div className={`grid gap-3 ${showComparison ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                  <div className={nestedPanelClass}>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Target</p>
                    <p className={`text-sm whitespace-pre-wrap break-words ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                      {focusedPreviewCell.translated || '(empty)'}
                    </p>
                  </div>
                  {showComparison && (
                    <div className={nestedPanelClass}>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Source</p>
                      <p className={`text-sm whitespace-pre-wrap break-words ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                        {focusedPreviewCell.original || '(empty)'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className={`overflow-auto h-[410px] scrollbar-thin ${isLight ? 'scrollbar-thumb-slate-200' : 'scrollbar-thumb-slate-800'}`}>
              {previewData.length === 0 ? (
                <div className={`h-full flex items-center justify-center text-sm italic ${isLight ? 'text-slate-400' : 'text-slate-600'}`}>
                  Waiting for data...
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-full table-fixed">
                  <thead className={`sticky top-0 text-[10px] font-semibold uppercase z-10 shadow-sm ${isLight ? 'bg-slate-50 text-slate-500' : 'bg-slate-800 text-slate-400'}`}>
                    <tr>
                      <th className={`px-4 py-3 border-b w-20 ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>Row</th>
                      {previewColumnKeys.map(key => (
                        <th key={key} className={`px-4 py-3 border-b truncate w-40 ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={isLight ? 'divide-y divide-slate-100' : 'divide-y divide-slate-800'}>
                    {previewRowIndices.map((actualIndex) => {
                      const record = previewData[actualIndex] || {};
                      const originalRecord = previewSourceRows[actualIndex] || {};
                      const isFocusedRow = previewFocus?.rowIndex === actualIndex;

                      return (
                        <tr
                          key={actualIndex}
                          className={`${isLight ? 'hover:bg-indigo-50/60' : 'hover:bg-slate-800/30'} transition-colors ${isFocusedRow ? 'bg-indigo-500/10' : ''}`}
                        >
                          <td className={`px-4 py-3 border-b text-[11px] text-slate-500 font-mono ${isLight ? 'border-slate-100' : 'border-slate-800/50'}`}>
                            R{formatExcelRowNumber(actualIndex)}
                          </td>
                          {previewColumnKeys.map((key, j) => {
                            const val = record[key];
                            const origVal = originalRecord ? originalRecord[key] : '';
                            const isDiff = hasChanged(origVal, val);
                            const isFocusedCell =
                              previewFocus?.rowIndex === actualIndex && previewFocus.columnKey === key;
                            
                            return (
                              <td
                                key={j}
                                className={`px-4 py-3 border-b ${isLight ? 'border-slate-100' : 'border-slate-800/50'} ${isFocusedCell ? 'bg-indigo-500/20 ring-1 ring-inset ring-indigo-400' : ''}`}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <span
                                    title={String(val)}
                                    className={`text-xs truncate whitespace-nowrap ${isDiff ? (isLight ? 'text-indigo-700 font-medium' : 'text-indigo-300 font-medium') : (isLight ? 'text-slate-700' : 'text-slate-300')}`}
                                  >
                                    {String(val)}
                                  </span>
                                  
                                  {showComparison && isDiff && (
                                    <span
                                      title={String(origVal)}
                                      className={`text-[10px] text-slate-500 truncate whitespace-nowrap px-1.5 py-0.5 rounded border w-fit max-w-full ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/50 border-slate-700/50'}`}
                                    >
                                      {String(origVal)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          </details>

        </div>
      </main>
      )}
    </div>
  );
};

export default App;
