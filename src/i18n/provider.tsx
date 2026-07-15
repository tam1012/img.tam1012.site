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
  isLocale,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  localeToHtmlLang,
  type Locale,
} from "./locales";
import en from "./messages/en";
import vi from "./messages/vi";
import type { Messages } from "./messages/vi";

const catalogs: Record<Locale, Messages> = { vi, en };

type MessageParams = Record<string, string | number>;

type NestedKeyOf<T, Prefix extends string = ""> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? `${Prefix}${K}`
        : NestedKeyOf<T[K], `${Prefix}${K}.`>;
    }[keyof T & string];

export type MessageKey = NestedKeyOf<Messages>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  messages: Messages;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof document !== "undefined") {
    const cookieMatch = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
    if (cookieMatch) {
      const value = decodeURIComponent(cookieMatch.slice(LOCALE_COOKIE.length + 1));
      if (isLocale(value)) return value;
    }
  }
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored)) return stored;
    } catch {
      // ignore
    }
    const nav = window.navigator?.language?.toLowerCase() || "";
    if (nav.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

function persistLocale(locale: Locale) {
  if (typeof document !== "undefined") {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; samesite=lax`;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }
}

function getMessage(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? `{${name}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = readStoredLocale();
    setLocaleState(initial);
    persistLocale(initial);
    document.documentElement.lang = localeToHtmlLang(initial);
    setReady(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = localeToHtmlLang(next);
    }
  }, []);

  const messages = catalogs[locale] || catalogs.vi;

  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => {
      const raw = getMessage(messages, key) ?? getMessage(catalogs.vi, key) ?? key;
      return interpolate(raw, params);
    },
    [messages]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, messages }),
    [locale, setLocale, t, messages]
  );

  // Avoid a flash of wrong language after hydration by waiting for stored locale.
  // Still render children with default vi on first paint (SSR / first client render).
  void ready;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}

export function useLocale() {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
