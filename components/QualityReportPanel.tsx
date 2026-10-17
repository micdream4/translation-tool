import React, { useMemo, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { AcceptedQualityFinding, QualityReport, QualitySeverity } from '../quality/checks';
import type { QualityFinding } from '../quality/report';
import type { SampleReviewAIResult } from '../types';

// Findings listed before "show all"; the counts always cover every finding.
const FINDINGS_PAGE_SIZE = 40;

type IssueSummaryView = {
  cells: number;
  rows: number;
};

type FormatSnapshotView = {
  sheetName: string;
  rows: number;
  cols: number;
} | null;

type SampleReviewItemView = {
  id: string;
  rowIndex: number;
  columnKey: string;
  locationLabel: string;
  original: string;
  translated: string;
  reason: string;
};

type SampleReviewAiSummaryView = {
  total: number;
  high: number;
  medium: number;
  low: number;
  fail: number;
  warning: number;
  pass: number;
};

type SampleReviewAiMetaView = {
  model?: string;
  engine?: string;
} | null;

interface QualityReportPanelProps {
  qualityReport: QualityReport | null;
  hasQualityReport: boolean;
  formatSnapshot: FormatSnapshotView;
  currentIssueSummary: IssueSummaryView;
  issueCaseCount: number;
  acceptedExceptionCount: number;
  acceptQualityFinding: (finding: QualityFinding) => void;
  undoQualityException: (key: string) => void;
  acceptedFindings: AcceptedQualityFinding[];
  exportAcceptedGoldenCases: () => void;
  qualityFindings: QualityFinding[];
  sampleReviewCount: number;
  sampleReviewItems: SampleReviewItemView[];
  sampleReviewAiSummary: SampleReviewAiSummaryView;
  sampleReviewAiMeta: SampleReviewAiMetaView;
  sampleReviewAiResults: Record<string, SampleReviewAIResult>;
  processedDataLength: number;
  isRunningSampleReviewAi: boolean;
  isLight: boolean;
  panelClass: string;
  metricCardClass: string;
  nestedPanelClass: string;
  subCardClass: string;
  headingMutedClass: string;
  mutedTextClass: string;
  disabledButtonClass: string;
  neutralButtonClass: string;
  primaryInlineButtonClass: string;
  sectionDividerClass: string;
  clearQualityReport: () => void;
  exportQualityReport: () => void;
  exportDebugPackage: () => void;
  exportIssueDraft: () => void;
  exportIssueCases: () => void;
  exportRegressionCases: () => void;
  exportIssueAssetCandidates: () => void;
  promoteIssueCasesToTranslationMemory: () => void;
  clearIssueCases: () => void;
  saveQualityFindingCorrection: (finding: QualityFinding, corrected: string, remember: boolean) => void | Promise<void>;
  jumpToPreviewCell: (rowIndex: number, columnKey: string) => void;
  setSampleReviewCount: (value: number) => void;
  generateSampleReview: () => void;
  runAiSampleReview: () => void;
  severityBadgeClass: (severity?: QualitySeverity) => string;
  reviewRiskBadgeClass: (risk: SampleReviewAIResult['risk']) => string;
  reviewVerdictBadgeClass: (verdict: SampleReviewAIResult['verdict']) => string;
}

// Residue and formatting findings can be false alarms (a name kept on purpose); mechanical damage cannot.
const ACCEPTABLE_FINDING_CATEGORIES = new Set<QualityFinding['category']>(['nonTarget', 'chinese', 'spacing']);

const QualityReportPanel: React.FC<QualityReportPanelProps> = ({
  qualityReport,
  hasQualityReport,
  formatSnapshot,
  currentIssueSummary,
  issueCaseCount,
  acceptedExceptionCount,
  acceptQualityFinding,
  undoQualityException,
  acceptedFindings,
  exportAcceptedGoldenCases,
  qualityFindings,
  sampleReviewCount,
  sampleReviewItems,
  sampleReviewAiSummary,
  sampleReviewAiMeta,
  sampleReviewAiResults,
  processedDataLength,
  isRunningSampleReviewAi,
  isLight,
  panelClass,
  metricCardClass,
  nestedPanelClass,
  subCardClass,
  headingMutedClass,
  mutedTextClass,
  disabledButtonClass,
  neutralButtonClass,
  primaryInlineButtonClass,
  sectionDividerClass,
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
  jumpToPreviewCell,
  setSampleReviewCount,
  generateSampleReview,
  runAiSampleReview,
  severityBadgeClass,
  reviewRiskBadgeClass,
  reviewVerdictBadgeClass
}) => {
  const { t } = useI18n();
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [showAllFindings, setShowAllFindings] = useState(false);
  const [draftTranslation, setDraftTranslation] = useState('');
  const [rememberDraft, setRememberDraft] = useState(true);
  const [findingSeverityFilter, setFindingSeverityFilter] = useState<'all' | QualitySeverity>('all');
  const residualCells = Math.max(currentIssueSummary.cells, qualityReport?.totals.nonTargetCells || 0);
  const residualRows = Math.max(currentIssueSummary.rows, qualityReport?.totals.nonTargetRows || 0);
  const findingCounts = useMemo(() => {
    const counts = { all: qualityFindings.length, high: 0, medium: 0, low: 0 };
    qualityFindings.forEach((finding) => {
      const severity = finding.severity || 'high';
      counts[severity] += 1;
    });
    return counts;
  }, [qualityFindings]);
  const filteredQualityFindings = useMemo(() => {
    if (findingSeverityFilter === 'all') return qualityFindings;
    return qualityFindings.filter((finding) => (finding.severity || 'high') === findingSeverityFilter);
  }, [findingSeverityFilter, qualityFindings]);

  return (
    <section className={`${panelClass} space-y-6`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className={`text-caption font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('report.title')}</h3>
          <p className={`text-caption mt-2 ${mutedTextClass}`}>
            {t('report.desc')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={clearQualityReport}
            disabled={!hasQualityReport}
            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
              !hasQualityReport ? disabledButtonClass : neutralButtonClass
            }`}
          >
            {t('report.clear')}
          </button>
          <button
            onClick={exportQualityReport}
            disabled={!hasQualityReport}
            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
              !hasQualityReport ? disabledButtonClass : primaryInlineButtonClass
            }`}
          >
            {t('report.export')}
          </button>
        </div>
      </div>


      <details className={`rounded-control border p-3 ${'border-line bg-sunken/80'}`}>
        <summary className={`cursor-pointer list-none text-caption font-semibold uppercase tracking-wider ${'text-ink'}`}>{t('report.moreTools')}</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
          <button
            onClick={exportIssueCases}
            disabled={issueCaseCount === 0}
            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
              issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
            }`}
          >
            {t('report.exportCases')}
          </button>
          <button
            onClick={exportDebugPackage}
            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
          >
            {t('report.debug')}
          </button>
          <button
            onClick={exportIssueDraft}
            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
          >
            {t('report.issueDraft')}
          </button>
          </div>
          <div className={`${nestedPanelClass} flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`}>
            <div>
              <h4 className={`text-caption font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('report.loop')}</h4>
              <p className={`text-caption mt-1 ${mutedTextClass}`}>
                {t('report.cases.hint', { count: issueCaseCount })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={promoteIssueCasesToTranslationMemory}
              disabled={issueCaseCount === 0}
              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.cases.promote')}
            </button>
            <button
              type="button"
              onClick={exportIssueAssetCandidates}
              disabled={issueCaseCount === 0}
              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.cases.asset')}
            </button>
            <button
              type="button"
              onClick={exportIssueCases}
              disabled={issueCaseCount === 0}
                className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                  issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
                }`}
            >
              {t('report.cases.jsonl')}
            </button>
            <button
              type="button"
              onClick={exportAcceptedGoldenCases}
              disabled={acceptedExceptionCount === 0}
              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                acceptedExceptionCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.accepted.export', { count: acceptedExceptionCount })}
            </button>
            <button
              type="button"
              onClick={exportRegressionCases}
              disabled={issueCaseCount === 0}
              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.cases.regression')}
            </button>
            <button
              type="button"
                onClick={clearIssueCases}
                disabled={issueCaseCount === 0}
                className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                  issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
                }`}
              >
                {t('report.cases.clear')}
              </button>
            </div>
          </div>

        </div>
      </details>

      {!hasQualityReport && (
        <p className={`text-caption ${mutedTextClass}`}>
          {t('report.empty')}
        </p>
      )}

      {hasQualityReport && qualityReport && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-caption">
            <div className={metricCardClass}>
              <p className={`text-caption ${mutedTextClass}`}>{t('report.card.scanned')}</p>
              <p className={`text-body mt-1 ${'text-ink'}`}>
                {t('report.card.rowsCells', { rows: qualityReport.totals.rowsScanned, cells: qualityReport.totals.cellsScanned })}
              </p>
              {formatSnapshot && (
                <p className={`text-caption mt-1 ${mutedTextClass}`}>
                  {formatSnapshot.sheetName} · {formatSnapshot.rows}x{formatSnapshot.cols}
                </p>
              )}
            </div>
            <div className={metricCardClass}>
              <p className={`text-caption ${mutedTextClass}`}>{t('report.card.residual')}</p>
              <p className={`text-body mt-1 ${'text-ink'}`}>
                {t('report.card.nonTarget', { cells: residualCells, chinese: qualityReport.totals.chineseCells })}
              </p>
              <p className={`text-caption mt-1 ${mutedTextClass}`}>
                {t('report.card.nonTargetRows', { rows: residualRows, chineseRows: qualityReport.totals.chineseRows })}
              </p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-caption ${mutedTextClass}`}>{t('report.card.repair')}</p>
              <p className={`text-body mt-1 ${'text-ink'}`}>
                {t('report.card.empty', { count: qualityReport.totals.emptyTranslations })}
              </p>
              <p className={`text-caption mt-1 ${mutedTextClass}`}>
                {t('report.card.placeholder', { placeholder: qualityReport.totals.placeholderCells, id: qualityReport.totals.idMismatches })}
              </p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-caption ${mutedTextClass}`}>{t('report.card.formatStructure')}</p>
              <p className={`text-body mt-1 ${'text-ink'}`}>
                {t('report.card.format', { count: qualityReport.totals.spacingIssues })}
              </p>
              <p className={`text-caption mt-1 ${mutedTextClass}`}>
                {t('report.card.formatLevels', { high: qualityReport.totals.spacingHigh, medium: qualityReport.totals.spacingMedium, low: qualityReport.totals.spacingLow })}
              </p>
              <p className={`text-caption mt-1 ${mutedTextClass}`}>
                {t('report.card.structure', { count: qualityReport.totals.structureMismatches })}
              </p>
            </div>
          </div>

          <details className={`rounded-control border p-3 ${'border-line bg-sunken/80'}`}>
            <summary className="cursor-pointer list-none flex items-center justify-between">
              <span className={`text-caption font-semibold uppercase tracking-wider ${'text-ink'}`}>{t('report.details')}</span>
              <span className={`text-caption ${mutedTextClass}`}>{t('report.findings.total', { count: qualityFindings.length })}</span>
            </summary>
            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-caption font-semibold text-muted uppercase tracking-wider">{t('report.findings')}</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['all', 'high', 'medium', 'low'] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setFindingSeverityFilter(filter)}
                        className={`min-h-9 px-3 py-1 rounded-full text-caption font-semibold uppercase tracking-wide transition-all sm:min-h-0 sm:px-3 ${
                          findingSeverityFilter === filter
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface text-ink-soft border border-line hover:bg-sunken'
                        }`}
                      >
                        {t(`report.filter.${filter}`)} {findingCounts[filter]}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-caption text-muted">
                  {t('report.findings.count', { shown: filteredQualityFindings.length, total: qualityFindings.length })}
                </span>
              </div>
              {filteredQualityFindings.length === 0 ? (
                <p className="text-caption text-muted">{t('report.findings.none')}</p>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {(showAllFindings ? filteredQualityFindings : filteredQualityFindings.slice(0, FINDINGS_PAGE_SIZE)).map((finding) => (
                    <div key={finding.id} className={subCardClass}>
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-caption font-medium ${'text-ink'}`}>
                              {finding.description}
                            </p>
                            {finding.severity && (
                              <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${severityBadgeClass(finding.severity)}`}>
                                {t(`report.filter.${finding.severity}`)}
                              </span>
                            )}
                          </div>
                          <p className="text-caption text-muted">{finding.locationLabel}</p>
                          {finding.original && (
                            <p className="text-caption text-muted">
                              {t('report.finding.original', { text: finding.original.replace(/\s+/g, ' ').slice(0, 120) })}
                            </p>
                          )}
                          <p className="text-caption text-muted">
                            {t('report.finding.translated', { text: (finding.translated || t('common.empty')).replace(/\s+/g, ' ').slice(0, 120) })}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setEditingFindingId(finding.id);
                              setDraftTranslation(finding.translated || '');
                            }}
                            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
                          >
                            {t('report.finding.save')}
                          </button>
                          {ACCEPTABLE_FINDING_CATEGORIES.has(finding.category) && (
                            <button
                              type="button"
                              onClick={() => acceptQualityFinding(finding)}
                              title={t('report.finding.accept.hint')}
                              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
                            >
                              {t('report.finding.accept')}
                            </button>
                          )}
                          <button
                            onClick={() => jumpToPreviewCell(finding.rowIndex, finding.columnKey)}
                            className="inline-flex items-center justify-center px-3 h-8 rounded-control bg-primary hover:bg-primary-hover text-on-primary text-caption font-semibold transition-all"
                          >
                            {t('common.jump')}
                          </button>
                        </div>
                      </div>
                      {editingFindingId === finding.id && (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={draftTranslation}
                            onChange={(e) => setDraftTranslation(e.target.value)}
                            rows={3}
                            className={`w-full rounded-control border px-3 py-2 text-caption ${'border-line bg-surface text-ink'}`}
                          />
                          <label className={`flex items-center gap-2 text-caption ${mutedTextClass}`}>
                            <input type="checkbox" checked={rememberDraft} onChange={(e) => setRememberDraft(e.target.checked)} />
                            {t('report.finding.remember')}
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!draftTranslation.trim()}
                              onClick={async () => {
                                await saveQualityFindingCorrection(finding, draftTranslation, rememberDraft);
                                setEditingFindingId(null);
                              }}
                              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold ${!draftTranslation.trim() ? disabledButtonClass : primaryInlineButtonClass}`}
                            >
                              {t('report.finding.apply')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFindingId(null)}
                              className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold ${neutralButtonClass}`}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredQualityFindings.length > FINDINGS_PAGE_SIZE && (
                    <button
                      type="button"
                      onClick={() => setShowAllFindings((value) => !value)}
                      className={`inline-flex h-8 w-full items-center justify-center rounded-control px-3 text-caption font-semibold ${neutralButtonClass}`}
                    >
                      {showAllFindings
                        ? t('report.findings.showLess')
                        : t('report.findings.showing', { shown: FINDINGS_PAGE_SIZE, total: filteredQualityFindings.length })}
                    </button>
                  )}
                </div>
              )}
              {acceptedFindings.length > 0 && (
                <details className={nestedPanelClass}>
                  <summary className={`cursor-pointer text-caption font-semibold ${'text-ink-soft'}`}>
                    {t('report.accepted.list', { count: acceptedFindings.length })}
                  </summary>
                  <p className={`text-caption mt-2 ${mutedTextClass}`}>{t('report.accepted.list.hint')}</p>
                  <div className="mt-2 space-y-2 max-h-[240px] overflow-auto pr-1">
                    {acceptedFindings.slice(0, 60).map((item) => (
                      <div
                        key={`${item.exceptionKey}@${item.rowIndex}:${item.columnKey}`}
                        className={`${subCardClass} flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-caption text-muted">{item.locationLabel || `${item.rowIndex + 1} / ${item.columnKey}`}</p>
                            {item.pendingReview && (
                              <span className={`px-2 py-0.5 rounded-full text-caption ${'bg-warning-soft text-warning'}`}>
                                {t('report.accepted.pending')}
                              </span>
                            )}
                          </div>
                          {item.original && item.original.trim() !== item.value.trim() && (
                            <p className="text-caption text-muted">
                              {t('report.finding.original', { text: item.original.replace(/\s+/g, ' ').slice(0, 120) })}
                            </p>
                          )}
                          <p className="text-caption text-muted">
                            {t('report.finding.translated', { text: item.value.replace(/\s+/g, ' ').slice(0, 120) })}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => undoQualityException(item.exceptionKey)}
                            title={t('report.accepted.undo.hint')}
                            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
                          >
                            {t('report.accepted.undo')}
                          </button>
                          <button
                            onClick={() => jumpToPreviewCell(item.rowIndex, item.columnKey)}
                            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
                          >
                            {t('common.jump')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <div className={`space-y-3 border-t pt-6 ${sectionDividerClass}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h4 className="text-caption font-semibold text-muted uppercase tracking-wider">{t('report.sample.title')}</h4>
                  <p className="text-caption text-muted mt-1">
                    {t('report.sample.hint')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={'bg-surface border border-line rounded-control px-3 h-8 text-caption text-ink shadow-sm'}
                    value={sampleReviewCount}
                    onChange={(e) => setSampleReviewCount(Number(e.target.value))}
                  >
                    {[10, 20, 30, 50].map((value) => (
                      <option key={value} value={value}>{t('report.sample.count', { count: value })}</option>
                    ))}
                  </select>
                  <button
                    onClick={generateSampleReview}
                    disabled={!hasQualityReport || processedDataLength === 0}
                    className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                      !hasQualityReport || processedDataLength === 0
                        ? disabledButtonClass
                        : 'bg-primary hover:bg-primary-hover text-on-primary'
                    }`}
                  >
                    {t('report.sample.start')}
                  </button>
                  <button
                    onClick={runAiSampleReview}
                    disabled={!hasQualityReport || processedDataLength === 0 || isRunningSampleReviewAi}
                    className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${
                      !hasQualityReport || processedDataLength === 0 || isRunningSampleReviewAi
                        ? disabledButtonClass
                        : 'bg-primary hover:bg-primary-hover text-on-primary'
                    }`}
                  >
                    {isRunningSampleReviewAi ? t('report.sample.aiRunning') : t('report.sample.ai')}
                  </button>
                </div>
              </div>

              {sampleReviewAiSummary.total > 0 && (
                <div className={subCardClass}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-muted">AI 审核结果</span>
                    <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewRiskBadgeClass('high')}`}>
                      {t('report.risk.high')} {sampleReviewAiSummary.high}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewRiskBadgeClass('medium')}`}>
                      {t('report.risk.medium')} {sampleReviewAiSummary.medium}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewRiskBadgeClass('low')}`}>
                      {t('report.risk.low')} {sampleReviewAiSummary.low}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewVerdictBadgeClass('fail')}`}>
                      {t('report.verdict.fail')} {sampleReviewAiSummary.fail}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewVerdictBadgeClass('warning')}`}>
                      {t('report.verdict.warning')} {sampleReviewAiSummary.warning}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewVerdictBadgeClass('pass')}`}>
                      {t('report.verdict.pass')} {sampleReviewAiSummary.pass}
                    </span>
                  </div>
                  {(sampleReviewAiMeta?.model || sampleReviewAiMeta?.engine) && (
                    <p className="text-caption text-muted mt-2">
                      {t('report.sample.model', { model: sampleReviewAiMeta?.model || t('common.unknown') })}
                      {sampleReviewAiMeta?.engine ? t('report.sample.engine', { engine: sampleReviewAiMeta.engine }) : ''}
                    </p>
                  )}
                </div>
              )}

              {sampleReviewItems.length > 0 && (
                <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                  {sampleReviewItems.map((item) => {
                    const review = sampleReviewAiResults[item.id];
                    return (
                      <div key={item.id} className={`${subCardClass} space-y-2`}>
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className={`text-caption font-medium ${'text-ink'}`}>{item.locationLabel}</p>
                              {review && (
                                <>
                                  <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewRiskBadgeClass(review.risk)}`}>
                                    {t(`report.risk.${review.risk}`)}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-full text-caption uppercase tracking-wide ${reviewVerdictBadgeClass(review.verdict)}`}>
                                    {t(`report.verdict.${review.verdict}`)}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="text-caption text-muted mt-1">抽样理由：{item.reason}</p>
                            {review?.issueTypes?.length ? (
                              <p className="text-caption text-muted mt-1">
                                {t('report.sample.issueTypes', { types: review.issueTypes.join(' / ') })}
                              </p>
                            ) : null}
                          </div>
                          <button
                            onClick={() => jumpToPreviewCell(item.rowIndex, item.columnKey)}
                            className={`inline-flex items-center justify-center px-3 h-8 rounded-control text-caption font-semibold transition-all ${neutralButtonClass}`}
                          >
                            {t('report.sample.view')}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-caption">
                          <div className={nestedPanelClass}>
                            <p className="text-muted uppercase tracking-wider mb-2">{t('preview.source')}</p>
                            <p className={`${'text-ink-soft'} whitespace-pre-wrap break-words`}>{item.original || '(empty)'}</p>
                          </div>
                          <div className={nestedPanelClass}>
                            <p className="text-muted uppercase tracking-wider mb-2">{t('preview.target')}</p>
                            <p className={`${'text-ink-soft'} whitespace-pre-wrap break-words`}>{item.translated || '(empty)'}</p>
                          </div>
                        </div>
                        {review && (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-caption">
                            <div className={nestedPanelClass}>
                              <p className="text-muted uppercase tracking-wider mb-2">{t('report.sample.comment')}</p>
                              <p className={`${'text-ink-soft'} whitespace-pre-wrap break-words`}>{review.comment || t('report.sample.noComment')}</p>
                            </div>
                            <div className={nestedPanelClass}>
                              <p className="text-muted uppercase tracking-wider mb-2">{t('report.sample.suggestion')}</p>
                              <p className={`${'text-ink-soft'} whitespace-pre-wrap break-words`}>{review.suggestion || t('report.sample.noChange')}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
};

export default QualityReportPanel;
