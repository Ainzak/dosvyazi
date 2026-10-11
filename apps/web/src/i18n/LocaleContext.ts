import { createContext, useContext } from 'react';
import type { Locale } from './messages';
import { translate } from './messages';

export const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);
export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('Language provider is missing.');
  return { ...context, t: (text: string | null | undefined, values?: Record<string, string | number>) => translate(context.locale, text ?? '', values) };
}
