export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "vi";

/** Cookie name — short, no secret. */
export const LOCALE_COOKIE = "img-locale";

/** localStorage backup when cookie is blocked. */
export const LOCALE_STORAGE_KEY = "imgstudio.locale";

export function isLocale(value: unknown): value is Locale {
  return value === "vi" || value === "en";
}

export function localeToHtmlLang(locale: Locale): string {
  return locale === "en" ? "en" : "vi";
}

export function localeToBcp47(locale: Locale): string {
  return locale === "en" ? "en-US" : "vi-VN";
}
