// Shared surface and control styles. Colors come from the theme tokens (index.css), which switch
// between light and dark on their own, so one class string serves both themes.
export const getUiClasses = (_isLight?: boolean) => {
  const pageClass = 'min-h-screen flex flex-col page-bg text-ink';
  const panelClass =
    'panel-surface border rounded-2xl p-6 shadow-[var(--shadow-panel)]';
  const detailsCardClass =
    'panel-surface border rounded-2xl shadow-[var(--shadow-panel)]';
  const sectionDividerClass = 'border-line';
  const headingMutedClass = 'text-muted';
  const mutedTextClass = 'text-muted';
  const fieldClass =
    'w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-ink focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all cursor-pointer shadow-sm';
  const textareaClass =
    'w-full min-h-[86px] bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all shadow-sm';
  const disabledButtonClass = 'bg-subtle text-muted border border-line cursor-not-allowed';
  const neutralButtonClass = 'bg-surface hover:bg-subtle text-ink-soft border border-line shadow-sm';
  const primaryInlineButtonClass = 'bg-primary hover:bg-primary-hover text-white border border-primary shadow-sm';
  const dangerButtonClass = 'bg-surface hover:bg-danger-soft text-danger border border-danger-border';
  const metricCardClass = 'bg-sunken rounded-xl p-3 border border-line shadow-[var(--shadow-card)]';
  const subCardClass = 'rounded-xl border border-line bg-surface p-3 shadow-sm';
  const nestedPanelClass = 'rounded-xl border border-line bg-sunken p-3';
  return {
    pageClass,
    panelClass,
    detailsCardClass,
    sectionDividerClass,
    headingMutedClass,
    mutedTextClass,
    fieldClass,
    textareaClass,
    disabledButtonClass,
    neutralButtonClass,
    primaryInlineButtonClass,
    dangerButtonClass,
    metricCardClass,
    subCardClass,
    nestedPanelClass
  };
};
