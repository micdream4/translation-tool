import React from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { AppView, ModelReviewStyleSelection } from './types';
import { getUiClasses } from './uiClasses';
import type { ModelReviewCandidate, ModelReviewJudgeResult, ModelReviewRankingRow, ModelReviewResult, ModelReviewSample, ModelReviewStyle } from '../../utils/modelReview';
import { DEFAULT_MODEL_REVIEW_JUDGE_MODELS, DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS } from '../../utils/modelReview';
import { getTargetLanguageLabel } from '../../utils/targetLanguage';
export interface ModelReviewViewProps {
  isLight: boolean;
  canRunModelReview: () => boolean;
  effectiveModelReviewStyle: ModelReviewStyle;
  exportModelReviewReport: () => void;
  file: File;
  getModelLabel: (model: string) => string;
  getModelReviewSourceLabel: () => "Excel cells" | "DOCX segments" | "PDF text segments" | "current document";
  getRecommendedModelReviewStyle: () => ModelReviewStyle;
  hasModelReviewJudgeScores: boolean;
  isRunningModelReview: boolean;
  isTranslating: boolean;
  modelReviewCount: number;
  modelReviewFailedCandidates: ModelReviewCandidate[];
  modelReviewFailedJudges: ModelReviewJudgeResult[];
  modelReviewResult: ModelReviewResult;
  modelReviewSamplesPreview: ModelReviewSample[];
  modelReviewScoredRows: ModelReviewRankingRow[];
  modelReviewStageClass: (stage: "idle" | "completed" | "sampling" | "translating" | "judging" | "error") => "text-success border border-success-border bg-success-soft" | "text-success border border-success-border bg-success-soft" | "text-danger border border-danger-border bg-danger-soft" | "text-danger border border-danger-border bg-danger-soft" | "text-primary-ink border border-primary-border bg-primary-soft" | "text-primary-ink border border-primary/30 bg-primary-soft" | "text-ink-soft border border-line bg-sunken" | "text-muted border border-line bg-surface/40";
  modelReviewStatus: { stage: "idle" | "sampling" | "translating" | "judging" | "completed" | "error"; message: string; };
  modelReviewStyleMetricLabel: "Cell" | "Readable" | "Faithful" | "Style" | "Manual";
  modelReviewStyleSelection: ModelReviewStyleSelection;
  modelReviewSuccessfulCandidates: ModelReviewCandidate[];
  runModelReview: () => Promise<void>;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setModelReviewCount: React.Dispatch<React.SetStateAction<number>>;
  setModelReviewStyleSelection: React.Dispatch<React.SetStateAction<ModelReviewStyleSelection>>;
  targetLang: string;
}

const ModelReviewView: React.FC<ModelReviewViewProps> = ({
  isLight,
  canRunModelReview,
  effectiveModelReviewStyle,
  exportModelReviewReport,
  file,
  getModelLabel,
  getModelReviewSourceLabel,
  getRecommendedModelReviewStyle,
  hasModelReviewJudgeScores,
  isRunningModelReview,
  isTranslating,
  modelReviewCount,
  modelReviewFailedCandidates,
  modelReviewFailedJudges,
  modelReviewResult,
  modelReviewSamplesPreview,
  modelReviewScoredRows,
  modelReviewStageClass,
  modelReviewStatus,
  modelReviewStyleMetricLabel,
  modelReviewStyleSelection,
  modelReviewSuccessfulCandidates,
  runModelReview,
  setActiveView,
  setModelReviewCount,
  setModelReviewStyleSelection,
  targetLang
}) => {
  const { t } = useI18n();
  const sourceKind = ({ 'Excel cells': 'excel', 'DOCX segments': 'docx', 'PDF text segments': 'pdf' } as Record<string, string>)[getModelReviewSourceLabel()] || 'other';
  const metricKey = modelReviewStyleMetricLabel.toLowerCase();
  const {
    panelClass,
    headingMutedClass,
    mutedTextClass,
    fieldClass,
    disabledButtonClass,
    neutralButtonClass,
    primaryInlineButtonClass,
    metricCardClass,
    subCardClass,
    nestedPanelClass
  } = getUiClasses(isLight);

  return (
          <main className="flex-1 max-w-[1480px] mx-auto w-full p-4 lg:px-8 lg:py-8 space-y-6">
            <section className={`${panelClass} space-y-5`}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('review.eyebrow')}</p>
                  <h2 className={`text-2xl font-semibold mt-2 ${'text-ink'}`}>
                    {t('review.title')}
                  </h2>
                  <p className={`text-sm mt-2 max-w-3xl ${mutedTextClass}`}>
                    {t('review.desc')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveView('translator')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${neutralButtonClass}`}
                  >
                    {t('review.back')}
                  </button>
                  <button
                    type="button"
                    onClick={exportModelReviewReport}
                    disabled={!modelReviewResult || isRunningModelReview}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      !modelReviewResult || isRunningModelReview ? disabledButtonClass : primaryInlineButtonClass
                    }`}
                  >
                    {t('review.export')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
                <div className={metricCardClass}>
                  <p className={`text-[11px] ${mutedTextClass}`}>{t('review.source')}</p>
                  <p className={`text-sm font-semibold mt-1 ${'text-ink'}`}>
                    {file?.name || t('review.noFile')}
                  </p>
                  <p className={`text-[11px] mt-1 ${mutedTextClass}`}>{t(`review.sourceLabel.${sourceKind}`)}</p>
                </div>
                <div className={metricCardClass}>
                  <p className={`text-[11px] ${mutedTextClass}`}>{t('review.target')}</p>
    	              <p className={`text-sm font-semibold mt-1 ${'text-ink'}`}>{getTargetLanguageLabel(targetLang)}</p>
    	              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
    	                {t(`review.style.${effectiveModelReviewStyle}`)}
    	              </p>
    	            </div>
                <div className={metricCardClass}>
                  <p className={`text-[11px] ${mutedTextClass}`}>{t('review.candidates')}</p>
                  <p className={`text-sm font-semibold mt-1 ${'text-ink'}`}>
                    {t('review.translationModels', { count: DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.length })}
                  </p>
                  <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
                    {t('review.judges', { count: DEFAULT_MODEL_REVIEW_JUDGE_MODELS.length })}
                  </p>
                </div>
    	            <div className={metricCardClass}>
    	              <p className={`text-[11px] ${mutedTextClass}`}>{t('review.statusLabel')}</p>
    	              <p className={`text-sm font-semibold mt-1 ${'text-ink'}`}>
    	                {isRunningModelReview ? t('review.status.running') : modelReviewResult ? (hasModelReviewJudgeScores ? t('review.status.completed') : t('review.status.noScore')) : t('review.status.idle')}
    	              </p>
    	              <p className={`text-[11px] mt-1 ${mutedTextClass}`}>
    	                {modelReviewResult
                        ? t('review.candidatesDone', { done: modelReviewSuccessfulCandidates.length, total: modelReviewResult.candidates.length })
                        : t('review.plannedSamples', { count: modelReviewCount })}
    	              </p>
    	            </div>
              </div>
            </section>

            <section className={`${panelClass} space-y-5`}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('review.run.title')}</h3>
                  <p className={`text-xs mt-2 ${mutedTextClass}`}>
                    {t('review.run.hint')}
                  </p>
    	            </div>
    	            <div className="flex flex-wrap items-center gap-2">
    	              <select
    	                className={fieldClass}
    	                value={modelReviewStyleSelection}
    	                onChange={(e) => setModelReviewStyleSelection(e.target.value as ModelReviewStyleSelection)}
    	                disabled={isRunningModelReview}
    	                title={t('review.styleTitle')}
    	              >
    	                <option value="recommended">
    	                  {t('review.style.recommended', { style: t(`review.style.${getRecommendedModelReviewStyle()}`) })}
    	                </option>
    	                <option value="auto">{t('review.style.auto')}</option>
    	                <option value="medical-report">{t('review.style.medical-report')}</option>
    	                <option value="ifu-manual">{t('review.style.ifu-manual')}</option>
    	                <option value="marketing-readable">{t('review.style.marketing-readable')}</option>
    	                <option value="terminology-faithful">{t('review.style.terminology-faithful')}</option>
    	              </select>
    	              <select
    	                className={fieldClass}
    	                value={modelReviewCount}
                    onChange={(e) => setModelReviewCount(Number(e.target.value))}
                    disabled={isRunningModelReview}
                  >
                    {[5, 10, 20].map((value) => (
                      <option key={value} value={value}>{t('review.samples', { count: value })}</option>
                    ))}
                  </select>
                  <button
                    onClick={runModelReview}
                    disabled={!canRunModelReview() || isTranslating || isRunningModelReview}
                    className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                      !canRunModelReview() || isTranslating || isRunningModelReview
                        ? disabledButtonClass
                        : 'bg-primary hover:bg-primary-hover text-white shadow-sm'
                    }`}
                  >
                    {isRunningModelReview ? t('review.running') : t('review.runButton')}
                  </button>
                </div>
              </div>

    	          <div className={`rounded-xl px-4 py-3 text-xs ${modelReviewStageClass(modelReviewStatus.stage)}`}>
    	            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    	              <div className="flex items-center gap-2">
    	                {isRunningModelReview && (
    	                  <span className="h-2 w-2 rounded-full bg-current animate-pulse"></span>
                    )}
                    <span className="font-semibold uppercase tracking-wider">{t(`review.stage.${modelReviewStatus.stage}`)}</span>
                  </div>
                  <span className="text-left sm:text-right">{modelReviewStatus.stage === 'idle' ? t('review.ready') : modelReviewStatus.message}</span>
                </div>
                {isRunningModelReview && (
                  <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${'bg-surface/80'}`}>
                    <div className="h-full w-2/3 rounded-full bg-current opacity-60 animate-pulse"></div>
    	              </div>
    	            )}
    	          </div>

    		          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={subCardClass}>
                  <p className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('review.preview.title')}</p>
                  {modelReviewSamplesPreview.length === 0 ? (
                    <p className={`text-xs mt-3 ${mutedTextClass}`}>{t('review.preview.empty')}</p>
                  ) : (
                    <div className="space-y-2 mt-3 max-h-[280px] overflow-auto pr-1">
                      {modelReviewSamplesPreview.map((sample) => (
                        <div key={sample.id} className={nestedPanelClass}>
                          <p className={`text-[11px] font-semibold ${'text-ink'}`}>{sample.location}</p>
                          <p className={`text-[11px] mt-1 line-clamp-3 ${mutedTextClass}`}>{sample.sourceText}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
    	            <div className={subCardClass}>
    	              <p className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('review.models.title')}</p>
    	              <div className="grid grid-cols-1 gap-2 mt-3">
    	                {DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.map((model) => {
    	                  const candidate = modelReviewResult?.candidates.find((item) => item.model === model);
    	                  const statusLabel = candidate
    	                    ? candidate.translations.length > 0
    	                      ? 'translated'
    	                      : 'failed'
    	                    : isRunningModelReview
    	                      ? 'running'
    	                      : 'planned';
    	                  return (
    	                    <div key={model} className={nestedPanelClass}>
    	                      <div className="flex items-center justify-between gap-3">
    	                        <p className={`text-[11px] ${'text-ink-soft'}`}>
    	                          {getModelLabel(model)}
    	                        </p>
    	                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
    	                          statusLabel === 'translated'
    	                            ? 'bg-success-soft text-success'
    	                            : statusLabel === 'failed'
    	                              ? 'bg-danger-soft text-danger'
    	                              : 'bg-subtle text-muted'
    	                        }`}>
    	                          {t(`review.model.${statusLabel}`)}
    	                        </span>
    	                      </div>
    	                    </div>
    	                  );
    	                })}
    	              </div>
    	            </div>
              </div>
            </section>

            {modelReviewResult && (
              <section className={`${panelClass} space-y-5`}>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
    	                <h3 className={`text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>{t('review.results.title')}</h3>
    	                <p className={`text-xs mt-2 ${mutedTextClass}`}>
    	                  {t('review.results.summary', { samples: modelReviewResult.samples.length, done: modelReviewSuccessfulCandidates.length, total: modelReviewResult.candidates.length, scored: modelReviewScoredRows.length })}
    	                </p>
    	              </div>
                  <button
                    onClick={exportModelReviewReport}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${primaryInlineButtonClass}`}
                  >
                    {t('review.export')}
    	              </button>
    	            </div>

    	            {(modelReviewFailedCandidates.length > 0 || modelReviewFailedJudges.length > 0 || !hasModelReviewJudgeScores) && (
    	              <div className={`rounded-xl border px-4 py-3 text-xs ${
    	                'border-warning-border bg-warning-soft text-warning'
    	              }`}>
    	                <p className="font-semibold">
    	                  {hasModelReviewJudgeScores ? t('review.warn.partial') : t('review.warn.noScore')}
    	                </p>
    	                <p className="mt-1">
    	                  {modelReviewFailedCandidates.length > 0 && `${t('review.warn.candidates', { count: modelReviewFailedCandidates.length })} `}
    	                  {modelReviewFailedJudges.length > 0 && `${t('review.warn.judges', { count: modelReviewFailedJudges.length })} `}
    	                  {t('review.warn.cause')}
    	                </p>
    	              </div>
    	            )}

    	            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
    	              {modelReviewResult.ranking.slice(0, 6).map((row, index) => (
    	                <div key={row.model} className={metricCardClass}>
    	                  <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-[11px] ${mutedTextClass}`}>#{index + 1}</p>
                          <p className={`text-sm font-semibold truncate ${'text-ink'}`}>
    	                        {getModelLabel(row.model)}
    	                      </p>
    	                    </div>
    	                    <p className={`text-lg font-semibold ${'text-primary-ink'}`}>
    	                      {row.judgeCount > 0 ? row.overall.toFixed(2) : t('review.notScored')}
    	                    </p>
    	                  </div>
    	                  <p className={`text-[11px] mt-2 ${mutedTextClass}`}>
    		                    {row.judgeCount > 0
    		                      ? t('review.metrics', { acc: row.accuracy.toFixed(1), fluency: row.fluency.toFixed(1), style: t(`review.metric.${metricKey}`), manual: row.manualStyle.toFixed(1), term: row.terminology.toFixed(1) })
    		                      : t('review.noScoreText')}
    	                  </p>
    	                </div>
    	              ))}
    	            </div>

    	            {(modelReviewFailedCandidates.length > 0 || modelReviewFailedJudges.length > 0) && (
    	              <details className={`rounded-xl border p-3 ${'border-line bg-sunken/80'}`}>
    	                <summary className={`cursor-pointer list-none flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>
    	                  <span>{t('review.diag.title')}</span>
    	                  <span>{t('review.diag.count', { count: modelReviewFailedCandidates.length + modelReviewFailedJudges.length })}</span>
    	                </summary>
    	                <div className="mt-3 space-y-2">
    	                  {modelReviewFailedCandidates.map((candidate) => (
    	                    <div key={`candidate-${candidate.model}`} className={nestedPanelClass}>
    	                      <p className={`text-[11px] font-semibold ${'text-ink'}`}>
    	                        {t('review.diag.candidate', { model: getModelLabel(candidate.model) })}
    	                      </p>
    	                      <p className={`text-[11px] mt-1 whitespace-pre-wrap break-words ${'text-danger'}`}>
    	                        {candidate.error || t('review.diag.noTranslations')}
    	                      </p>
    	                    </div>
    	                  ))}
    	                  {modelReviewFailedJudges.map((judge) => (
    	                    <div key={`judge-${judge.model}`} className={nestedPanelClass}>
    	                      <p className={`text-[11px] font-semibold ${'text-ink'}`}>
    	                        {t('review.diag.judge', { model: getModelLabel(judge.model) })}
    	                      </p>
    	                      <p className={`text-[11px] mt-1 whitespace-pre-wrap break-words ${'text-danger'}`}>
    	                        {judge.error || t('review.diag.noScores')}
    	                      </p>
    	                    </div>
    	                  ))}
    	                </div>
    	              </details>
    	            )}

    	            <details className={`rounded-xl border p-3 ${'border-line bg-sunken/80'}`}>
                  <summary className={`cursor-pointer list-none flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${headingMutedClass}`}>
                    <span>{t('review.compare.title')}</span>
                    <span>{t('review.samples', { count: modelReviewResult.samples.length })}</span>
                  </summary>
                  <div className="space-y-4 mt-4 max-h-[620px] overflow-auto pr-1">
                    {modelReviewResult.samples.map((sample) => (
                      <div key={sample.id} className={`${subCardClass} space-y-3`}>
                        <div>
                          <p className={`text-xs font-semibold ${'text-ink'}`}>{sample.location}</p>
                          <p className={`text-[11px] mt-1 whitespace-pre-wrap break-words ${'text-ink-soft'}`}>
                            {sample.sourceText}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          {modelReviewResult.candidates.map((candidate) => {
                            const translation = candidate.translations.find((item) => item.id === sample.id);
                            return (
                              <div key={`${sample.id}-${candidate.model}`} className={nestedPanelClass}>
                                <p className="text-muted uppercase tracking-wider mb-2 text-[10px]">
                                  {getModelLabel(candidate.model)}
                                </p>
                                <p className={`${'text-ink-soft'} whitespace-pre-wrap break-words text-[11px]`}>
                                  {translation?.translation || candidate.error || '(empty)'}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            )}
          </main>
  );
};

export default ModelReviewView;
