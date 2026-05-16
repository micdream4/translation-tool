import React from 'react';
import type { QualityReport, QualitySeverity } from '../utils/quality';
import type { QualityFinding } from '../utils/qualityReport';
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
  exportIssueCases: () => void;
  clearIssueCases: () => void;
  saveQualityFindingCorrection: (finding: QualityFinding) => void;
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
  exportIssueCases,
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
  return (
    <section className={`${panelClass} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Quality Report</h3>
          <p className={`text-xs mt-2 ${mutedTextClass}`}>
            Summary view for Quality Check results, issue navigation, export, and sample review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearQualityReport}
            disabled={!hasQualityReport}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              !hasQualityReport ? disabledButtonClass : neutralButtonClass
            }`}
          >
            Clear
          </button>
          <button
            onClick={exportQualityReport}
            disabled={!hasQualityReport}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              !hasQualityReport ? disabledButtonClass : primaryInlineButtonClass
            }`}
          >
            Export Report
          </button>
          <button
            onClick={exportIssueCases}
            disabled={issueCaseCount === 0}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
            }`}
          >
            Export Cases
          </button>
          <button
            onClick={exportDebugPackage}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
          >
            Debug Package
          </button>
        </div>
      </div>

      {!hasQualityReport && (
        <p className={`text-xs ${mutedTextClass}`}>
          Run `Run Quality Check` to show summary cards, findings, and sample review controls.
        </p>
      )}

      {hasQualityReport && qualityReport && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Scanned</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                {qualityReport.totals.rowsScanned} rows / {qualityReport.totals.cellsScanned} cells
              </p>
              {formatSnapshot && (
                <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                  {formatSnapshot.sheetName} · {formatSnapshot.rows}x{formatSnapshot.cols}
                </p>
              )}
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Residual</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                非目标语言 {currentIssueSummary.cells} / 中文 {qualityReport.totals.chineseCells}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                {currentIssueSummary.rows} rows / {qualityReport.totals.chineseRows} rows
              </p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Repair Targets</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                空白漏翻 {qualityReport.totals.emptyTranslations}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                占位符 {qualityReport.totals.placeholderCells} · ID {qualityReport.totals.idMismatches}
              </p>
            </div>
            <div className={metricCardClass}>
              <p className={`text-[11px] ${mutedTextClass}`}>Format & Structure</p>
              <p className={`text-sm mt-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                格式 {qualityReport.totals.spacingIssues}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                H {qualityReport.totals.spacingHigh} · M {qualityReport.totals.spacingMedium} · L {qualityReport.totals.spacingLow}
              </p>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                结构 {qualityReport.totals.structureMismatches}
              </p>
            </div>
          </div>

          <div className={`${nestedPanelClass} flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`}>
            <div>
              <h4 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>Quality Loop</h4>
              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                本地问题样本库：{issueCaseCount} 条。点击每条 finding 的 Save Correction 可保存人工修正，后续可转术语、翻译记忆、QA 规则或回归测试。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportIssueCases}
                disabled={issueCaseCount === 0}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
                }`}
              >
                Export JSONL
              </button>
              <button
                type="button"
                onClick={clearIssueCases}
                disabled={issueCaseCount === 0}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  issueCaseCount === 0 ? disabledButtonClass : neutralButtonClass
                }`}
              >
                Clear Cases
              </button>
            </div>
          </div>

          <details className={`rounded-lg border p-3 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-950/30'}`}>
            <summary className="cursor-pointer list-none flex items-center justify-between">
              <span className={`text-xs font-semibold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>Details & Sample Review</span>
              <span className={`text-[11px] ${mutedTextClass}`}>{qualityFindings.length} findings</span>
            </summary>
            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Findings</h4>
                <span className="text-[11px] text-slate-500">
                  {qualityFindings.length} items
                </span>
              </div>
              {qualityFindings.length === 0 ? (
                <p className="text-xs text-slate-500">当前未发现需要定位的问题。</p>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {qualityFindings.slice(0, 40).map((finding) => (
                    <div key={finding.id} className={subCardClass}>
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-xs font-medium ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                              {finding.description}
                            </p>
                            {finding.severity && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${severityBadgeClass(finding.severity)}`}>
                                {finding.severity}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">{finding.locationLabel}</p>
                          {finding.original && (
                            <p className="text-[11px] text-slate-400">
                              原文：{finding.original.replace(/\s+/g, ' ').slice(0, 120)}
                            </p>
                          )}
                          <p className="text-[11px] text-slate-500">
                            译文：{(finding.translated || '(empty)').replace(/\s+/g, ' ').slice(0, 120)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => saveQualityFindingCorrection(finding)}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
                          >
                            Save Correction
                          </button>
                          <button
                            onClick={() => jumpToPreviewCell(finding.rowIndex, finding.columnKey)}
                            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
                          >
                            Jump
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`space-y-3 border-t pt-5 ${sectionDividerClass}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sample Review</h4>
                  <p className="text-[11px] text-slate-500 mt-1">
                    先生成抽样池，再用 AI 做只读审核。不会自动改写译文。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={isLight ? 'bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 shadow-sm' : 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200'}
                    value={sampleReviewCount}
                    onChange={(e) => setSampleReviewCount(Number(e.target.value))}
                  >
                    {[10, 20, 30, 50].map((value) => (
                      <option key={value} value={value}>{value} samples</option>
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
                    Start Sample Review
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
                    {isRunningSampleReviewAi ? 'AI Reviewing...' : 'Run AI Review'}
                  </button>
                </div>
              </div>

              {sampleReviewAiSummary.total > 0 && (
                <div className={subCardClass}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-slate-500">AI 审核结果</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('high')}`}>
                      High {sampleReviewAiSummary.high}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('medium')}`}>
                      Medium {sampleReviewAiSummary.medium}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewRiskBadgeClass('low')}`}>
                      Low {sampleReviewAiSummary.low}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('fail')}`}>
                      Fail {sampleReviewAiSummary.fail}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('warning')}`}>
                      Warning {sampleReviewAiSummary.warning}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass('pass')}`}>
                      Pass {sampleReviewAiSummary.pass}
                    </span>
                  </div>
                  {(sampleReviewAiMeta?.model || sampleReviewAiMeta?.engine) && (
                    <p className="text-[11px] text-slate-500 mt-2">
                      审核模型：{sampleReviewAiMeta?.model || 'unknown'}
                      {sampleReviewAiMeta?.engine ? ` · 引擎 ${sampleReviewAiMeta.engine}` : ''}
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
                                    {review.risk}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${reviewVerdictBadgeClass(review.verdict)}`}>
                                    {review.verdict}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">抽样理由：{item.reason}</p>
                            {review?.issueTypes?.length ? (
                              <p className="text-[11px] text-slate-500 mt-1">
                                问题类型：{review.issueTypes.join(' / ')}
                              </p>
                            ) : null}
                          </div>
                          <button
                            onClick={() => jumpToPreviewCell(item.rowIndex, item.columnKey)}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
                          >
                            View In Table
                          </button>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-[11px]">
                          <div className={nestedPanelClass}>
                            <p className="text-slate-500 uppercase tracking-wider mb-2">Source</p>
                            <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{item.original || '(empty)'}</p>
                          </div>
                          <div className={nestedPanelClass}>
                            <p className="text-slate-500 uppercase tracking-wider mb-2">Target</p>
                            <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{item.translated || '(empty)'}</p>
                          </div>
                        </div>
                        {review && (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-[11px]">
                            <div className={nestedPanelClass}>
                              <p className="text-slate-500 uppercase tracking-wider mb-2">AI Comment</p>
                              <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{review.comment || '未给出额外说明。'}</p>
                            </div>
                            <div className={nestedPanelClass}>
                              <p className="text-slate-500 uppercase tracking-wider mb-2">Suggested Fix</p>
                              <p className={`${isLight ? 'text-slate-700' : 'text-slate-300'} whitespace-pre-wrap break-words`}>{review.suggestion || '无需修改'}</p>
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
