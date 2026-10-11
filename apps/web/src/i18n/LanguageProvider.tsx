import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { LocaleContext, useI18n } from './LocaleContext';
import type { Locale } from './messages';

const storageKey = 'dosvyazi.language';
function storedLocale(): Locale {
  try { return localStorage.getItem(storageKey) === 'ru' ? 'ru' : 'en'; }
  catch { return 'en'; }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(storedLocale);
  const setLocale = (next: Locale) => {
    updateLocale(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Session-only choice when storage is disabled. */ }
  };
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === storageKey) updateLocale(event.newValue === 'ru' ? 'ru' : 'en'); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return <div className="language-switcher" role="group" aria-label={t('Interface language')}>
    <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
    <button type="button" lang="ru" aria-pressed={locale === 'ru'} onClick={() => setLocale('ru')}>Русский</button>
  </div>;
}
