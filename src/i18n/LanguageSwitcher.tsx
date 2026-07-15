"use client";

import { useLocale, useT } from "@/i18n";
import type { Locale } from "@/i18n";

type Size = "sm" | "md";

export default function LanguageSwitcher({ size = "md" }: { size?: Size }) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  const base =
    size === "sm"
      ? "min-h-9 min-w-10 px-2.5 text-xs"
      : "min-h-10 min-w-11 px-3 text-sm";

  function choose(next: Locale) {
    if (next !== locale) setLocale(next);
  }

  return (
    <div
      role="group"
      aria-label={t("lang.label")}
      className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5"
    >
      <button
        type="button"
        onClick={() => choose("vi")}
        aria-pressed={locale === "vi"}
        aria-label={t("lang.switchToVi")}
        className={`${base} rounded-md font-medium transition-colors cursor-pointer ${
          locale === "vi"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
        }`}
      >
        {t("lang.vi")}
      </button>
      <button
        type="button"
        onClick={() => choose("en")}
        aria-pressed={locale === "en"}
        aria-label={t("lang.switchToEn")}
        className={`${base} rounded-md font-medium transition-colors cursor-pointer ${
          locale === "en"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
        }`}
      >
        {t("lang.en")}
      </button>
    </div>
  );
}
