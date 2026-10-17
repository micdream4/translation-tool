import type { TranslationHub, TranslationRequest } from "../services/translationHub";
import type { BatchMonitor, POCTRecord, ProcessingState, TargetLanguage, WorkflowStageKey } from "../types";
import type { PdfContext, PdfSegment } from '../utils/pdf';
import { getPdfSegmentText, setPdfSegmentText } from '../utils/pdfSegments';
import { polishTranslation } from "../utils/postprocess";
import {
  buildAdaptiveTextBatches,
  formatElapsedSeconds,
  isPendingSegment,
  sumBatchTextChars
} from "../utils/translationBatching";
import { guardTranslationTokens, restoreTranslationTokens } from "../utils/translationTokens";
import type { TranslationMemoryPair } from "../utils/translationMemory";

type TranslationMemoryStats = {
  hits: number;
  deduped: number;
  stored: number;
};

type SetProcessingState = (
  value: ProcessingState | ((previous: ProcessingState) => ProcessingState)
) => void;
type StageResult = "paused" | "completed" | "stale" | void;

export interface PdfTranslationWorkflowOptions {
  context: PdfContext;
  mode?: "fresh" | "resume";
  batchSize: number;
  batchCharLimit?: number;
  targetLang: TargetLanguage;
  documentKind: string;
  fileName?: string;
  translationHub: TranslationHub;
  placeholderStore: Map<string, Record<string, string>>;
  pauseRequestedRef: { current: boolean };
  addLog: (message: string) => void;
  batchMonitor?: BatchMonitor;
  getUsedModelLabel?: () => string;
  modelLabel?: string;
  shouldTranslateText: (text: string) => boolean;
  dedupeLeadingRepeat: (source: string, translated: string) => string;
  getTranslationOptions: () => TranslationRequest["options"];
  createTranslationMemoryStats: () => TranslationMemoryStats;
  lookupReusableTranslations: (sourceTexts: string[]) => Promise<Map<string, string>>;
  getTranslationMemoryKey: (sourceText: string) => string;
  rememberTranslationPairs: (
    pairs: TranslationMemoryPair[],
    stats?: TranslationMemoryStats
  ) => Promise<void>;
  logTranslationMemoryStats: (label: string, stats: TranslationMemoryStats) => void;
  runStage: (
    key: WorkflowStageKey,
    handler: () => Promise<StageResult>,
    options?: { preserveCompleted?: boolean }
  ) => Promise<StageResult>;
  setPdfStats: (stats: { pages: number; total: number; translated: number }) => void;
  setTranslationStatus: (status: "idle" | "running" | "paused" | "completed") => void;
  setProcessingState: SetProcessingState;
}

export const runPdfTranslationWorkflow = async ({
  context,
  mode = "fresh",
  batchSize,
  batchCharLimit = 12000,
  targetLang,
  documentKind,
  fileName,
  translationHub,
  placeholderStore,
  pauseRequestedRef,
  addLog,
  batchMonitor,
  getUsedModelLabel,
  modelLabel,
  shouldTranslateText,
  dedupeLeadingRepeat,
  getTranslationOptions,
  createTranslationMemoryStats,
  lookupReusableTranslations,
  getTranslationMemoryKey,
  rememberTranslationPairs,
  logTranslationMemoryStats,
  runStage,
  setPdfStats,
  setTranslationStatus,
  setProcessingState
}: PdfTranslationWorkflowOptions) => {
  const segments = context.segments;
  const candidates = segments.filter((segment) =>
    mode === "resume"
      ? isPendingSegment(segment.original, segment.translated) && shouldTranslateText(segment.original)
      : shouldTranslateText(getPdfSegmentText(segment) || segment.original)
  );
  const countTranslated = () => segments.filter((segment) => segment.translated.trim()).length;
  if (!candidates.length) {
    addLog("PDF: 当前文档已经是目标语言或没有可翻译的文本。");
    return;
  }

  pauseRequestedRef.current = false;
  const alreadyTranslated = Math.max(0, segments.length - candidates.length);
  setPdfStats({ pages: context.pageCount, total: segments.length, translated: countTranslated() });
  setTranslationStatus("running");
  if (mode === "resume") {
    addLog(
      `PDF Resume: 已处理 ${alreadyTranslated}/${segments.length}，继续处理剩余 ${candidates.length} 个文本段。`
    );
  }
  setProcessingState({
    status: "processing",
    progress: 0,
    total: candidates.length,
    currentBatch: 0
  });

  try {
    const result = await runStage("translate", async () => {
      let completed = 0;
      let failedSegments = 0;
      let paused = false;
      // Source text and translation-memory keys always come from the original segment, so a
      // resumed run never stores a partial translation as if it were source text.
      const batches = buildAdaptiveTextBatches({
        items: candidates,
        getText: (segment) => segment.original || getPdfSegmentText(segment),
        maxItems: batchSize,
        maxChars: batchCharLimit
      });
      const totalBatches = batches.length;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        if (pauseRequestedRef.current) {
          paused = true;
          addLog(`PDF translation paused before batch ${batchIndex + 1}.`);
          break;
        }
        const chunk = batches[batchIndex];
        const batchNum = batchIndex + 1;
        const chunkChars = sumBatchTextChars(
          chunk,
          (segment) => segment.original || getPdfSegmentText(segment)
        );
        addLog(`PDF Batch ${batchNum}/${totalBatches}: ${chunk.length} 个文本段，约 ${chunkChars} 字符`);
        batchMonitor?.begin({ kind: 'pdf', batchNum, totalBatches, items: chunk.length, unit: 'segments' });
        const memoryStats = createTranslationMemoryStats();
        const memoryHits = await lookupReusableTranslations(
          chunk.map((segment) => segment.original || getPdfSegmentText(segment))
        );
        const leaders: Array<{
          segment: PdfSegment;
          rawText: string;
          sanitized: string;
          placeholders: Record<string, string> | null;
          memoryKey: string;
        }> = [];
        const followers = new Map<string, PdfSegment[]>();
        const seenInBatch = new Set<string>();

        chunk.forEach((segment) => {
          const rawText = segment.original || getPdfSegmentText(segment);
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
            placeholderStore.set(segment.id, placeholders);
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
              options: getTranslationOptions()
            });
            addLog(
              `PDF Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}，模型: ${getUsedModelLabel?.() || modelLabel || "unknown"}，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}`
            );
            batchMonitor?.end('pdf', batchNum, 'ok');
          } else {
            addLog(`PDF Batch ${batchNum}: 全部命中本地翻译记忆。`);
            batchMonitor?.end('pdf', batchNum, 'memory');
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          addLog(
            `PDF Batch ${batchNum} 翻译失败，模型: ${modelLabel || "unknown"}，用时 ${formatElapsedSeconds(
              Date.now() - batchStartedAt
            )}：${errMsg}`
          );
          batchMonitor?.end('pdf', batchNum, 'failed', errMsg);
          failedSegments += chunk.length;
          continue;
        }

        const memoryPairs: TranslationMemoryPair[] = [];
        leaders.forEach((leader, index) => {
          const segment = leader.segment;
          const translatedRecord = translatedBatch[index] || {};
          const rawText = leader.rawText;
          const placeholders = leader.placeholders || placeholderStore.get(segment.id);
          // No reply for this segment: leave it empty so it is reported and retried, never
          // filled with the source text as if it had been translated.
          const sanitizedResult =
            typeof translatedRecord.content === "string" ? translatedRecord.content : "";
          const restored = sanitizedResult.trim() ? restoreTranslationTokens(sanitizedResult, placeholders) : "";
          const polished = restored
            ? dedupeLeadingRepeat(rawText || "", polishTranslation(rawText || "", restored, targetLang))
            : "";
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
            fileName
          });
        });
        await rememberTranslationPairs(memoryPairs, memoryStats);
        logTranslationMemoryStats(`PDF Batch ${batchNum}`, memoryStats);

        completed += chunk.length;
        setPdfStats({
          pages: context.pageCount,
          total: segments.length,
          translated: countTranslated()
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
        setProcessingState((prev) => ({ ...prev, status: "idle" }));
        setTranslationStatus("paused");
        return "paused";
      }

      if (failedSegments > 0) {
        // Failed batches are not "done": show the real progress and leave Resume available,
        // which sends only the segments that are still untranslated.
        setProcessingState((prev) => ({
          ...prev,
          status: "idle",
          progress: Math.round((completed / candidates.length) * 100)
        }));
        setTranslationStatus("paused");
        addLog(
          `PDF Translation incomplete: ${completed}/${candidates.length} 个文本段完成，${failedSegments} 段因批次失败未翻译。点击 Resume 只补译未完成的段。`
        );
        return "paused";
      }
      setProcessingState((prev) => ({
        ...prev,
        status: "completed",
        progress: 100
      }));
      addLog(`PDF Translation Completed: ${completed}/${candidates.length} 个文本段处理完成。`);
      return "completed";
    });

    if (result !== "paused") {
      setTranslationStatus("completed");
    }
  } catch (error) {
    setTranslationStatus("idle");
    addLog(`PDF Translation Failed: ${error instanceof Error ? error.message : String(error)}`);
    setProcessingState((prev) => ({ ...prev, status: "error" }));
  }
};
