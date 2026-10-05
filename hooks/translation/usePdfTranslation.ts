
import React from 'react';
import type { DocxIssueDetail } from '../../components/translator/types';
import {
  buildTextSegmentRetryPlan
} from '../../quality/retryTargets';
import type { QualityReport } from '../../quality/types';
import { TranslationHub } from '../../services/translationHub';
import {
  BatchMonitor,
  POCTRecord,
  ProcessingState,
  TargetLanguage,
  WorkflowStageKey
} from '../../types';
import type { PdfContext, PdfSegment } from '../../utils/pdf';
import { getPdfSegmentText, setPdfSegmentText } from '../../utils/pdfSegments';
import { polishTranslation } from '../../utils/postprocess';
import {
  PLACEHOLDER_REGEX
} from '../../utils/quality';
import {
  buildAdaptiveTextBatches,
  formatElapsedSeconds,
  sumBatchTextChars
} from '../../utils/translationBatching';
import {
  type TranslationMemoryPair
} from '../../utils/translationMemory';
import {
  guardTranslationTokens,
  restoreTranslationTokens
} from '../../utils/translationTokens';
import type {
  StageResult,
  TranslationMemoryStats
} from '../../utils/translatorShared';
import {
  DOCX_PLACEHOLDER_VARIANT_REGEX,
  dedupeLeadingRepeat
} from '../../utils/translatorShared';
import { runPdfTranslationWorkflow } from '../../workflows/pdfTranslationWorkflow';

export interface PdfTranslationContext {
  addLog: (msg: string) => void;
  applyLatestOpenRouterModelCooldowns: (contextLabel: string) => void;
  batchMonitor: BatchMonitor;
  buildPdfIssueDetails: (context: PdfContext) => { pending: number[]; details: DocxIssueDetail[]; qualityReport: QualityReport; };
  createTranslationMemoryStats: () => TranslationMemoryStats;
  currentModelDisplayLabel: string;
  documentKind: "docx" | "pdf" | "excel";
  docxPlaceholderStore: React.RefObject<Map<string, Record<string, string>>>;
  file: File;
  getDocumentBatchPolicy: () => { maxItems: number; maxChars: number; label: string; };
  getDocumentQualityTranslationOptions: () => { model: "cloudflare-ai"; providerModel: string; profile: "docx-manual"; openRouterModel?: undefined; openRouterModels?: undefined; } | { model: "deepseek"; providerModel: string; profile: "docx-manual"; openRouterModel?: undefined; openRouterModels?: undefined; } | { model: "openrouter"; openRouterModel: string; profile: "docx-manual"; providerModel?: undefined; openRouterModels?: undefined; } | { profile: "docx-manual"; openRouterModels: string[]; model?: undefined; providerModel?: undefined; openRouterModel?: undefined; };
  getTranslationMemoryKey: (sourceText: string, lang?: TargetLanguage) => string;
  getUsedModelLabel: () => string;
  logTranslationMemoryStats: (label: string, stats: TranslationMemoryStats) => void;
  lookupReusableTranslations: (sourceTexts: string[], lang?: TargetLanguage) => Promise<Map<string, string>>;
  pauseRequestedRef: React.RefObject<boolean>;
  pdfContextRef: React.RefObject<PdfContext>;
  pdfIssueDetails: DocxIssueDetail[];
  pdfIssueIndices: number[];
  rememberTranslationPairs: (pairs: TranslationMemoryPair[], stats?: TranslationMemoryStats) => Promise<void>;
  runStage: (key: WorkflowStageKey, task: () => Promise<StageResult>) => Promise<StageResult>;
  setPdfIssueDetails: React.Dispatch<React.SetStateAction<DocxIssueDetail[]>>;
  setPdfIssueIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setPdfStats: React.Dispatch<React.SetStateAction<{ pages: number; total: number; translated: number; }>>;
  setProcessingState: React.Dispatch<React.SetStateAction<ProcessingState>>;
  setTranslationStatus: React.Dispatch<React.SetStateAction<"paused" | "completed" | "idle" | "running">>;
  shouldTranslateDocxText: (text: string) => boolean;
  syncDocumentIssueSummary: (details: DocxIssueDetail[]) => void;
  targetLang: string;
  translationHub: TranslationHub;
}

export const usePdfTranslation = (ctx: PdfTranslationContext) => {
  const {
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
  } = ctx;

  const runPdfTranslation = async (mode: 'fresh' | 'resume' = 'fresh') => {
    const context = pdfContextRef.current;
    if (!context) {
      addLog('PDF: 未检测到可翻译的内容。');
      return;
    }
    const documentBatchPolicy = getDocumentBatchPolicy();
    addLog(
      `PDF: 使用 ${currentModelDisplayLabel}，每批最多 ${documentBatchPolicy.maxItems} 段 / ${documentBatchPolicy.maxChars} 字符（${documentBatchPolicy.label}）。`
    );

    await runPdfTranslationWorkflow({
      context,
      mode,
      batchSize: documentBatchPolicy.maxItems,
      batchCharLimit: documentBatchPolicy.maxChars,
      targetLang,
      documentKind,
      fileName: file?.name,
      translationHub,
      placeholderStore: docxPlaceholderStore.current,
      pauseRequestedRef,
      addLog,
      batchMonitor,
      getUsedModelLabel,
      modelLabel: currentModelDisplayLabel,
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
        const documentBatchPolicy = getDocumentBatchPolicy();
        const batches = buildAdaptiveTextBatches<PdfSegment>({
          items: targets,
          getText: (segment) => getPdfSegmentText(segment) || segment.original,
          maxItems: documentBatchPolicy.maxItems,
          maxChars: documentBatchPolicy.maxChars
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
              `PDF Retry Batch ${batchNum} 失败，模型: ${currentModelDisplayLabel}，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}：${errMsg}`
            );
            continue;
          }
          addLog(
            `PDF Retry Batch ${batchNum} 完成，模型: ${currentModelDisplayLabel}，用时 ${formatElapsedSeconds(Date.now() - batchStartedAt)}`
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

  return {
    runPdfTranslation,
    retryPdfSegments
  };
};
