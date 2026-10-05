import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  UI_LANG_STORAGE_KEY,
  detectInitialUiLang,
  formatUiString,
  type UiLang
} from '../utils/i18n';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type I18nContextValue = {
  lang: UiLang;
  setLang: (lang: UiLang) => void;
  t: TranslateFn;
};

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => undefined,
  t: (key, params) => formatUiString('zh', key, params)
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<UiLang>(detectInitialUiLang);

  const setLang = useCallback((next: UiLang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(UI_LANG_STORAGE_KEY, next);
    } catch {
      // Remembering the language is a convenience only.
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t: (key, params) => formatUiString(lang, key, params) }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
