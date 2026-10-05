import React from 'react';
import { useEmbeddedVisualText } from './EmbeddedVisualsNotice';
import { hasEmbeddedVisuals, type EmbeddedVisualSummary } from '../../utils/embeddedVisuals';
import { useI18n } from '../../hooks/useI18n';
import { getUiClasses } from './uiClasses';

export interface ExportBarProps {
  isLight: boolean;
  embeddedVisuals?: EmbeddedVisualSummary | null;
  canDownload: boolean;
  documentKind: "pdf" | "excel" | "docx";
  docxBlockingIssueCount: number;
  handleDownload: () => Promise<void>;
  handleDownloadPdfDocx: () => void;
  translationStatus: "running" | "idle" | "paused" | "completed";
}

const ExportBar: React.FC<ExportBarProps> = ({
  isLight,
  embeddedVisuals,
  canDownload,
  documentKind,
  docxBlockingIssueCount,
  handleDownload,
  handleDownloadPdfDocx,
  translationStatus
}) => {
  const { t } = useI18n();
  const { describeParts } = useEmbeddedVisualText();
  const {
    mutedTextClass,
    disabledButtonClass,
    neutralButtonClass
  } = getUiClasses(isLight);

  return (
    <div className={`sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3 backdrop-blur ${
      isLight ? 'border-slate-200 bg-white/95 shadow-[0_16px_40px_rgba(15,23,42,0.12)]' : 'border-white/[0.1] bg-slate-900/90'
    }`}>
      <p className={`min-w-0 flex-1 text-sm ${
        docxBlockingIssueCount > 0 && translationStatus !== 'running'
          ? isLight ? 'text-rose-700' : 'text-rose-300'
          : mutedTextClass
      }`}>
        {translationStatus === 'running'
          ? t('export.wait')
          : docxBlockingIssueCount > 0
            ? t('export.risk', { count: docxBlockingIssueCount })
            : hasEmbeddedVisuals(embeddedVisuals)
              ? t('visuals.export', { parts: describeParts(embeddedVisuals!) })
              : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {documentKind === 'pdf' && (
          <button
            type="button"
            onClick={handleDownloadPdfDocx}
            disabled={!canDownload}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
              !canDownload ? disabledButtonClass : neutralButtonClass
            }`}
          >
            {t('export.reviewDocx')}
          </button>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={!canDownload}
          className={`rounded-xl px-6 py-2.5 text-sm font-semibold transition-all ${
            !canDownload
              ? disabledButtonClass
              : 'bg-emerald-600 text-white shadow-[0_10px_24px_rgba(5,150,105,0.22)] hover:bg-emerald-500'
          }`}
        >
          {documentKind === 'pdf' ? t('export.pdf') : t('export.doc')}
        </button>
      </div>
    </div>
  );
};

export default ExportBar;
