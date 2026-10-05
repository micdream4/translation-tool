
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../hooks/useI18n';

type ThemeMode = 'light' | 'dark';

interface HeaderProps {
  theme: ThemeMode;
  onThemeToggle: () => void;
  activeView?: 'translator' | 'modelReview';
  onNavigate?: (view: 'translator' | 'modelReview') => void;
  version?: string;
  authStatus?: 'checking' | 'authenticated' | 'anonymous' | 'blocked';
  userEmail?: string;
}

const Header: React.FC<HeaderProps> = ({
  theme,
  onThemeToggle,
  activeView = 'translator',
  onNavigate,
  version,
  authStatus = 'anonymous',
  userEmail
}) => {
  const { lang, setLang, t } = useI18n();
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';
  const authLabel =
    authStatus === 'checking'
      ? t('header.auth.loading')
      : authStatus === 'blocked'
        ? t('header.auth.blocked')
        : authStatus === 'authenticated'
          ? userEmail || t('header.auth.authenticated')
          : t('header.auth.anonymous');

  useEffect(() => {
    if (!isGuideOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!guideRef.current?.contains(event.target as Node)) {
        setIsGuideOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsGuideOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGuideOpen]);

  return (
    <header className={`sticky top-0 z-50 border-b backdrop-blur-md ${
      isLight
        ? 'border-slate-200/80 bg-white/90 shadow-[0_10px_34px_rgba(15,23,42,0.08)]'
        : 'border-slate-800 bg-slate-950/85 shadow-[0_10px_34px_rgba(0,0,0,0.22)]'
    }`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute inset-0 ${
          isLight
            ? 'bg-[radial-gradient(circle_at_88%_-45%,rgba(99,102,241,0.22)_0,rgba(99,102,241,0.10)_30%,transparent_58%),linear-gradient(135deg,rgba(255,255,255,0)_0%,rgba(248,250,252,0.65)_52%,rgba(238,242,255,0.92)_100%)]'
            : 'bg-[radial-gradient(circle_at_88%_-40%,rgba(79,70,229,0.38)_0,rgba(37,99,235,0.14)_34%,transparent_62%),linear-gradient(135deg,rgba(2,6,23,0.96)_0%,rgba(15,23,42,0.92)_56%,rgba(30,41,59,0.86)_100%)]'
        }`}></div>
        <div className={`absolute -right-24 -top-20 h-44 w-[560px] rotate-[-18deg] border-l ${
          isLight
            ? 'border-indigo-100/90 bg-gradient-to-r from-transparent via-indigo-50/80 to-blue-100/70'
            : 'border-indigo-400/10 bg-gradient-to-r from-transparent via-indigo-500/10 to-cyan-400/10'
        }`}></div>
        <div className={`absolute right-24 top-0 h-24 w-px rotate-[46deg] ${
          isLight ? 'bg-indigo-100/90' : 'bg-indigo-300/10'
        }`}></div>
      </div>
      <div className="relative z-10 max-w-7xl mx-auto px-4 min-h-[72px] py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_12px_30px_rgba(79,70,229,0.25)] ring-1 ring-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M4 19.5V5a2 2 0 0 1 2-2h9l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5z"/><path d="M14 3v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/><path d="M8 9h2"/></svg>
          </div>
          <div className="flex flex-col justify-center leading-none">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-base sm:text-xl font-bold whitespace-nowrap ${
                isLight
                  ? 'text-slate-950'
                  : 'bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-blue-400'
              }`}>
                {t('header.title')}
              </h1>
              {version && (
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 ${
                  isLight
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200'
                }`}>
                  v{version}
                </span>
              )}
            </div>
            <p className={`mt-1.5 hidden sm:block text-xs font-medium tracking-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{t('header.tagline')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className={`flex items-center gap-1 rounded-full border p-1 ${
            isLight ? 'border-slate-200 bg-white/75 shadow-sm' : 'border-white/[0.08] bg-white/[0.05]'
          }`}>
            <button
              type="button"
              onClick={() => onNavigate?.('translator')}
              className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition-all ${
                activeView === 'translator'
                  ? isLight
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-950'
                  : isLight
                    ? 'text-slate-600 hover:text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <span className="hidden sm:inline">{t('header.nav.translator')}</span>
              <span className="sm:hidden">{t('header.nav.translatorShort')}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('modelReview')}
              className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition-all ${
                activeView === 'modelReview'
                  ? isLight
                    ? 'bg-indigo-600 text-white'
                    : 'bg-indigo-400 text-slate-950'
                  : isLight
                    ? 'text-slate-600 hover:text-indigo-700'
                    : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <span className="hidden sm:inline">{t('header.nav.review')}</span>
              <span className="sm:hidden">{t('header.nav.reviewShort')}</span>
            </button>
          </div>
          <div
            className={`hidden lg:inline-flex max-w-[220px] items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              authStatus === 'blocked'
                ? isLight
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-rose-400/25 bg-rose-500/10 text-rose-200'
                : isLight
                  ? 'border-slate-200 bg-white/75 text-slate-600'
                  : 'border-white/[0.08] bg-white/[0.05] text-slate-300'
            }`}
            title={userEmail || authLabel}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                authStatus === 'authenticated'
                  ? 'bg-emerald-500'
                  : authStatus === 'blocked'
                    ? 'bg-rose-500'
                    : authStatus === 'checking'
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
              }`}
            ></span>
            <span className="truncate">{authLabel}</span>
          </div>
          <div className="relative" ref={guideRef}>
            <button
              type="button"
              onClick={() => setIsGuideOpen((open) => !open)}
              className={`cursor-pointer list-none inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                isLight
                  ? 'bg-white/80 text-slate-700 border-white/80 shadow-sm hover:border-indigo-300 hover:text-indigo-700'
                  : 'bg-white/[0.06] text-slate-300 border-white/[0.08] hover:border-indigo-500/40 hover:text-slate-100'
              }`}
            >
              {t('header.guide')}
            </button>
            {isGuideOpen && (
            <div className={`absolute right-0 mt-3 w-[min(460px,calc(100vw-2rem))] max-h-[calc(100vh-96px)] overflow-y-auto overscroll-contain rounded-xl border p-4 shadow-2xl ${
              isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-700 bg-slate-950 text-slate-400'
            }`}>
              <div className={`space-y-4 text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                {([
                  ['basic', 6],
                  ['run', 3],
                  ['qc', 3],
                  ['sample', 2]
                ] as const).map(([section, count]) => (
                  <section key={section}>
                    <h3 className={`mb-2 text-[11px] font-semibold tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-300'}`}>{t(`guide.${section}.title`)}</h3>
                    <ol className="space-y-2 list-decimal list-inside">
                      {Array.from({ length: count }, (_, index) => (
                        <li key={index}>{t(`guide.${section}.${index + 1}`)}</li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            </div>
            )}
          </div>
          <button
            type="button"
            onClick={onThemeToggle}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              isLight
                ? 'border-indigo-200/80 bg-indigo-50/90 text-indigo-700 hover:bg-indigo-100'
                : 'border-white/[0.08] bg-white/[0.06] text-slate-300 hover:border-indigo-500/40 hover:text-slate-100'
            }`}
            aria-label={t('header.theme')}
          >
            <span className={`h-2 w-2 rounded-full ${isLight ? 'bg-indigo-500' : 'bg-slate-400'}`}></span>
            {isLight ? t('common.light') : t('common.dark')}
          </button>
          <div
            className={`inline-flex items-center rounded-full border p-0.5 text-xs font-semibold ${
              isLight ? 'border-slate-200 bg-white/75' : 'border-white/[0.08] bg-white/[0.05]'
            }`}
            role="group"
            aria-label={t('header.language')}
          >
            {(['zh', 'en'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLang(option)}
                aria-pressed={lang === option}
                className={`rounded-full px-2.5 py-1 transition-all ${
                  lang === option
                    ? isLight
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-950'
                    : isLight
                      ? 'text-slate-600 hover:text-slate-950'
                      : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {option === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
