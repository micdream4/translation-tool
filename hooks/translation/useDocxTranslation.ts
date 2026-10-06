
import React from 'react';
import type { TranslationRequest } from '../../services/translationHub';
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
import {
  getDocxSegmentText,
  setDocxSegmentText,
  type DocxContext,
  type DocxSegment
} from '../../utils/docx';
import { polishTranslation } from '../../utils/postprocess';
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
  dedupeLeadingRepeat
} from '../../utils/translatorShared';

export interface DocxTranslationContext {
  addLog: (msg: string) => void;
  batchMonitor: BatchMonitor;
  buildDocxIssueDetails: (context: DocxContext) => { pending: number[]; details: DocxIssueDetail[]; qualityReport: QualityReport; };
  createTranslationMemoryStats: () => TranslationMemoryStats;
  currentModelDisplayLabel: string;
  documentKind: "docx" | "pdf" | "excel";
  docxContextRef: React.RefObject<DocxContext>;
  docxIssueDetails: DocxIssueDetail[];
  docxIssueIndices: number[];
  docxPlaceholderStore: React.RefObject<Map<string, Record<string, string>>>;
  file: File;
  getDocumentBatchPolicy: () => { maxItems: number; maxChars: number; label: string; };
  getDocumentQualityTranslationOptions: () => TranslationRequest['options'];
  getTranslationMemoryKey: (sourceText: string, lang?: TargetLanguage) => string;
  getUsedModelLabel: () => string;
  logTranslationMemoryStats: (label: string, stats: TranslationMemoryStats) => void;
  lookupReusableTranslations: (sourceTexts: string[], lang?: TargetLanguage) => Promise<Map<string, string>>;
  pauseRequestedRef: React.RefObject<boolean>;
  rememberTranslationPairs: (pairs: TranslationMemoryPair[], stats?: TranslationMemoryStats) => Promise<void>;
  runStage: (key: WorkflowStageKey, task: () => Promise<StageResult>) => Promise<StageResult>;
  setDocxIssueDetails: React.Dispatch<React.SetStateAction<DocxIssueDetail[]>>;
  setDocxIssueIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setDocxStats: React.Dispatch<React.SetStateAction<{ total: number; translated: number; }>>;
  setProcessingState: React.Dispatch<React.SetStateAction<ProcessingState>>;
  setTranslationStatus: React.Dispatch<React.SetStateAction<"paused" | "completed" | "idle" | "running">>;
  shouldTranslateDocxText: (text: string) => boolean;
  syncDocumentIssueSummary: (details: DocxIssueDetail[]) => void;
  targetLang: string;
  translationHub: TranslationHub;
}

export const useDocxTranslation = (ctx: DocxTranslationContext) => {
  const {
    addLog,
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
  } = ctx;

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
    const documentBatchPolicy = getDocumentBatchPolicy();
    const batches = buildAdaptiveTextBatches<DocxSegment>({
      items: candidates,
      getText: (segment) => getDocxSegmentText(segment) || segment.original,
      maxItems: documentBatchPolicy.maxItems,
      maxChars: documentBatchPolicy.maxChars
    });
    addLog(
      `Docx: 使用 ${currentModelDisplayLabel}，按 ${batches.length} 批处理；每批最多 ${documentBatchPolicy.maxItems} 段 / ${documentBatchPolicy.maxChars} 字符（${documentBatchPolicy.label}）。`
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
          batchMonitor.begin({ kind: 'docx', batchNum, totalBatches, items: chunk.length, unit: 'segments' });
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
              addLog(
                `Docx Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}，模型: ${getUsedModelLabel()}，用时 ${formatElapsedSeconds(
                  Date.now() - batchStartedAt
                )}`
              );
              batchMonitor.end('docx', batchNum, 'ok');
            } else {
              addLog(`Docx Batch ${batchNum}: 全部命中本地翻译记忆。`);
              batchMonitor.end('docx', batchNum, 'memory');
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(
              `Docx Batch ${batchNum} 翻译失败，模型: ${currentModelDisplayLabel}，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}：${errMsg}`
            );
            batchMonitor.end('docx', batchNum, 'failed', errMsg);
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
        const documentBatchPolicy = getDocumentBatchPolicy();
        const batches = buildAdaptiveTextBatches<DocxSegment>({
          items: targets,
          getText: (segment) => segment.original || getDocxSegmentText(segment),
          maxItems: documentBatchPolicy.maxItems,
          maxChars: documentBatchPolicy.maxChars
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
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog(
              `Docx Retry Batch ${batchNum} 失败，模型: ${currentModelDisplayLabel}，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}：${errMsg}`
            );
            continue;
          }
          addLog(
            `Docx Retry Batch ${batchNum} 完成，模型: ${currentModelDisplayLabel}，用时 ${formatElapsedSeconds(
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

  return {
    runDocxTranslation,
    retryDocxSegments
  };
};
