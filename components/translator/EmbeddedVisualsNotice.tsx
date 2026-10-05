import React from 'react';
import { useI18n } from '../../hooks/useI18n';
import { hasEmbeddedVisuals, type EmbeddedVisualSummary } from '../../utils/embeddedVisuals';

const MAX_AREAS_SHOWN = 6;

export const useEmbeddedVisualText = () => {
  const { t } = useI18n();
  const describeParts = (summary: EmbeddedVisualSummary) =>
    [
      summary.images ? t('visuals.part.images', { count: summary.images }) : '',
      summary.charts ? t('visuals.part.charts', { count: summary.charts }) : '',
      summary.shapes ? t('visuals.part.shapes', { count: summary.shapes }) : ''
    ]
      .filter(Boolean)
      .join(t('visuals.separator'));

  const describeAreas = (summary: EmbeddedVisualSummary) => {
    const labels = summary.areas.map((area) => {
      const count = area.images + area.charts + area.shapes;
      const name =
        area.kind === 'docx'
          ? t(`visuals.area.${area.area}`)
          : area.kind === 'page'
            ? t('visuals.page', { n: area.area })
            : area.kind === 'cell'
              ? t('visuals.area.cell')
              : area.area;
      return `${name} ${count}`;
    });
    const shown = labels.slice(0, MAX_AREAS_SHOWN).join(t('visuals.separator'));
    return labels.length > MAX_AREAS_SHOWN
      ? `${shown}${t('visuals.more', { count: labels.length - MAX_AREAS_SHOWN })}`
      : shown;
  };
  return { describeParts, describeAreas };
};

interface EmbeddedVisualsNoticeProps {
  isLight: boolean;
  summary?: EmbeddedVisualSummary | null;
}

const EmbeddedVisualsNotice: React.FC<EmbeddedVisualsNoticeProps> = ({ isLight, summary }) => {
  const { t } = useI18n();
  const { describeParts, describeAreas } = useEmbeddedVisualText();
  if (!summary || !hasEmbeddedVisuals(summary)) return null;

  return (
    <div
      role="note"
      className={`rounded-xl border px-4 py-3 text-sm ${
        isLight ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
      }`}
    >
      <p className="font-semibold">{t('visuals.title')}</p>
      <p className="mt-1">{t('visuals.summary', { parts: describeParts(summary) })}</p>
      <p className={`mt-1 text-xs ${isLight ? 'text-amber-800' : 'text-amber-200/90'}`}>
        {t('visuals.where', { areas: describeAreas(summary) })}
      </p>
      <p className={`mt-1 text-xs ${isLight ? 'text-amber-800' : 'text-amber-200/90'}`}>{t('visuals.advice')}</p>
    </div>
  );
};

export default EmbeddedVisualsNotice;
