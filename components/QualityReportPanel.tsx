import React, { useMemo, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { QualityReport, QualitySeverity } from '../utils/quality';
import type { QualityFinding } from '../quality/report';
import type { SampleReviewAIResult } from '../types';

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

const QualityReportPanel: React.FC<QualityReportPanelProps> = ({
  qualityReport,
  hasQualityReport,
  formatSnapshot,
  currentIssueSummary,
  issueCaseCount,
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
    <section className={`${panelClass} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('report.title')}</h3>
          <p className={`text-xs mt-2 ${mutedTextClass}`}>
            {t('report.desc')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={clearQualityReport}
            disabled={!hasQualityReport}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              !hasQualityReport ? disabledButtonClass : neutralButtonClass
            }`}
          >
            {t('report.clear')}
          </button>
          <button
            onClick={exportQualityReport}
            disabled={!hasQualityReport}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              !hasQualityReport ? disabledButtonClass : primaryInlineButtonClass
            }`}
          >
            {t('report.export')}
          </button>
        </div>
      </div>


      <details className={`rounded-lg border p-3 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-950/30'}`}>
        <summary className={`cursor-pointer list-none text-xs font-semibold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{t('report.moreTools')}</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
          <button
            onClick={exportIssueCases}
            disabled={issueCaseCount === 0}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
            }`}
          >
            {t('report.exportCases')}
          </button>
          <button
            onClick={exportDebugPackage}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
          >
            {t('report.debug')}
          </button>
          <button
            onClick={exportIssueDraft}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
          >
            {t('report.issueDraft')}
          </button>
          </div>
          <div className={`${nestedPanelClass} flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`}>
            <div>
              <h4 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('report.loop')}</h4>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {t('report.cases.hint', { count: issueCaseCount })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={promoteIssueCasesToTranslationMemory}
              disabled={issueCaseCount === 0}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.cases.promote')}
            </button>
            <button
              type="button"
              onClick={exportIssueAssetCandidates}
              disabled={issueCaseCount === 0}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.cases.asset')}
            </button>
            <button
              type="button"
              onClick={exportIssueCases}
              disabled={issueCaseCount === 0}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
                }`}
            >
              {t('report.cases.jsonl')}
            </button>
            <button
              type="button"
              onClick={exportRegressionCases}
              disabled={issueCaseCount === 0}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
              }`}
            >
              {t('report.cases.regression')}
            </button>
            <button
              type="button"
                onClick={clearIssueCases}
                disabled={issueCaseCount === 0}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
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
        <p className={`text-xs ${mutedTextClass}`}>
          {t('report.empty')}
        </p>
      )}

      {hasQualityReport && qualityReport && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>{t('report.card.scanned')}</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {t('report.card.rowsCells', { rows: qualityReport.totals.rowsScanned, cells: qualityReport.totals.cellsScanned })}
              </p>
              {formatSnapshot && (
                <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                  {formatSnapshot.sheetName} · {formatSnapshot.rows}x{formatSnapshot.cols}
                </p>
              )}
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>{t('report.card.residual')}</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {t('report.card.nonTarget', { cells: residualCells, chinese: qualityReport.totals.chineseCells })}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {t('report.card.nonTargetRows', { rows: residualRows, chineseRows: qualityReport.totals.chineseRows })}
              </p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>{t('report.card.repair')}</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {t('report.card.empty', { count: qualityReport.totals.emptyTranslations })}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {t('report.card.placeholder', { placeholder: qualityReport.totals.placeholderCells, id: qualityReport.totals.idMismatches })}
              </p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>{t('report.card.formatStructure')}</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {t('report.card.format', { count: qualityReport.totals.spacingIssues })}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {t('report.card.formatLevels', { high: qualityReport.totals.spacingHigh, medium: qualityReport.totals.spacingMedium, low: qualityReport.totals.spacingLow })}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {t('report.card.structure', { count: qualityReport.totals.structureMismatches })}
              </p>
            </div>
          </div>

          <details className={`rounded-lg border p-3 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-950/30'}`}>
            <summary className="cursor-pointer list-none flex items-center justify-between">
              <span className={`text-xs font-semibold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{t('report.details')}</span>
              <span className={`text-[11px] ${mutedTextClass}`}>{t('report.findings.total', { count: qualityFindings.length })}</span>
            </summary>
            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('report.findings')}</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['all', 'high', 'medium', 'low'] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setFindingSeverityFilter(filter)}
                        className={`min-h-9 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-all sm:min-h-0 sm:px-2.5 ${
                          findingSeverityFilter === filter
                            ? 'bg-indigo-600 text-white'
                            : isLight
                              ? 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {t(`report.filter.${filter}`)} {findingCounts[filter]}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-[11px] text-slate-500">
                  {t('report.findings.count', { shown: filteredQualityFindings.length, total: qualityFindings.length })}
                </span>
              </div>
              {filteredQualityFindings.length === 0 ? (
                <p className="text-xs text-slate-500">{t('report.findings.none')}</p>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {filteredQualityFindings.slice(0, 40).map((finding) => (
                    <div key={finding.id} className={subCardClass}>
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-xs font-medium ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                              {finding.description}
                            </p>
                            {finding.severity && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${severityBadgeClass(finding.severity)}`}>
                                {t(`report.filter.${finding.severity}`)}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">{finding.locationLabel}</p>
                          {finding.original && (
                            <p className="text-[11px] text-slate-400">
                              {t('report.finding.original', { text: finding.original.replace(/\s+/g, ' ').slice(0, 120) })}
                            </p>
                          )}
                          <p className="text-[11px] text-slate-500">
                            {t('report.finding.translated', { text: (finding.translated || t('common.empty')).replace(/\s+/g, ' ').slice(0, 120) })}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setEditingFindingId(finding.id);
                              setDraftTranslation(finding.translated || '');
                            }}
                            className={`min-h-9 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
                          >
                            {t('report.finding.save')}
                          </button>
                          <button
                            onClick={() => jumpToPreviewCell(finding.rowIndex, finding.columnKey)}
                            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
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
                            className={`w-full rounded-lg border px-3 py-2 text-xs ${isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-slate-700 bg-slate-900 text-slate-200'}`}
                          />
                          <label className={`flex items-center gap-2 text-[11px] ${mutedTextClass}`}>
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
                              className={`min-h-9 px-3 py-2 rounded-lg text-xs font-semibold ${!draftTranslation.trim() ? disabledButtonClass : primaryInlineButtonClass}`}
                            >
                              {t('report.finding.apply')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFindingId(null)}
                              className={`min-h-9 px-3 py-2 rounded-lg text-xs font-semibold ${neutralButtonClass}`}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`space-y-3 border-t pt-5 ${sectionDividerClass}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('report.sample.title')}</h4>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {t('report.sample.hint')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={isLight ? 'bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 shadow-sm' : 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200'}
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
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      !hasQualityReport || processedDataLength === 0
                        ? disabledButtonClass
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {t('report.sample.start')}
                  </button>
                  <button
                    onClick={runAiSampleReview}
                    disabled={!hasQualityReport || processedDataLength === 0 || isRunningSampleReviewAi}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      !hasQualityReport || processedDataLength === 0 || isRunningSampleReviewAi
                        ? disabledButtonClass
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {isRunningSampleReviewAi ? t('report.sample.aiRunning') : t('report.sample.ai')}
                  </button>
                </div>
              </div>

              {sampleReviewAiSummary.total > 0 && (
                <div className={subCardClass}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-slate-500">AI 审核结果</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('high')}`}>
                      {t('report.risk.high')} {sampleReviewAiSummary.high}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('medium')}`}>
                      {t('report.risk.medium')} {sampleReviewAiSummary.medium}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('low')}`}>
                      {t('report.risk.low')} {sampleReviewAiSummary.low}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('fail')}`}>
                      {t('report.verdict.fail')} {sampleReviewAiSummary.fail}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('warning')}`}>
                      {t('report.verdict.warning')} {sampleReviewAiSummary.warning}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('pass')}`}>
                      {t('report.verdict.pass')} {sampleReviewAiSummary.pass}
                    </span>
                  </div>
                  {(sampleReviewAiMeta?.model || sampleReviewAiMeta?.engine) && (
                    <p className="text-[11px] text-slate-500 mt-2">
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
                              <p className={`text-xs font-medium ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>{item.locationLabel}</p>
                              {review && (
                                <>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass(review.risk)}`}>
                                    {t(`report.risk.${review.risk}`)}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass(review.verdict)}`}>
                                    {t(`report.verdict.${review.verdict}`)}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">抽样理由：{item.reason}</p>
                            {review?.issueTypes?.length ? (
                              <p className="text-[11px] text-slate-500 mt-1">
                                {t('report.sample.issueTypes', { types: review.issueTypes.join(' / ') })}
                              </p>
                            ) : null}
                          </div>
                          <button
                            onClick={() => jumpToPreviewCell(item.rowIndex, item.columnKey)}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
                          >
                            {t('report.sample.view')}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-[11px]">
                          <div className={nestedPanelClass}>
                            <p className="text-slate-500 uppercase tracking-wider mb-2">{t('preview.source')}</p>
                            <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{item.original || '(empty)'}</p>
                          </div>
                          <div className={nestedPanelClass}>
                            <p className="text-slate-500 uppercase tracking-wider mb-2">{t('preview.target')}</p>
                            <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{item.translated || '(empty)'}</p>
                          </div>
                        </div>
                        {review && (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-[11px]">
                            <div className={nestedPanelClass}>
                              <p className="text-slate-500 uppercase tracking-wider mb-2">{t('report.sample.comment')}</p>
                              <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{review.comment || t('report.sample.noComment')}</p>
                            </div>
                            <div className={nestedPanelClass}>
                              <p className="text-slate-500 uppercase tracking-wider mb-2">{t('report.sample.suggestion')}</p>
                              <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{review.suggestion || t('report.sample.noChange')}</p>
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
