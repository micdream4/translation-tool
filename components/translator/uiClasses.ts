// Shared surface and control styles. Colors, type sizes and radii come from the theme tokens
// (index.css, tailwind.config.js), which switch between light and dark on their own.
// Controls are 36px high (small: 32px), radius 10; panels radius 16, padding 20 (24 from sm).
export const getUiClasses = (_isLight?: boolean) => {
  const pageClass = 'min-h-screen flex flex-col page-bg text-ink';
  const panelClass =
    'panel-surface border rounded-panel p-5 sm:p-6 shadow-[var(--shadow-panel)]';
  const detailsCardClass =
    'panel-surface border rounded-panel shadow-[var(--shadow-panel)]';
  const sectionDividerClass = 'border-line';
  const headingMutedClass = 'text-muted';
  const mutedTextClass = 'text-muted';
  const fieldClass =
    'w-full h-9 bg-surface border border-line rounded-control px-3 text-body text-ink focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none transition-colors cursor-pointer';
  const textareaClass =
    'w-full min-h-[88px] bg-surface border border-line rounded-control px-3 py-2 text-body text-ink focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none transition-colors';
  const disabledButtonClass = 'bg-subtle text-muted border border-line cursor-not-allowed';
  const neutralButtonClass = 'glass-control text-ink-soft border border-line';
  const primaryInlineButtonClass = 'bg-primary hover:bg-primary-hover text-on-primary border border-primary';
  const dangerButtonClass = 'bg-transparent hover:bg-danger-soft text-danger border border-danger-border';
  const metricCardClass = 'bg-sunken/60 rounded-control p-3 border border-line';
  const subCardClass = 'rounded-control border border-line bg-surface/70 p-3';
  const nestedPanelClass = 'rounded-control border border-line bg-sunken/60 p-4';
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
