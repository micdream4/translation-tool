import { useEffect, useMemo, useState } from 'react';
import { SampleReviewAuditService } from '../services/sampleReviewAuditService';
import type { QualityRows } from '../quality/types';
import type { TranslationMemoryPair } from '../utils/translationMemory';
import type { UntranslatedCell } from '../utils/language';
import type { DocxContext } from '../utils/docx';
import type { PdfContext } from '../utils/pdf';
import { serializeDebugPackage, serializeGitHubIssueMarkdown, type DebugFormatSnapshot, type DebugPackageInput } from '../utils/debugPackage';
import {
  clearTranslationIssueCases,
  countTranslationIssueCases,
  loadTranslationIssueCases,
  saveTranslationIssueCase,
  serializeTranslationIssueCasesJsonl
} from '../utils/issueCases';
import {
  buildRegressionCasesFromIssueCases,
  serializeRegressionCasesJsonl
} from '../utils/regressionAssets';
import {
  buildIssueAssetPackage,
  buildTranslationMemoryPairsFromIssueCases,
  serializeIssueAssetPackage
} from '../utils/issueAssets';
import {
  buildQualityFindings,
  buildQualityReportText,
  mapQualityFindingToIssueType,
  type QualityFinding
} from '../quality/report';
import { runQualityChecks, runQualityChecksOnUnits, type QualityCheckInput, type QualityReport } from '../utils/quality';
import type { POCTRecord, ReviewSample, SampleReviewAIResult, TargetLanguage } from '../types';

export type SampleReviewAiSummary = {
  total: number;
  low: number;
  medium: number;
  high: number;
  pass: number;
  warning: number;
  fail: number;
};

export type SampleReviewItem = {
  id: string;
  rowIndex: number;
  columnKey: string;
  locationLabel: string;
  original: string;
  translated: string;
  reason: string;
};

type DocumentKind = 'excel' | 'docx' | 'pdf';
type PreviewFocus = { rowIndex: number; columnKey: string } | null;
type CurrentIssueSummary = {
  cells?: number;
  rows?: number;
  rowIndices?: number[];
  missingRows?: number[];
  details: UntranslatedCell[];
};

type DocumentIssueDetail = {
  index: number;
  id: string;
  text: string;
  snippet: string;
  chineseChars: number;
  lowPriority: boolean;
  issueType: 'source' | 'placeholder' | 'glue';
};

type DocumentIssueResult = {
  pending: number[];
  details: DocumentIssueDetail[];
};

type AutoRepairExcelPlaceholdersResult = {
  records: POCTRecord[];
  fixedCells: number;
  remainingCells: number;
  changed: boolean;
};

type RefreshTranslationIssuesResult = {
  summary: {
    cells: number;
    rows: number;
    details?: UntranslatedCell[];
  };
  refreshedMissing: number[];
  refreshedWriteFailed: number[];
};

type UseQualityWorkflowParams = {
  appVersion: string;
  documentKind: DocumentKind;
  targetLang: TargetLanguage;
  data: POCTRecord[];
  processedData: POCTRecord[];
  translatedFlags: boolean[];
  currentRowsForRetry: POCTRecord[];
  currentIssueSummary: CurrentIssueSummary;
  qualityRowsForDisplay: QualityRows;
  formatSnapshot: DebugFormatSnapshot;
  currentModelLabel: string;
  fileName?: string;
  translationModelPreference: string;
  autoModelValue: string;
  addLog: (message: string) => void;
  setPreviewFocus: (focus: PreviewFocus) => void;
  formatLocationLabel: (rowIndex: number, columnKey: string) => string;
  formatIssueLocationPreview: (details: UntranslatedCell[], limit: number) => string;
  formatExcelRowNumber: (rowIndex: number) => number;
  getDocxContext: () => DocxContext | null;
  getPdfContext: () => PdfContext | null;
  buildDocxIssueDetails: (context: DocxContext) => DocumentIssueResult;
  buildPdfIssueDetails: (context: PdfContext) => DocumentIssueResult;
  syncDocumentIssueSummary: (details: DocumentIssueDetail[]) => void;
  setDocxIssueIndices: (indices: number[]) => void;
  setDocxIssueDetails: (details: DocumentIssueDetail[]) => void;
  setPdfIssueIndices: (indices: number[]) => void;
  setPdfIssueDetails: (details: DocumentIssueDetail[]) => void;
  buildDocumentQualityRows: () => QualityRows | null;
  buildDocumentQualityInput: () => QualityCheckInput | null;
  autoRepairExcelPlaceholders: (
    records: POCTRecord[],
    options?: { mutateState?: boolean; logLabel?: string }
  ) => AutoRepairExcelPlaceholdersResult;
  refreshTranslationIssues: (records: POCTRecord[]) => RefreshTranslationIssuesResult;
  persistProgress: (
    records: POCTRecord[],
    flags: boolean[],
    missingRows: number[],
    writeFailedRows?: number[]
  ) => void;
  rememberTranslationPairs: (pairs: TranslationMemoryPair[]) => Promise<void>;
  downloadTextFile: (filename: string, content: string) => void;
};

const createSampleReviewAiSummary = (): SampleReviewAiSummary => ({
  total: 0,
  low: 0,
  medium: 0,
  high: 0,
  pass: 0,
  warning: 0,
  fail: 0
});

export const useQualityWorkflow = ({
  appVersion,
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
  fileName,
  translationModelPreference,
  autoModelValue,
  addLog,
  setPreviewFocus,
  formatLocationLabel,
  formatIssueLocationPreview,
  formatExcelRowNumber,
  getDocxContext,
  getPdfContext,
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
}: UseQualityWorkflowParams) => {
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [sampleReviewCount, setSampleReviewCount] = useState<number>(20);
  const [sampleReviewItems, setSampleReviewItems] = useState<SampleReviewItem[]>([]);
  const [sampleReviewAiResults, setSampleReviewAiResults] = useState<Record<string, SampleReviewAIResult>>({});
  const [sampleReviewAiMeta, setSampleReviewAiMeta] = useState<{ model?: string; engine?: string } | null>(null);
  const [isRunningSampleReviewAi, setIsRunningSampleReviewAi] = useState(false);
  const [issueCaseCount, setIssueCaseCount] = useState<number>(0);

  const sampleReviewAuditService = useMemo(() => new SampleReviewAuditService(), []);

  const refreshIssueCaseCount = () => {
    setIssueCaseCount(countTranslationIssueCases());
  };

  useEffect(() => {
    refreshIssueCaseCount();
  }, []);

  const resetSampleReviewState = () => {
    setSampleReviewItems([]);
    setSampleReviewAiResults({});
    setSampleReviewAiMeta(null);
  };

  const hasQualityReport = Boolean(qualityReport);

  const qualityFindings = useMemo<QualityFinding[]>(() => {
    return buildQualityFindings({
      qualityReport,
      nonTargetDetails: currentIssueSummary.details,
      qualityRows: qualityRowsForDisplay,
      formatLocationLabel
    });
  }, [qualityReport, currentIssueSummary.details, qualityRowsForDisplay, formatLocationLabel]);

  const sampleReviewAiSummary = useMemo(
    () =>
      (Object.values(sampleReviewAiResults) as SampleReviewAIResult[]).reduce<SampleReviewAiSummary>(
        (acc, item) => {
          acc.total += 1;
          acc[item.risk] += 1;
          acc[item.verdict] += 1;
          return acc;
        },
        createSampleReviewAiSummary()
      ),
    [sampleReviewAiResults]
  );

  const runQualityCheck = () => {
    if (documentKind === 'docx') {
      const context = getDocxContext();
      if (!context) {
        addLog('Quality Check: 当前没有可检查的 DOCX。');
        return;
      }
      const { pending, details } = buildDocxIssueDetails(context);
      setDocxIssueIndices(pending);
      setDocxIssueDetails(details);
      syncDocumentIssueSummary(details);
      const qualityInput = buildDocumentQualityInput();
      if (qualityInput) {
        setQualityReport(runQualityChecksOnUnits(qualityInput, { targetLang }));
      }
      resetSampleReviewState();
      addLog(
        `Quality Check DOCX: 检测到 ${details.length} 个异常语义段，建议重译 ${details.filter((item) => !item.lowPriority).length} 段。`
      );
      return;
    }

    if (documentKind === 'pdf') {
      const context = getPdfContext();
      if (!context) {
        addLog('Quality Check: 当前没有可检查的 PDF。');
        return;
      }
      const { pending, details } = buildPdfIssueDetails(context);
      setPdfIssueIndices(pending);
      setPdfIssueDetails(details);
      syncDocumentIssueSummary(details);
      const qualityInput = buildDocumentQualityInput();
      if (qualityInput) {
        setQualityReport(runQualityChecksOnUnits(qualityInput, { targetLang }));
      }
      resetSampleReviewState();
      addLog(
        `Quality Check PDF: 检测到 ${details.length} 个异常文本段，建议重译 ${details.filter((item) => !item.lowPriority).length} 段。`
      );
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
    const report = runQualityChecks(data, target, { targetLang });
    setQualityReport(report);
    resetSampleReviewState();
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
    const issueDetails = summary.details || [];
    if (issueDetails.length > 0) {
      const preview = formatIssueLocationPreview(issueDetails, 6);
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

  const exportQualityReport = () => {
    if (!qualityReport) {
      addLog('Quality Report: 当前没有可导出的检查结果。');
      return;
    }
    const qualityRows = buildDocumentQualityRows() || {
      sourceRows: data,
      targetRows: currentRowsForRetry
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(
      `Quality_Report_${targetLang}_${stamp}.txt`,
      buildQualityReportText({
        qualityReport,
        nonTargetDetails: currentIssueSummary.details,
        qualityRows,
        targetLang,
        formatLocationLabel
      })
    );
    addLog('Quality Report: 已导出当前检查报告。');
  };

  const clearQualityReport = () => {
    setQualityReport(null);
    resetSampleReviewState();
    setPreviewFocus(null);
    addLog('Quality Report: 已清除当前检查结果。');
  };

  const saveQualityFindingCorrection = async (finding: QualityFinding) => {
    if (typeof window === 'undefined') return;
    const suggested = finding.translated || '';
    const corrected = window.prompt('输入人工修正译文。保存后会进入本地问题样本库。', suggested);
    if (corrected === null) return;
    const trimmed = corrected.trim();
    if (!trimmed) {
      addLog('Issue Case: 人工修正为空，未保存。');
      return;
    }

    const issueCase = saveTranslationIssueCase({
      appVersion,
      documentKind,
      targetLang,
      sourceText: finding.original,
      badTranslation: finding.translated,
      correctedTranslation: trimmed,
      issueType: mapQualityFindingToIssueType(finding),
      locationLabel: finding.locationLabel,
      model: currentModelLabel,
      promptProfile: documentKind === 'excel' ? 'spreadsheet' : 'docx-manual',
      notes: finding.description
    });
    refreshIssueCaseCount();
    addLog(`Issue Case: 已保存 ${issueCase.issueType} 样本（${finding.locationLabel}）。`);

    if (
      finding.original.trim() &&
      trimmed &&
      window.confirm('是否同时把这条人工修正写入 Translation Memory？')
    ) {
      await rememberTranslationPairs([
        {
          sourceText: finding.original,
          targetText: trimmed,
          targetLang,
          model: currentModelLabel,
          documentKind,
          fileName
        }
      ]);
      addLog('Issue Case: 已同步写入 Translation Memory。');
    }
  };

  const exportIssueCases = () => {
    const cases = loadTranslationIssueCases();
    if (!cases.length) {
      addLog('Issue Cases: 当前没有可导出的问题样本。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`Translation_Issue_Cases_${stamp}.jsonl`, serializeTranslationIssueCasesJsonl(cases));
    addLog(`Issue Cases: 已导出 ${cases.length} 条问题样本 JSONL。`);
  };

  const exportRegressionCases = () => {
    const cases = loadTranslationIssueCases();
    const regressionCases = buildRegressionCasesFromIssueCases(cases);
    if (!regressionCases.length) {
      addLog('Regression Cases: 当前没有包含人工修正的问题样本可转为回归测试。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(
      `Translation_Regression_Cases_${stamp}.jsonl`,
      serializeRegressionCasesJsonl(regressionCases)
    );
    addLog(`Regression Cases: 已导出 ${regressionCases.length} 条回归测试 JSONL，可追加到 fixtures/translation-issue-regression.jsonl。`);
  };

  const exportIssueAssetCandidates = () => {
    const cases = loadTranslationIssueCases();
    if (!cases.length) {
      addLog('Issue Assets: 当前没有可转换的问题样本。');
      return;
    }
    const assetPackage = buildIssueAssetPackage(cases, { fileName });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(
      `Translation_Issue_Assets_${stamp}.json`,
      serializeIssueAssetPackage(assetPackage)
    );
    addLog(
      `Issue Assets: 已导出 TM ${assetPackage.counts.translationMemoryPairs} 条、术语候选 ${assetPackage.counts.terminologyCandidates} 条、QA 规则候选 ${assetPackage.counts.qaRuleCandidates} 条。`
    );
  };

  const promoteIssueCasesToTranslationMemory = async () => {
    const cases = loadTranslationIssueCases();
    const pairs = buildTranslationMemoryPairsFromIssueCases(cases, fileName);
    if (!pairs.length) {
      addLog('Translation Memory: 当前没有包含人工修正的问题样本可写入。');
      return;
    }
    await rememberTranslationPairs(pairs);
    addLog(`Translation Memory: 已从问题样本写入/更新 ${pairs.length} 条 TM 句对。`);
  };

  const buildCurrentDebugPackageInput = (): DebugPackageInput => {
    const cases = loadTranslationIssueCases();
    return {
      appVersion,
      documentKind,
      targetLang,
      fileName,
      modelLabel: currentModelLabel,
      modelPreference: translationModelPreference,
      qualityReport,
      issueSummary: {
        cells: currentIssueSummary.cells ?? currentIssueSummary.details.length,
        rows:
          currentIssueSummary.rows ??
          new Set(currentIssueSummary.details.map((item) => item.rowIndex)).size,
        rowIndices: currentIssueSummary.rowIndices || [],
        missingRows: currentIssueSummary.missingRows || [],
        details: currentIssueSummary.details
      },
      qualityFindings,
      issueCases: cases,
      qualityRows: qualityRowsForDisplay,
      formatSnapshot
    };
  };

  const exportDebugPackage = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const debugInput = buildCurrentDebugPackageInput();
    downloadTextFile(
      `Translation_Debug_Package_${targetLang}_${stamp}.json`,
      serializeDebugPackage(debugInput)
    );
    const cases = debugInput.issueCases;
    addLog(`Debug Package: 已导出调试包（Quality findings ${qualityFindings.length} 条，Issue cases ${cases.length} 条）。`);
  };

  const exportIssueDraft = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const debugInput = buildCurrentDebugPackageInput();
    downloadTextFile(
      `GitHub_Issue_Draft_${targetLang}_${stamp}.md`,
      serializeGitHubIssueMarkdown(debugInput)
    );
    addLog('Issue Draft: 已导出 GitHub Issue Markdown 草稿，可粘贴到 Issue 模板并附上 Debug Package JSON。');
  };

  const clearIssueCases = () => {
    if (typeof window !== 'undefined' && !window.confirm('确认清空本地问题样本库？此操作不会影响翻译记忆。')) {
      return;
    }
    clearTranslationIssueCases();
    refreshIssueCaseCount();
    addLog('Issue Cases: 已清空本地问题样本库。');
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
        translationModelPreference === autoModelValue ? undefined : translationModelPreference
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

  return {
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
  };
};
