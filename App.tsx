
import React,{ useEffect,useMemo,useRef,useState } from 'react';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import RunMonitor from './components/RunMonitor';
import ExportBar from './components/translator/ExportBar';
import ModelReviewView from './components/translator/ModelReviewView';
import PreviewPanel from './components/translator/PreviewPanel';
import QualityTab from './components/translator/QualityTab';
import SettingsPanel from './components/translator/SettingsPanel';
import StringResourcePanel from './components/translator/StringResourcePanel';
import type { AppView,DocxIssueDetail,ModelReviewStyleSelection } from './components/translator/types';
import { getUiClasses } from './components/translator/uiClasses';
import { useDocumentIO } from './hooks/translation/useDocumentIO';
import { useDocxTranslation } from './hooks/translation/useDocxTranslation';
import { useExcelTranslation } from './hooks/translation/useExcelTranslation';
import { useIssueLocations } from './hooks/translation/useIssueLocations';
import { useModelReview } from './hooks/translation/useModelReview';
import { useModelRouting } from './hooks/translation/useModelRouting';
import { usePdfTranslation } from './hooks/translation/usePdfTranslation';
import { useStringResources } from './hooks/translation/useStringResources';
import { useAuth } from './hooks/useAuth';
import { useI18n } from './hooks/useI18n';
import { useQualityWorkflow } from './hooks/useQualityWorkflow';
import { segmentsToQualityRows,segmentsToQualityUnits } from './quality/adapters';
import {
  buildRetryableExcelSummary
} from './quality/retryTargets';
import { ModelReviewService } from './services/modelReviewService';
import { TranslationHub } from './services/translationHub';
import {
  BatchMonitor,
  BatchRun,
  LogEntry,
  POCTRecord,
  ProcessingState,
  SampleReviewAIResult,
  TargetLanguage,
  WorkflowStageKey,
  WorkflowStageState
} from './types';
import {
  getDocxSegmentText,
  type DocxContext,
  type DocxSegment
} from './utils/docx';
import type { ExcelContext } from './utils/excel';
import { isExcelFormulaCell } from './utils/excel';
import {
  formatExcelSkipScopeSummary,
  isExcelCellSkipped,
  parseExcelSkipScope
} from './utils/excelSkipScope';
import { isNeutralToken } from './utils/language';
import {
  type ModelReviewResult
} from './utils/modelReview';
import {
  getPdfSegmentText,
  type PdfContext,
  type PdfSegment
} from './utils/pdf';
import { fixSpacingArtifacts,polishTranslation } from './utils/postprocess';
import {
  PLACEHOLDER_REGEX,
  collectPlaceholderIssues,
  hasSpacingIssue,
  runQualityChecksOnUnits,
  type QualityCheckOptions,
  type QualitySeverity
} from './utils/quality';
import {
  loadTranslationProgress,
  saveTranslationProgress,
  type TranslationProgressSnapshot
} from './utils/storage';
import { loadStringHistory } from './utils/stringHistory';
import {
  INTERNAL_STRING_PLACEHOLDER_REGEX,
  extractStructuredStringContent,
  isLikelyDateFormatPattern,
  isXmlCommentLine,
  parseStringResourceLine,
  validateStringResourceXml
} from './utils/stringResources';
import { normalizeTerminology } from './utils/terminology';
import {
  buildTranslationMemoryKey,
  clearTranslationMemory,
  countTranslationMemoryEntries,
  lookupTranslationMemoryBatch,
  normalizeMemorySource,
  saveTranslationMemoryPairs,
  type TranslationMemoryPair
} from './utils/translationMemory';
import {
  DOCX_MANUAL_OPENROUTER_MODELS
} from './utils/translationProfiles';
import {
  containsProtectedTerm,
  guardTranslationTokens,
  isLikelyIdentifier,
  restoreTranslationTokens,
  setRuntimeProtectedTerms,
  stripPreservedUiLabels,
  stripProtectedTerms
} from './utils/translationTokens';
import type {
  IssueSummaryState,
  OpenRouterModelCooldown,
  StageResult,
  StringOutputDiagnostic,
  ThemeMode,
  TranslationMemoryStats
} from './utils/translatorShared';
import {
  ALL_STRING_TARGETS,
  APP_VERSION,
  AUTO_OPENROUTER_MODEL,
  BATCH_SIZE,
  DEEPSEEK_DIRECT_MODEL_VALUES,
  DOCX_WORD_REGEX,
  PACKAGE_VERSION,
  PROTECTED_TERMS_STORAGE_KEY,
  STRING_TARGET_LANGS,
  TRANSLATION_MEMORY_ENABLED_STORAGE_KEY,
  UI_THEME_STORAGE_KEY,
  applyPostprocessRow,
  cellNeedsTranslation,
  countChineseChars,
  createInitialStages,
  createIssueSummary,
  downloadTextFile,
  formatAutoModelChainLabel,
  formatRowRanges,
  getModelLabel,
  getTranslationModelLabel,
  isDeepSeekDirectProModel,
  isSevereDocxIssue,
  parseCloudflareAiModelOptions,
  parseOpenRouterAutoModelOptions,
  parseOpenRouterModelOptions,
  parseRuntimeProtectedTerms,
  shouldLockCell,
  toCloudflareAiModelValue,
  toDocxSnippet,
  valueNeedsTranslation
} from './utils/translatorShared';
import { summarizeUntranslated } from './utils/untranslated';


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
  const { t, lang: uiLang } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [batchRuns, setBatchRuns] = useState<BatchRun[]>([]);
  const [resultTab, setResultTab] = useState<'preview' | 'quality' | 'logs' | 'strings'>('preview');
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
  const [excelSkipScopeRaw, setExcelSkipScopeRaw] = useState<string>('');
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
  const previewSectionRef = useRef<HTMLElement | null>(null);
  const [docxIssueIndices, setDocxIssueIndices] = useState<number[]>([]);
  const [docxIssueDetails, setDocxIssueDetails] = useState<DocxIssueDetail[]>([]);
  const [pdfIssueIndices, setPdfIssueIndices] = useState<number[]>([]);
  const [pdfIssueDetails, setPdfIssueDetails] = useState<DocxIssueDetail[]>([]);
  const [docxStats, setDocxStats] = useState<{ total: number; translated: number }>({ total: 0, translated: 0 });
  const [pdfStats, setPdfStats] = useState<{ pages: number; total: number; translated: number }>({ pages: 0, total: 0, translated: 0 });
  const excelSkipScope = useMemo(
    () => parseExcelSkipScope(excelSkipScopeRaw, excelContext),
    [excelSkipScopeRaw, excelContext]
  );
  const excelSkipScopeSummary = useMemo(
    () => formatExcelSkipScopeSummary(excelSkipScope),
    [excelSkipScope]
  );
  const shouldSkipExcelCell = (rowIndex: number, columnKey: string) =>
    documentKind === 'excel' &&
    (isExcelCellSkipped(excelSkipScope, rowIndex, columnKey) ||
      isExcelFormulaCell(excelContext, rowIndex, columnKey));
  const excelQualityOptions = useMemo<QualityCheckOptions>(
    () => ({
      targetLang,
      shouldIgnoreUnit: (unit) => shouldSkipExcelCell(unit.rowIndex, unit.columnKey)
    }),
    [targetLang, excelSkipScope, excelContext, documentKind]
  );
  const untranslatedOptions = useMemo(
    () => ({
      shouldIgnoreCell: (rowIndex: number, columnKey: string) => shouldSkipExcelCell(rowIndex, columnKey)
    }),
    [excelSkipScope, excelContext, documentKind]
  );
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
      ...(capabilities.deepseek ? DEEPSEEK_DIRECT_MODEL_VALUES : []),
      ...(capabilities.cloudflareAi ? cloudflareAiModels.map(toCloudflareAiModelValue) : []),
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
    setLogs(prev => [...prev, { time: Date.now(), message: msg }]);
  };

  const getUsedModelLabel = () => {
    const used = translationHub.getLastModel?.();
    return used ? getModelLabel(used) : currentModelDisplayLabel;
  };

  const batchMonitor: BatchMonitor = {
    begin: ({ kind, batchNum, totalBatches, items, unit }) => {
      setBatchRuns(prev => [
        ...prev.filter(run => !(run.kind === kind && run.batchNum === batchNum)),
        {
          id: `${kind}-${batchNum}-${Date.now()}`,
          kind,
          batchNum,
          totalBatches,
          items,
          unit,
          startedAt: Date.now(),
          status: 'running'
        }
      ]);
    },
    end: (kind, batchNum, outcome, note) => {
      const issues = outcome === 'ok' ? translationHub.getLastModelIssues?.() || [] : [];
      const status = outcome === 'ok' && issues.length > 0 ? 'switched' : outcome;
      const lastModel = translationHub.getLastModel?.();
      const model =
        outcome === 'ok'
          ? lastModel
            ? getModelLabel(lastModel)
            : String(translationHub.getLastEngine())
          : undefined;
      const switchedNote = issues
        .slice(0, 2)
        .map(issue => `${getModelLabel(issue.model)} ${issue.status || issue.kind || 'error'}`)
        .join(', ');
      const noteText = note ? note.slice(0, 140) : status === 'switched' ? switchedNote : undefined;
      setBatchRuns(prev =>
        prev.map(run =>
          run.kind === kind && run.batchNum === batchNum && run.status === 'running'
            ? { ...run, status, elapsedMs: Date.now() - run.startedAt, model, note: noteText }
            : run
        )
      );
    }
  };

  const resetModelReviewState = () => {
    setModelReviewResult(null);
    setIsRunningModelReview(false);
    setModelReviewStatus({ stage: 'idle', message: 'Ready to run.' });
  };

  const isUsingDeepSeekPro = () => isDeepSeekDirectProModel(translationModelPreference);

  const getSpreadsheetBatchSize = () => BATCH_SIZE;

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
          `检测到本地进度：已翻译 ${translatedCount}/${data.length} 行，剩余 ${remaining} 行；未写入 ${writeFailed.length} 行。${snapshot.excelSkipScopeRaw ? '包含 Excel 跳过行/列设置。' : ''}点击“恢复进度”可恢复，或直接 Run Global Translation 重新开始。`
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
      writeFailedRows,
      excelSkipScopeRaw
    });
  };

  const refreshTranslationIssues = (records: POCTRecord[]) => {
    const summary = summarizeUntranslated(records, targetLang, untranslatedOptions);
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

  const restoreSkippedExcelCells = (row: POCTRecord, rowIndex: number) => {
    if (documentKind !== 'excel') return row;
    const original = data[rowIndex] || {};
    const output: POCTRecord = { ...row };
    Object.keys(original).forEach((key) => {
      if (shouldSkipExcelCell(rowIndex, key)) {
        output[key] = original[key];
      }
    });
    return output;
  };

  // Safe, model-free cleanup of translated Excel rows: terminology, spacing and ID restoration.
  const cleanupExcelRow = (rowIndex: number, row: POCTRecord): POCTRecord => {
    const original = data[rowIndex] || {};
    const polished = applyPostprocessRow(original, row, targetLang);
    const output: POCTRecord = { ...polished };
    Object.entries(polished).forEach(([key, value]) => {
      if (shouldSkipExcelCell(rowIndex, key)) {
        output[key] = original[key];
        return;
      }
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
  };

  const autoRepairExcelPlaceholders = (
    records: POCTRecord[],
    options?: { mutateState?: boolean; logLabel?: string }
  ) => {
    if (documentKind !== 'excel' || !records.length) {
      return { records, fixedCells: 0, cleanedCells: 0, remainingCells: 0, changed: false };
    }

    let fixedCells = 0;
    let cleanedCells = 0;
    let remainingCells = 0;
    let changed = false;

    const repaired = records.map((sourceRow, rowIndex) => {
      const originalRow = data[rowIndex] || {};
      let rowChanged = false;
      const row = options?.mutateState ? cleanupExcelRow(rowIndex, sourceRow) : sourceRow;
      if (row !== sourceRow) {
        Object.keys(row).forEach((key) => {
          if (String(row[key]) !== String(sourceRow[key])) {
            cleanedCells += 1;
            rowChanged = true;
            changed = true;
          }
        });
      }
      const nextRow: POCTRecord = { ...row };

      Object.entries(nextRow).forEach(([key, value]) => {
        if (shouldSkipExcelCell(rowIndex, key)) return;
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
        if (fixedCells > 0) addLog(`${options.logLabel}: 已自动修复 ${fixedCells} 个占位符单元格。`);
        if (cleanedCells > 0) addLog(`${options.logLabel}: 已自动清理 ${cleanedCells} 个单元格的格式、术语或 ID。`);
      }
    }

    return { records: repaired, fixedCells, cleanedCells, remainingCells, changed };
  };

  const jumpToPreviewCell = (rowIndex: number, columnKey: string) => {
    setResultTab('preview');
    setPreviewFocus({ rowIndex, columnKey });
    window.setTimeout(() => {
      previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
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

  const [queuedResidualRetry, setQueuedResidualRetry] = useState(false);

  // One entry point for every kind of leftover problem. Excel placeholder errors are retried
  // first; residual source text is queued for the next render so it sees the updated results.
  const retryAllIssues = async () => {
    if (documentKind === 'docx') {
      await retryDocxSegments();
      return;
    }
    if (documentKind === 'pdf') {
      await retryPdfSegments();
      return;
    }
    if (placeholderIssueCount > 0) {
      await retryPlaceholderCells();
      setQueuedResidualRetry(true);
      return;
    }
    await retryMissingRows(currentIssueSummary.rowIndices);
  };

  useEffect(() => {
    if (!queuedResidualRetry) return;
    setQueuedResidualRetry(false);
    if (currentIssueSummary.rows > 0 && !isRetryingMissing) {
      void retryMissingRows(currentIssueSummary.rowIndices);
    }
  }, [queuedResidualRetry]);

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
    () => (documentKind === 'excel' ? summarizeUntranslated(currentRowsForRetry, targetLang, untranslatedOptions) : translationIssues),
    [documentKind, currentRowsForRetry, targetLang, translationIssues, untranslatedOptions]
  );
  const retryableRowsFromDetails = useMemo(() => {
    return buildRetryableExcelSummary({
      details: currentIssueSummary.details,
      originalRows: data,
      sourceRows: currentRowsForRetry,
      isRetryableCell: ({ rowIndex, columnKey, value, originalValue }) => {
        if (!value.trim()) return false;
        if (shouldSkipExcelCell(rowIndex, columnKey)) return false;
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        return !shouldLockCell(columnKey, lockBasis) && !isNeutralToken(value.trim());
      }
    }).rowIndices;
  }, [currentIssueSummary.details, currentRowsForRetry, data, excelSkipScope, documentKind]);
  const retryableCellCount = useMemo(() => {
    return buildRetryableExcelSummary({
      details: currentIssueSummary.details,
      originalRows: data,
      sourceRows: currentRowsForRetry,
      isRetryableCell: ({ rowIndex, columnKey, value, originalValue }) => {
        if (!value.trim()) return false;
        if (shouldSkipExcelCell(rowIndex, columnKey)) return false;
        const lockBasis = typeof originalValue === 'string' ? originalValue : value;
        return !shouldLockCell(columnKey, lockBasis) && !isNeutralToken(value.trim());
      }
    }).cellCount;
  }, [currentIssueSummary.details, currentRowsForRetry, data, excelSkipScope, documentKind]);
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
    return collectPlaceholderIssues(data, target, excelQualityOptions);
  }, [documentKind, data, processedData, excelQualityOptions]);
  const placeholderIssueCount = livePlaceholderIssues.length;
  const fixableIssueCount =
    documentKind === 'docx'
      ? docxRetryableCount
      : documentKind === 'pdf'
        ? pdfHighPriorityCount
        : retryableCellCount + placeholderIssueCount;
  const canRetryIssues = fixableIssueCount > 0 && translationStatus !== 'running' && !isRetryingMissing;
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
  const { formatExcelRowNumber, formatIssueLocationPreview, formatLocationLabel } = useIssueLocations({
    excelContext
  });

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
    excelQualityOptions,
    excelSkipSummary: excelSkipScopeSummary,
    excelSkippedCellCount: excelSkipScope.cellCount,
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
      changed: hasChanged(originalValue, translatedValue),
      skipped: shouldSkipExcelCell(previewFocus.rowIndex, previewFocus.columnKey)
    };
  }, [previewFocus, previewData, previewSourceRows, excelSkipScope, documentKind]);
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
      ? t('monitor.status.processing')
      : translationStatus === 'paused'
        ? t('monitor.status.paused')
        : processingState.status === 'completed'
          ? t('monitor.status.completed')
          : processingState.status === 'error'
            ? t('monitor.status.error')
            : processingState.status === 'analyzing'
              ? t('monitor.status.analyzing')
              : t('monitor.status.idle');
  const isLight = theme === 'light';
  const {
    pageClass,
    panelClass,
    detailsCardClass,
    sectionDividerClass,
    headingMutedClass,
    mutedTextClass,
    fieldClass,
    textareaClass,
    disabledButtonClass,
    neutralButtonClass,
    primaryInlineButtonClass,
    metricCardClass,
    subCardClass,
    nestedPanelClass
  } = getUiClasses(isLight);
  const fileExtension = file ? (file.name.split('.').pop() || '').toUpperCase() : '';
  const fileSummaryLine = !file
    ? t('settings.upload.hint')
    : documentKind === 'docx' && docxContextRef.current
      ? t('settings.docx.stats', { total: docxStats.total, translated: docxStats.translated })
      : documentKind === 'pdf' && pdfContextRef.current
        ? t('settings.pdf.stats', { pages: pdfStats.pages, total: pdfStats.total, translated: pdfStats.translated })
        : documentKind === 'excel' && data.length > 0
          ? `${data.length} ${t('common.rows')}`
          : '';
  const autoModelChainLabel = formatAutoModelChainLabel(
    capabilities.cloudflareAi ? cloudflareAiModels : [],
    usesDocumentQualityModels ? activeDocumentQualityOpenRouterModels : activeOpenRouterModels,
    capabilities.deepseek
  );
  const isDocumentLoaded =
    documentKind === 'docx'
      ? docxContextRef.current !== null
      : documentKind === 'pdf'
        ? pdfContextRef.current !== null
        : processedData.length > 0;
  const resultTabs = [
    { key: 'preview', label: t('tabs.preview'), badge: 0 },
    { key: 'quality', label: t('tabs.quality'), badge: hasQualityReport ? qualityFindings.length : 0 },
    { key: 'logs', label: t('tabs.logs'), badge: 0 },
    { key: 'strings', label: t('tabs.strings'), badge: 0 }
  ] as const;
  const { buildModelReviewSamples, canRunModelReview, getRecommendedModelReviewStyle, getEffectiveModelReviewStyle, runModelReview, exportModelReviewReport, getModelReviewSourceLabel } = useModelReview({
    addLog,
    data,
    documentKind,
    docxContextRef,
    isRunningModelReview,
    modelReviewCount,
    modelReviewResult,
    modelReviewService,
    modelReviewStyleSelection,
    pdfContextRef,
    setIsRunningModelReview,
    setModelReviewResult,
    setModelReviewStatus,
    shouldSkipExcelCell,
    shouldTranslateDocxText,
    shouldTranslateValue,
    targetLang,
    translationStatus
  });

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

  const { applyLatestOpenRouterModelCooldowns, getFallbackPriority, getRetryAttemptModelLabel, getTranslationOptions, getDocumentQualityTranslationOptions, getDocumentBatchPolicy } = useModelRouting({
    activeDocumentQualityOpenRouterModels,
    activeOpenRouterModels,
    addLog,
    allOpenRouterModels,
    capabilities,
    isUsingDeepSeekPro,
    openRouterModelCooldownsRef,
    setOpenRouterModelCooldownVersion,
    translationHub,
    translationModelPreference
  });

  const { runPdfTranslation, retryPdfSegments } = usePdfTranslation({
    addLog,
    applyLatestOpenRouterModelCooldowns,
    batchMonitor,
    buildPdfIssueDetails,
    createTranslationMemoryStats,
    currentModelDisplayLabel,
    documentKind,
    docxPlaceholderStore,
    file,
    getDocumentBatchPolicy,
    getDocumentQualityTranslationOptions,
    getTranslationMemoryKey,
    getUsedModelLabel,
    logTranslationMemoryStats,
    lookupReusableTranslations,
    pauseRequestedRef,
    pdfContextRef,
    pdfIssueDetails,
    pdfIssueIndices,
    rememberTranslationPairs,
    runStage,
    setPdfIssueDetails,
    setPdfIssueIndices,
    setPdfStats,
    setProcessingState,
    setTranslationStatus,
    shouldTranslateDocxText,
    syncDocumentIssueSummary,
    targetLang,
    translationHub
  });

  const { runDocxTranslation, retryDocxSegments } = useDocxTranslation({
    addLog,
    applyLatestOpenRouterModelCooldowns,
    batchMonitor,
    buildDocxIssueDetails,
    createTranslationMemoryStats,
    currentModelDisplayLabel,
    documentKind,
    docxContextRef,
    docxIssueDetails,
    docxIssueIndices,
    docxPlaceholderStore,
    file,
    getDocumentBatchPolicy,
    getDocumentQualityTranslationOptions,
    getTranslationMemoryKey,
    getUsedModelLabel,
    logTranslationMemoryStats,
    lookupReusableTranslations,
    pauseRequestedRef,
    rememberTranslationPairs,
    runStage,
    setDocxIssueDetails,
    setDocxIssueIndices,
    setDocxStats,
    setProcessingState,
    setTranslationStatus,
    shouldTranslateDocxText,
    syncDocumentIssueSummary,
    targetLang,
    translationHub
  });

  const { runTranslation, retryMissingRows, retryPlaceholderCells } = useExcelTranslation({
    addLog,
    autoRepairExcelPlaceholders,
    batchMonitor,
    createTranslationMemoryStats,
    data,
    documentKind,
    excelQualityOptions,
    excelSkipScope,
    excelSkipScopeSummary,
    file,
    fileId,
    formatIssueLocationPreview,
    getFallbackPriority,
    getRetryAttemptModelLabel,
    getSpreadsheetBatchSize,
    getTranslationMemoryKey,
    getTranslationOptions,
    getUsedModelLabel,
    isRetryingMissing,
    logTranslationMemoryStats,
    lookupReusableTranslations,
    missingRowIndices,
    pauseRequestedRef,
    persistProgress,
    processedData,
    refreshTranslationIssues,
    rememberTranslationPairs,
    resetSampleReviewState,
    restoreSkippedExcelCells,
    runDocxTranslation,
    runPdfTranslation,
    runStage,
    setBatchRuns,
    setIsRetryingMissing,
    setMissingRowIndices,
    setProcessedData,
    setProcessingState,
    setQualityReport,
    setSavedSnapshot,
    setTranslatedFlags,
    setTranslationIssues,
    setTranslationStatus,
    setWriteFailedRowIndices,
    shouldSkipExcelCell,
    shouldTranslateValue,
    snapshotPromptKeyRef,
    targetLang,
    translatedFlags,
    translationHub,
    translationMode,
    translationModelPreference,
    untranslatedOptions,
    writeFailedRowIndices
  });

  const { translateStringResources, clearStringResources, copyStringOutput, exportStringHistory, exportCurrentStringOutput, clearStringHistoryData } = useStringResources({
    addLog,
    applyLatestOpenRouterModelCooldowns,
    applyStringAutoFix,
    collectStringOutputDiagnostics,
    currentModelDisplayLabel,
    currentSkippedOpenRouterModels,
    getCurrentStringOutputDiagnostics,
    getTranslationOptions,
    selectedStringTargetLangs,
    setStringError,
    setStringErrorDetails,
    setStringHistoryCount,
    setStringInput,
    setStringOutputs,
    setStringQualitySummary,
    setStringStatus,
    stringAutoFix,
    stringInput,
    stringOutputs,
    translationHub,
    translationModelPreference
  });

  const { handleFileUpload, applySavedProgress, discardSavedProgress, handleDownload, handleDownloadPdfDocx } = useDocumentIO({
    addLog,
    buildDocxIssueDetails,
    data,
    documentKind,
    docxContextRef,
    docxPlaceholderStore,
    excelContext,
    excelSkipScope,
    file,
    fileId,
    getSpreadsheetBatchSize,
    pauseRequestedRef,
    pdfContextRef,
    processedData,
    resetModelReviewState,
    resetSampleReviewState,
    resetStages,
    restoreSkippedExcelCells,
    savedSnapshot,
    setData,
    setDocumentKind,
    setDocxIssueDetails,
    setDocxIssueIndices,
    setDocxStats,
    setExcelContext,
    setExcelSkipScopeRaw,
    setFile,
    setFileId,
    setMissingRowIndices,
    setPdfIssueDetails,
    setPdfIssueIndices,
    setPdfStats,
    setPreviewFocus,
    setProcessedData,
    setProcessingState,
    setQualityReport,
    setSavedSnapshot,
    setTranslatedFlags,
    setTranslationIssues,
    setTranslationStatus,
    setWriteFailedRowIndices,
    snapshotPromptKeyRef,
    targetLang,
    translationStatus,
    updateStageStatus
  });

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
<ModelReviewView
  isLight={isLight}
  canRunModelReview={canRunModelReview}
  effectiveModelReviewStyle={effectiveModelReviewStyle}
  exportModelReviewReport={exportModelReviewReport}
  file={file}
  getModelLabel={getModelLabel}
  getModelReviewSourceLabel={getModelReviewSourceLabel}
  getRecommendedModelReviewStyle={getRecommendedModelReviewStyle}
  hasModelReviewJudgeScores={hasModelReviewJudgeScores}
  isRunningModelReview={isRunningModelReview}
  isTranslating={isTranslating}
  modelReviewCount={modelReviewCount}
  modelReviewFailedCandidates={modelReviewFailedCandidates}
  modelReviewFailedJudges={modelReviewFailedJudges}
  modelReviewResult={modelReviewResult}
  modelReviewSamplesPreview={modelReviewSamplesPreview}
  modelReviewScoredRows={modelReviewScoredRows}
  modelReviewStageClass={modelReviewStageClass}
  modelReviewStatus={modelReviewStatus}
  modelReviewStyleMetricLabel={modelReviewStyleMetricLabel}
  modelReviewStyleSelection={modelReviewStyleSelection}
  modelReviewSuccessfulCandidates={modelReviewSuccessfulCandidates}
  runModelReview={runModelReview}
  setActiveView={setActiveView}
  setModelReviewCount={setModelReviewCount}
  setModelReviewStyleSelection={setModelReviewStyleSelection}
  targetLang={targetLang}
/>
      ) : (
      <main className="flex-1 max-w-[1180px] mx-auto w-full p-4 lg:px-8 lg:py-8 space-y-5">
        <SettingsPanel
          isLight={isLight}
          AUTO_OPENROUTER_MODEL={AUTO_OPENROUTER_MODEL}
          applySavedProgress={applySavedProgress}
          autoModelChainLabel={autoModelChainLabel}
          availableTranslationModels={availableTranslationModels}
          canRunTranslation={canRunTranslation}
          clearTranslationMemoryData={clearTranslationMemoryData}
          currentSkippedOpenRouterModels={currentSkippedOpenRouterModels}
          discardSavedProgress={discardSavedProgress}
          documentKind={documentKind}
          docxContextRef={docxContextRef}
          excelSkipScope={excelSkipScope}
          excelSkipScopeRaw={excelSkipScopeRaw}
          excelSkipScopeSummary={excelSkipScopeSummary}
          file={file}
          fileExtension={fileExtension}
          fileSummaryLine={fileSummaryLine}
          getModelLabel={getModelLabel}
          getTranslationModelLabel={getTranslationModelLabel}
          handleFileUpload={handleFileUpload}
          isStringTranslating={isStringTranslating}
          isTranslating={isTranslating}
          pdfContextRef={pdfContextRef}
          processedData={processedData}
          processingState={processingState}
          runTranslation={runTranslation}
          runtimeProtectedTermsCount={runtimeProtectedTermsCount}
          runtimeProtectedTermsRaw={runtimeProtectedTermsRaw}
          savedSnapshot={savedSnapshot}
          setExcelSkipScopeRaw={setExcelSkipScopeRaw}
          setRuntimeProtectedTermsRaw={setRuntimeProtectedTermsRaw}
          setTargetLang={setTargetLang}
          setTranslationMemoryEnabled={setTranslationMemoryEnabled}
          setTranslationMode={setTranslationMode}
          setTranslationModelPreference={setTranslationModelPreference}
          targetLang={targetLang}
          translationMemoryCount={translationMemoryCount}
          translationMemoryEnabled={translationMemoryEnabled}
          translationMode={translationMode}
          translationModelPreference={translationModelPreference}
          usesDocumentQualityModels={usesDocumentQualityModels}
        />

        <RunMonitor
          isLight={isLight}
          statusLabel={runStatusLabel}
          progress={processingState.progress}
          modelLabel={translationModelPreference === AUTO_OPENROUTER_MODEL ? t('settings.model.autoShort') : currentModelDisplayLabel}
          batchRuns={batchRuns}
          showPauseResume={showPauseResume}
          isTranslating={isTranslating}
          pauseResumeDisabled={pauseResumeDisabled}
          onPauseResume={pauseResumeHandler}
          panelClass={panelClass}
          metricCardClass={metricCardClass}
          mutedTextClass={mutedTextClass}
          neutralButtonClass={neutralButtonClass}
          disabledButtonClass={disabledButtonClass}
        />

        <section className={`${panelClass} !p-0 overflow-hidden`}>
          <div role="tablist" className={`flex gap-1 overflow-x-auto border-b px-3 ${sectionDividerClass}`}>
            {resultTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`result-tab-${tab.key}`}
                aria-selected={resultTab === tab.key}
                aria-controls={`result-panel-${tab.key}`}
                onClick={() => setResultTab(tab.key)}
                className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  resultTab === tab.key
                    ? isLight
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-indigo-400 text-indigo-200'
                    : `border-transparent ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-100'}`
                }`}
              >
                {tab.label}
                {tab.badge > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/15 text-rose-200'}`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-5" role="tabpanel" id={`result-panel-${resultTab}`} aria-labelledby={`result-tab-${resultTab}`}>
            {resultTab === 'preview' && (
                <PreviewPanel
                  isLight={isLight}
                  focusedPreviewCell={focusedPreviewCell}
                  formatExcelRowNumber={formatExcelRowNumber}
                  formatLocationLabel={formatLocationLabel}
                  hasChanged={hasChanged}
                  previewColumnKeys={previewColumnKeys}
                  previewData={previewData}
                  previewFocus={previewFocus}
                  previewRowIndices={previewRowIndices}
                  previewSectionRef={previewSectionRef}
                  previewSourceRows={previewSourceRows}
                  setPreviewFocus={setPreviewFocus}
                  setShowComparison={setShowComparison}
                  shouldSkipExcelCell={shouldSkipExcelCell}
                  showComparison={showComparison}
                />
            )}

            {resultTab === 'quality' && (
              <QualityTab
                isLight={isLight}
                canRetryIssues={canRetryIssues}
                canRunQualityCheck={canRunQualityCheck}
                clearIssueCases={clearIssueCases}
                clearQualityReport={clearQualityReport}
                currentIssueSummary={currentIssueSummary}
                documentKind={documentKind}
                docxIssueDetails={docxIssueDetails}
                docxIssuePreview={docxIssuePreview}
                docxLowPriorityCount={docxLowPriorityCount}
                docxRetryableCount={docxRetryableCount}
                exportDebugPackage={exportDebugPackage}
                exportIssueAssetCandidates={exportIssueAssetCandidates}
                exportIssueCases={exportIssueCases}
                exportIssueDraft={exportIssueDraft}
                exportQualityReport={exportQualityReport}
                exportRegressionCases={exportRegressionCases}
                fixableIssueCount={fixableIssueCount}
                formatSnapshot={formatSnapshot}
                generateSampleReview={generateSampleReview}
                hasDocxIssues={hasDocxIssues}
                hasPdfIssues={hasPdfIssues}
                hasQualityReport={hasQualityReport}
                hasTranslationAlerts={hasTranslationAlerts}
                isRetryingMissing={isRetryingMissing}
                isRunningSampleReviewAi={isRunningSampleReviewAi}
                issueCaseCount={issueCaseCount}
                jumpToPreviewCell={jumpToPreviewCell}
                pdfHighPriorityCount={pdfHighPriorityCount}
                pdfIssueDetails={pdfIssueDetails}
                pdfIssuePreview={pdfIssuePreview}
                pdfLowPriorityCount={pdfLowPriorityCount}
                placeholderIssueCount={placeholderIssueCount}
                processedData={processedData}
                promoteIssueCasesToTranslationMemory={promoteIssueCasesToTranslationMemory}
                qualityFindings={qualityFindings}
                qualityReport={qualityReport}
                retryAllIssues={retryAllIssues}
                retryCandidates={retryCandidates}
                retryableCellCount={retryableCellCount}
                reviewRiskBadgeClass={reviewRiskBadgeClass}
                reviewVerdictBadgeClass={reviewVerdictBadgeClass}
                runAiSampleReview={runAiSampleReview}
                runQualityCheck={runQualityCheck}
                sampleReviewAiMeta={sampleReviewAiMeta}
                sampleReviewAiResults={sampleReviewAiResults}
                sampleReviewAiSummary={sampleReviewAiSummary}
                sampleReviewCount={sampleReviewCount}
                sampleReviewItems={sampleReviewItems}
                saveQualityFindingCorrection={saveQualityFindingCorrection}
                setSampleReviewCount={setSampleReviewCount}
                severityBadgeClass={severityBadgeClass}
                translationStatus={translationStatus}
                untranslatedLocationPreview={untranslatedLocationPreview}
                writeFailedRowIndices={writeFailedRowIndices}
                writeFailedRowPreview={writeFailedRowPreview}
              />
            )}

            {resultTab === 'logs' && <LogConsole logs={logs} theme={theme} onClear={() => setLogs([])} />}

            {resultTab === 'strings' && (
            <StringResourcePanel
              isLight={isLight}
              ALL_STRING_TARGETS={ALL_STRING_TARGETS}
              STRING_TARGET_LANGS={STRING_TARGET_LANGS}
              clearStringHistoryData={clearStringHistoryData}
              clearStringResources={clearStringResources}
              copyStringOutput={copyStringOutput}
              currentModelDisplayLabel={currentModelDisplayLabel}
              exportCurrentStringOutput={exportCurrentStringOutput}
              exportStringHistory={exportStringHistory}
              hasStringOutputs={hasStringOutputs}
              isStringTranslating={isStringTranslating}
              selectedStringTargetLangs={selectedStringTargetLangs}
              setStringAutoFix={setStringAutoFix}
              setStringInput={setStringInput}
              setStringOutputTarget={setStringOutputTarget}
              stringAutoFix={stringAutoFix}
              stringError={stringError}
              stringErrorDetails={stringErrorDetails}
              stringHistoryCount={stringHistoryCount}
              stringInput={stringInput}
              stringOutputTarget={stringOutputTarget}
              stringOutputs={stringOutputs}
              stringQualitySummary={stringQualitySummary}
              translateStringResources={translateStringResources}
            />
            )}
          </div>
        </section>

        {isDocumentLoaded && (
          <ExportBar
            isLight={isLight}
            canDownload={canDownload}
            documentKind={documentKind}
            docxBlockingIssueCount={docxBlockingIssueCount}
            handleDownload={handleDownload}
            handleDownloadPdfDocx={handleDownloadPdfDocx}
            translationStatus={translationStatus}
          />
        )}
      </main>
      )}
    </div>
  );
};

export default App;
