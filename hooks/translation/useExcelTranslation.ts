
import React from 'react';
import type { TranslationRequest } from '../../services/translationHub';
import {
  buildExcelRetryTargets
} from '../../quality/retryTargets';
import type { QualityReport } from '../../quality/types';
import { TranslationHub } from '../../services/translationHub';
import type { UntranslatedSummary } from '../../types';
import {
  BatchMonitor,
  BatchRun,
  POCTRecord,
  ProcessingState,
  TargetLanguage,
  WorkflowStageKey
} from '../../types';
import type { ExcelSkipScope } from '../../utils/excelSkipScope';
import type { UntranslatedCell } from '../../utils/language';
import { detectUntranslatedCells,isNeutralToken } from '../../utils/language';
import { polishTranslation } from '../../utils/postprocess';
import {
  collectPlaceholderIssues,
  runQualityChecks,
  type QualityCheckOptions
} from '../../utils/quality';
import {
  clearTranslationProgress,
  type TranslationProgressSnapshot
} from '../../utils/storage';
import { normalizeTerminology } from '../../utils/terminology';
import {
  formatElapsedSeconds
} from '../../utils/translationBatching';
import {
  type TranslationMemoryPair
} from '../../utils/translationMemory';
import {
  guardTranslationTokens,
  restoreTranslationTokens
} from '../../utils/translationTokens';
import type {
  IssueSummaryState,
  StageResult,
  TranslationEngine,
  TranslationMemoryStats
} from '../../utils/translatorShared';
import {
  AUTO_MODEL,
  RETRY_BATCH_SIZE,
  cellNeedsTranslation,
  createIssueSummary,
  formatRowRanges,
  getCloudflareAiProviderModel,
  getDeepSeekDirectProviderModel,
  isCloudflareAiModelValue,
  isDeepSeekDirectModel,
  shouldLockCell
} from '../../utils/translatorShared';
import { summarizeUntranslated } from '../../utils/untranslated';

export interface ExcelTranslationContext {
  addLog: (msg: string) => void;
  autoRepairExcelPlaceholders: (records: POCTRecord[], options?: { mutateState?: boolean; logLabel?: string; }) => { records: POCTRecord[]; fixedCells: number; cleanedCells: number; remainingCells: number; changed: boolean; };
  batchMonitor: BatchMonitor;
  createTranslationMemoryStats: () => TranslationMemoryStats;
  data: POCTRecord[];
  documentKind: "excel" | "docx" | "pdf";
  excelQualityOptions: QualityCheckOptions;
  excelSkipScope: ExcelSkipScope;
  excelSkipScopeSummary: string;
  file: File;
  fileId: string;
  formatIssueLocationPreview: (details: UntranslatedCell[], limit?: number) => string;
  getFallbackPriority: (respectSelectedEngine?: boolean) => TranslationEngine[];
  getRetryAttemptModelLabel: (model: TranslationEngine) => string;
  getSpreadsheetBatchSize: () => number;
  getTranslationMemoryKey: (sourceText: string, lang?: TargetLanguage) => string;
  getTranslationOptions: () => TranslationRequest['options'];
  getUsedModelLabel: () => string;
  isRetryingMissing: boolean;
  logTranslationMemoryStats: (label: string, stats: TranslationMemoryStats) => void;
  lookupReusableTranslations: (sourceTexts: string[], lang?: TargetLanguage) => Promise<Map<string, string>>;
  missingRowIndices: number[];
  pauseRequestedRef: React.RefObject<boolean>;
  persistProgress: (records: POCTRecord[], flags: boolean[], missingRows: number[], writeFailedRows?: number[]) => void;
  processedData: POCTRecord[];
  refreshTranslationIssues: (records: POCTRecord[]) => { summary: UntranslatedSummary; refreshedMissing: number[]; refreshedWriteFailed: number[]; mergedRowIndices: number[]; };
  rememberTranslationPairs: (pairs: TranslationMemoryPair[], stats?: TranslationMemoryStats) => Promise<void>;
  resetSampleReviewState: () => void;
  restoreSkippedExcelCells: (row: POCTRecord, rowIndex: number) => POCTRecord;
  runDocxTranslation: (mode?: "fresh" | "resume") => Promise<void>;
  runPdfTranslation: (mode?: "fresh" | "resume") => Promise<void>;
  runStage: (key: WorkflowStageKey, task: () => Promise<StageResult>) => Promise<StageResult>;
  setBatchRuns: React.Dispatch<React.SetStateAction<BatchRun[]>>;
  setIsRetryingMissing: React.Dispatch<React.SetStateAction<boolean>>;
  setMissingRowIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setProcessedData: React.Dispatch<React.SetStateAction<POCTRecord[]>>;
  setProcessingState: React.Dispatch<React.SetStateAction<ProcessingState>>;
  setQualityReport: React.Dispatch<React.SetStateAction<QualityReport>>;
  setSavedSnapshot: React.Dispatch<React.SetStateAction<TranslationProgressSnapshot>>;
  setTranslatedFlags: React.Dispatch<React.SetStateAction<boolean[]>>;
  setTranslationIssues: React.Dispatch<React.SetStateAction<IssueSummaryState>>;
  setTranslationStatus: React.Dispatch<React.SetStateAction<"paused" | "completed" | "idle" | "running">>;
  setWriteFailedRowIndices: React.Dispatch<React.SetStateAction<number[]>>;
  shouldSkipExcelCell: (rowIndex: number, columnKey: string) => boolean;
  shouldTranslateValue: (value: unknown, key?: string) => boolean;
  snapshotPromptKeyRef: React.RefObject<string>;
  targetLang: string;
  translatedFlags: boolean[];
  translationHub: TranslationHub;
  translationMode: "full" | "selective";
  translationModelPreference: string;
  untranslatedOptions: { shouldIgnoreCell: (rowIndex: number, columnKey: string) => boolean; };
  writeFailedRowIndices: number[];
}

export const useExcelTranslation = (ctx: ExcelTranslationContext) => {
  const {
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
  } = ctx;

  const runTranslation = async (mode: 'fresh' | 'resume' = 'fresh') => {
    if (mode === 'fresh') setBatchRuns([]);
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
    const rowHasUnskippedTranslatableCell = (row: POCTRecord, rowIndex: number) =>
      Object.entries(row).some(
        ([key, value]) =>
          !shouldSkipExcelCell(rowIndex, key) &&
          typeof value === 'string' &&
          value.trim() &&
          !shouldLockCell(key, value) &&
          shouldTranslateValue(value, key)
      );
    const rowNeedsUnskippedTranslation = (row: POCTRecord, rowIndex: number) =>
      Object.entries(row).some(
        ([key, value]) => !shouldSkipExcelCell(rowIndex, key) && cellNeedsTranslation(key, value, targetLang)
      );
    const initialFlags =
      translationMode === 'selective'
        ? data.map((row, rowIndex) => (rowNeedsUnskippedTranslation(row, rowIndex) ? false : true))
        : data.map((row, rowIndex) => !rowHasUnskippedTranslatableCell(row, rowIndex));
    const workingFlags =
      shouldResume && translatedFlags.length === data.length
        ? [...translatedFlags]
        : [...initialFlags];
    const resumeMissing = shouldResume ? summarizeUntranslated(workingResults, targetLang, untranslatedOptions).rowIndices : [];
    const workingMissing = new Set<number>(resumeMissing);
    const spreadsheetBatchSize = getSpreadsheetBatchSize();

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
      if (excelSkipScope.cellCount > 0) {
        addLog(`Excel Skip Scope: ${excelSkipScopeSummary}`);
      }
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
        currentBatch: Math.max(1, Math.ceil(resumeRow / spreadsheetBatchSize))
      }));
    }

    const firstPendingIndex = shouldResume
      ? workingFlags.findIndex(flag => !flag)
      : 0;
    const startIndex = firstPendingIndex === -1 ? data.length : firstPendingIndex;

    if (startIndex >= data.length && shouldResume) {
      addLog('所有行均已翻译，如需重新翻译请使用“开始翻译”。');
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
        const totalBatches = Math.ceil(data.length / spreadsheetBatchSize);
        let paused = false;

        for (let i = startIndex; i < data.length; i += spreadsheetBatchSize) {
          const chunkIndices: number[] = [];
          for (let offset = 0; offset < spreadsheetBatchSize && i + offset < data.length; offset++) {
            chunkIndices.push(i + offset);
          }
          const pendingIndices = chunkIndices.filter(idx => !flags[idx]);
          if (pendingIndices.length === 0) continue;

          const batchNum = Math.floor(i / spreadsheetBatchSize) + 1;
          const rowLabel = formatRowRanges(pendingIndices, 1);
          addLog(`Translating Batch ${batchNum}/${totalBatches} (${pendingIndices.length} records，行 ${rowLabel})...`);
          batchMonitor.begin({ kind: 'excel', batchNum, totalBatches, items: pendingIndices.length, unit: 'rows' });

          let translatedBatch: POCTRecord[] = [];
          const memoryStats = createTranslationMemoryStats();
          const translatableCells: Array<{ rowIdx: number; key: string; value: string }> = [];
          pendingIndices.forEach((rowIdx) => {
            Object.entries(data[rowIdx]).forEach(([key, value]) => {
              if (shouldSkipExcelCell(rowIdx, key)) return;
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
              if (shouldSkipExcelCell(rowIdx, key)) {
                return;
              }
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

          let modelCallStartedAt = 0;
          try {
            if (callRows.length > 0) {
              modelCallStartedAt = Date.now();
              translatedBatch = await translationHub.translateBatch({
                records: callRows.map((item) => item.sanitizedRow),
                targetLang,
                options: getTranslationOptions()
              });
              addLog(
                `Batch ${batchNum} 使用引擎: ${translationHub.getLastEngine()}，模型: ${getUsedModelLabel()}，用时 ${formatElapsedSeconds(
                  Date.now() - modelCallStartedAt
                )}`
              );
              batchMonitor.end('excel', batchNum, 'ok');
            } else {
              addLog(`Batch ${batchNum}: 全部命中本地翻译记忆或无需模型翻译。`);
              batchMonitor.end('excel', batchNum, 'memory');
            }
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            addLog(
              `Translation warning: 批次 ${batchNum} 行 ${rowLabel} 失败，用时 ${formatElapsedSeconds(
                Date.now() - modelCallStartedAt
              )} (${errMsg})，将跳过该批继续。`
            );
            batchMonitor.end('excel', batchNum, 'failed', errMsg);
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
              if (shouldSkipExcelCell(item.rowIdx, key)) {
                merged[key] = originalValue;
                return;
              }
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

            finalResults[item.rowIdx] = restoreSkippedExcelCells(
              normalizeTerminology(merged, targetLang, data[item.rowIdx]),
              item.rowIdx
            );
          });
          await rememberTranslationPairs(memoryPairs, memoryStats);
          logTranslationMemoryStats(`Batch ${batchNum}`, memoryStats);

          pendingIndices.forEach((rowIdx) => {
            finalResults[rowIdx] = restoreSkippedExcelCells(
              normalizeTerminology(
                finalResults[rowIdx] || data[rowIdx],
                targetLang,
                data[rowIdx]
              ),
              rowIdx
            );
            const stillUntranslated =
              detectUntranslatedCells([finalResults[rowIdx]], targetLang, {
                shouldIgnoreCell: (_localRowIndex, columnKey) => shouldSkipExcelCell(rowIdx, columnKey)
              }).length > 0;
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
          const summarySnapshot = summarizeUntranslated(snapshot, targetLang, untranslatedOptions);
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
        const finalSummary = summarizeUntranslated(finalResults, targetLang, untranslatedOptions);
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
            ? ` 未写入 ${writeFailedSnapshot.length} 行，可使用“重译问题项”。`
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
    const summary = summarizeUntranslated(records, targetLang, untranslatedOptions);
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
      addLog('重译问题项: 正在处理中，请等待当前重译完成。');
      return;
    }
    setIsRetryingMissing(true);
    try {
      const uniqueIndices = Array.from(new Set(rowIndices))
      .filter(idx => idx >= 0 && idx < data.length)
      .sort((a, b) => a - b);
    if (uniqueIndices.length === 0) {
      addLog('重译问题项: 无待重译的行。');
      return;
    }
    addLog(`重译问题项: 针对 ${uniqueIndices.length} 行重新翻译...`);

    const fallbackPriority = getFallbackPriority(
      translationModelPreference !== AUTO_MODEL
    );

    const sourceRecords =
      baseSnapshot && baseSnapshot.length === data.length
        ? baseSnapshot
        : processedData.length === data.length
          ? processedData
          : data;
    const missingSummary = summarizeUntranslated(sourceRecords, targetLang, untranslatedOptions);
    const retryItems = buildExcelRetryTargets({
      rowIndices: uniqueIndices,
      details: missingSummary.details || [],
      originalRows: data,
      sourceRows: sourceRecords,
      isRetryableCell: ({ rowIndex, columnKey, value, originalValue }) => {
        if (shouldSkipExcelCell(rowIndex, columnKey)) return false;
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
      addLog('重译问题项: 当前没有可重译的单元格。');
      if (mergedRowIndices.length === 0) {
        addLog('重译问题项: 状态已刷新，当前无待补译内容。');
      } else {
        addLog('重译问题项: 剩余项可能是锁定字段或纯符号单元格，请先运行“质量检查”后再试。');
        const preview = formatIssueLocationPreview(refreshedSummary.details || [], 6);
        if (preview) {
          addLog(`重译问题项: 残留位置示例 -> ${preview}`);
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
      addLog(`重译问题项: Batch ${batchNum}/${totalBatches} 重译 ${chunk.length} 行...`);

      let translatedBatch: POCTRecord[] | null = null;
      for (const model of fallbackPriority) {
        const attemptLabel = getRetryAttemptModelLabel(model);
        const attemptStartedAt = Date.now();
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
                    : undefined
            }
          });
          addLog(
            `重译问题项: Batch ${batchNum} 使用 ${attemptLabel} 成功，用时 ${formatElapsedSeconds(
              Date.now() - attemptStartedAt
            )}。`
          );
          break;
        } catch (err) {
          addLog(
            `重译问题项: Batch ${batchNum} ${attemptLabel} 失败，用时 ${formatElapsedSeconds(
              Date.now() - attemptStartedAt
            )} - ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (!translatedBatch) {
        addLog(`重译问题项: Batch ${batchNum} 所有备用模型失败，已跳过。`);
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

        baseProcessed[rowIdx] = restoreSkippedExcelCells(
          normalizeTerminology(merged, targetLang, data[rowIdx]),
          rowIdx
        );
        const stillUntranslated =
          detectUntranslatedCells([baseProcessed[rowIdx]], targetLang, {
            shouldIgnoreCell: (_localRowIndex, columnKey) => shouldSkipExcelCell(rowIdx, columnKey)
          }).length > 0;
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
      const summarySnapshot = summarizeUntranslated(synced, targetLang, untranslatedOptions);
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
    const summary = summarizeUntranslated(synced, targetLang, untranslatedOptions);
    const missingSnapshot = summary.rowIndices;
    const writeFailedSnapshot = Array.from(writeFailedSet).sort((a, b) => a - b);
    setProcessedData(synced);
    setTranslatedFlags(flagsSnapshot);
    setMissingRowIndices(missingSnapshot);
    setWriteFailedRowIndices(writeFailedSnapshot);
    persistProgress(synced, flagsSnapshot, missingSnapshot, writeFailedSnapshot);
    if (retryAutoFixed > 0) {
      addLog(`重译问题项: 已自动恢复 ${retryAutoFixed} 个坏 token。`);
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
      addLog('重译问题项: 重译后所有单元格均为目标语言。');
    } else {
      addLog(
        `重译问题项: 仍有 ${summary.cells} 个单元格或 ${missingSnapshot.length} 行未完全翻译，可继续重试。`
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
        if (shouldSkipExcelCell(rowIdx, key)) return;
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
      translationModelPreference !== AUTO_MODEL
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
        const attemptLabel = getRetryAttemptModelLabel(model);
        const attemptStartedAt = Date.now();
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
                    : undefined
            }
          });
          addLog(
            `${label}: Batch ${batchNum} 使用 ${attemptLabel} 成功，用时 ${formatElapsedSeconds(
              Date.now() - attemptStartedAt
            )}。`
          );
          break;
        } catch (err) {
          addLog(
            `${label}: Batch ${batchNum} ${attemptLabel} 失败，用时 ${formatElapsedSeconds(
              Date.now() - attemptStartedAt
            )} - ${err instanceof Error ? err.message : String(err)}`
          );
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
          if (shouldSkipExcelCell(rowIdx, key)) {
            merged[key] = original[key];
            return;
          }
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

        baseProcessed[rowIdx] = restoreSkippedExcelCells(
          normalizeTerminology(merged, targetLang, data[rowIdx]),
          rowIdx
        );
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
    setQualityReport(runQualityChecks(data, synced, excelQualityOptions));
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
      logLabel: '重译占位符异常'
    });
    if (!target.length) {
      addLog('重译占位符异常: 当前没有可扫描的数据。');
      return;
    }
    const issues = collectPlaceholderIssues(data, target, excelQualityOptions);
    if (fixedCells > 0 && issues.length === 0) {
      addLog('重译占位符异常: 坏 token 已自动恢复，无需重翻。');
      return;
    }
    if (!issues.length) {
      addLog('重译占位符异常: 未检测到占位符残留。');
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
    addLog(`重译占位符异常: 实时检测到 ${issues.length} 个占位符异常单元格。`);
    if (fixedCells > 0) {
      addLog(`重译占位符异常: 已先自动修复 ${fixedCells} 个，仅对剩余 ${remainingCells} 个执行重翻。`);
    }
    await retryCellsByKeys(items, '重译占位符异常', { forceTranslate: true });
  };

  return {
    runTranslation,
    retryMissingRows,
    retryPlaceholderCells
  };
};
