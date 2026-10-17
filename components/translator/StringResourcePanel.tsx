import React from 'react';
import { useI18n } from '../../hooks/useI18n';
import { getUiClasses } from './uiClasses';
import type { TargetLanguage } from '../../types';
import { getTargetLanguageLabel } from '../../utils/targetLanguage';
export interface StringResourcePanelProps {
  isLight: boolean;
  ALL_STRING_TARGETS: "__ALL_STRING_TARGETS__";
  STRING_TARGET_LANGS: string[];
  clearStringHistoryData: () => void;
  clearStringResources: () => void;
  copyStringOutput: (lang: TargetLanguage) => Promise<void>;
  currentModelDisplayLabel: string;
  exportCurrentStringOutput: () => void;
  exportStringHistory: () => void;
  hasStringOutputs: boolean;
  isStringTranslating: boolean;
  selectedStringTargetLangs: string[];
  setStringAutoFix: React.Dispatch<React.SetStateAction<boolean>>;
  setStringInput: React.Dispatch<React.SetStateAction<string>>;
  setStringOutputTarget: React.Dispatch<React.SetStateAction<string>>;
  stringAutoFix: boolean;
  stringError: string;
  stringErrorDetails: string;
  stringHistoryCount: number;
  stringInput: string;
  stringOutputTarget: string;
  stringOutputs: Record<string, string>;
  stringQualitySummary: string;
  translateStringResources: () => Promise<void>;
}

const StringResourcePanel: React.FC<StringResourcePanelProps> = ({
  isLight,
  ALL_STRING_TARGETS,
  STRING_TARGET_LANGS,
  clearStringHistoryData,
  clearStringResources,
  copyStringOutput,
  currentModelDisplayLabel,
  exportCurrentStringOutput,
  exportStringHistory,
  hasStringOutputs,
  isStringTranslating,
  selectedStringTargetLangs,
  setStringAutoFix,
  setStringInput,
  setStringOutputTarget,
  stringAutoFix,
  stringError,
  stringErrorDetails,
  stringHistoryCount,
  stringInput,
  stringOutputTarget,
  stringOutputs,
  stringQualitySummary,
  translateStringResources
}) => {
  const { t } = useI18n();
  const {
    sectionDividerClass,
    disabledButtonClass,
    neutralButtonClass,
    dangerButtonClass
  } = getUiClasses(isLight);

  return (
      <div className="space-y-3">
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted pr-3">
        {t('strings.desc')}
      </p>
    </div>
    <textarea
      className={'w-full bg-surface border border-line rounded-lg p-3 text-sm text-ink focus:ring-2 focus:ring-primary outline-none transition-all min-h-[140px] shadow-sm'}
      placeholder={t('strings.input.placeholder')}
      value={stringInput}
      onChange={(e) => setStringInput(e.target.value)}
      disabled={isStringTranslating}
    />
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted">{t('strings.outputLang')}</label>
      <select
        className={'bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink shadow-sm'}
        value={stringOutputTarget}
        onChange={(e) => setStringOutputTarget(e.target.value)}
        disabled={isStringTranslating}
      >
        <option value={ALL_STRING_TARGETS}>{t('strings.all', { count: STRING_TARGET_LANGS.length })}</option>
        {STRING_TARGET_LANGS.map((lang) => (
          <option key={lang} value={lang}>
            {t('strings.only', { lang: getTargetLanguageLabel(lang).split(' / ').pop() || lang })}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted">
        {t('strings.dateHint')}</p>
      <p className="text-[11px] text-muted">
        {t('strings.modelHint', { model: currentModelDisplayLabel })}
      </p>
    </div>
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={translateStringResources}
          disabled={!stringInput.trim() || isStringTranslating}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all shadow-lg ${
            !stringInput.trim() || isStringTranslating
              ? 'bg-strong text-muted cursor-not-allowed'
              : 'bg-primary hover:bg-primary-hover text-white shadow-primary/20 active:scale-95'
          }`}
        >
          {isStringTranslating
            ? t('strings.running')
            : stringOutputTarget === ALL_STRING_TARGETS
              ? t('strings.runAll', { count: STRING_TARGET_LANGS.length })
              : t('strings.runOne', { lang: stringOutputTarget })}
        </button>
        <button
          onClick={clearStringResources}
          disabled={isStringTranslating || (!stringInput.trim() && !hasStringOutputs)}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
            isStringTranslating || (!stringInput.trim() && !hasStringOutputs)
              ? disabledButtonClass
              : dangerButtonClass
          }`}
        >
          {t('strings.clearAll')}
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={stringAutoFix}
          onChange={(e) => setStringAutoFix(e.target.checked)}
          disabled={isStringTranslating}
          className="h-4 w-4 rounded border-line bg-surface text-primary-ink focus:ring-primary"
        />
        {t('strings.autoFix')}
      </label>
    </div>
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
      <span className="text-xs text-muted">
        {t('strings.history', { count: stringHistoryCount })}
      </span>
      <div className="flex gap-2">
        <button
          onClick={exportCurrentStringOutput}
          disabled={!hasStringOutputs || isStringTranslating}
          className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            !hasStringOutputs || isStringTranslating
              ? disabledButtonClass
              : 'bg-primary hover:bg-primary-hover text-white'
          }`}
        >
          {t('strings.exportCurrent')}
        </button>
        <button
          onClick={exportStringHistory}
          disabled={stringHistoryCount === 0 || isStringTranslating}
          className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            stringHistoryCount === 0 || isStringTranslating
              ? disabledButtonClass
              : neutralButtonClass
          }`}
        >
          {t('strings.exportHistory')}
        </button>
        <button
          onClick={clearStringHistoryData}
          disabled={stringHistoryCount === 0 || isStringTranslating}
          className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            stringHistoryCount === 0 || isStringTranslating
              ? disabledButtonClass
              : dangerButtonClass
          }`}
        >
          {t('strings.clearHistory')}
        </button>
      </div>
    </div>
    {stringQualitySummary && (
      <div className="text-xs text-warning bg-warning-soft border border-warning-border rounded-md px-3 py-2">
        {stringQualitySummary}
      </div>
    )}
    {stringError && (
      <div className="text-xs text-danger space-y-1">
        <p>{stringError}</p>
        {stringErrorDetails && (
          <p className="text-danger">{stringErrorDetails}</p>
        )}
      </div>
    )}
    {hasStringOutputs && (
      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t ${sectionDividerClass}`}>
        {selectedStringTargetLangs.map((lang) => (
          <div
            key={lang}
            className={'bg-sunken border border-line rounded-lg p-3'}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted uppercase">
                {lang}
              </span>
              <button
                onClick={() => copyStringOutput(lang)}
                className="text-[10px] text-muted hover:text-ink-soft"
                disabled={!stringOutputs[lang]}
              >
                {t('common.copy')}
              </button>
            </div>
            <textarea
              readOnly
              className={'w-full bg-surface border border-line rounded-md p-2 text-xs text-ink min-h-[120px] resize-vertical'}
              value={stringOutputs[lang] || ''}
            />
          </div>
        ))}
      </div>
    )}
      </div>
  );
};

export default StringResourcePanel;
