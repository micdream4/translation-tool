export const getUiClasses = (isLight: boolean) => {
  const pageClass = isLight
    ? 'min-h-screen flex flex-col bg-[radial-gradient(circle_at_84%_4%,rgba(99,102,241,0.12)_0,rgba(99,102,241,0.04)_28%,transparent_58%),linear-gradient(180deg,#f8fafc_0%,#f5f7fb_46%,#eef2f7_100%)] text-slate-900'
    : 'min-h-screen flex flex-col bg-[radial-gradient(circle_at_82%_0%,rgba(79,70,229,0.20)_0,rgba(15,23,42,0.18)_32%,transparent_62%),linear-gradient(180deg,#020617_0%,#070b16_48%,#0b1120_100%)] text-slate-200';
  const panelClass = isLight
    ? 'bg-white/92 border border-white/80 rounded-2xl p-6 shadow-[0_20px_54px_rgba(15,23,42,0.09)] ring-1 ring-slate-900/[0.035]'
    : 'bg-slate-900/82 border border-white/[0.07] rounded-2xl p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)] ring-1 ring-white/[0.03]';
  const detailsCardClass = isLight
    ? 'bg-white/92 border border-white/80 rounded-2xl shadow-[0_16px_42px_rgba(15,23,42,0.075)] ring-1 ring-slate-900/[0.035]'
    : 'bg-slate-900/82 border border-white/[0.07] rounded-2xl shadow-[0_20px_58px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.03]';
  const sectionDividerClass = isLight ? 'border-slate-200/80' : 'border-white/[0.07]';
  const headingMutedClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const mutedTextClass = isLight ? 'text-slate-500' : 'text-slate-500';
  const fieldClass = isLight
    ? 'w-full bg-white/90 border border-slate-200/80 rounded-xl px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 outline-none transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] [color-scheme:light]'
    : 'w-full bg-slate-950/70 border border-white/[0.16] rounded-xl px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500/35 focus:border-indigo-400/60 outline-none transition-all cursor-pointer [color-scheme:dark]';
  const textareaClass = isLight
    ? 'w-full min-h-[86px] bg-white/90 border border-slate-200/80 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 outline-none transition-all shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
    : 'w-full min-h-[86px] bg-white/[0.055] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400/40 outline-none transition-all';
  const disabledButtonClass = isLight
    ? 'bg-slate-100/90 text-slate-400 border border-slate-200/80 cursor-not-allowed'
    : 'bg-white/[0.06] text-slate-500 border border-white/[0.06] cursor-not-allowed';
  const neutralButtonClass = isLight
    ? 'bg-white/90 hover:bg-slate-50 text-slate-700 border border-slate-200/80 shadow-sm'
    : 'bg-white/[0.06] hover:bg-white/[0.09] text-slate-200 border border-white/[0.07]';
  const primaryInlineButtonClass = isLight
    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white border border-indigo-400/40 shadow-[0_12px_26px_rgba(79,70,229,0.20)]'
    : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white border border-indigo-400/25 shadow-[0_12px_26px_rgba(79,70,229,0.22)]';
  const metricCardClass = isLight
    ? 'bg-gradient-to-br from-white to-slate-50/90 rounded-xl p-3 border border-slate-200/75 shadow-[0_8px_22px_rgba(15,23,42,0.045)]'
    : 'bg-white/[0.035] rounded-xl p-3 border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]';
  const subCardClass = isLight
    ? 'rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm'
    : 'rounded-xl border border-white/[0.07] bg-white/[0.035] p-3';
  const nestedPanelClass = isLight
    ? 'rounded-xl border border-slate-200/80 bg-slate-50/80 p-3'
    : 'rounded-xl border border-white/[0.07] bg-slate-950/35 p-3';
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
    metricCardClass,
    subCardClass,
    nestedPanelClass
  };
};
