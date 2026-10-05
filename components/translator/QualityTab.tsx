import React from 'react';
import EmbeddedVisualsNotice from './EmbeddedVisualsNotice';
import type { EmbeddedVisualSummary } from '../../utils/embeddedVisuals';
import { useI18n } from '../../hooks/useI18n';
import { getUiClasses } from './uiClasses';
import QualityReportPanel from '../QualityReportPanel';
import type { DocxIssueDetail } from './types';
import type { POCTRecord, SampleReviewAIResult, UntranslatedSummary } from '../../types';
import type { QualityFinding } from '../../utils/qualityReport';
import type { QualityReport } from '../../quality/types';
import type { SampleReviewAiSummary, SampleReviewItem } from '../../hooks/useQualityWorkflow';
import type { QualitySeverity } from '../../utils/quality';
export interface QualityTabProps {
  isLight: boolean;
  embeddedVisuals?: EmbeddedVisualSummary | null;
  canRetryIssues: boolean;
  canRunQualityCheck: boolean;
  clearIssueCases: () => void;
  clearQualityReport: () => void;
  currentIssueSummary: UntranslatedSummary;
  documentKind: "excel" | "docx" | "pdf";
  docxIssueDetails: DocxIssueDetail[];
  docxIssuePreview: string;
  docxLowPriorityCount: number;
  docxRetryableCount: number;
  exportDebugPackage: () => void;
  exportIssueAssetCandidates: () => void;
  exportIssueCases: () => void;
  exportIssueDraft: () => void;
  exportQualityReport: () => void;
  exportRegressionCases: () => void;
  fixableIssueCount: number;
  formatSnapshot: { sheetName: string; rows: number; cols: number; merges: number; };
  generateSampleReview: () => void;
  hasDocxIssues: boolean;
  hasPdfIssues: boolean;
  hasQualityReport: boolean;
  hasTranslationAlerts: boolean;
  isRetryingMissing: boolean;
  isRunningSampleReviewAi: boolean;
  issueCaseCount: number;
  jumpToPreviewCell: (rowIndex: number, columnKey: string) => void;
  pdfHighPriorityCount: number;
  pdfIssueDetails: DocxIssueDetail[];
  pdfIssuePreview: string;
  pdfLowPriorityCount: number;
  placeholderIssueCount: number;
  processedData: POCTRecord[];
  promoteIssueCasesToTranslationMemory: () => Promise<void>;
  qualityFindings: QualityFinding[];
  qualityReport: QualityReport;
  retryAllIssues: () => Promise<void>;
  retryCandidates: number[];
  retryableCellCount: number;
  reviewRiskBadgeClass: (risk?: SampleReviewAIResult["risk"]) => "text-rose-300 border border-rose-500/30 bg-rose-500/10" | "text-amber-300 border border-amber-500/30 bg-amber-500/10" | "text-emerald-300 border border-emerald-500/30 bg-emerald-500/10" | "text-slate-400 border border-slate-700 bg-slate-900/40";
  reviewVerdictBadgeClass: (verdict?: SampleReviewAIResult["verdict"]) => "text-rose-300 border border-rose-500/30 bg-rose-500/10" | "text-amber-300 border border-amber-500/30 bg-amber-500/10" | "text-emerald-300 border border-emerald-500/30 bg-emerald-500/10" | "text-slate-400 border border-slate-700 bg-slate-900/40";
  runAiSampleReview: () => Promise<void>;
  runQualityCheck: () => void;
  sampleReviewAiMeta: { model?: string; engine?: string; };
  sampleReviewAiResults: Record<string, SampleReviewAIResult>;
  sampleReviewAiSummary: SampleReviewAiSummary;
  sampleReviewCount: number;
  sampleReviewItems: SampleReviewItem[];
  saveQualityFindingCorrection: (finding: QualityFinding) => Promise<void>;
  setSampleReviewCount: React.Dispatch<React.SetStateAction<number>>;
  severityBadgeClass: (severity?: QualitySeverity) => "text-rose-300 border border-rose-500/30 bg-rose-500/10" | "text-amber-300 border border-amber-500/30 bg-amber-500/10" | "text-slate-400 border border-slate-700 bg-slate-900/40" | "text-sky-300 border border-sky-500/30 bg-sky-500/10";
  translationStatus: "running" | "idle" | "paused" | "completed";
  untranslatedLocationPreview: string;
  writeFailedRowIndices: number[];
  writeFailedRowPreview: string;
}

const QualityTab: React.FC<QualityTabProps> = ({
  isLight,
  embeddedVisuals,
  canRetryIssues,
  canRunQualityCheck,
  clearIssueCases,
  clearQualityReport,
  currentIssueSummary,
  documentKind,
  docxIssueDetails,
  docxIssuePreview,
  docxLowPriorityCount,
  docxRetryableCount,
  exportDebugPackage,
  exportIssueAssetCandidates,
  exportIssueCases,
  exportIssueDraft,
  exportQualityReport,
  exportRegressionCases,
  fixableIssueCount,
  formatSnapshot,
  generateSampleReview,
  hasDocxIssues,
  hasPdfIssues,
  hasQualityReport,
  hasTranslationAlerts,
  isRetryingMissing,
  isRunningSampleReviewAi,
  issueCaseCount,
  jumpToPreviewCell,
  pdfHighPriorityCount,
  pdfIssueDetails,
  pdfIssuePreview,
  pdfLowPriorityCount,
  placeholderIssueCount,
  processedData,
  promoteIssueCasesToTranslationMemory,
  qualityFindings,
  qualityReport,
  retryAllIssues,
  retryCandidates,
  retryableCellCount,
  reviewRiskBadgeClass,
  reviewVerdictBadgeClass,
  runAiSampleReview,
  runQualityCheck,
  sampleReviewAiMeta,
  sampleReviewAiResults,
  sampleReviewAiSummary,
  sampleReviewCount,
  sampleReviewItems,
  saveQualityFindingCorrection,
  setSampleReviewCount,
  severityBadgeClass,
  translationStatus,
  untranslatedLocationPreview,
  writeFailedRowIndices,
  writeFailedRowPreview
}) => {
  const { t } = useI18n();
  const {
    panelClass,
    sectionDividerClass,
    headingMutedClass,
    mutedTextClass,
    disabledButtonClass,
    neutralButtonClass,
    primaryInlineButtonClass,
    metricCardClass,
    subCardClass,
    nestedPanelClass
  } = getUiClasses(isLight);

  return (
    <div className="space-y-4">
      <EmbeddedVisualsNotice isLight={isLight} summary={embeddedVisuals} />
      <div className={`${nestedPanelClass} space-y-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runQualityCheck}
            disabled={!canRunQualityCheck || translationStatus === 'running'}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
              !canRunQualityCheck || translationStatus === 'running'
                ? disabledButtonClass
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
            }`}
          >
            {t('qc.run')}
          </button>
          <button
            type="button"
            onClick={retryAllIssues}
            disabled={!canRetryIssues}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
              !canRetryIssues
                ? disabledButtonClass
                : isLight
                  ? 'bg-amber-500 text-white hover:bg-amber-400'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
            }`}
          >
            {isRetryingMissing
              ? t('settings.starting')
              : fixableIssueCount > 0
                ? t('qc.fix.count', { count: fixableIssueCount })
                : t('qc.fix')}
          </button>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={t('qc.flow')}>
            {[1, 2, 3, 4].map((step) => (
              <li
                key={step}
                className={`rounded-full border px-2.5 py-0.5 ${
                  isLight ? 'border-slate-200 text-slate-500' : 'border-white/[0.1] text-slate-400'
                }`}
              >
                {step}. {t(`qc.flow.${step}`)}
              </li>
            ))}
          </ol>
        </div>
        <div className={`space-y-1 text-xs ${mutedTextClass}`}>
          <p>{t('qc.help.run')}</p>
          <p>{t('qc.help.fix')}</p>
          {documentKind !== 'excel' && <p>{t('qc.help.docx')}</p>}
        </div>
        {(hasTranslationAlerts || hasDocxIssues || hasPdfIssues || placeholderIssueCount > 0) && (
          <div className={`space-y-1 border-t pt-3 text-xs ${sectionDividerClass} ${isLight ? 'text-amber-800' : 'text-amber-300'}`}>
            {documentKind === 'excel' && currentIssueSummary.cells > 0 && (
              <p>{t('qc.alert.nonTarget', { cells: currentIssueSummary.cells, rows: currentIssueSummary.rows })}</p>
            )}
            {documentKind === 'excel' && currentIssueSummary.cells > 0 && (
              <p>{t('qc.alert.retryable', { cells: retryableCellCount, rows: retryCandidates.length })}</p>
            )}
            {documentKind === 'excel' && currentIssueSummary.cells > 0 && untranslatedLocationPreview && (
              <p className={mutedTextClass}>{t('qc.alert.example', { preview: untranslatedLocationPreview })}</p>
            )}
            {documentKind === 'excel' && writeFailedRowIndices.length > 0 && (
              <p>{t('qc.alert.writeFailed', { count: writeFailedRowIndices.length, preview: writeFailedRowPreview || 'N/A' })}</p>
            )}
            {documentKind === 'excel' && placeholderIssueCount > 0 && (
              <p>{t('qc.alert.placeholder', { count: placeholderIssueCount })}</p>
            )}
            {documentKind === 'excel' && retryCandidates.length === 0 && currentIssueSummary.cells > 0 && (
              <p className={mutedTextClass}>{t('qc.alert.locked')}</p>
            )}
            {hasDocxIssues && (
              <>
                <p>{t('qc.alert.docx', { count: docxIssueDetails.length, retry: docxRetryableCount, low: docxLowPriorityCount })}</p>
                {docxIssuePreview && <p className={mutedTextClass}>{t('qc.alert.example2', { preview: docxIssuePreview })}</p>}
              </>
            )}
            {hasPdfIssues && (
              <>
                <p>{t('qc.alert.pdf', { count: pdfIssueDetails.length, retry: pdfHighPriorityCount, low: pdfLowPriorityCount })}</p>
                {pdfIssuePreview && <p className={mutedTextClass}>{t('qc.alert.example2', { preview: pdfIssuePreview })}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <QualityReportPanel
        qualityReport={qualityReport}
        hasQualityReport={hasQualityReport}
        formatSnapshot={formatSnapshot}
        currentIssueSummary={currentIssueSummary}
        issueCaseCount={issueCaseCount}
        qualityFindings={qualityFindings}
        sampleReviewCount={sampleReviewCount}
        sampleReviewItems={sampleReviewItems}
        sampleReviewAiSummary={sampleReviewAiSummary}
        sampleReviewAiMeta={sampleReviewAiMeta}
        sampleReviewAiResults={sampleReviewAiResults}
        processedDataLength={processedData.length}
        isRunningSampleReviewAi={isRunningSampleReviewAi}
        isLight={isLight}
        panelClass={panelClass}
        metricCardClass={metricCardClass}
        nestedPanelClass={nestedPanelClass}
        subCardClass={subCardClass}
        headingMutedClass={headingMutedClass}
        mutedTextClass={mutedTextClass}
        disabledButtonClass={disabledButtonClass}
        neutralButtonClass={neutralButtonClass}
        primaryInlineButtonClass={primaryInlineButtonClass}
        sectionDividerClass={sectionDividerClass}
        clearQualityReport={clearQualityReport}
        exportQualityReport={exportQualityReport}
        exportDebugPackage={exportDebugPackage}
        exportIssueDraft={exportIssueDraft}
        exportIssueCases={exportIssueCases}
        exportRegressionCases={exportRegressionCases}
        exportIssueAssetCandidates={exportIssueAssetCandidates}
        promoteIssueCasesToTranslationMemory={promoteIssueCasesToTranslationMemory}
        clearIssueCases={clearIssueCases}
        saveQualityFindingCorrection={saveQualityFindingCorrection}
        jumpToPreviewCell={jumpToPreviewCell}
        setSampleReviewCount={setSampleReviewCount}
        generateSampleReview={generateSampleReview}
        runAiSampleReview={runAiSampleReview}
        severityBadgeClass={severityBadgeClass}
        reviewRiskBadgeClass={reviewRiskBadgeClass}
        reviewVerdictBadgeClass={reviewVerdictBadgeClass}
      />
    </div>
  );
};

export default QualityTab;
