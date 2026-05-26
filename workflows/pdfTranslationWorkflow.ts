import type { TranslationHub, TranslationRequest } from "../services/translationHub";
import type { POCTRecord, ProcessingState, TargetLanguage, WorkflowStageKey } from "../types";
import { getPdfSegmentText, setPdfSegmentText, type PdfContext, type PdfSegment } from "../utils/pdf";
import { polishTranslation } from "../utils/postprocess";
import {
  buildAdaptiveTextBatches,
  formatElapsedSeconds,
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
type StageResult = "paused" | "completed" | void;

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
  shouldTranslateText: (text: string) => boolean;
  dedupeLeadingRepeat: (source: string, translated: string) => string;
  getTranslationOptions: () => TranslationRequest["options"];
  applyLatestModelCooldowns?: (contextLabel: string) => void;
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
  shouldTranslateText,
  dedupeLeadingRepeat,
  getTranslationOptions,
  applyLatestModelCooldowns,
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
    shouldTranslateText(getPdfSegmentText(segment) || segment.original)
  );
  if (!candidates.length) {
    addLog("PDF: 当前文档已经是目标语言或没有可翻译的文本。");
    return;
  }

  pauseRequestedRef.current = false;
  const alreadyTranslated = Math.max(0, segments.length - candidates.length);
  setPdfStats({ pages: context.pageCount, total: segments.length, translated: alreadyTranslated });
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
      let paused = false;
      const batches = buildAdaptiveTextBatches({
        items: candidates,
        getText: (segment) => getPdfSegmentText(segment) || segment.original,
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
          (segment) => getPdfSegmentText(segment) || segment.original
        );
        addLog(`PDF Batch ${batchNum}/${totalBatches}: ${chunk.length} 个文本段，约 ${chunkChars} 字符`);
        const memoryStats = createTranslationMemoryStats();
        const memoryHits = await lookupReusableTranslations(
          chunk.map((segment) => getPdfSegmentText(segment) || segment.original)
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
            applyLatestModelCooldowns?.(`PDF Batch ${batchNum}`);
            addLog(
              `PDF Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}，用时 ${formatElapsedSeconds(
                Date.now() - batchStartedAt
              )}`
            );
          } else {
            addLog(`PDF Batch ${batchNum}: 全部命中本地翻译记忆。`);
          }
        } catch (err) {
          applyLatestModelCooldowns?.(`PDF Batch ${batchNum}`);
          const errMsg = err instanceof Error ? err.message : String(err);
          addLog(
            `PDF Batch ${batchNum} 翻译失败，用时 ${formatElapsedSeconds(
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
          const placeholders = leader.placeholders || placeholderStore.get(segment.id);
          const sanitizedResult =
            typeof translatedRecord.content === "string" ? translatedRecord.content : rawText;
          const restored = restoreTranslationTokens(sanitizedResult, placeholders);
          const polished = dedupeLeadingRepeat(
            rawText || "",
            polishTranslation(rawText || "", restored, targetLang)
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
            fileName
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
        setProcessingState((prev) => ({ ...prev, status: "idle" }));
        setTranslationStatus("paused");
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
