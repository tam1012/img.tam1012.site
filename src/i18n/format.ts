import { localeToBcp47, type Locale } from "./locales";

/** Format VND for display. Always VND; only grouping/suffix change by locale. */
export function formatVnd(value: number, locale: Locale = "vi"): string {
  const formatted = new Intl.NumberFormat(localeToBcp47(locale)).format(value);
  return locale === "en" ? `${formatted} VND` : `${formatted}đ`;
}

export function formatDateTime(dateStr: string, locale: Locale = "vi"): string {
  return new Date(dateStr).toLocaleString(localeToBcp47(locale), { hour12: false });
}

export function formatDateShort(dateStr: string, locale: Locale = "vi"): string {
  return new Date(dateStr).toLocaleDateString(localeToBcp47(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
