
import React from 'react';
import type { DocxIssueDetail } from '../../components/translator/types';
import type { QualityReport } from '../../quality/types';
import {
  POCTRecord,
  ProcessingState,
  WorkflowStageKey,
  WorkflowStageState
} from '../../types';
import {
  exportDocxFile,
  formatDocxCoverageSummary,
  parseDocxFile,
  type DocxContext
} from '../../utils/docx';
import type { ExcelContext } from '../../utils/excel';
import { exportToExcelPreservingStyles,parseExcelFile } from '../../utils/excel';
import type { ExcelSkipScope } from '../../utils/excelSkipScope';
import {
  exportPdfTranslationAsDocx,
  exportPdfTranslationAsPdf,
  getPdfTextLayerStats,
  parsePdfFile,
  type PdfContext
} from '../../utils/pdf';
import {
  clearTranslationProgress,
  type TranslationProgressSnapshot
} from '../../utils/storage';
import type {
  IssueSummaryState
} from '../../utils/translatorShared';
import {
  applyPostprocessRow,
  createIssueSummary,
  isSevereDocxIssue
} from '../../utils/translatorShared';

export interface DocumentIOContext {
  addLog: (msg: string) => void;
  buildDocxIssueDetails: (context: DocxContext) => { pending: number[]; details: DocxIssueDetail[]; qualityReport: QualityReport; };
  data: POCTRecord[];
  documentKind: "docx" | "pdf" | "excel";
  docxContextRef: React.RefObject<DocxContext>;
  docxPlaceholderStore: React.RefObject<Map<string, Record<string, string>>>;
  excelContext: ExcelContext;
  excelSkipScope: ExcelSkipScope;
  file: File;
  fileId: string;
  getSpreadsheetBatchSize: () => number;
  pauseRequestedRef: React.RefObject<boolean>;
  pdfContextRef: React.RefObject<PdfContext>;
  processedData: POCTRecord[];
  resetModelReviewState: () => void;
  resetSampleReviewState: () => void;
  resetStages: () => void;
  restoreSkippedExcelCells: (row: POCTRecord, rowIndex: number) => POCTRecord;
  savedSnapshot: TranslationProgressSnapshot;
  setData: React.Dispatch<React.SetStateAction<POCTRecord[]>>;
  setDocumentKind: React.Dispatch<React.SetStateAction<"docx" | "pdf" | "excel">>;
  setDocxIssueDetails: React.Dispatch<React.SetStateAction<DocxIssueDetail[]>>;
  setDocxIssueIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setDocxStats: React.Dispatch<React.SetStateAction<{ total: number; translated: number; }>>;
  setExcelContext: React.Dispatch<React.SetStateAction<ExcelContext>>;
  setExcelSkipScopeRaw: React.Dispatch<React.SetStateAction<string>>;
  setFile: React.Dispatch<React.SetStateAction<File>>;
  setFileId: React.Dispatch<React.SetStateAction<string>>;
  setMissingRowIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setPdfIssueDetails: React.Dispatch<React.SetStateAction<DocxIssueDetail[]>>;
  setPdfIssueIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setPdfStats: React.Dispatch<React.SetStateAction<{ pages: number; total: number; translated: number; }>>;
  setPreviewFocus: React.Dispatch<React.SetStateAction<{ rowIndex: number; columnKey: string; }>>;
  setProcessedData: React.Dispatch<React.SetStateAction<POCTRecord[]>>;
  setProcessingState: React.Dispatch<React.SetStateAction<ProcessingState>>;
  setQualityReport: React.Dispatch<React.SetStateAction<QualityReport>>;
  setSavedSnapshot: React.Dispatch<React.SetStateAction<TranslationProgressSnapshot>>;
  setTranslatedFlags: React.Dispatch<React.SetStateAction<boolean[]>>;
  setTranslationIssues: React.Dispatch<React.SetStateAction<IssueSummaryState>>;
  setTranslationStatus: React.Dispatch<React.SetStateAction<"idle" | "completed" | "running" | "paused">>;
  setWriteFailedRowIndices: React.Dispatch<React.SetStateAction<number[]>>;
  snapshotPromptKeyRef: React.RefObject<string>;
  targetLang: string;
  translationStatus: "idle" | "completed" | "running" | "paused";
  updateStageStatus: (key: WorkflowStageKey, status: WorkflowStageState["status"], message?: string) => void;
}

export const useDocumentIO = (ctx: DocumentIOContext) => {
  const {
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
  } = ctx;

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
    setExcelSkipScopeRaw('');
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
    setExcelSkipScopeRaw(savedSnapshot.excelSkipScopeRaw || '');
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
      currentBatch: Math.ceil(translatedCount / getSpreadsheetBatchSize())
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

const handleDownload = async () => {
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
          `Docx download warning: 仍有 ${details.length} 段待优化问题（高优先级 ${highPriorityCount} 段，严重问题 ${blockingCount} 段），建议先“重译问题项”再导出。`
        );
      } else {
        addLog('Docx download gate: 审计通过，可导出。');
      }
      addLog(`Docx coverage: 导出覆盖 ${formatDocxCoverageSummary(context.coverage)}。`);
      const filename = `Translated_${targetLang}_${file?.name || 'Result.docx'}`;
      addLog(`Generating file: ${filename}`);
      exportDocxFile(context, filename, targetLang);
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
      restoreSkippedExcelCells(applyPostprocessRow(data[idx], row, targetLang), idx)
    );
    try {
      const stats = await exportToExcelPreservingStyles(outputRows, filename, excelContext || undefined);
      if (stats.stylePreserved) {
        addLog('Excel export: 已基于原始工作簿写回译文并保留原格式。');
      }
      if (excelSkipScope.cellCount > 0) {
        addLog(`Excel export: 已按跳过范围保留 ${excelSkipScope.cellCount} 个源文单元格。`);
      }
      if (stats?.overwrittenFormulas) {
        addLog(`Excel export warning: 意外覆盖 ${stats.overwrittenFormulas} 个公式单元格。`);
      }
      if (stats?.skippedFormulas) {
        addLog(`Excel export: 已保留 ${stats.skippedFormulas} 个公式单元格。`);
      }
    } catch (error) {
      addLog(`Excel export failed: ${error instanceof Error ? error.message : String(error)}`);
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

  return {
    handleFileUpload,
    applySavedProgress,
    discardSavedProgress,
    handleDownload,
    handleDownloadPdfDocx
  };
};
