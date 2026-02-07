
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import LogConsole from './components/LogConsole';
import { parseExcelFile, exportToExcel } from './utils/excel';
import type { ExcelContext } from './utils/excel';
import { parseDocxFile, exportDocxFile, DocxContext, guardInlineTokens, restoreInlineTokens, containsChinese } from './utils/docx';
import { TranslationHub } from './services/translationHub';
import { RuleEngine } from './services/ruleEngine';
import { MultiAIJudge } from './services/multiAIJudge';
import { detectUntranslatedCells, isLikelyTargetLanguage, isNeutralToken } from './utils/language';
import { summarizeUntranslated } from './utils/untranslated';
import { loadTranslationProgress, saveTranslationProgress, clearTranslationProgress } from './utils/storage';
import { normalizeTerminology } from './utils/terminology';
import { polishTranslation, fixSpacingArtifacts } from './utils/postprocess';
import { guardTranslationTokens, restoreTranslationTokens, isLikelyIdentifier } from './utils/translationTokens';
import { guardStringResourceTokens, parseStringResourceLine, restoreStringResourceTokens } from './utils/stringResources';
import { appendStringHistory, clearStringHistory, loadStringHistory, type StringTranslationHistoryEntry } from './utils/stringHistory';
import { hasSpacingIssue, runQualityChecks, QualityReport, PLACEHOLDER_REGEX } from './utils/quality';
import {
  ClinicalRule,
  CrossCheckResult,
  MissingCombination,
  POCTRecord,
  ProcessingState,
  TargetLanguage,
  WorkflowStageKey,
  WorkflowStageState
} from './types';

// Batch size kept small for reliability with large column counts
const BATCH_SIZE = 5;
const DOCX_BATCH_SIZE = 20;
const RETRY_BATCH_SIZE = 5;
const SOURCE_LANG_REGEX = /[\u4e00-\u9fff]/;
const STRING_TARGET_LANGS: TargetLanguage[] = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Russian',
  'Portuguese'
];

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
      const lines: string[] = [
        `Record ${index + 1}`,
        `Timestamp: ${new Date(entry.createdAt).toLocaleString()}`,
        '',
        '[Original]',
        entry.source || ''
      ];
      STRING_TARGET_LANGS.forEach((lang) => {
        lines.push('', `[${lang}]`, entry.outputs[lang] || '');
      });
      return lines.join('\n');
    })
    .join(separator);
};

type IssueSummaryState = {
  cells: number;
  rows: number;
  rowIndices: number[];
  missingRows: number[];
};

const createIssueSummary = (): IssueSummaryState => ({
  cells: 0,
  rows: 0,
  rowIndices: [],
  missingRows: []
});

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

const rowNeedsTranslation = (row: POCTRecord, targetLang: TargetLanguage) => {
  return Object.values(row).some(value => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    return !isLikelyTargetLanguage(trimmed, targetLang);
  });
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
  if (LOCKED_KEY_REGEX.test(key)) return true;
  if (!value.trim()) return false;
  if (SOURCE_LANG_REGEX.test(value)) return false;
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
    output[key] = polishTranslation(sourceText, value);
  });
  return normalizeTerminology(output, lang);
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
  const [documentKind, setDocumentKind] = useState<'excel' | 'docx'>('excel');
  const [excelContext, setExcelContext] = useState<ExcelContext | null>(null);
  const [targetLang, setTargetLang] = useState<TargetLanguage>('English');
  const [logs, setLogs] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState<boolean>(false); // New State for Comparison View
  const [workflowStages, setWorkflowStages] = useState<WorkflowStageState[]>(createInitialStages);
  const [rules, setRules] = useState<ClinicalRule[]>([]);
  const [missingCombinations, setMissingCombinations] = useState<MissingCombination[]>([]);
  const [aiFindings, setAiFindings] = useState<CrossCheckResult[]>([]);
  const [translationIssues, setTranslationIssues] = useState<IssueSummaryState>(createIssueSummary());
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [activeStage, setActiveStage] = useState<WorkflowStageKey | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'running' | 'paused' | 'completed'>('idle');
  const [translatedFlags, setTranslatedFlags] = useState<boolean[]>([]);
  const [missingRowIndices, setMissingRowIndices] = useState<number[]>([]);
  const [translationMode, setTranslationMode] = useState<'full' | 'selective'>('full');
  const [stringInput, setStringInput] = useState<string>('');
  const [stringOutputs, setStringOutputs] = useState<Record<string, string>>({});
  const [stringStatus, setStringStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [stringError, setStringError] = useState<string | null>(null);
  const [stringQualitySummary, setStringQualitySummary] = useState<string | null>(null);
  const [stringErrorDetails, setStringErrorDetails] = useState<string | null>(null);
  const [stringAutoFix, setStringAutoFix] = useState<boolean>(true);
  const [stringHistoryCount, setStringHistoryCount] = useState<number>(0);
  const [processingState, setProcessingState] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    total: 0,
    currentBatch: 0
  });
  const docxContextRef = useRef<DocxContext | null>(null);
  const docxPlaceholderStore = useRef<Map<string, Record<string, string>>>(new Map());
  const [docxIssueIndices, setDocxIssueIndices] = useState<number[]>([]);
  const [docxStats, setDocxStats] = useState<{ total: number; translated: number }>({ total: 0, translated: 0 });
  const pauseRequestedRef = useRef(false);

  const translationHub = useMemo(() => new TranslationHub(), []);
  const capabilities = useMemo(() => translationHub.getCapabilities(), [translationHub]);
  const [enginePreference, setEnginePreference] = useState<'auto' | 'openrouter' | 'deepseek'>(
    capabilities.openrouter ? 'openrouter' : 'deepseek'
  );
  const ruleEngine = useMemo(() => new RuleEngine(), []);
  const multiAIJudge = useMemo(() => new MultiAIJudge(), []);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg]);
  };

  const getFallbackPriority = (): Array<'openrouter' | 'deepseek' | 'gemini'> => {
    const engines: Array<'openrouter' | 'deepseek' | 'gemini'> = [];
    if (capabilities.openrouter) engines.push('openrouter');
    if (capabilities.deepseek) engines.push('deepseek');
    if (capabilities.gemini) engines.push('gemini');
    return engines.length > 0 ? engines : ['openrouter'];
  };

  const shouldTranslateValue = (value: unknown) => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (isNeutralToken(trimmed)) return false;
    if (translationMode === 'full') return true;
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

    setFile(uploadedFile);
    const identifier = `${uploadedFile.name}-${uploadedFile.size}-${uploadedFile.lastModified || Date.now()}`;
    setFileId(identifier);
    setQualityReport(null);
    resetStages();
    setTranslationStatus('idle');
    pauseRequestedRef.current = false;
    updateStageStatus('ingest', 'running', '解析中...');
    addLog(`Importing: ${uploadedFile.name}`);

    const extension = uploadedFile.name.split('.').pop()?.toLowerCase();
    if (extension === 'docx') {
      setDocumentKind('docx');
      setExcelContext(null);
      docxContextRef.current = null;
      docxPlaceholderStore.current.clear();
      setDocxIssueIndices([]);
      setData([]);
      setProcessedData([]);
      setRules([]);
      setMissingCombinations([]);
      setAiFindings([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags([]);
      setMissingRowIndices([]);
      setDocxStats({ total: 0, translated: 0 });
      try {
        const context = await parseDocxFile(uploadedFile);
        docxContextRef.current = context;
        setDocxStats({ total: context.textNodes.length, translated: 0 });
        setDocxIssueIndices([]);
        setProcessingState({
          status: 'idle',
          progress: 0,
          total: context.textNodes.length,
          currentBatch: 0
        });
        updateStageStatus('ingest', 'completed', `DOCX: 检测到 ${context.textNodes.length} 个文本节点`);
        addLog(`Success: Loaded DOCX with ${context.textNodes.length} text segments.`);
      } catch (err) {
        addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setProcessingState(prev => ({ ...prev, status: 'error' }));
        updateStageStatus('ingest', 'error', '解析失败');
      }
      return;
    }

    setDocumentKind('excel');
    docxContextRef.current = null;
    setExcelContext(null);
    setDocxStats({ total: 0, translated: 0 });
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
      setProcessingState({
        status: 'analyzing',
        progress: 0,
        total: records.length,
        currentBatch: 0
      });
      updateStageStatus('ingest', 'completed', `已载入 ${records.length} 行`);
      addLog(`Success: Detected ${records.length} records with ${Object.keys(records[0]).length} columns.`);
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
      const normalized =
        snapshot.records.length === data.length
          ? snapshot.records.map(rec => ({ ...rec }))
          : data.map((row, idx) => ({ ...(snapshot.records[idx] || row) }));

      const flags =
        snapshot.translatedFlags && snapshot.translatedFlags.length === data.length
          ? snapshot.translatedFlags
          : Array.from({ length: data.length }, (_, idx) => idx < snapshot.records.length);

      const missing = snapshot.missingRows ?? [];
      const translatedCount = flags.filter(Boolean).length;

      setProcessedData(normalized);
      setTranslatedFlags(flags);
      setMissingRowIndices(missing);

      const progress = Math.round((translatedCount / data.length) * 100);
      setProcessingState(prev => ({
        ...prev,
        status: 'idle',
        progress,
        total: data.length,
        currentBatch: Math.ceil(translatedCount / BATCH_SIZE)
      }));
      setTranslationStatus('paused');
      const remaining = Math.max(0, data.length - translatedCount);
      addLog(
        `检测到本地进度：已翻译 ${translatedCount}/${data.length} 行，剩余 ${remaining} 行；失败行 ${missing.length} 行，可继续翻译或直接导出。`
      );
    }
  }, [fileId, targetLang, data.length, processedData.length, documentKind]);

  useEffect(() => {
    setStringHistoryCount(loadStringHistory().length);
  }, []);

  const persistProgress = (
    records: POCTRecord[],
    flags: boolean[],
    missingRows: number[]
  ) => {
    if (!fileId) return;
    saveTranslationProgress(fileId, targetLang, {
      records,
      translatedFlags: flags,
      missingRows
    });
  };

  const refreshTranslationIssues = (
    records: POCTRecord[],
    missingCandidates: number[]
  ) => {
    const summary = summarizeUntranslated(records, targetLang);
    const summaryRows = new Set(summary.rowIndices);
    const refreshedMissing = Array.from(new Set(missingCandidates))
      .filter((idx) => summaryRows.has(idx))
      .sort((a, b) => a - b);
    const mergedRowIndices = Array.from(
      new Set([...summary.rowIndices, ...refreshedMissing])
    ).sort((a, b) => a - b);
    setMissingRowIndices(refreshedMissing);
    setTranslationIssues({
      ...summary,
      rowIndices: mergedRowIndices,
      missingRows: refreshedMissing
    });
    return {
      summary,
      refreshedMissing,
      mergedRowIndices
    };
  };

  const formatExcelRowNumber = (rowIndex: number) => {
    if (!excelContext) return rowIndex + 1;
    return excelContext.headerRow + rowIndex + 2;
  };

  const runQualityCheck = () => {
    if (documentKind !== 'excel') {
      addLog('Quality Check: 当前仅支持 Excel 文档。');
      return;
    }
    const target = processedData.length > 0 ? processedData : data;
    if (!target.length) {
      addLog('Quality Check: 没有可检查的数据。');
      return;
    }
    const report = runQualityChecks(data, target);
    setQualityReport(report);
    addLog(
      `Quality Check: 中文残留 ${report.totals.chineseCells} 个，` +
      `占位符 ${report.totals.placeholderCells} 个，` +
      `ID 异常 ${report.totals.idMismatches} 个，` +
      `格式问题 ${report.totals.spacingIssues} 个。`
    );
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
            value
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
      refreshedMissing
    } = refreshTranslationIssues(fixed, missingRowIndices);
    setProcessedData(fixed);
    setTranslatedFlags(flags);
    persistProgress(fixed, flags, refreshedMissing);
    setQualityReport(runQualityChecks(data, fixed));
    addLog('Quality Fix: 已应用常见格式与 ID 修复。');
  };

  const shouldTranslateDocxText = (text: string) => {
    return shouldTranslateValue(text);
  };

  const auditDocxTranslation = () => {
    const context = docxContextRef.current;
    if (!context) return;
    const pending: number[] = [];
    context.textNodes.forEach((node, idx) => {
      const text = node.node.textContent ?? node.original ?? '';
      if (!isLikelyTargetLanguage(text, targetLang)) {
        pending.push(idx);
      }
    });
    setDocxIssueIndices(pending);
    if (pending.length === 0) {
      addLog('Docx audit: 所有段落均已翻译为目标语言。');
    } else {
      addLog(`Docx audit: 检测到 ${pending.length} 段文本仍包含源语言，可重译。`);
    }
  };

  const runDocxTranslation = async () => {
    const context = docxContextRef.current;
    if (!context) {
      addLog('Docx: 未检测到可翻译的内容。');
      return;
    }
    const nodes = context.textNodes;
    if (!nodes.length) {
      addLog('Docx: 文档中没有可翻译的文本节点。');
      return;
    }
    const candidates = nodes.filter((node) =>
      shouldTranslateDocxText(node.node.textContent ?? node.original)
    );
    if (!candidates.length) {
      addLog('Docx: 当前文档已经是目标语言或没有可翻译的文本。');
      return;
    }

    pauseRequestedRef.current = false;
    setDocxStats({ total: nodes.length, translated: 0 });
    setDocxIssueIndices([]);
    setTranslationStatus('running');
    setProcessingState({
      status: 'processing',
      progress: 0,
      total: candidates.length,
      currentBatch: 0
    });

    try {
      const result = await runStage('translate', async () => {
        let completed = 0;
        const totalBatches = Math.ceil(candidates.length / DOCX_BATCH_SIZE);

        for (let i = 0; i < candidates.length; i += DOCX_BATCH_SIZE) {
          const chunk = candidates.slice(i, i + DOCX_BATCH_SIZE);
          const batchNum = Math.floor(i / DOCX_BATCH_SIZE) + 1;
          addLog(`Docx Batch ${batchNum}/${totalBatches}: ${chunk.length} 段文本`);
          let translatedBatch: POCTRecord[];
          try {
            const payload = chunk.map((node) => {
              const rawText = node.node.textContent ?? node.original;
              const { sanitized, placeholders } = guardInlineTokens(rawText);
              if (placeholders) {
                docxPlaceholderStore.current.set(node.id, placeholders);
              } else {
                docxPlaceholderStore.current.delete(node.id);
              }
              return {
                content: sanitized
              };
            });
            translatedBatch = await translationHub.translateBatch({
              records: payload,
              targetLang,
              options: enginePreference === 'auto' ? undefined : { model: enginePreference }
            });
            addLog(`Docx Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(`Docx Batch ${batchNum} 翻译失败：${errMsg}`);
            continue;
          }

          chunk.forEach((node, index) => {
            const translatedRecord = translatedBatch[index] || {};
            const rawText = node.node.textContent ?? node.original;
            const placeholders = docxPlaceholderStore.current.get(node.id);
            const sanitizedResult =
              typeof translatedRecord.content === 'string'
                ? translatedRecord.content
                : rawText;
            const restored = restoreInlineTokens(sanitizedResult, placeholders);
            const polished = polishTranslation(rawText || '', restored);
            node.node.textContent = polished;
            node.original = polished;
          });

          completed += chunk.length;
          setDocxStats({ total: nodes.length, translated: completed });
          const progress = Math.round((completed / candidates.length) * 100);
          setProcessingState((prev) => ({
            ...prev,
            progress,
            currentBatch: batchNum
          }));
        }

        setProcessingState((prev) => ({
          ...prev,
          status: 'completed',
          progress: 100
        }));
        addLog(`DOCX Translation Completed: ${completed}/${candidates.length} 段文本处理完成。`);
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

  const retryDocxSegments = async () => {
    const context = docxContextRef.current;
    if (!context) return;
    if (docxIssueIndices.length === 0) {
      addLog('Docx: 当前没有需要重译的段落。');
      return;
    }
    const targets = docxIssueIndices
      .map(index => context.textNodes[index])
      .filter(Boolean);
    if (!targets.length) return;

    pauseRequestedRef.current = false;
    setTranslationStatus('running');
    setProcessingState({
      status: 'processing',
      progress: 0,
      total: targets.length,
      currentBatch: 0
    });

    try {
      await runStage('translate', async () => {
        let completed = 0;
        const totalBatches = Math.ceil(targets.length / DOCX_BATCH_SIZE);
        for (let i = 0; i < targets.length; i += DOCX_BATCH_SIZE) {
          const chunk = targets.slice(i, i + DOCX_BATCH_SIZE);
          const batchNum = Math.floor(i / DOCX_BATCH_SIZE) + 1;
          addLog(`Docx Retry Batch ${batchNum}/${totalBatches}: ${chunk.length} 段文本`);
          let translatedBatch: POCTRecord[];
          try {
            const payload = chunk.map((node) => {
              const rawText = node.node.textContent ?? node.original;
              const { sanitized, placeholders } = guardInlineTokens(rawText);
              if (placeholders) {
                docxPlaceholderStore.current.set(node.id, placeholders);
              } else {
                docxPlaceholderStore.current.delete(node.id);
              }
              return {
                content: sanitized
              };
            });
            translatedBatch = await translationHub.translateBatch({
              records: payload,
              targetLang,
              options: enginePreference === 'auto' ? undefined : { model: enginePreference }
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(`Docx Retry Batch ${batchNum} 失败：${errMsg}`);
            continue;
          }

          chunk.forEach((node, index) => {
            const translatedRecord = translatedBatch[index] || {};
            const rawText = node.node.textContent ?? node.original;
            const placeholders = docxPlaceholderStore.current.get(node.id);
            const sanitizedResult =
              typeof translatedRecord.content === 'string'
                ? translatedRecord.content
                : rawText;
            const restored = restoreInlineTokens(sanitizedResult, placeholders);
            const polished = polishTranslation(rawText || '', restored);
            node.node.textContent = polished;
            node.original = polished;
          });

          completed += chunk.length;
          setDocxStats(prev => ({
            total: prev.total || context.textNodes.length,
            translated: Math.min((prev.translated || 0) + chunk.length, prev.total || context.textNodes.length)
          }));
          const progress = Math.round((completed / targets.length) * 100);
          setProcessingState(prev => ({
            ...prev,
            progress,
            currentBatch: batchNum
          }));
        }

        setProcessingState(prev => ({
          ...prev,
          status: 'completed',
          progress: 100
        }));
        addLog(`Docx 重译完成：${completed}/${targets.length} 段。`);
        return 'completed';
      });
      setTranslationStatus('completed');
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
    const placeholderStore = new Map<number, Record<string, string> | null>();
    const indexMap = new Map<number, number>();
    const payload: POCTRecord[] = [];

    entries.forEach((entry, index) => {
      if (!entry.needsTranslation) return;
      const { sanitized, placeholders } = guardStringResourceTokens(entry.content);
      placeholderStore.set(index, placeholders || null);
      indexMap.set(index, payload.length);
      payload.push({ content: sanitized });
    });

    if (payload.length === 0) {
      const outputs: Record<string, string> = {};
      STRING_TARGET_LANGS.forEach((lang) => {
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

    const applyStringAutoFix = (text: string) => {
      const base = fixSpacingArtifacts(text);
      return base.replace(/\b([A-Za-z])\s+(\d{1,3})\b/g, '$1$2');
    };

    const buildOutput = (translatedBatch: POCTRecord[], lang: TargetLanguage) => {
      const mergedLines = entries.map((entry, index) => {
        if (!entry.needsTranslation) {
          return entry.original;
        }
        const batchIndex = indexMap.get(index);
        const translatedRecord =
          typeof batchIndex === 'number' ? translatedBatch[batchIndex] || {} : {};
        const candidate =
          typeof translatedRecord.content === 'string'
            ? translatedRecord.content
            : entry.content;
        const placeholders = placeholderStore.get(index);
        const restored = restoreStringResourceTokens(candidate, placeholders);
        const fixed = stringAutoFix ? applyStringAutoFix(restored) : restored;
        const polished = polishTranslation(entry.content || '', fixed);
        const normalized = normalizeTerminology({ content: polished }, lang);
        const normalizedContent =
          typeof normalized.content === 'string' ? normalized.content : polished;
        return `${entry.prefix}${normalizedContent}${entry.suffix}`;
      });
      return mergedLines.join(lineBreak) + (hasTrailingNewline ? lineBreak : '');
    };

    setStringStatus('running');
    setStringError(null);
    setStringQualitySummary(null);
    setStringErrorDetails(null);

    const results = await Promise.allSettled(
      STRING_TARGET_LANGS.map(async (lang) => {
        const translatedBatch = await translationHub.translateBatch({
          records: payload,
          targetLang: lang,
          options: enginePreference === 'auto' ? undefined : { model: enginePreference }
        });
        return buildOutput(translatedBatch, lang);
      })
    );

    const outputs: Record<string, string> = {};
    const failed: string[] = [];
    const failureDetails: string[] = [];
    results.forEach((result, index) => {
      const lang = STRING_TARGET_LANGS[index];
      if (result.status === 'fulfilled') {
        outputs[lang] = result.value;
      } else {
        failed.push(lang);
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failureDetails.push(`${lang}: ${reason}`);
      }
    });
    STRING_TARGET_LANGS.forEach((lang) => {
      if (outputs[lang] === undefined) {
        outputs[lang] = '';
      }
    });

    setStringOutputs(outputs);
    const hasContent = Object.values(outputs).some((value) => value && value.trim());
    if (hasContent) {
      const entry = {
        id: `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        source: input,
        outputs
      };
      const updated = appendStringHistory(entry);
      setStringHistoryCount(updated.length);
    }
    const qualityIssues: string[] = [];
    const analyzeStringOutput = (output: string, lang: TargetLanguage) => {
      const lines = output.split(/\r?\n/);
      const entries = lines.map(parseStringResourceLine);
      const contents = entries.map((entry) => entry.content);
      const untranslated = summarizeUntranslated(
        contents.map((content) => ({ content })),
        lang
      ).cells;
      const placeholderLeaks = contents.filter((content) =>
        PLACEHOLDER_REGEX.test(content)
      ).length;
      const spacingIssues = contents.filter((content) =>
        hasSpacingIssue(content)
      ).length;
      return { untranslated, placeholderLeaks, spacingIssues };
    };

    STRING_TARGET_LANGS.forEach((lang) => {
      const output = outputs[lang] || '';
      if (!output.trim()) return;
      const { untranslated, placeholderLeaks, spacingIssues } = analyzeStringOutput(output, lang);
      const parts: string[] = [];
      if (untranslated > 0) parts.push(`未翻译 ${untranslated}`);
      if (placeholderLeaks > 0) parts.push(`占位符 ${placeholderLeaks}`);
      if (spacingIssues > 0) parts.push(`空格异常 ${spacingIssues}`);
      if (parts.length > 0) {
        qualityIssues.push(`${lang}: ${parts.join('，')}`);
      }
    });
    if (qualityIssues.length > 0) {
      const summaryText = `质量检查：${qualityIssues.join('；')}。`;
      setStringQualitySummary(summaryText);
      addLog(summaryText);
    }

    if (failed.length > 0) {
      setStringStatus('error');
      setStringError(`翻译失败：${failed.join(', ')}`);
      if (failureDetails.length > 0) {
        setStringErrorDetails(failureDetails.slice(0, 4).join(' | '));
      }
    } else {
      setStringStatus('completed');
      setStringError(null);
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

  const clearStringHistoryData = () => {
    clearStringHistory();
    setStringHistoryCount(0);
    addLog('已清空字符串翻译记录。');
  };

  const runTranslation = async (mode: 'fresh' | 'resume' = 'fresh') => {
    if (documentKind === 'docx') {
      await runDocxTranslation();
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
    const workingMissing = new Set<number>(shouldResume ? missingRowIndices : []);

    if (!shouldResume) {
      clearTranslationProgress(fileId, targetLang);
      setProcessedData([]);
      setRules([]);
      setMissingCombinations([]);
      setAiFindings([]);
      setTranslationIssues(createIssueSummary());
      setTranslatedFlags([...initialFlags]);
      setMissingRowIndices([]);
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

          let translatedBatch: POCTRecord[];
          const batchPlaceholders: Array<Record<string, Record<string, string> | null>> = [];
          try {
            const sanitizedRecords = pendingIndices.map((rowIdx) => {
              const row = data[rowIdx];
              const placeholdersForRow: Record<string, Record<string, string> | null> = {};
              const sanitizedRow: POCTRecord = {};

              Object.entries(row).forEach(([key, value]) => {
                if (typeof value !== 'string') {
                  sanitizedRow[key] = value;
                  return;
                }
                if (!value.trim() || shouldLockCell(key, value) || !shouldTranslateValue(value)) {
                  sanitizedRow[key] = value;
                  return;
                }
                const { sanitized, placeholders } = guardTranslationTokens(value);
                if (placeholders) {
                  placeholdersForRow[key] = placeholders;
                }
                sanitizedRow[key] = sanitized;
              });

              batchPlaceholders.push(placeholdersForRow);
              return sanitizedRow;
            });
            translatedBatch = await translationHub.translateBatch({
              records: sanitizedRecords,
              targetLang,
              options: enginePreference === 'auto' ? undefined : { model: enginePreference }
            });
            addLog(`Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}`);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            addLog(`Translation warning: 批次 ${batchNum} 行 ${rowLabel} 失败 (${errMsg})，将跳过该批继续。`);
            pendingIndices.forEach(idx => missingRows.add(idx));
            const missingSnapshot = Array.from(missingRows).sort((a, b) => a - b);
            persistProgress(finalResults, flags, missingSnapshot);
            setMissingRowIndices(missingSnapshot);
            continue;
          }

          const incompleteRows: number[] = [];
          pendingIndices.forEach((rowIdx, index) => {
            const translated = translatedBatch[index];
            const original = data[rowIdx];
            const merged: POCTRecord = { ...original };
            const placeholdersForRow = batchPlaceholders[index] || {};

            const requiredKeys = Object.entries(original)
              .filter(([, value]) => typeof value === 'string' && shouldTranslateValue(value))
              .map(([key]) => key);
            const missingKeys: string[] = [];

            requiredKeys.forEach((key) => {
              if (!translated || translated[key] === undefined) {
                missingKeys.push(key);
              }
            });

            Object.keys(original).forEach(key => {
              if (!translated || translated[key] === undefined) return;
              const originalValue = original[key];
              if (shouldLockCell(key, originalValue) || !shouldTranslateValue(originalValue)) {
                merged[key] = originalValue;
                return;
              }
              const candidate = translated[key];
              merged[key] =
                typeof candidate === 'string'
                  ? polishTranslation(
                      typeof originalValue === 'string' ? (originalValue as string) : '',
                      candidate
                    )
                  : candidate;
              if (typeof merged[key] === 'string' && placeholdersForRow[key]) {
                merged[key] = restoreTranslationTokens(
                  merged[key] as string,
                  placeholdersForRow[key]
                );
              }
            });

            finalResults[rowIdx] = normalizeTerminology(merged, targetLang);
            const stillUntranslated =
              detectUntranslatedCells([finalResults[rowIdx]], targetLang).length > 0;
            if (missingKeys.length > 0 || stillUntranslated) {
              incompleteRows.push(rowIdx);
              missingRows.add(rowIdx);
              flags[rowIdx] = false;
            } else {
              flags[rowIdx] = true;
              missingRows.delete(rowIdx);
            }
          });
          if (incompleteRows.length > 0) {
            addLog(
              `Translation warning: 批次 ${batchNum} 有 ${incompleteRows.length} 行返回不完整，已标记为待重译。`
            );
          }

          const snapshot = finalResults.map(row => ({ ...row }));
          const flagsSnapshot = [...flags];
          const missingSnapshot = Array.from(missingRows).sort((a, b) => a - b);
          persistProgress(snapshot, flagsSnapshot, missingSnapshot);
          setProcessedData(snapshot);
          setTranslatedFlags(flagsSnapshot);
          setMissingRowIndices(missingSnapshot);

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
        const missingSnapshot = Array.from(missingRows).sort((a, b) => a - b);
        setMissingRowIndices(missingSnapshot);
        setTranslatedFlags([...flags]);
        const snapshot = finalResults.map(row => ({ ...row }));
        setProcessedData(snapshot);
        persistProgress(snapshot, [...flags], missingSnapshot);
        latestResults = snapshot;

        if (paused) {
          setProcessingState(prev => ({ ...prev, status: 'idle' }));
          setTranslationStatus('paused');
          return 'paused';
        }

        const completionMsg = `Translation Completed: ${completedCount}/${data.length} 行。`;
        addLog(missingSnapshot.length > 0 ? `${completionMsg} 尚有 ${missingSnapshot.length} 行待处理，可使用 Retry Missing Cells。` : completionMsg);
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
    const mergedRowIndices = Array.from(
      new Set([...summary.rowIndices, ...missingRowIndices])
    ).sort((a, b) => a - b);
    const mergedSummary: IssueSummaryState = {
      ...summary,
      rowIndices: mergedRowIndices,
      missingRows: [...missingRowIndices]
    };
    setTranslationIssues(mergedSummary);

    if (mergedSummary.cells === 0 && mergedSummary.missingRows.length === 0) {
      addLog('Translation audit: 所有单元格均为目标语言。');
      return;
    }

    if (mergedRowIndices.length === 0) {
      addLog('Translation audit: 检测到异常但无可定位的行，请手动核查。');
      return;
    }

    addLog(
      `Translation audit: 检测到 ${summary.cells} 个未翻译单元格，涉及 ${mergedRowIndices.length} 行。`
    );

    await retryMissingRows(mergedRowIndices, records);
  };

  const retryMissingRows = async (
    rowIndices: number[],
    baseSnapshot?: POCTRecord[]
  ) => {
    const uniqueIndices = Array.from(new Set(rowIndices))
      .filter(idx => idx >= 0 && idx < data.length)
      .sort((a, b) => a - b);
    if (uniqueIndices.length === 0) {
      addLog('Retry Missing Cells: 无待重译的行。');
      return;
    }
    addLog(`Retry Missing Cells: 针对 ${uniqueIndices.length} 行重新翻译...`);

    const fallbackPriority = getFallbackPriority();

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
      const row = data[rowIdx];
      const sanitizedRow: POCTRecord = {};
      const placeholdersForRow: Record<string, Record<string, string> | null> = {};
      keys.forEach((key) => {
        const value = row?.[key];
        if (typeof value !== 'string') {
          sanitizedRow[key] = value;
          return;
        }
        if (!value.trim() || shouldLockCell(key, value) || !shouldTranslateValue(value)) {
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
      const { refreshedMissing, mergedRowIndices } = refreshTranslationIssues(
        synced,
        missingRowIndices
      );
      setProcessedData(synced);
      setTranslatedFlags(flagsSnapshot);
      persistProgress(synced, flagsSnapshot, refreshedMissing);
      addLog('Retry Missing Cells: 当前没有可重译的单元格。');
      if (mergedRowIndices.length === 0) {
        addLog('Retry Missing Cells: 状态已刷新，当前无待补译内容。');
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
    const missingSet = new Set(missingRowIndices);

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
            options: { model }
          });
          addLog(`Retry Missing Cells: Batch ${batchNum} 使用 ${model} 成功。`);
          break;
        } catch (err) {
          addLog(`Retry Missing Cells: Batch ${batchNum} ${model} 失败 - ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (!translatedBatch) {
        addLog(`Retry Missing Cells: Batch ${batchNum} 所有备用模型失败，已跳过。`);
        continue;
      }

      chunk.forEach((item, index) => {
        const updated = translatedBatch?.[index];
        if (!updated) return;
        const rowIdx = item.rowIdx;
        const original = data[rowIdx];
        const merged: POCTRecord = { ...(baseProcessed[rowIdx] || original) };
        const placeholdersForRow = item.placeholders || {};
        let updatedCount = 0;

        item.keys.forEach((key) => {
          const originalValue = original[key];
          if (shouldLockCell(key, originalValue) || !shouldTranslateValue(originalValue)) {
            return;
          }
          if (updated[key] === undefined) return;
          const candidate = updated[key];
          merged[key] =
            typeof candidate === 'string'
              ? polishTranslation(
                  typeof originalValue === 'string' ? (originalValue as string) : '',
                  candidate
                )
              : candidate;
          if (typeof merged[key] === 'string' && placeholdersForRow[key]) {
            merged[key] = restoreTranslationTokens(
              merged[key] as string,
              placeholdersForRow[key]
            );
          }
          updatedCount += 1;
        });

        baseProcessed[rowIdx] = normalizeTerminology(merged, targetLang);
        const stillUntranslated =
          detectUntranslatedCells([baseProcessed[rowIdx]], targetLang).length > 0;
        const isComplete = updatedCount >= item.keys.size && !stillUntranslated;
        updatedFlags[rowIdx] = isComplete;
        if (isComplete) {
          missingSet.delete(rowIdx);
        } else {
          missingSet.add(rowIdx);
        }
      });

      const synced = baseProcessed.map(row => ({ ...row }));
      const flagsSnapshot = [...updatedFlags];
      const missingSnapshot = Array.from(missingSet)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      setProcessedData(synced);
      setTranslatedFlags(flagsSnapshot);
      setMissingRowIndices(missingSnapshot);
      persistProgress(synced, flagsSnapshot, missingSnapshot);
    }

    const synced = baseProcessed.map(row => ({ ...row }));
    const flagsSnapshot = [...updatedFlags];
    const missingSnapshot = Array.from(missingSet)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    setProcessedData(synced);
    setTranslatedFlags(flagsSnapshot);
    setMissingRowIndices(missingSnapshot);
    persistProgress(synced, flagsSnapshot, missingSnapshot);

    const summary = summarizeUntranslated(synced, targetLang);
    const mergedRowIndices = Array.from(
      new Set([...summary.rowIndices, ...missingSnapshot])
    ).sort((a, b) => a - b);
    setTranslationIssues({
      ...summary,
      rowIndices: mergedRowIndices,
      missingRows: missingSnapshot
    });

    if (mergedRowIndices.length === 0) {
      addLog('Retry Missing Cells: 重译后所有单元格均为目标语言。');
    } else {
      addLog(
        `Retry Missing Cells: 仍有 ${summary.cells} 个单元格或 ${missingSnapshot.length} 行未完全翻译，可继续重试。`
      );
    }
  };

  const retryCellsByKeys = async (
    items: Array<{ rowIdx: number; keys: Set<string> }>,
    label: string
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
        if (!value.trim() || shouldLockCell(key, value) || !shouldTranslateValue(value)) {
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

    const fallbackPriority = getFallbackPriority();

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
            options: { model }
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
          if (shouldLockCell(key, originalValue) || !shouldTranslateValue(originalValue)) {
            return;
          }
          if (updated[key] === undefined) return;
          const candidate = updated[key];
          merged[key] =
            typeof candidate === 'string'
              ? polishTranslation(
                  typeof originalValue === 'string' ? (originalValue as string) : '',
                  candidate
                )
              : candidate;
          if (typeof merged[key] === 'string' && placeholdersForRow[key]) {
            merged[key] = restoreTranslationTokens(
              merged[key] as string,
              placeholdersForRow[key]
            );
          }
        });

        baseProcessed[rowIdx] = normalizeTerminology(merged, targetLang);
        updatedFlags[rowIdx] = true;
      });

      const synced = baseProcessed.map(row => ({ ...row }));
      setProcessedData(synced);
      setTranslatedFlags([...updatedFlags]);
      persistProgress(synced, [...updatedFlags], missingRowIndices);
    }

    const synced = baseProcessed.map(row => ({ ...row }));
    setProcessedData(synced);
    setTranslatedFlags([...updatedFlags]);
    persistProgress(synced, [...updatedFlags], missingRowIndices);
    setQualityReport(runQualityChecks(data, synced));
    addLog(`${label}: 完成重译。`);
  };

  const retryPlaceholderCells = async () => {
    if (!qualityReport) {
      addLog('Retry Placeholder Cells: 请先执行质量检查。');
      return;
    }
    const issues = qualityReport.issues.placeholders;
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
    await retryCellsByKeys(items, 'Retry Placeholder Cells');
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
      if (!docxContextRef.current) return;
      const filename = `Translated_${targetLang}_${file?.name || 'Result.docx'}`;
      addLog(`Generating file: ${filename}`);
      exportDocxFile(docxContextRef.current, filename);
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
    documentKind === 'excel' && translationStatus === 'paused' && activeStage === null;
  const showPauseResume = isTranslating || canResume;
  const pauseResumeLabel = isTranslating ? 'Pause' : 'Resume';
  const pauseResumeDisabled = isTranslating ? activeStage !== 'translate' : !canResume;
  const pauseResumeHandler = isTranslating ? handlePause : () => runTranslation('resume');
  const canDownload =
    documentKind === 'docx'
      ? docxContextRef.current !== null && translationStatus !== 'running'
      : processedData.length > 0 && translationStatus !== 'running';
  const canRunTranslation =
    documentKind === 'docx' ? docxContextRef.current !== null : data.length > 0;
  const issueRowsForRetry = Array.from(new Set([...translationIssues.rowIndices, ...missingRowIndices]));
  const hasTranslationAlerts = issueRowsForRetry.length > 0 && documentKind === 'excel';
  const hasDocxIssues = documentKind === 'docx' && docxIssueIndices.length > 0;
  const missingRowPreview = formatRowRanges(missingRowIndices);
  const isStringTranslating = stringStatus === 'running';
  const hasStringOutputs = Object.keys(stringOutputs).length > 0;
  const hasQualityReport = Boolean(qualityReport);
  const placeholderIssueCount = qualityReport?.totals.placeholderCells ?? 0;
  const formatSnapshot = excelContext
    ? {
        sheetName: excelContext.sheetName,
        rows: excelContext.range.e.r - excelContext.range.s.r + 1,
        cols: excelContext.range.e.c - excelContext.range.s.c + 1,
        merges: (excelContext.worksheet['!merges'] || []).length
      }
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">使用说明</h2>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">可分享给他人</span>
            </div>
            <ol className="text-xs text-slate-400 space-y-2 list-decimal list-inside">
              <li>上传 Excel/DOCX 文件。</li>
              <li>选择目标语言与翻译策略。</li>
              <li>点击 Run Global Translation 开始。</li>
              <li>中途可 Pause 再导出检查进度。</li>
              <li>提示缺失时用 Retry Missing Cells 补译。</li>
            </ol>
            <details className="mt-3 border border-slate-800 rounded-lg bg-slate-950/40 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-400 uppercase tracking-wider">
                功能说明
              </summary>
              <ul className="mt-2 text-[11px] text-slate-500 space-y-1 list-disc list-inside">
                <li>全量翻译：重写所有行，适合首次翻译。</li>
                <li>智能补译：仅补中文单元格，适合修补或续翻。</li>
                <li>Retry Missing Cells：只重译缺失单元格，避免重复消耗。</li>
                <li>组合校验 / 多 AI 核验：可选质量检查。</li>
                <li>进度保存在浏览器本地，重新上传同一文件可继续。</li>
              </ul>
            </details>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
              Translation Settings
            </h2>
            
            <div className="space-y-4">
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">基础设置</h3>
              <label className="block">
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-800 border-dashed rounded-lg hover:border-indigo-500/50 transition-colors group cursor-pointer relative">
                  <input
                    type="file"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".xlsx,.xls,.docx"
                    onChange={handleFileUpload}
                    disabled={processingState.status === 'processing'}
                  />
                  <div className="space-y-1 text-center">
                    <svg className="mx-auto h-12 w-12 text-slate-500 group-hover:text-indigo-400 transition-colors" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="text-sm font-medium text-indigo-500">
                      {file ? file.name : "Upload Source Document"}
                    </div>
                    <p className="text-xs text-slate-500">
                      {documentKind === 'docx'
                        ? 'Supports DOCX manuals with original layout'
                        : 'Supports Excel (.xlsx/.xls) row-by-row precision'}
                    </p>
                  </div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Target Language</label>
                <select 
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
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
                  <option>Russian</option>
                  <option>Portuguese</option>
                </select>
              </div>
              {documentKind === 'docx' && docxContextRef.current && (
                <p className="text-xs text-slate-500 text-center">
                  DOCX 文本节点：{docxStats.total}，本次已翻译 {docxStats.translated}
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Translation Strategy</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTranslationMode('full')}
                    disabled={isTranslating}
                    className={`py-2 rounded-lg font-semibold border text-sm transition-all ${
                      translationMode === 'full'
                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-indigo-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    全量翻译
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranslationMode('selective')}
                    disabled={isTranslating}
                    className={`py-2 rounded-lg font-semibold border text-sm transition-all ${
                      translationMode === 'selective'
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    智能补译
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  全量翻译会重写所有行；智能补译仅对检测到中文的行调用模型。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Translation Engine</label>
                <select
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                  value={enginePreference}
                  onChange={(e) => setEnginePreference(e.target.value as 'auto' | 'openrouter' | 'deepseek')}
                  disabled={isTranslating}
                >
                  <option value="auto">Auto (优先 OpenRouter)</option>
                  <option value="openrouter" disabled={!capabilities.openrouter}>
                    OpenRouter Gemini 3 Flash {capabilities.openrouter ? '' : '(未配置)'}
                  </option>
                  <option value="deepseek" disabled={!capabilities.deepseek}>
                    Deepseek {capabilities.deepseek ? '' : '(未配置)'}
                  </option>
                </select>
              </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">核心操作</h3>
                <button 
                  onClick={() => runTranslation('fresh')}
                  disabled={!canRunTranslation || isTranslating}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all shadow-lg ${
                    !canRunTranslation || isTranslating
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 active:scale-95'
                  }`}
                  >
                    {isTranslating ? 'Translating...' : 'Run Global Translation'}
                  </button>

                {showPauseResume && (
                  <button
                    onClick={pauseResumeHandler}
                    disabled={pauseResumeDisabled}
                    className={`w-full py-3 rounded-lg font-semibold transition-all shadow-lg ${
                      pauseResumeDisabled
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : isTranslating
                        ? 'bg-slate-800 hover:bg-slate-700 text-white'
                        : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    }`}
                  >
                    {pauseResumeLabel}
                  </button>
                )}

                {(documentKind === 'docx' ? docxContextRef.current !== null : processedData.length > 0) && (
                  <button 
                    onClick={handleDownload}
                    disabled={!canDownload}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all shadow-lg ${
                      !canDownload
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
                    }`}
                  >
                    {translationStatus === 'running' ? 'Wait for Translation...' : 'Download Translated Document'}
                  </button>
                )}
              </div>

              {hasTranslationAlerts && (
                <div className="text-xs text-amber-300 text-center space-y-1">
                  {translationIssues.cells > 0 && (
                    <p>检测到 {translationIssues.cells} 个未翻译单元格（{translationIssues.rows} 行）。</p>
                  )}
                  {missingRowIndices.length > 0 && (
                    <p>有 {missingRowIndices.length} 行未写入（示例行：{missingRowPreview || 'N/A'}）。</p>
                  )}
                  <button
                    onClick={() => retryMissingRows(issueRowsForRetry)}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-all shadow-amber-500/20"
                    disabled={translationStatus === 'running'}
                  >
                    Retry Missing Cells
                  </button>
                </div>
              )}
              {hasDocxIssues && (
                <div className="text-xs text-amber-300 text-center space-y-1">
                  <p>DOCX 审计：仍有 {docxIssueIndices.length} 段文本包含中文。</p>
                  <button
                    onClick={retryDocxSegments}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-all shadow-amber-500/20"
                    disabled={translationStatus === 'running'}
                  >
                    Retry Missing Segments
                  </button>
                </div>
              )}

              <details className="mt-2 border border-slate-800 rounded-lg p-3 bg-slate-950/40">
                <summary className="cursor-pointer text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Advanced Checks
                </summary>
                <div className="mt-3 space-y-2">
                  <button
                    onClick={runRuleCheck}
                    disabled={data.length === 0 || isTranslating}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-semibold transition-all shadow-lg ${
                      data.length === 0 || isTranslating
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20 active:scale-95'
                    }`}
                  >
                    {activeStage === 'ruleCheck' ? 'Analyzing...' : 'Run Combination Check'}
                  </button>

                  <button
                    onClick={runAiValidation}
                    disabled={rules.length === 0 || isTranslating}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-semibold transition-all shadow-lg ${
                      rules.length === 0 || isTranslating
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20 active:scale-95'
                    }`}
                  >
                    {activeStage === 'aiValidate' ? 'Cross-checking...' : 'Run Multi-AI Validation'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  用于组合校验与多 AI 核验，非必需步骤。
                </p>
              </details>
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Progress Monitor</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-end text-sm">
                <span className="text-slate-300">Total Completion</span>
                <span className="font-mono text-indigo-400">{processingState.progress}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${processingState.progress}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 uppercase flex justify-between">
                <span>Rows: {processingState.total}</span>
                <span>Batch: {processingState.currentBatch}</span>
              </div>
              <div className="space-y-3 pt-2 border-t border-slate-800">
                {workflowStages.map(stage => (
                  <div key={stage.key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${
                          stage.status === 'completed'
                            ? 'bg-emerald-400'
                            : stage.status === 'running'
                            ? 'bg-indigo-400'
                            : stage.status === 'error'
                            ? 'bg-rose-400'
                            : 'bg-slate-600'
                        }`}></span>
                        <span className="text-slate-300">{stage.label}</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${getStageBadgeClass(stage.status)}`}>
                        {describeStageStatus(stage.status)}
                      </span>
                    </div>
                    {stage.message && (
                      <p className="text-[11px] text-slate-500 pl-5">{stage.message}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Analysis Snapshot</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center text-sm">
              <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                <p className="text-[11px] text-slate-500">Translation Flags</p>
                <p className={`text-xl font-semibold ${translationIssues.cells > 0 ? 'text-amber-300' : 'text-slate-200'}`}>
                  {translationIssues.cells}
                </p>
                <p className="text-[11px] text-slate-500">{translationIssues.rows} rows</p>
                {missingRowIndices.length > 0 && (
                  <p className="text-[11px] text-amber-300">Missing rows: {missingRowIndices.length}</p>
                )}
              </div>
              <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                <p className="text-[11px] text-slate-500">Rules Parsed</p>
                <p className="text-xl font-semibold text-slate-200">{rules.length}</p>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                <p className="text-[11px] text-slate-500">Missing Combos</p>
                <p className="text-xl font-semibold text-amber-300">{missingCombinations.length}</p>
              </div>
              <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                <p className="text-[11px] text-slate-500">AI Findings</p>
                <p className="text-xl font-semibold text-emerald-300">{aiFindings.length}</p>
              </div>
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Quality Check</h3>
            <div className="space-y-3">
              <button
                onClick={runQualityCheck}
                disabled={documentKind !== 'excel' || data.length === 0}
                className={`w-full py-2 rounded-lg font-semibold text-sm transition-all ${
                  documentKind !== 'excel' || data.length === 0
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
                }`}
              >
                Run Quality Check
              </button>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={applyQualityFixes}
                  disabled={documentKind !== 'excel' || processedData.length === 0}
                  className={`w-full py-2 rounded-lg font-semibold text-sm transition-all ${
                    documentKind !== 'excel' || processedData.length === 0
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
                  }`}
                >
                  Apply Cleanup
                </button>
                <button
                  onClick={retryPlaceholderCells}
                  disabled={!placeholderIssueCount || translationStatus === 'running'}
                  className={`w-full py-2 rounded-lg font-semibold text-sm transition-all ${
                    !placeholderIssueCount || translationStatus === 'running'
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20'
                  }`}
                >
                  Retry Placeholder Cells
                </button>
              </div>
            </div>

            {!hasQualityReport && (
              <p className="text-xs text-slate-500 mt-4">
                运行检查后会显示格式、ID、占位符与残留中文等统计。
              </p>
            )}

            {hasQualityReport && qualityReport && (
              <div className="mt-4 space-y-3 text-xs text-slate-400">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-slate-500">Scanned</p>
                    <p className="text-sm text-slate-200">
                      {qualityReport.totals.rowsScanned} rows / {qualityReport.totals.cellsScanned} cells
                    </p>
                  </div>
                  {formatSnapshot && (
                    <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                      <p className="text-[11px] text-slate-500">Format</p>
                      <p className="text-sm text-slate-200">
                        {formatSnapshot.sheetName} · {formatSnapshot.rows}x{formatSnapshot.cols} · merges {formatSnapshot.merges}
                      </p>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-slate-500">Chinese Residue</p>
                    <p className="text-sm text-slate-200">
                      {qualityReport.totals.chineseCells} cells / {qualityReport.totals.chineseRows} rows
                    </p>
                  </div>
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-slate-500">Placeholders</p>
                    <p className="text-sm text-slate-200">
                      {qualityReport.totals.placeholderCells} cells / {qualityReport.totals.placeholderRows} rows
                    </p>
                  </div>
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-slate-500">ID Mismatch</p>
                    <p className="text-sm text-slate-200">
                      {qualityReport.totals.idMismatches} cells / {qualityReport.totals.idMismatchRows} rows
                    </p>
                  </div>
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-slate-500">Spacing Issues</p>
                    <p className="text-sm text-slate-200">
                      {qualityReport.totals.spacingIssues} cells / {qualityReport.totals.spacingRows} rows
                    </p>
                  </div>
                </div>

                {qualityReport.issues.placeholders.length > 0 && (
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-amber-300 mb-1">Placeholder Samples</p>
                    {qualityReport.issues.placeholders.slice(0, 3).map((issue, idx) => (
                      <p key={`${issue.rowIndex}-${issue.columnKey}-${idx}`} className="text-[11px] text-slate-400">
                        行 {formatExcelRowNumber(issue.rowIndex)} · {issue.columnKey}
                      </p>
                    ))}
                  </div>
                )}
                {qualityReport.issues.idMismatch.length > 0 && (
                  <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800">
                    <p className="text-[11px] text-rose-300 mb-1">ID Mismatch Samples</p>
                    {qualityReport.issues.idMismatch.slice(0, 3).map((issue, idx) => (
                      <p key={`${issue.rowIndex}-${issue.columnKey}-${idx}`} className="text-[11px] text-slate-400">
                        行 {formatExcelRowNumber(issue.rowIndex)} · {issue.columnKey}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="lg:col-span-2 space-y-6 flex flex-col">
          <section className="flex-1 flex flex-col space-y-4">
             <div className="flex items-center justify-between">
               <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="w-1.5 h-6 bg-emerald-500 rounded-full"></span>
                Translation Logs
              </h2>
              <button onClick={() => setLogs([])} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>
             </div>
             <LogConsole logs={logs} />
          </section>

          <details className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
            <summary className="cursor-pointer list-none px-6 py-4 flex items-center justify-between text-sm font-semibold text-slate-300 uppercase">
              <span>String Resource Translator</span>
              <span className="text-[10px] text-slate-500">Optional</span>
            </summary>
            <div className="px-6 pb-6 pt-2 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  仅替换中文，保留格式与符号（如 %s / {0}）。
                </p>
                <button
                  onClick={clearStringResources}
                  className="text-xs text-slate-500 hover:text-slate-300"
                  disabled={isStringTranslating}
                >
                  Clear
                </button>
              </div>
              <textarea
                className="w-full bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[140px]"
                placeholder="粘贴 <string name=...>中文</string> 文本，系统会按 7 种语言输出。"
                value={stringInput}
                onChange={(e) => setStringInput(e.target.value)}
                disabled={isStringTranslating}
              />
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <button
                  onClick={translateStringResources}
                  disabled={!stringInput.trim() || isStringTranslating}
                  className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all shadow-lg ${
                    !stringInput.trim() || isStringTranslating
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 active:scale-95'
                  }`}
                >
                  {isStringTranslating ? 'Translating...' : 'Translate 7 Languages'}
                </button>
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
                  History: {stringHistoryCount} records
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={exportStringHistory}
                    disabled={stringHistoryCount === 0 || isStringTranslating}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      stringHistoryCount === 0 || isStringTranslating
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    Export TXT
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
                    Clear History
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t border-slate-800">
                  {STRING_TARGET_LANGS.map((lang) => (
                    <div
                      key={lang}
                      className="bg-slate-950/50 border border-slate-800 rounded-lg p-3"
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
                        className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-xs text-slate-200 min-h-[120px] resize-vertical"
                        value={stringOutputs[lang] || ''}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex-1 max-h-[400px]">
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase">Live Data Preview</h2>
                {processedData.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={showComparison}
                        onChange={() => setShowComparison(!showComparison)}
                      />
                      <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      <span className="ml-2 text-xs text-slate-400 font-medium">Verify Mode (Show Original)</span>
                    </label>
                  </div>
                )}
              </div>
              <div className="text-[10px] text-slate-500">
                {processedData.length > 0 
                  ? `Showing last ${Math.min(5, processedData.length)} of ${processedData.length} rows` 
                  : "No data"}
              </div>
            </div>
            
            <div className="overflow-auto h-[350px] scrollbar-thin scrollbar-thumb-slate-800">
              {processedData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm italic">
                  Waiting for data...
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-full table-fixed">
                  <thead className="sticky top-0 bg-slate-800 text-[10px] font-semibold text-slate-400 uppercase z-10 shadow-sm">
                    <tr>
                      {Object.keys(processedData[0]).slice(0, 6).map(key => (
                        <th key={key} className="px-4 py-3 border-b border-slate-700 truncate w-40">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {/* Reverse slice to show latest first or keep standard order, utilizing slice(-5) for tailing logs style */}
                    {processedData.slice(-10).reverse().map((record, reverseIndex) => {
                      // Calculate actual index to retrieve original data
                      const actualIndex = processedData.length - 1 - reverseIndex;
                      const originalRecord = data[actualIndex];

                      return (
                        <tr key={actualIndex} className="hover:bg-slate-800/30 transition-colors">
                          {Object.keys(record).slice(0, 6).map((key, j) => {
                            const val = record[key];
                            const origVal = originalRecord ? originalRecord[key] : '';
                            const isDiff = hasChanged(origVal, val);
                            
                            return (
                              <td key={j} className="px-4 py-3 border-b border-slate-800/50">
                                <div className="flex flex-col gap-0.5">
                                  <span className={`text-xs truncate whitespace-nowrap ${isDiff ? 'text-indigo-300 font-medium' : 'text-slate-300'}`}>
                                    {String(val)}
                                  </span>
                                  
                                  {showComparison && isDiff && (
                                    <span className="text-[10px] text-slate-500 truncate whitespace-nowrap bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50 w-fit max-w-full">
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

          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Missing Combination Highlights</h3>
                {missingCombinations.length === 0 ? (
                  <p className="text-slate-500 text-sm">尚未检测到缺失组合。</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-auto pr-2">
                    {missingCombinations.slice(0, 5).map(item => (
                      <li key={item.id} className="bg-slate-950/40 border border-amber-500/30 rounded-lg p-3">
                        <p className="text-sm text-amber-200 font-medium">{item.indicator}</p>
                        <p className="text-xs text-slate-400 mt-1">{item.suggestion}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">AI Cross-Check Signals</h3>
                {aiFindings.length === 0 ? (
                  <p className="text-slate-500 text-sm">等待 AI 核验结果...</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-auto pr-2">
                    {aiFindings.slice(0, 5).map(item => (
                      <li key={item.ruleId} className="bg-slate-950/40 border border-indigo-500/20 rounded-lg p-3">
                        <p className="text-sm text-slate-200 font-semibold">Rule {item.ruleId}</p>
                        <p className="text-xs text-slate-400 mt-1">{item.aggregatedSummary}</p>
                        <p className="text-[11px] text-emerald-400 mt-2">{item.finalRecommendation}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
