
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

  const initials = (userEmail || '').split('@')[0].slice(0, 2).toUpperCase() || '·';
  const statusDot =
    authStatus === 'authenticated'
      ? 'bg-emerald-500'
      : authStatus === 'blocked'
        ? 'bg-rose-500'
        : authStatus === 'checking'
          ? 'bg-amber-400'
          : 'bg-slate-400';
  const iconButtonClass = `inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
    isLight
      ? 'border-slate-200 bg-white/80 text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
      : 'border-white/[0.08] bg-white/[0.05] text-slate-300 hover:border-indigo-400/40 hover:text-slate-100'
  }`;
  const navItems = [
    { view: 'translator' as const, label: t('header.nav.translator') },
    { view: 'modelReview' as const, label: t('header.nav.review') }
  ];

  return (
    <header className={`sticky top-0 z-50 border-b backdrop-blur-md ${
      isLight
        ? 'border-slate-200/80 bg-white/90 shadow-[0_10px_34px_rgba(15,23,42,0.08)]'
        : 'border-slate-800 bg-slate-950/85 shadow-[0_10px_34px_rgba(0,0,0,0.22)]'
    }`}>
      <div className="relative z-10 mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:min-h-[64px]">
        <div className="order-1 flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6M9 17h4" />
            </svg>
          </div>
          <h1 className={`truncate text-base font-bold sm:text-lg ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>
            {t('header.title')}
          </h1>
          {version && (
            <span className={`hidden rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 sm:inline ${
              isLight ? 'border-slate-200 text-slate-500' : 'border-white/[0.1] text-slate-400'
            }`}>
              v{version}
            </span>
          )}
        </div>

        <nav
          className="order-3 -mb-px flex w-full gap-1 overflow-x-auto sm:order-2 sm:w-auto"
          aria-label={t('header.nav.label')}
        >
          {navItems.map((item) => {
            const active = activeView === item.view;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => onNavigate?.(item.view)}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
                  active
                    ? isLight
                      ? 'border-indigo-600 font-semibold text-slate-950'
                      : 'border-indigo-400 font-semibold text-white'
                    : `border-transparent ${isLight ? 'text-slate-500 hover:text-slate-900' : 'text-slate-400 hover:text-slate-100'}`
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
          <div className="relative" ref={guideRef}>
            <button
              type="button"
              onClick={() => setIsGuideOpen((open) => !open)}
              aria-label={t('header.guide')}
              aria-expanded={isGuideOpen}
              title={t('header.guide')}
              className={iconButtonClass}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
                <path d="M12 17h.01" />
              </svg>
            </button>
            {isGuideOpen && (
            <div className={`fixed inset-x-4 top-full mt-2 max-h-[calc(100vh-96px)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:w-[460px] overflow-y-auto overscroll-contain rounded-xl border p-4 shadow-2xl ${
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

          <div
            className={`inline-flex items-center rounded-lg border p-0.5 text-xs font-semibold ${
              isLight ? 'border-slate-200 bg-white/80' : 'border-white/[0.08] bg-white/[0.05]'
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
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
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

          <button
            type="button"
            onClick={onThemeToggle}
            aria-label={t('header.theme')}
            title={isLight ? t('header.theme.toDark') : t('header.theme.toLight')}
            className={iconButtonClass}
          >
            {isLight ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>

          <div
            className={`relative grid h-9 w-9 place-items-center rounded-full text-xs font-semibold ${
              authStatus === 'blocked'
                ? isLight
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-rose-500/15 text-rose-200'
                : isLight
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'bg-indigo-400/15 text-indigo-200'
            }`}
            title={authLabel}
            aria-label={`${t('header.account')}: ${authLabel}`}
            role="img"
          >
            {initials}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 ${statusDot} ${
                isLight ? 'border-white' : 'border-slate-950'
              }`}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
