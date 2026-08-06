"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "es" | "en" | "de" | "pt";
export type Messages = Record<string, Record<Locale, string>>;

const supportedLocales: Locale[] = ["es", "en", "de", "pt"];
const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({ locale: "es", setLocale: () => undefined });

const isLocale = (value: string | null): value is Locale =>
  supportedLocales.includes(value as Locale);

export function LocaleProvider({ children, initialLocale = "es" }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const saved = window.localStorage.getItem("olvm-locale");
    if (isLocale(saved)) setLocaleState(saved);
  }, []);

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem("olvm-locale", nextLocale);
    } catch {
      // The cookie still preserves the choice when browser storage is unavailable.
    }
    document.cookie = `olvm_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useTranslations(messages: Messages) {
  const { locale } = useLocale();
  return (key: string, values?: Record<string, string | number>) => {
    let text = messages[key]?.[locale] ?? messages[key]?.es ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  };
}
