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
  /** Findings confirmed as correct but not yet reviewed into the rule set. */
  pendingAcceptedCount?: number;
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
  pendingAcceptedCount = 0,
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
    <div className={`static z-30 flex flex-wrap items-center justify-end gap-3 rounded-panel border px-4 py-3 sm:sticky sm:bottom-4 sm:px-4 backdrop-blur ${
      'border-line bg-surface/95 shadow-[var(--shadow-panel)]'
    }`}>
      <p className={`min-w-0 flex-1 text-body empty:hidden ${
        docxBlockingIssueCount > 0 && translationStatus !== 'running'
          ? 'text-danger'
          : mutedTextClass
      }`}>
        {translationStatus === 'running'
          ? t('export.wait')
          : !canDownload
            ? t('export.notTranslated')
            : docxBlockingIssueCount > 0
            ? t('export.risk', { count: docxBlockingIssueCount })
            : hasEmbeddedVisuals(embeddedVisuals)
              ? t('visuals.export', { parts: describeParts(embeddedVisuals!) })
              : ''}
        {translationStatus !== 'running' && canDownload && pendingAcceptedCount > 0 && (
          <span className="block">{t('export.acceptedPending', { count: pendingAcceptedCount })}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {documentKind === 'pdf' && (
          <button
            type="button"
            onClick={handleDownloadPdfDocx}
            disabled={!canDownload}
            className={`inline-flex items-center justify-center rounded-control px-4 h-9 text-body font-semibold transition-all ${
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
          className={`inline-flex items-center justify-center rounded-control px-6 h-9 text-body font-semibold transition-all ${
            !canDownload
              ? disabledButtonClass
              : 'bg-primary text-on-primary shadow-sm hover:bg-primary-hover'
          }`}
        >
          {documentKind === 'pdf' ? t('export.pdf') : t('export.doc')}
        </button>
      </div>
    </div>
  );
};

export default ExportBar;
