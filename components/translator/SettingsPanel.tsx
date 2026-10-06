import React from 'react';
import EmbeddedVisualsNotice from './EmbeddedVisualsNotice';
import type { EmbeddedVisualSummary } from '../../utils/embeddedVisuals';
import { useI18n } from '../../hooks/useI18n';
import { getUiClasses } from './uiClasses';
import type { DocxContext } from '../../utils/docx';
import type { ExcelSkipScope } from '../../utils/excelSkipScope';
import type { PdfContext } from '../../utils/pdf';
import type { POCTRecord, ProcessingState } from '../../types';
import type { TranslationProgressSnapshot } from '../../utils/storage';
import { TARGET_LANGUAGE_OPTIONS, getTargetLanguageLabel } from '../../utils/targetLanguage';
import { TargetLanguage } from '../../types';
import { formatDocxCoverageSummary } from '../../utils/docx';
export interface SettingsPanelProps {
  isLight: boolean;
  embeddedVisuals?: EmbeddedVisualSummary | null;
  AUTO_MODEL: "__AUTO_MODEL__";
  applySavedProgress: () => void;
  autoModelChainLabel: string;
  availableTranslationModels: string[];
  canRunTranslation: boolean;
  clearTranslationMemoryData: () => Promise<void>;
  discardSavedProgress: () => void;
  documentKind: "docx" | "pdf" | "excel";
  docxContextRef: React.RefObject<DocxContext>;
  excelSkipScope: ExcelSkipScope;
  excelSkipScopeRaw: string;
  excelSkipScopeSummary: string;
  file: File;
  fileExtension: string;
  fileSummaryLine: string;
  getModelLabel: (model: string) => string;
  getTranslationModelLabel: (model: string) => string;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  isStringTranslating: boolean;
  isTranslating: boolean;
  pdfContextRef: React.RefObject<PdfContext>;
  processedData: POCTRecord[];
  processingState: ProcessingState;
  runTranslation: (mode?: "fresh" | "resume") => Promise<void>;
  runtimeProtectedTermsCount: number;
  runtimeProtectedTermsRaw: string;
  savedSnapshot: TranslationProgressSnapshot;
  setExcelSkipScopeRaw: React.Dispatch<React.SetStateAction<string>>;
  setRuntimeProtectedTermsRaw: React.Dispatch<React.SetStateAction<string>>;
  setTargetLang: React.Dispatch<React.SetStateAction<string>>;
  setTranslationMemoryEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setTranslationMode: React.Dispatch<React.SetStateAction<"full" | "selective">>;
  setTranslationModelPreference: React.Dispatch<React.SetStateAction<string>>;
  targetLang: string;
  translationMemoryCount: number;
  translationMemoryEnabled: boolean;
  translationMode: "full" | "selective";
  translationModelPreference: string;
  usesDocumentQualityModels: boolean;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isLight,
  embeddedVisuals,
  AUTO_MODEL,
  applySavedProgress,
  autoModelChainLabel,
  availableTranslationModels,
  canRunTranslation,
  clearTranslationMemoryData,
  discardSavedProgress,
  documentKind,
  docxContextRef,
  excelSkipScope,
  excelSkipScopeRaw,
  excelSkipScopeSummary,
  file,
  fileExtension,
  fileSummaryLine,
  getModelLabel,
  getTranslationModelLabel,
  handleFileUpload,
  isStringTranslating,
  isTranslating,
  pdfContextRef,
  processedData,
  processingState,
  runTranslation,
  runtimeProtectedTermsCount,
  runtimeProtectedTermsRaw,
  savedSnapshot,
  setExcelSkipScopeRaw,
  setRuntimeProtectedTermsRaw,
  setTargetLang,
  setTranslationMemoryEnabled,
  setTranslationMode,
  setTranslationModelPreference,
  targetLang,
  translationMemoryCount,
  translationMemoryEnabled,
  translationMode,
  translationModelPreference,
  usesDocumentQualityModels
}) => {
  const { t } = useI18n();
  const {
    panelClass,
    sectionDividerClass,
    headingMutedClass,
    mutedTextClass,
    fieldClass,
    textareaClass,
    disabledButtonClass,
    neutralButtonClass
  } = getUiClasses(isLight);

  return (
    <section className={`${panelClass} space-y-5`}>
      <h2 className="sr-only">{t('settings.title')}</h2>

      <div
        className={`relative flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed px-4 py-3 transition-colors ${
          isLight
            ? 'border-indigo-100 bg-slate-50/70 hover:border-indigo-300'
            : 'border-white/[0.08] bg-white/[0.025] hover:border-indigo-500/45'
        }`}
      >
        <input
          type="file"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          accept=".xlsx,.docx,.pdf"
          onChange={handleFileUpload}
          disabled={processingState.status === 'processing'}
          aria-label={file ? t('settings.upload.replace') : t('settings.upload.cta')}
        />
        <div
          className={`grid h-11 w-9 shrink-0 place-items-center rounded-md font-mono text-[11px] font-semibold ${
            isLight ? 'bg-indigo-50 text-indigo-700' : 'bg-indigo-400/15 text-indigo-200'
          }`}
          aria-hidden="true"
        >
          {fileExtension || '+'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={file ? file.name : undefined}>{file ? file.name : t('settings.upload.cta')}</p>
          <p className={`truncate text-xs ${mutedTextClass}`}>{fileSummaryLine}</p>
        </div>
        <span
          className={`pointer-events-none rounded-lg border px-3 py-1.5 text-xs font-semibold ${
            isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-white/[0.1] bg-white/[0.05] text-slate-200'
          }`}
        >
          {file ? t('settings.upload.replace') : t('settings.upload.cta')}
        </span>
      </div>
      {documentKind === 'docx' && docxContextRef.current && (
        <div className={`space-y-1 text-xs ${mutedTextClass}`}>
          <p>{t('settings.docx.coverage', { coverage: formatDocxCoverageSummary(docxContextRef.current.coverage) })}</p>
          {docxContextRef.current.coverageWarnings.length > 0 && (
            <p>{t('settings.scopeWarn', { warnings: docxContextRef.current.coverageWarnings.join('；') })}</p>
          )}
        </div>
      )}
      {documentKind === 'pdf' && pdfContextRef.current && pdfContextRef.current.coverageWarnings.length > 0 && (
        <p className={`text-xs ${mutedTextClass}`}>
          {t('settings.scopeWarn', { warnings: pdfContextRef.current.coverageWarnings.join('；') })}
        </p>
      )}

      <EmbeddedVisualsNotice isLight={isLight} summary={embeddedVisuals} />

      {savedSnapshot && processedData.length === 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${isLight ? 'border-amber-200 bg-amber-50' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <p className={`text-sm ${isLight ? 'text-amber-800' : 'text-amber-200'}`}>{t('settings.progress.found')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applySavedProgress}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
            >
              {t('settings.progress.restore')}
            </button>
            <button
              type="button"
              onClick={discardSavedProgress}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${neutralButtonClass}`}
            >
              {t('settings.progress.discard')}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)_auto] xl:items-start">
        <div className="min-w-0">
          <label htmlFor="target-language" className={`mb-1.5 block text-xs font-medium ${headingMutedClass}`}>{t('settings.targetLang')}</label>
          <select
            id="target-language"
            className={fieldClass}
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value as TargetLanguage)}
            disabled={processingState.status === 'processing'}
          >
            {TARGET_LANGUAGE_OPTIONS.map((langOption) => (
              <option key={langOption} value={langOption}>
                {getTargetLanguageLabel(langOption)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className={`mb-1.5 text-xs font-medium ${headingMutedClass}`}>{t('settings.strategy')}</p>
          <div className={`inline-flex rounded-xl border p-0.5 ${isLight ? 'border-slate-200 bg-white' : 'border-white/[0.1] bg-white/[0.04]'}`} role="group" aria-label={t('settings.strategy')}>
            {([
              ['full', t('settings.strategy.full')],
              ['selective', t('settings.strategy.selective')]
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTranslationMode(mode)}
                disabled={isTranslating}
                aria-pressed={translationMode === mode}
                className={`rounded-[10px] px-4 py-2 text-sm font-semibold transition-all ${
                  translationMode === mode
                    ? 'bg-indigo-600 text-white'
                    : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor="translation-model" className={`mb-1.5 block text-xs font-medium ${headingMutedClass}`}>{t('settings.model')}</label>
          <select
            id="translation-model"
            className={fieldClass}
            value={translationModelPreference}
            onChange={(e) => setTranslationModelPreference(e.target.value)}
            disabled={isTranslating || isStringTranslating}
          >
            <option value={AUTO_MODEL}>
              {usesDocumentQualityModels
                ? t('settings.model.autoDoc', { kind: documentKind.toUpperCase(), chain: autoModelChainLabel })
                : t('settings.model.auto', { chain: autoModelChainLabel })}
            </option>
            {availableTranslationModels.map((model) => (
              <option key={model} value={model}>
                {getTranslationModelLabel(model)}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 xl:col-span-1">
          <span className="mb-1.5 hidden text-xs xl:block" aria-hidden="true">&nbsp;</span>
          <button
            type="button"
            onClick={() => runTranslation('fresh')}
            disabled={!canRunTranslation || isTranslating}
            className={`w-full whitespace-nowrap rounded-xl px-6 py-2.5 font-semibold transition-all ${
              !canRunTranslation || isTranslating
                ? disabledButtonClass
                : 'bg-indigo-600 text-white shadow-[0_10px_24px_rgba(79,70,229,0.24)] hover:bg-indigo-500 active:scale-[0.99]'
            }`}
          >
            {isTranslating ? t('settings.starting') : t('settings.start')}
          </button>
          {!canRunTranslation && !isTranslating && (
            <p className={`mt-1.5 text-xs ${mutedTextClass}`}>{t('settings.needFile')}</p>
          )}
        </div>
      </div>

      <div className={`space-y-1 text-xs ${mutedTextClass}`}>
        <p>{t('settings.strategy.fullHint')}</p>
        <p>
          {usesDocumentQualityModels
            ? t('settings.model.autoDocHint', { kind: documentKind.toUpperCase(), chain: autoModelChainLabel })
            : t('settings.model.autoHint', { chain: autoModelChainLabel })}
        </p>
      </div>

      <details className={`rounded-xl border ${isLight ? 'border-slate-200' : 'border-white/[0.08]'}`}>
        <summary className={`flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
          <span>{t('settings.more')}</span>
          <span className={`text-xs font-normal ${mutedTextClass}`}>
            {t('settings.more.summary', {
              terms: runtimeProtectedTermsCount,
              tm: translationMemoryEnabled ? t('common.on') : t('common.off')
            })}
          </span>
        </summary>
        <div className={`grid gap-5 border-t p-4 md:grid-cols-2 ${sectionDividerClass}`}>
          <div>
            <label htmlFor="protected-terms" className={`mb-1.5 block text-xs font-medium ${headingMutedClass}`}>{t('settings.protected')}</label>
            <textarea
              id="protected-terms"
              className={textareaClass}
              value={runtimeProtectedTermsRaw}
              onChange={(e) => setRuntimeProtectedTermsRaw(e.target.value)}
              disabled={isTranslating}
              placeholder={t('settings.protected.placeholder')}
            />
            <p className={`mt-1 text-xs ${mutedTextClass}`}>{t('settings.protected.hint', { count: runtimeProtectedTermsCount })}</p>
          </div>

          {documentKind === 'excel' && (
            <div>
              <label htmlFor="excel-skip-scope" className={`mb-1.5 block text-xs font-medium ${headingMutedClass}`}>{t('settings.skip')}</label>
              <textarea
                id="excel-skip-scope"
                className={textareaClass}
                value={excelSkipScopeRaw}
                onChange={(e) => setExcelSkipScopeRaw(e.target.value)}
                disabled={isTranslating}
                placeholder={t('settings.skip.placeholder')}
              />
              <p className={`mt-1 text-xs ${mutedTextClass}`}>{t('settings.skip.hint', { summary: excelSkipScopeSummary })}</p>
              {excelSkipScope.errors.length > 0 && (
                <p className={`mt-1 text-[11px] ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                  {excelSkipScope.errors.slice(0, 3).join('；')}
                  {excelSkipScope.errors.length > 3 ? '；...' : ''}
                </p>
              )}
            </div>
          )}

          <div className={`space-y-2 text-xs ${mutedTextClass}`}>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={translationMemoryEnabled}
                  onChange={(e) => setTranslationMemoryEnabled(e.target.checked)}
                  disabled={isTranslating}
                  className="h-5 w-5 accent-indigo-500 sm:h-4 sm:w-4"
                />
                <span>{t('settings.tm.use')}</span>
              </label>
              <button
                type="button"
                onClick={clearTranslationMemoryData}
                disabled={isTranslating || translationMemoryCount === 0}
                className={`min-h-9 rounded-lg px-3 py-1.5 font-semibold transition-all sm:min-h-0 ${
                  isTranslating || translationMemoryCount === 0 ? disabledButtonClass : neutralButtonClass
                }`}
              >
                {t('settings.tm.clear')}
              </button>
            </div>
            <p>{t('settings.tm.count', { count: translationMemoryCount })}</p>
          </div>
        </div>
      </details>
    </section>
  );
};

export default SettingsPanel;
