
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import { parseExcelFile, exportToExcel } from './utils/excel';
import type { ExcelContext } from './utils/excel';
import {
  parseDocxFile,
  exportDocxFile,
  DocxContext,
  getDocxSegmentText,
  setDocxSegmentText
} from './utils/docx';
import {
  parsePdfFile,
  exportPdfTranslationAsDocx,
  getPdfSegmentText,
  setPdfSegmentText,
  type PdfContext
} from './utils/pdf';
import { TranslationHub } from './services/translationHub';
import { RuleEngine } from './services/ruleEngine';
import { MultiAIJudge } from './services/multiAIJudge';
import { SampleReviewAuditService } from './services/sampleReviewAuditService';
import { detectUntranslatedCells, isLikelyTargetLanguage, isNeutralToken } from './utils/language';
import type { UntranslatedCell } from './utils/language';
import { summarizeUntranslated } from './utils/untranslated';
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
  stripProtectedTerms
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
import { collectPlaceholderIssues, hasGlueIssue, hasSpacingIssue, runQualityChecks, QualityReport, PLACEHOLDER_REGEX, type QualitySeverity } from './utils/quality';
import {
  ClinicalRule,
  CrossCheckResult,
  MissingCombination,
  POCTRecord,
  ProcessingState,
  ReviewSample,
  SampleReviewAIResult,
  TargetLanguage,
  WorkflowStageKey,
  WorkflowStageState
} from './types';

// Batch size kept small for reliability with large column counts
const BATCH_SIZE = 5;
const DOCX_BATCH_SIZE = 20;
const RETRY_BATCH_SIZE = 5;
const STRING_BATCH_SIZE = 40;
const SOURCE_LANG_REGEX = /[\u4e00-\u9fff]/;
const STRING_TARGET_LANGS: TargetLanguage[] = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Turkish',
  'Russian',
  'Portuguese'
];
const ALL_STRING_TARGETS = '__ALL_STRING_TARGETS__';
const PROTECTED_TERMS_STORAGE_KEY = 'poct.protected_terms';
const UI_THEME_STORAGE_KEY = 'poct.ui_theme';
const DEFAULT_OPENROUTER_MODELS = [
  'google/gemini-3-flash-preview',
  'qwen/qwen3.6-plus',
  'deepseek/deepseek-v3.2'
] as const;
const AUTO_OPENROUTER_MODEL = '__AUTO_OPENROUTER__';
const OPENROUTER_MODEL_LABELS: Record<string, string> = {
  'google/gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
  'deepseek/deepseek-v3.2': 'DeepSeek V3.2'
};
type ThemeMode = 'light' | 'dark';
type TranslationMemoryStats = {
  hits: number;
  deduped: number;
  stored: number;
};

const parseOpenRouterModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_OPENROUTER_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => item.trim()).filter(Boolean)
    : [...DEFAULT_OPENROUTER_MODELS];
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
  text: string;
  snippet: string;
  chineseChars: number;
  lowPriority: boolean;
  issueType: 'source' | 'placeholder' | 'glue';
};

type QualityFinding = {
  id: string;
  category: 'nonTarget' | 'chinese' | 'emptyTranslation' | 'placeholder' | 'idMismatch' | 'spacing' | 'structureMismatch';
  rowIndex: number;
  columnKey: string;
  locationLabel: string;
  original: string;
  translated: string;
  description: string;
  severity?: QualitySeverity;
};

type SampleReviewItem = {
  id: string;
  rowIndex: number;
  columnKey: string;
  locationLabel: string;
  original: string;
  translated: string;
  reason: string;
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
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isNeutralToken(trimmed) || isLikelyIdentifier(trimmed)) return false;
  if (shouldLockCell(key, value)) return false;
  return !isLikelyTargetLanguage(trimmed, targetLang);
};

const rowNeedsTranslation = (row: POCTRecord, targetLang: TargetLanguage) => {
  return Object.entries(row).some(([key, value]) => cellNeedsTranslation(key, value, targetLang));
};

const valueNeedsTranslation = (value: unknown, target: TargetLanguage) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !isLikelyTargetLanguage(trimmed, target);
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
  { key: 'translate', label: '全局翻译', status: 'pending' },
  { key: 'ruleCheck', label: '组合校验', status: 'pending' },
  { key: 'aiValidate', label: '多 AI 核验', status: 'pending' }
]);

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<POCTRecord[]>([]); // Original Data
  const [processedData, setProcessedData] = useState<POCTRecord[]>([]); // Translated Data
  const [documentKind, setDocumentKind] = useState<'excel' | 'docx' | 'pdf'>('excel');
  const [excelContext, setExcelContext] = useState<ExcelContext | null>(null);
  const [targetLang, setTargetLang] = useState<TargetLanguage>('English');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.localStorage.getItem(UI_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState<boolean>(false); // New State for Comparison View
  const [workflowStages, setWorkflowStages] = useState<WorkflowStageState[]>(createInitialStages);
  const [rules, setRules] = useState<ClinicalRule[]>([]);
  const [missingCombinations, setMissingCombinations] = useState<MissingCombination[]>([]);
  const [aiFindings, setAiFindings] = useState<CrossCheckResult[]>([]);
  const [translationIssues, setTranslationIssues] = useState<IssueSummaryState>(createIssueSummary());
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [previewFocus, setPreviewFocus] = useState<{ rowIndex: number; columnKey: string } | null>(null);
  const [sampleReviewCount, setSampleReviewCount] = useState<number>(20);
  const [sampleReviewItems, setSampleReviewItems] = useState<SampleReviewItem[]>([]);
  const [sampleReviewAiResults, setSampleReviewAiResults] = useState<Record<string, SampleReviewAIResult>>({});
  const [sampleReviewAiMeta, setSampleReviewAiMeta] = useState<{ model?: string; engine?: string } | null>(null);
  const [isRunningSampleReviewAi, setIsRunningSampleReviewAi] = useState(false);
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
  const [docxStats, setDocxStats] = useState<{ total: number; translated: number }>({ total: 0, translated: 0 });
  const [pdfStats, setPdfStats] = useState<{ pages: number; total: number; translated: number }>({ pages: 0, total: 0, translated: 0 });
  const pauseRequestedRef = useRef(false);
  const snapshotPromptKeyRef = useRef<string>('');
  const translationMemorySessionRef = useRef<Map<string, string>>(new Map());

  const translationHub = useMemo(() => new TranslationHub(), []);
  const capabilities = useMemo(() => translationHub.getCapabilities(), [translationHub]);
  const openRouterModels = useMemo(() => parseOpenRouterModelOptions(), []);
  const [translationModelPreference, setTranslationModelPreference] = useState<string>(
    AUTO_OPENROUTER_MODEL
  );
  const ruleEngine = useMemo(() => new RuleEngine(), []);
  const multiAIJudge = useMemo(() => new MultiAIJudge(), []);
  const sampleReviewAuditService = useMemo(() => new SampleReviewAuditService(), []);
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

  const resetSampleReviewState = () => {
    setSampleReviewItems([]);
    setSampleReviewAiResults({});
    setSampleReviewAiMeta(null);
  };

  const getFallbackPriority = (
    respectSelectedEngine: boolean = false
  ): Array<'openrouter' | 'deepseek' | 'gemini'> => {
    const engines: Array<'openrouter' | 'deepseek' | 'gemini'> = [];
    if (capabilities.openrouter) engines.push('openrouter');
    if (capabilities.deepseek) engines.push('deepseek');
    if (capabilities.gemini) engines.push('gemini');

    if (respectSelectedEngine && translationModelPreference !== AUTO_OPENROUTER_MODEL) {
      if (capabilities.openrouter) return ['openrouter'];
    }

    return engines.length > 0 ? engines : ['openrouter'];
  };

  const getTranslationOptions = () => {
    if (translationModelPreference === AUTO_OPENROUTER_MODEL) {
      return undefined;
    }
    return {
      model: 'openrouter' as const,
      openRouterModel: translationModelPreference
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
      setData([]);
      setProcessedData([]);
      setRules([]);
      setMissingCombinations([]);
      setAiFindings([]);
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
        setProcessingState({
          status: 'idle',
          progress: 0,
          total: context.segments.length,
          currentBatch: 0
        });
        updateStageStatus('ingest', 'completed', `DOCX: 检测到 ${context.segments.length} 个语义段`);
        addLog(`Success: Loaded DOCX with ${context.segments.length} semantic segments.`);
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
      setData([]);
      setProcessedData([]);
      setRules([]);
      setMissingCombinations([]);
      setAiFindings([]);
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
    setExcelContext(null);
      setDocxStats({ total: 0, translated: 0 });
      setPdfStats({ pages: 0, total: 0, translated: 0 });
      setSavedSnapshot(null);
      try {
      const { records, context } = await parseExcelFile(uploadedFile);
      setData(records);
      setExcelContext(context);
      setProcessedData([]);
      setRules([]);
      setMissingCombinations([]);
      setAiFindings([]);
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
    const summaryRows = new Set(summary.rowIndices);
    const refreshedMissing = summary.rowIndices;
    const mergedRowIndices = [...refreshedMissing];
    const refreshedWriteFailed = Array.from(new Set(writeFailedRowIndices))
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
      const location = formatLocationLabel(issue.rowIndex, issue.columnKey);
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

  const exportQualityReport = () => {
    if (!qualityReport) {
      addLog('Quality Report: 当前没有可导出的检查结果。');
      return;
    }
    const findings = [
      ...currentIssueSummary.details.map((item) => ({
        type: 'Non-target language',
        location: formatLocationLabel(item.rowIndex, item.columnKey),
        original: typeof data[item.rowIndex]?.[item.columnKey] === 'string' ? data[item.rowIndex][item.columnKey] : '',
        translated: typeof currentRowsForRetry[item.rowIndex]?.[item.columnKey] === 'string'
          ? currentRowsForRetry[item.rowIndex][item.columnKey]
          : ''
      })),
      ...qualityReport.issues.emptyTranslations.map((item) => ({
        type: 'Empty translation',
        location: formatLocationLabel(item.rowIndex, item.columnKey),
        original: item.original || '',
        translated: item.value || ''
      })),
      ...qualityReport.issues.structureMismatches.map((item) => ({
        type: 'Structure mismatch',
        location: formatLocationLabel(item.rowIndex, item.columnKey),
        original: item.original || '',
        translated: item.value || ''
      })),
      ...qualityReport.issues.placeholders.map((item) => ({
        type: 'Placeholder',
        location: formatLocationLabel(item.rowIndex, item.columnKey),
        original: item.original || '',
        translated: item.value || ''
      })),
      ...qualityReport.issues.idMismatch.map((item) => ({
        type: 'ID mismatch',
        location: formatLocationLabel(item.rowIndex, item.columnKey),
        original: item.original || '',
        translated: item.value || ''
      })),
      ...qualityReport.issues.spacing.map((item) => ({
        type: 'Spacing issue',
        severity: item.severity || 'medium',
        location: formatLocationLabel(item.rowIndex, item.columnKey),
        original: item.original || '',
        translated: item.value || ''
      }))
    ];

    const lines = [
      'POCT Translation Quality Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Target language: ${targetLang}`,
      '',
      'Overview',
      `- Rows scanned: ${qualityReport.totals.rowsScanned}`,
      `- Cells scanned: ${qualityReport.totals.cellsScanned}`,
      `- Non-target residual: ${currentIssueSummary.cells} cells / ${currentIssueSummary.rows} rows`,
      `- Chinese residue: ${qualityReport.totals.chineseCells} cells / ${qualityReport.totals.chineseRows} rows`,
      `- Empty translations: ${qualityReport.totals.emptyTranslations} cells / ${qualityReport.totals.emptyTranslationRows} rows`,
      `- Placeholders: ${qualityReport.totals.placeholderCells} cells / ${qualityReport.totals.placeholderRows} rows`,
      `- ID mismatch: ${qualityReport.totals.idMismatches} cells / ${qualityReport.totals.idMismatchRows} rows`,
      `- Spacing issues: ${qualityReport.totals.spacingIssues} cells / ${qualityReport.totals.spacingRows} rows`,
      `  - High: ${qualityReport.totals.spacingHigh}`,
      `  - Medium: ${qualityReport.totals.spacingMedium}`,
      `  - Low: ${qualityReport.totals.spacingLow}`,
      `- Structure mismatch: ${qualityReport.totals.structureMismatches} cells / ${qualityReport.totals.structureMismatchRows} rows`,
      '',
      'Findings'
    ];

    findings.slice(0, 200).forEach((item, index) => {
      lines.push(
        `${index + 1}. [${item.type}${item.severity ? ` / ${String(item.severity).toUpperCase()}` : ''}] ${item.location}`,
        `   Source: ${String(item.original || '').replace(/\s+/g, ' ').trim() || '(empty)'}`,
        `   Target: ${String(item.translated || '').replace(/\s+/g, ' ').trim() || '(empty)'}`
      );
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`Quality_Report_${targetLang}_${stamp}.txt`, lines.join('\n'));
    addLog('Quality Report: 已导出当前检查报告。');
  };

  const clearQualityReport = () => {
    setQualityReport(null);
    resetSampleReviewState();
    setPreviewFocus(null);
    addLog('Quality Report: 已清除当前检查结果。');
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

  const buildSampleReviewItems = (limit: number = sampleReviewCount): SampleReviewItem[] => {
    if (documentKind !== 'excel') {
      return [];
    }
    if (!processedData.length) {
      return [];
    }

    const issueMap = new Map<number, QualityFinding[]>();
    qualityFindings.forEach((item) => {
      if (!issueMap.has(item.rowIndex)) issueMap.set(item.rowIndex, []);
      issueMap.get(item.rowIndex)!.push(item);
    });

    const scoredRows = processedData
      .map((row, rowIndex) => {
        const issues = issueMap.get(rowIndex) || [];
        const originalRow = data[rowIndex] || {};
        const keys = Object.keys({ ...originalRow, ...row });
        const textCandidates = keys
          .map((key) => {
            const source = typeof originalRow[key] === 'string' ? originalRow[key].trim() : '';
            const translated = typeof row[key] === 'string' ? row[key].trim() : '';
            return { key, source, translated };
          })
          .filter((item) => item.source || item.translated);

        if (!textCandidates.length) return null;

        const preferredIssue = issues.find((item) => item.columnKey !== '__ROW__');
        const longest = [...textCandidates].sort((a, b) => b.source.length - a.source.length)[0];
        const chosen = preferredIssue
          ? textCandidates.find((item) => item.key === preferredIssue.columnKey) || longest
          : longest;

        if (!chosen) return null;

        const maxLength = chosen.source.length;
        const reason =
          issues.length > 0
            ? 'Issue-hit'
            : maxLength >= 36
              ? 'Long sentence'
              : maxLength <= 12
                ? 'Short label'
                : 'General row';

        const priority = issues.length > 0 ? 3 : maxLength >= 36 ? 2 : maxLength <= 12 ? 1 : 0;
        return {
          rowIndex,
          columnKey: chosen.key,
          original: chosen.source,
          translated: chosen.translated,
          reason,
          priority
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.original.length - a.original.length;
      });

    return scoredRows.slice(0, limit).map((item) => ({
      id: `${item.rowIndex}-${item.columnKey}`,
      rowIndex: item.rowIndex,
      columnKey: item.columnKey,
      locationLabel: formatLocationLabel(item.rowIndex, item.columnKey),
      original: item.original,
      translated: item.translated,
      reason: item.reason
    }));
  };

  const generateSampleReview = () => {
    if (documentKind !== 'excel') {
      addLog('Sample Review: 当前仅支持 Excel 文档。');
      return;
    }
    if (!processedData.length) {
      addLog('Sample Review: 请先完成翻译，再生成抽样检查。');
      return;
    }

    const picked = buildSampleReviewItems(sampleReviewCount);

    setSampleReviewItems(picked);
    setSampleReviewAiResults({});
    setSampleReviewAiMeta(null);
    addLog(`Sample Review: 已生成 ${picked.length} 条抽样检查样本。`);
  };

  const runAiSampleReview = async () => {
    if (documentKind !== 'excel') {
      addLog('AI Sample Review: 当前仅支持 Excel 文档。');
      return;
    }
    if (!processedData.length) {
      addLog('AI Sample Review: 请先完成翻译，再发起 AI 审核。');
      return;
    }
    if (isRunningSampleReviewAi) {
      addLog('AI Sample Review: 正在审核中，请等待当前任务完成。');
      return;
    }

    const currentItems =
      sampleReviewItems.length > 0 ? sampleReviewItems : buildSampleReviewItems(sampleReviewCount);
    if (!currentItems.length) {
      addLog('AI Sample Review: 当前没有可审核的抽样条目。');
      return;
    }

    if (sampleReviewItems.length === 0) {
      setSampleReviewItems(currentItems);
    }

    setIsRunningSampleReviewAi(true);
    try {
      addLog(`AI Sample Review: 开始审核 ${currentItems.length} 条抽样样本。`);
      const payload: ReviewSample[] = currentItems.map((item) => ({
        id: item.id,
        location: item.locationLabel,
        source: item.original,
        target: item.translated
      }));
      const reviewResponse = await sampleReviewAuditService.reviewSamples(
        payload,
        targetLang,
        translationModelPreference === AUTO_OPENROUTER_MODEL ? undefined : translationModelPreference
      );

      const resultMap = reviewResponse.reviews.reduce<Record<string, SampleReviewAIResult>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {});
      const highRisk = reviewResponse.reviews.filter((item) => item.risk === 'high').length;
      const failCount = reviewResponse.reviews.filter((item) => item.verdict === 'fail').length;

      setSampleReviewAiResults(resultMap);
      setSampleReviewAiMeta({
        model: reviewResponse.model,
        engine: reviewResponse.engine
      });
      addLog(
        `AI Sample Review: 已完成 ${reviewResponse.reviews.length} 条审核；高风险 ${highRisk} 条，失败 ${failCount} 条。`
      );
    } catch (error) {
      addLog(`AI Sample Review: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunningSampleReviewAi(false);
    }
  };

  const runQualityCheck = () => {
    if (documentKind !== 'excel') {
      addLog('Quality Check: 当前仅支持 Excel 文档。');
      return;
    }
    const rawTarget = processedData.length > 0 ? processedData : data;
    const { records: target, fixedCells } = autoRepairExcelPlaceholders(rawTarget, {
      mutateState: processedData.length > 0,
      logLabel: 'Quality Check'
    });
    if (!target.length) {
      addLog('Quality Check: 没有可检查的数据。');
      return;
    }
    const report = runQualityChecks(data, target);
    setQualityReport(report);
    resetSampleReviewState();
    // Keep top warning banners in sync with the latest dataset snapshot.
    const { summary, refreshedMissing, refreshedWriteFailed } = refreshTranslationIssues(target);
    persistProgress(
      target.map((row) => ({ ...row })),
      translatedFlags.length === target.length ? [...translatedFlags] : Array(target.length).fill(false),
      refreshedMissing,
      refreshedWriteFailed
    );
    addLog(
      `Quality Check: 非目标语言残留 ${summary.cells} 个（${summary.rows} 行），中文残留 ${report.totals.chineseCells} 个，` +
      `空白漏翻 ${report.totals.emptyTranslations} 个，` +
      `占位符 ${report.totals.placeholderCells} 个，` +
      `ID 异常 ${report.totals.idMismatches} 个，` +
      `格式问题 ${report.totals.spacingIssues} 个，` +
      `结构异常 ${report.totals.structureMismatches} 个。`
    );
    if (fixedCells > 0) {
      addLog(`Quality Check: 已在检查前自动恢复 ${fixedCells} 个坏 token。`);
    }
    if (summary.details.length > 0) {
      const preview = formatIssueLocationPreview(summary.details, 6);
      if (preview) {
        addLog(`Quality Check: 非目标语言位置示例 -> ${preview}`);
      }
    }
    if (report.issues.chinese.length > 0) {
      const preview = report.issues.chinese
        .slice(0, 5)
        .map((issue) => {
          const rowNo = formatExcelRowNumber(issue.rowIndex);
          const value = String(issue.value || '').replace(/\s+/g, ' ').slice(0, 28);
          return `R${rowNo}/${issue.columnKey}: ${value}`;
        })
        .join(' | ');
      addLog(`Quality Check: 中文残留位置示例 -> ${preview}`);
    }
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
    setQualityReport(runQualityChecks(data, fixed));
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
    const trimmed = stripProtectedTerms(text).trim();
    if (!trimmed) return true;
    if (isNeutralToken(trimmed) || isLikelyIdentifier(trimmed)) return true;
    if (DOCX_WORD_REGEX.test(trimmed)) return true;
    const chineseChars = countChineseChars(trimmed);
    if (chineseChars <= 1 && trimmed.length <= 12) return true;
    return false;
  };

  const buildDocxIssueDetails = (context: DocxContext) => {
    const pending: number[] = [];
    const details: DocxIssueDetail[] = [];
    context.segments.forEach((segment, idx) => {
      const text = getDocxSegmentText(segment) || segment.original || '';
      const trimmed = text.trim();
      if (!trimmed) return;
      const stripped = stripProtectedTerms(trimmed);
      if (!stripped) return;
      const hasSourceLanguage = !isLikelyTargetLanguage(stripped, targetLang);
      const hasPlaceholderLeak =
        PLACEHOLDER_REGEX.test(trimmed) || DOCX_PLACEHOLDER_VARIANT_REGEX.test(trimmed);
      const hasGlueLeak =
        String(targetLang || '').toLowerCase().includes('english') && hasGlueIssue(trimmed);
      if (!hasSourceLanguage && !hasPlaceholderLeak && !hasGlueLeak) return;
      pending.push(idx);
      details.push({
        index: idx,
        id: segment.id,
        text: trimmed,
        snippet: toDocxSnippet(trimmed),
        chineseChars: countChineseChars(stripped),
        lowPriority: hasPlaceholderLeak || hasGlueLeak ? false : isLowPriorityDocxIssue(trimmed),
        issueType: hasPlaceholderLeak ? 'placeholder' : hasGlueLeak ? 'glue' : 'source'
      });
    });
    return { pending, details };
  };

  const exportDocxIssueReport = () => {
    if (!docxIssueDetails.length) {
      addLog('Docx report: 当前没有可导出的审计问题。');
      return;
    }
    const now = new Date();
    const iso = now.toISOString();
    const retryable = docxIssueDetails.filter((item) => !item.lowPriority).length;
    const lowPriority = docxIssueDetails.length - retryable;
    const lines: string[] = [
      `Generated At: ${iso}`,
      `Target Language: ${targetLang}`,
      `Total Issues: ${docxIssueDetails.length}`,
      `Retryable (recommended): ${retryable}`,
      `Low Priority: ${lowPriority}`,
      'Index Mapping: #N means the Nth semantic segment in document order (NOT page number).',
      'Segment ID Mapping: docx-segment-(N-1) is the internal zero-based segment id.',
      ''
    ];
    docxIssueDetails.forEach((item) => {
      lines.push(
        `#${item.index + 1} (${item.id}) [Type=${item.issueType}] [CJKChars=${item.chineseChars}] [${item.lowPriority ? 'LowPriority' : 'Retryable'}]`,
        item.text || '(empty)',
        ''
      );
    });
    const safeStamp = iso.replace(/[:.]/g, '-');
    downloadTextFile(`Docx_Issue_Report_${targetLang}_${safeStamp}.txt`, lines.join('\n'));
    addLog(`Docx report: 已导出 ${docxIssueDetails.length} 段问题文本明细。`);
  };

  const auditDocxTranslation = () => {
    const context = docxContextRef.current;
    if (!context) return;
    const { pending, details } = buildDocxIssueDetails(context);
    setDocxIssueIndices(pending);
    setDocxIssueDetails(details);
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

    try {
      const result = await runStage('translate', async () => {
        let completed = 0;
        let paused = false;
        const totalBatches = Math.ceil(candidates.length / DOCX_BATCH_SIZE);

        for (let i = 0; i < candidates.length; i += DOCX_BATCH_SIZE) {
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Docx translation paused before batch ${Math.floor(i / DOCX_BATCH_SIZE) + 1}.`);
            break;
          }
          const chunk = candidates.slice(i, i + DOCX_BATCH_SIZE);
          const batchNum = Math.floor(i / DOCX_BATCH_SIZE) + 1;
          addLog(`Docx Batch ${batchNum}/${totalBatches}: ${chunk.length} 个语义段`);
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
          try {
            if (leaders.length > 0) {
              translatedBatch = await translationHub.translateBatch({
                records: leaders.map((leader) => ({ content: leader.sanitized })),
                targetLang,
                options: getTranslationOptions()
              });
              addLog(`Docx Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}`);
            } else {
              addLog(`Docx Batch ${batchNum}: 全部命中本地翻译记忆。`);
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(`Docx Batch ${batchNum} 翻译失败：${errMsg}`);
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
    const segments = context.segments;
    const candidates = segments.filter((segment) =>
      shouldTranslateDocxText(getPdfSegmentText(segment) || segment.original)
    );
    if (!candidates.length) {
      addLog('PDF: 当前文档已经是目标语言或没有可翻译的文本。');
      return;
    }

    pauseRequestedRef.current = false;
    const alreadyTranslated = Math.max(0, segments.length - candidates.length);
    setPdfStats({ pages: context.pageCount, total: segments.length, translated: alreadyTranslated });
    setTranslationStatus('running');
    if (mode === 'resume') {
      addLog(`PDF Resume: 已处理 ${alreadyTranslated}/${segments.length}，继续处理剩余 ${candidates.length} 个文本段。`);
    }
    setProcessingState({
      status: 'processing',
      progress: 0,
      total: candidates.length,
      currentBatch: 0
    });

    try {
      const result = await runStage('translate', async () => {
        let completed = 0;
        let paused = false;
        const totalBatches = Math.ceil(candidates.length / DOCX_BATCH_SIZE);

        for (let i = 0; i < candidates.length; i += DOCX_BATCH_SIZE) {
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`PDF translation paused before batch ${Math.floor(i / DOCX_BATCH_SIZE) + 1}.`);
            break;
          }
          const chunk = candidates.slice(i, i + DOCX_BATCH_SIZE);
          const batchNum = Math.floor(i / DOCX_BATCH_SIZE) + 1;
          addLog(`PDF Batch ${batchNum}/${totalBatches}: ${chunk.length} 个文本段`);
          const memoryStats = createTranslationMemoryStats();
          const memoryHits = await lookupReusableTranslations(
            chunk.map((segment) => getPdfSegmentText(segment) || segment.original)
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
            const rawText = getPdfSegmentText(segment) || segment.original;
            const memoryKey = getTranslationMemoryKey(rawText);
            const memoryTarget = memoryHits.get(memoryKey);
            if (memoryTarget) {
              setPdfSegmentText(segment, memoryTarget);
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
          try {
            if (leaders.length > 0) {
              translatedBatch = await translationHub.translateBatch({
                records: leaders.map((leader) => ({ content: leader.sanitized })),
                targetLang,
                options: getTranslationOptions()
              });
              addLog(`PDF Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}`);
            } else {
              addLog(`PDF Batch ${batchNum}: 全部命中本地翻译记忆。`);
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(`PDF Batch ${batchNum} 翻译失败：${errMsg}`);
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
            setPdfSegmentText(segment, polished);
            (followers.get(leader.memoryKey) || []).forEach((follower) => {
              setPdfSegmentText(follower, polished);
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
          logTranslationMemoryStats(`PDF Batch ${batchNum}`, memoryStats);

          completed += chunk.length;
          setPdfStats({
            pages: context.pageCount,
            total: segments.length,
            translated: Math.min(alreadyTranslated + completed, segments.length)
          });
          setProcessingState((prev) => ({
            ...prev,
            progress: Math.round((completed / candidates.length) * 100),
            currentBatch: batchNum
          }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`PDF translation paused after batch ${batchNum}.`);
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
        addLog(`PDF Translation Completed: ${completed}/${candidates.length} 个文本段处理完成。`);
        return 'completed';
      });

      if (result !== 'paused') {
        setTranslationStatus('completed');
      }
    } catch (error) {
      setTranslationStatus('idle');
      addLog(`PDF Translation Failed: ${error instanceof Error ? error.message : String(error)}`);
      setProcessingState((prev) => ({ ...prev, status: 'error' }));
    }
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
    const recommended = docxIssueDetails
      .filter((item) => !item.lowPriority)
      .map((item) => item.index);
    const targetIndices = recommended.length > 0 ? recommended : pendingIndices;
    if (recommended.length === 0 && docxIssueDetails.length > 0) {
      addLog('Docx Retry: 当前剩余问题均为低优先级短文本，将尝试全量重译。');
    } else if (docxIssueDetails.length > recommended.length) {
      addLog(
        `Docx Retry: 已自动聚焦 ${recommended.length} 段高优先级文本，跳过 ${docxIssueDetails.length - recommended.length} 段低优先级项。`
      );
    }
    const detailByIndex = new Map(docxIssueDetails.map((item) => [item.index, item]));
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
      targets = targetIndices
        .map(index => context.segments[index])
        .filter(Boolean)
        .filter((segment) => {
          const text = getDocxSegmentText(segment) || segment.original;
          return PLACEHOLDER_REGEX.test(text) || DOCX_PLACEHOLDER_VARIANT_REGEX.test(text) || !isLikelyTargetLanguage(stripProtectedTerms(text), targetLang);
        });
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
        const totalBatches = Math.ceil(targets.length / DOCX_BATCH_SIZE);
        for (let i = 0; i < targets.length; i += DOCX_BATCH_SIZE) {
          if (pauseRequestedRef.current) {
            paused = true;
            addLog(`Docx retry paused before batch ${Math.floor(i / DOCX_BATCH_SIZE) + 1}.`);
            break;
          }
          const chunk = targets.slice(i, i + DOCX_BATCH_SIZE);
          const batchNum = Math.floor(i / DOCX_BATCH_SIZE) + 1;
          addLog(`Docx Retry Batch ${batchNum}/${totalBatches}: ${chunk.length} 个语义段`);
          let translatedBatch: POCTRecord[];
          try {
            const payload = chunk.map((segment) => {
              const rawText = getDocxSegmentText(segment) || segment.original;
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
              options: getTranslationOptions()
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(`Docx Retry Batch ${batchNum} 失败：${errMsg}`);
            continue;
          }

          chunk.forEach((segment, index) => {
            const translatedRecord = translatedBatch[index] || {};
            const rawText = getDocxSegmentText(segment) || segment.original;
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
    const results = await Promise.allSettled(targetLangs.map(async (lang) => {
      addLog(`String Resource: ${lang} 开始处理...`);
      try {
        if (payload.length === 0) {
          const output = buildOutput([], lang);
          setStringOutputs((prev) => ({ ...prev, [lang]: output }));
          completedLangCount += 1;
          addLog(`String Resource: ${lang} 已完成（${completedLangCount}/${totalLangCount}）。`);
          return output;
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
        return output;
      } catch (error) {
        completedLangCount += 1;
        const reason = error instanceof Error ? error.message : String(error);
        addLog(`String Resource: ${lang} 失败（${completedLangCount}/${totalLangCount}）：${reason}`);
        throw error;
      }
    }));

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
    const availableOutputs = Object.fromEntries(
      Object.entries(stringOutputs).filter(([, value]) => String(value || '').trim())
    );
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
      setRules([]);
      setMissingCombinations([]);
      setAiFindings([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags([...initialFlags]);
      setMissingRowIndices([]);
      setWriteFailedRowIndices([]);
      setProcessingState(prev => ({ ...prev, status: 'processing', progress: 0, currentBatch: 0, total: data.length }));
      updateStageStatus('ruleCheck', 'pending', '等待组合校验');
      updateStageStatus('aiValidate', 'pending', '等待多 AI 核验');
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

  const runRuleCheck = async () => {
    const sourceRecords = processedData.length > 0 ? processedData : data;
    if (sourceRecords.length === 0) return;
    setAiFindings([]);
    updateStageStatus('aiValidate', 'pending', '等待多 AI 核验');

    await runStage('ruleCheck', async () => {
      const extracted = ruleEngine.extractRules(sourceRecords);
      const missing = ruleEngine.detectMissingCombinations(extracted);
      setRules(extracted);
      setMissingCombinations(missing);
      addLog(`Stage[ruleCheck]: Parsed ${extracted.length} rules, detected ${missing.length} coverage gaps.`);
    });
  };

  const runAiValidation = async () => {
    if (rules.length === 0) {
      addLog('Stage[aiValidate]: 无可用规则，请先执行组合校验。');
      return;
    }
    await runStage('aiValidate', async () => {
      const results = await multiAIJudge.crossValidate(rules, { maxItems: 50 });
      setAiFindings(results);
      addLog(`Stage[aiValidate]: Generated ${results.length} AI findings.`);
    });
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
    const missingByRow = new Map<number, Set<string>>();
    (missingSummary.details || []).forEach((cell) => {
      if (!uniqueIndices.includes(cell.rowIndex)) return;
      if (!missingByRow.has(cell.rowIndex)) {
        missingByRow.set(cell.rowIndex, new Set());
      }
      missingByRow.get(cell.rowIndex)!.add(cell.columnKey);
    });

    const retryItems: Array<{
      rowIdx: number;
      keys: Set<string>;
      sanitizedRow: POCTRecord;
      placeholders: Record<string, Record<string, string> | null>;
    }> = [];
    uniqueIndices.forEach((rowIdx) => {
      const keys = missingByRow.get(rowIdx);
      if (!keys || keys.size === 0) return;
      const originalRow = data[rowIdx] || {};
      const sourceRow = sourceRecords[rowIdx] || originalRow;
      const sanitizedRow: POCTRecord = {};
      const placeholdersForRow: Record<string, Record<string, string> | null> = {};
      keys.forEach((key) => {
        const sourceValue = sourceRow?.[key];
        const originalValue = originalRow?.[key];
        const value = typeof sourceValue === 'string' ? sourceValue : originalValue;
        if (typeof value !== 'string') {
          sanitizedRow[key] = value;
          return;
        }
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        if (!value.trim() || shouldLockCell(key, lockBasis) || isNeutralToken(value.trim())) {
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
    const missingSet = new Set(missingSummary.rowIndices);
    const writeFailedSet = new Set(
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
    setQualityReport(runQualityChecks(data, synced));
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
    task: () => Promise<'paused' | 'completed' | void>
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
      const filename = `Translated_${targetLang}_${file?.name || 'Result.docx'}`;
      addLog(`Generating file: ${filename}`);
      exportDocxFile(context, filename);
      return;
    }

    if (documentKind === 'pdf') {
      const context = pdfContextRef.current;
      if (!context) return;
      const untranslatedCount = context.segments.filter((segment) =>
        shouldTranslateDocxText(getPdfSegmentText(segment) || segment.original)
      ).length;
      if (untranslatedCount > 0) {
        addLog(`PDF download warning: 仍有 ${untranslatedCount} 个文本段可能未翻译，建议先继续翻译再导出。`);
      }
      const baseName = file?.name?.replace(/\.pdf$/i, '') || 'Result';
      const filename = `Translated_${targetLang}_${baseName}.docx`;
      addLog(`Generating file: ${filename}`);
      void exportPdfTranslationAsDocx(context, filename, targetLang);
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

  const handlePause = () => {
    if (translationStatus !== 'running' || activeStage !== 'translate') return;
    pauseRequestedRef.current = true;
  };

  const getStageBadgeClass = (status: WorkflowStageState['status']) => {
    switch (status) {
      case 'running':
        return 'text-indigo-300 border border-indigo-500/40';
      case 'completed':
        return 'text-emerald-300 border border-emerald-500/40';
      case 'error':
        return 'text-rose-300 border border-rose-500/40';
      default:
        return 'text-slate-500 border border-slate-700/50';
    }
  };

  const describeStageStatus = (status: WorkflowStageState['status']) => {
    switch (status) {
      case 'running':
        return '运行中';
      case 'completed':
        return '完成';
      case 'error':
        return '异常';
      default:
        return '待处理';
    }
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
  const canDownload =
    documentKind === 'docx'
      ? docxContextRef.current !== null && translationStatus !== 'running'
      : documentKind === 'pdf'
      ? pdfContextRef.current !== null && translationStatus !== 'running'
      : processedData.length > 0 && translationStatus !== 'running';
  const canRunTranslation =
    documentKind === 'docx'
      ? docxContextRef.current !== null
      : documentKind === 'pdf'
      ? pdfContextRef.current !== null
      : data.length > 0;
  const currentRowsForRetry =
    processedData.length === data.length && processedData.length > 0 ? processedData : data;
  const currentIssueSummary = useMemo(
    () => (documentKind === 'excel' ? summarizeUntranslated(currentRowsForRetry, targetLang) : createIssueSummary()),
    [documentKind, currentRowsForRetry, targetLang]
  );
  const retryableRowsFromDetails = useMemo(() => {
    const grouped = new Map<number, Set<string>>();
    currentIssueSummary.details.forEach((item) => {
      if (item.rowIndex < 0 || item.rowIndex >= data.length) return;
      if (!grouped.has(item.rowIndex)) {
        grouped.set(item.rowIndex, new Set());
      }
      grouped.get(item.rowIndex)!.add(item.columnKey);
    });

    const rows: number[] = [];
    grouped.forEach((keys, rowIdx) => {
      const originalRow = data[rowIdx] || {};
      const sourceRow = currentRowsForRetry[rowIdx] || originalRow;
      let retryable = false;
      keys.forEach((key) => {
        if (retryable) return;
        const sourceValue = sourceRow?.[key];
        const originalValue = originalRow?.[key];
        const value = typeof sourceValue === 'string' ? sourceValue : originalValue;
        if (typeof value !== 'string' || !value.trim()) return;
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        if (shouldLockCell(key, lockBasis) || isNeutralToken(value.trim())) return;
        retryable = true;
      });
      if (retryable) rows.push(rowIdx);
    });
    return rows.sort((a, b) => a - b);
  }, [currentIssueSummary.details, currentRowsForRetry, data]);
  const retryableCellCount = useMemo(() => {
    let count = 0;
    currentIssueSummary.details.forEach((item) => {
      if (item.rowIndex < 0 || item.rowIndex >= data.length) return;
      const originalRow = data[item.rowIndex] || {};
      const sourceRow = currentRowsForRetry[item.rowIndex] || originalRow;
      const sourceValue = sourceRow?.[item.columnKey];
      const originalValue = originalRow?.[item.columnKey];
      const value = typeof sourceValue === 'string' ? sourceValue : originalValue;
      if (typeof value !== 'string' || !value.trim()) return;
      const lockBasis = typeof originalValue === 'string' ? originalValue : value;
      if (shouldLockCell(item.columnKey, lockBasis) || isNeutralToken(value.trim())) return;
      count += 1;
    });
    return count;
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
  const runtimeProtectedTermsCount = useMemo(
    () => parseRuntimeProtectedTerms(runtimeProtectedTermsRaw).length,
    [runtimeProtectedTermsRaw]
  );
  const docxRetryableCount = docxHighPriorityCount;
  const retryCandidates = [...retryableRowsFromDetails];
  const hasTranslationAlerts = (currentIssueSummary.rows > 0 || writeFailedRowIndices.length > 0) && documentKind === 'excel';
  const hasDocxIssues = documentKind === 'docx' && docxIssueDetails.length > 0;
  const writeFailedRowPreview = formatRowRanges(writeFailedRowIndices);
  const isStringTranslating = stringStatus === 'running';
  const hasStringOutputs = Object.keys(stringOutputs).length > 0;
  const hasQualityReport = Boolean(qualityReport);
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
  const qualityFindings = useMemo<QualityFinding[]>(() => {
    if (!qualityReport) return [];

    const findingMap = new Map<string, QualityFinding>();
    const pushFinding = (finding: QualityFinding) => {
      if (!findingMap.has(finding.id)) {
        findingMap.set(finding.id, finding);
      }
    };

    currentIssueSummary.details.forEach((item) => {
      const translated =
        typeof currentRowsForRetry[item.rowIndex]?.[item.columnKey] === 'string'
          ? currentRowsForRetry[item.rowIndex][item.columnKey]
          : '';
      pushFinding({
        id: `nonTarget-${item.rowIndex}-${item.columnKey}`,
        category: 'nonTarget',
        rowIndex: item.rowIndex,
        columnKey: item.columnKey,
        locationLabel: formatLocationLabel(item.rowIndex, item.columnKey),
        original: typeof data[item.rowIndex]?.[item.columnKey] === 'string' ? data[item.rowIndex][item.columnKey] : '',
        translated,
        description: '检测到非目标语言残留'
      });
    });

    const appendQualityIssues = (
      category: QualityFinding['category'],
      list: Array<{ rowIndex: number; columnKey: string; original?: string; value: string; severity?: QualitySeverity }>,
      description: string
    ) => {
      list.forEach((item) => {
        pushFinding({
          id: `${category}-${item.rowIndex}-${item.columnKey}`,
          category,
          rowIndex: item.rowIndex,
          columnKey: item.columnKey,
          locationLabel: formatLocationLabel(item.rowIndex, item.columnKey),
          original: item.original || '',
          translated: item.value || '',
          description,
          severity: item.severity
        });
      });
    };

    appendQualityIssues('chinese', qualityReport.issues.chinese, '仍有中文残留');
    appendQualityIssues('emptyTranslation', qualityReport.issues.emptyTranslations, '原文可译，但目标单元格为空');
    appendQualityIssues('placeholder', qualityReport.issues.placeholders, '占位符泄漏');
    appendQualityIssues('idMismatch', qualityReport.issues.idMismatch, '锁定字段与原文不一致');
    appendQualityIssues('spacing', qualityReport.issues.spacing, '格式或空格异常');
    appendQualityIssues('structureMismatch', qualityReport.issues.structureMismatches, '表结构与原文不一致');

    const order: Record<QualityFinding['category'], number> = {
      nonTarget: 0,
      emptyTranslation: 1,
      structureMismatch: 2,
      placeholder: 3,
      idMismatch: 4,
      chinese: 5,
      spacing: 6
    };

    return [...findingMap.values()].sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
      if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
      return a.columnKey.localeCompare(b.columnKey);
    });
  }, [qualityReport, currentIssueSummary.details, currentRowsForRetry, data, excelContext]);
  const sampleReviewAiSummary = useMemo(
    () =>
      Object.values(sampleReviewAiResults).reduce(
        (acc, item) => {
          acc.total += 1;
          acc[item.risk] += 1;
          acc[item.verdict] += 1;
          return acc;
        },
        {
          total: 0,
          low: 0,
          medium: 0,
          high: 0,
          pass: 0,
          warning: 0,
          fail: 0
        }
      ),
    [sampleReviewAiResults]
  );
  const previewData = processedData.length > 0 ? processedData : data;
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
    const mergedKeys = Object.keys({ ...(data[rowIndex] || {}), ...(previewData[rowIndex] || {}) });
    if (!previewFocus) return mergedKeys.slice(0, 6);
    const base = mergedKeys.slice(0, 5);
    return Array.from(new Set([...base, previewFocus.columnKey])).slice(0, 6);
  }, [previewData, previewFocus, previewRowIndices, data]);
  const focusedPreviewCell = useMemo(() => {
    if (!previewFocus) return null;
    const translatedRecord = previewData[previewFocus.rowIndex] || {};
    const originalRecord = data[previewFocus.rowIndex] || {};
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
  }, [previewFocus, previewData, data]);
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
  const currentModelLabel =
    translationModelPreference === AUTO_OPENROUTER_MODEL
      ? 'Auto'
      : OPENROUTER_MODEL_LABELS[translationModelPreference] || translationModelPreference;
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

  return (
    <div className={pageClass} data-theme={theme}>
      <Header
        theme={theme}
        onThemeToggle={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
      />

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
                  <option>Chinese</option>
                  <option>English</option>
                  <option>Spanish</option>
                  <option>French</option>
                  <option>German</option>
                  <option>Italian</option>
                  <option>Turkish</option>
                  <option>Russian</option>
                  <option>Portuguese</option>
                </select>
              </div>
              {documentKind === 'docx' && docxContextRef.current && (
                <div className={`text-xs text-center space-y-1 ${mutedTextClass}`}>
                  <p>DOCX 语义段：{docxStats.total}，本次已翻译 {docxStats.translated}</p>
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
                  disabled={isTranslating}
                >
                  <option value={AUTO_OPENROUTER_MODEL}>Auto (Gemini → Qwen → DeepSeek)</option>
                  {openRouterModels.map((model) => (
                    <option key={model} value={model}>
                      {OPENROUTER_MODEL_LABELS[model] || model}
                    </option>
                  ))}
                </select>
                <p className={`text-xs mt-1 ${mutedTextClass}`}>
                  Auto 会按 Gemini → Qwen → DeepSeek 顺序自动切换；手工选择时只使用当前模型。
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

              <div className={`flex items-center justify-between gap-3 text-xs ${mutedTextClass}`}>
                <span>Translation Memory: {translationMemoryCount} 条本地记忆</span>
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
                      {translationStatus === 'running' ? 'Wait for Translation...' : 'Download Translated Document'}
                    </button>
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
                  <button
                    onClick={exportDocxIssueReport}
                    className={`w-full py-2 rounded-lg font-semibold transition-all ${isLight ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200' : 'bg-slate-700 hover:bg-slate-600 text-slate-100'}`}
                    disabled={translationStatus === 'running' || docxIssueDetails.length === 0}
                  >
                    Export Issue Report
                  </button>
                </div>
              )}

              <div className={`space-y-2 pt-3 border-t ${sectionDividerClass}`}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Quality Check</h3>
                {documentKind === 'docx' && (
                  <p className={`text-[11px] ${mutedTextClass}`}>
                    DOCX 已内置自动审计与 Retry Missing Segments；本区按钮仅用于 Excel。
                  </p>
                )}
                {documentKind === 'pdf' && (
                  <p className={`text-[11px] ${mutedTextClass}`}>
                    PDF 第一阶段导出为 Word 译文；本区按钮仅用于 Excel。
                  </p>
                )}
                <button
                  onClick={runQualityCheck}
                  disabled={documentKind !== 'excel' || data.length === 0}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                    documentKind !== 'excel' || data.length === 0
                      ? disabledButtonClass
                      : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-[0_12px_26px_rgba(79,70,229,0.22)]'
                  }`}
                >
                  Run Quality Check
                </button>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={applyQualityFixes}
                    disabled={documentKind !== 'excel' || processedData.length === 0}
                    className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                      documentKind !== 'excel' || processedData.length === 0
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
              </div>

              <details className={`mt-2 border rounded-xl p-3 ${isLight ? 'border-slate-200/80 bg-slate-50/80' : 'border-white/[0.07] bg-white/[0.025]'}`}>
                <summary className={`cursor-pointer text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>
                  Advanced Checks
                </summary>
                <div className="mt-3 space-y-2">
                  <button
                    onClick={runRuleCheck}
                    disabled={data.length === 0 || isTranslating}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl font-semibold transition-all shadow-lg ${
                      data.length === 0 || isTranslating
                        ? disabledButtonClass
                        : 'bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white shadow-[0_12px_26px_rgba(217,119,6,0.18)] active:scale-[0.99]'
                    }`}
                  >
                    {activeStage === 'ruleCheck' ? 'Analyzing...' : 'Run Combination Check'}
                  </button>

                  <button
                    onClick={runAiValidation}
                    disabled={rules.length === 0 || isTranslating}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl font-semibold transition-all shadow-lg ${
                      rules.length === 0 || isTranslating
                        ? disabledButtonClass
                        : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_12px_26px_rgba(5,150,105,0.18)] active:scale-[0.99]'
                    }`}
                  >
                    {activeStage === 'aiValidate' ? 'Cross-checking...' : 'Run Multi-AI Validation'}
                  </button>
                </div>
                <p className={`text-[11px] mt-2 ${mutedTextClass}`}>
                  用于组合校验与多 AI 核验，非必需步骤。
                </p>
              </details>
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
                <p className={`text-lg font-semibold mt-1 truncate ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{currentModelLabel}</p>
              </div>
             </div>
             <LogConsole logs={logs} theme={theme} />
          </section>

          <section className={`${panelClass} space-y-5`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Quality Report</h3>
                <p className={`text-xs mt-2 ${mutedTextClass}`}>
                  Summary view for Quality Check results, issue navigation, export, and sample review.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearQualityReport}
                  disabled={!hasQualityReport}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    !hasQualityReport
                      ? disabledButtonClass
                      : neutralButtonClass
                  }`}
                >
                  Clear
                </button>
                <button
                  onClick={exportQualityReport}
                  disabled={!hasQualityReport}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    !hasQualityReport
                      ? disabledButtonClass
                      : primaryInlineButtonClass
                  }`}
                >
                  Export Report
                </button>
              </div>
            </div>

            {!hasQualityReport && (
              <p className={`text-xs ${mutedTextClass}`}>
                Run `Run Quality Check` to show summary cards, findings, and sample review controls.
              </p>
            )}

            {hasQualityReport && qualityReport && (
              <>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                  <div className={metricCardClass}>
                    <p className={`text-[11px] ${mutedTextClass}`}>Scanned</p>
                    <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                      {qualityReport.totals.rowsScanned} rows / {qualityReport.totals.cellsScanned} cells
                    </p>
                    {formatSnapshot && (
                      <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                        {formatSnapshot.sheetName} · {formatSnapshot.rows}x{formatSnapshot.cols}
                      </p>
                    )}
                  </div>
                  <div className={metricCardClass}>
                    <p className={`text-[11px] ${mutedTextClass}`}>Residual</p>
                    <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                      非目标语言 {currentIssueSummary.cells} / 中文 {qualityReport.totals.chineseCells}
                    </p>
                    <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                      {currentIssueSummary.rows} rows / {qualityReport.totals.chineseRows} rows
                    </p>
                  </div>
                  <div className={metricCardClass}>
                    <p className={`text-[11px] ${mutedTextClass}`}>Repair Targets</p>
                    <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                      空白漏翻 {qualityReport.totals.emptyTranslations}
                    </p>
                    <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                      占位符 {qualityReport.totals.placeholderCells} · ID {qualityReport.totals.idMismatches}
                    </p>
                  </div>
                  <div className={metricCardClass}>
                    <p className={`text-[11px] ${mutedTextClass}`}>Format & Structure</p>
                    <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                      格式 {qualityReport.totals.spacingIssues}
                    </p>
                    <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                      H {qualityReport.totals.spacingHigh} · M {qualityReport.totals.spacingMedium} · L {qualityReport.totals.spacingLow}
                    </p>
                    <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                      结构 {qualityReport.totals.structureMismatches}
                    </p>
                  </div>
                </div>

                <details className={`rounded-lg border p-3 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-950/30'}`}>
                  <summary className="cursor-pointer list-none flex items-center justify-between">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>Details & Sample Review</span>
                    <span className={`text-[11px] ${mutedTextClass}`}>{qualityFindings.length} findings</span>
                  </summary>
                  <div className="space-y-3 mt-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Findings</h4>
                    <span className="text-[11px] text-slate-500">
                      {qualityFindings.length} items
                    </span>
                  </div>
                  {qualityFindings.length === 0 ? (
                    <p className="text-xs text-slate-500">当前未发现需要定位的问题。</p>
                  ) : (
                    <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                      {qualityFindings.slice(0, 40).map((finding) => (
                        <div
                          key={finding.id}
                          className={subCardClass}
                        >
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-xs font-medium ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                                  {finding.description}
                                </p>
                                {finding.severity && (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${severityBadgeClass(finding.severity)}`}>
                                    {finding.severity}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500">{finding.locationLabel}</p>
                              {finding.original && (
                                <p className="text-[11px] text-slate-400">
                                  原文：{finding.original.replace(/\s+/g, ' ').slice(0, 120)}
                                </p>
                              )}
                              <p className="text-[11px] text-slate-500">
                                译文：{(finding.translated || '(empty)').replace(/\s+/g, ' ').slice(0, 120)}
                              </p>
                            </div>
                            <button
                              onClick={() => jumpToPreviewCell(finding.rowIndex, finding.columnKey)}
                              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
                            >
                              Jump
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>

                <div className={`space-y-3 border-t pt-5 ${sectionDividerClass}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sample Review</h4>
                      <p className="text-[11px] text-slate-500 mt-1">
                        先生成抽样池，再用 AI 做只读审核。不会自动改写译文。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className={isLight ? 'bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 shadow-sm' : 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200'}
                        value={sampleReviewCount}
                        onChange={(e) => setSampleReviewCount(Number(e.target.value))}
                      >
                        {[10, 20, 30, 50].map((value) => (
                          <option key={value} value={value}>{value} samples</option>
                        ))}
                      </select>
                      <button
                        onClick={generateSampleReview}
                        disabled={!hasQualityReport || processedData.length === 0}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                          !hasQualityReport || processedData.length === 0
                            ? disabledButtonClass
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        Start Sample Review
                      </button>
                      <button
                        onClick={runAiSampleReview}
                        disabled={!hasQualityReport || processedData.length === 0 || isRunningSampleReviewAi}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                          !hasQualityReport || processedData.length === 0 || isRunningSampleReviewAi
                            ? disabledButtonClass
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        }`}
                      >
                        {isRunningSampleReviewAi ? 'AI Reviewing...' : 'Run AI Review'}
                      </button>
                    </div>
                  </div>

                  {sampleReviewAiSummary.total > 0 && (
                    <div className={subCardClass}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-slate-500">AI 审核结果</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('high')}`}>
                          High {sampleReviewAiSummary.high}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('medium')}`}>
                          Medium {sampleReviewAiSummary.medium}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('low')}`}>
                          Low {sampleReviewAiSummary.low}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('fail')}`}>
                          Fail {sampleReviewAiSummary.fail}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('warning')}`}>
                          Warning {sampleReviewAiSummary.warning}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('pass')}`}>
                          Pass {sampleReviewAiSummary.pass}
                        </span>
                      </div>
                      {(sampleReviewAiMeta?.model || sampleReviewAiMeta?.engine) && (
                        <p className="text-[11px] text-slate-500 mt-2">
                          审核模型：{sampleReviewAiMeta?.model || 'unknown'}
                          {sampleReviewAiMeta?.engine ? ` · 引擎 ${sampleReviewAiMeta.engine}` : ''}
                        </p>
                      )}
                    </div>
                  )}

                  {sampleReviewItems.length > 0 && (
                    <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                      {sampleReviewItems.map((item) => {
                        const review = sampleReviewAiResults[item.id];
                        return (
                          <div key={item.id} className={`${subCardClass} space-y-2`}>
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className={`text-xs font-medium ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{item.locationLabel}</p>
                                  {review && (
                                    <>
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass(review.risk)}`}>
                                        {review.risk}
                                      </span>
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass(review.verdict)}`}>
                                        {review.verdict}
                                      </span>
                                    </>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1">抽样理由：{item.reason}</p>
                                {review?.issueTypes?.length ? (
                                  <p className="text-[11px] text-slate-500 mt-1">
                                    问题类型：{review.issueTypes.join(' / ')}
                                  </p>
                                ) : null}
                              </div>
                              <button
                                onClick={() => jumpToPreviewCell(item.rowIndex, item.columnKey)}
                                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
                              >
                                View In Table
                              </button>
                            </div>
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-[11px]">
                              <div className={nestedPanelClass}>
                                <p className="text-slate-500 uppercase tracking-wider mb-2">Source</p>
                                <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{item.original || '(empty)'}</p>
                              </div>
                              <div className={nestedPanelClass}>
                                <p className="text-slate-500 uppercase tracking-wider mb-2">Target</p>
                                <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{item.translated || '(empty)'}</p>
                              </div>
                            </div>
                            {review && (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-[11px]">
                                <div className={nestedPanelClass}>
                                  <p className="text-slate-500 uppercase tracking-wider mb-2">AI Comment</p>
                                  <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{review.comment || '未给出额外说明。'}</p>
                                </div>
                                <div className={nestedPanelClass}>
                                  <p className="text-slate-500 uppercase tracking-wider mb-2">Suggested Fix</p>
                                  <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{review.suggestion || '无需修改'}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                </details>
              </>
            )}
          </section>

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
                      仅输出 {lang}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  日期/时间格式模板（如 `M月d日E`、`yyyy年M月d日`）会按规则本地转换，不走模型。
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
                      const originalRecord = data[actualIndex] || {};
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

          <details className={detailsCardClass}>
            <summary className={`cursor-pointer list-none px-6 py-4 flex items-center justify-between text-sm font-semibold uppercase ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
              <span>Advanced Signals</span>
              <span className="text-[10px] text-slate-500">Combination / AI Cross-check</span>
            </summary>
          <section className={`p-6 border-t ${sectionDividerClass}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${headingMutedClass}`}>Missing Combination Highlights</h3>
                {missingCombinations.length === 0 ? (
                  <p className="text-slate-500 text-sm">尚未检测到缺失组合。</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-auto pr-2">
                    {missingCombinations.slice(0, 5).map(item => (
                      <li key={item.id} className={isLight ? 'bg-amber-50 border border-amber-200 rounded-lg p-3' : 'bg-slate-950/40 border border-amber-500/30 rounded-lg p-3'}>
                        <p className={`text-sm font-medium ${isLight ? 'text-amber-800' : 'text-amber-200'}`}>{item.indicator}</p>
                        <p className={`text-xs mt-1 ${headingMutedClass}`}>{item.suggestion}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${headingMutedClass}`}>AI Cross-Check Signals</h3>
                {aiFindings.length === 0 ? (
                  <p className="text-slate-500 text-sm">等待 AI 核验结果...</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-auto pr-2">
                    {aiFindings.slice(0, 5).map(item => (
                      <li key={item.ruleId} className={isLight ? 'bg-indigo-50 border border-indigo-100 rounded-lg p-3' : 'bg-slate-950/40 border border-indigo-500/20 rounded-lg p-3'}>
                        <p className={`text-sm font-semibold ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>Rule {item.ruleId}</p>
                        <p className={`text-xs mt-1 ${headingMutedClass}`}>{item.aggregatedSummary}</p>
                        <p className={`text-[11px] mt-2 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>{item.finalRecommendation}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
          </details>
        </div>
      </main>
    </div>
  );
};

export default App;
