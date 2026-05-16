import { useEffect, useMemo, useState } from 'react';
import { SampleReviewAuditService } from '../services/sampleReviewAuditService';
import type { QualityRows } from '../quality/types';
import type { TranslationMemoryPair } from '../utils/translationMemory';
import type { UntranslatedCell } from '../utils/language';
import {
  clearTranslationIssueCases,
  countTranslationIssueCases,
  loadTranslationIssueCases,
  saveTranslationIssueCase,
  serializeTranslationIssueCasesJsonl
} from '../utils/issueCases';
import {
  buildQualityFindings,
  buildQualityReportText,
  mapQualityFindingToIssueType,
  type QualityFinding
} from '../utils/qualityReport';
import type { QualityReport } from '../utils/quality';
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
  details: UntranslatedCell[];
};

type UseQualityWorkflowParams = {
  appVersion: string;
  documentKind: DocumentKind;
  targetLang: TargetLanguage;
  data: POCTRecord[];
  processedData: POCTRecord[];
  currentRowsForRetry: POCTRecord[];
  currentIssueSummary: CurrentIssueSummary;
  qualityRowsForDisplay: QualityRows;
  currentModelLabel: string;
  fileName?: string;
  translationModelPreference: string;
  autoModelValue: string;
  addLog: (message: string) => void;
  setPreviewFocus: (focus: PreviewFocus) => void;
  formatLocationLabel: (rowIndex: number, columnKey: string) => string;
  buildDocumentQualityRows: () => QualityRows | null;
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
  currentRowsForRetry,
  currentIssueSummary,
  qualityRowsForDisplay,
  currentModelLabel,
  fileName,
  translationModelPreference,
  autoModelValue,
  addLog,
  setPreviewFocus,
  formatLocationLabel,
  buildDocumentQualityRows,
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
    clearQualityReport,
    exportQualityReport,
    exportIssueCases,
    clearIssueCases,
    saveQualityFindingCorrection,
    generateSampleReview,
    runAiSampleReview
  };
};
