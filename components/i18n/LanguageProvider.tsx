"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_KEY,
  LOCALE_HTML_LANG,
  LOCALE_STORAGE_KEY,
  type Locale,
  type TranslationKey,
  type Translations,
  type TranslationValues,
  isLocale,
  parseLocale,
  translate,
  translations,
} from "@/lib/i18n";

export type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  dict: Translations;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readLocaleCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${LOCALE_COOKIE_KEY}=`;
  const item = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be disabled; the cookie remains a best-effort fallback.
  }

  document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function browserLocale(): Locale | null {
  if (typeof navigator === "undefined") return null;
  for (const language of navigator.languages ?? [navigator.language]) {
    const parsed = parseLocale(language, DEFAULT_LOCALE);
    const normalized = language.trim().replaceAll("_", "-").toLowerCase();
    if (
      normalized === "en" || normalized.startsWith("en-") ||
      normalized === "ms" || normalized === "bm" || normalized.startsWith("ms-") ||
      normalized === "zh" || normalized === "cmn" || normalized.startsWith("zh-") || normalized.startsWith("cmn-") ||
      normalized === "yue" || normalized.startsWith("yue-") ||
      normalized === "ta" || normalized.startsWith("ta-")
    ) {
      return parsed;
    }
  }
  return null;
}

export type LanguageProviderProps = {
  children: ReactNode;
  initialLocale?: Locale | string | null;
};

export function LanguageProvider({ children, initialLocale }: LanguageProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => parseLocale(initialLocale));

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // Fall through to the cookie, initial value, or browser preference.
    }

    const next = stored
      ? parseLocale(stored)
      : readLocaleCookie()
        ? parseLocale(readLocaleCookie())
        : initialLocale
          ? parseLocale(initialLocale)
          : browserLocale() ?? DEFAULT_LOCALE;

    setLocaleState(next);
  }, [initialLocale]);

  useEffect(() => {
    document.documentElement.lang = LOCALE_HTML_LANG[locale];
    persistLocale(locale);
  }, [locale]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY || !event.newValue) return;
      const next = parseLocale(event.newValue);
      setLocaleState((current) => (current === next ? current : next));
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      dict: translations[locale],
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
