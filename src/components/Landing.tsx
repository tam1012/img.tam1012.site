"use client";

import Link from "next/link";
import LanguageSwitcher from "@/i18n/LanguageSwitcher";
import { ADMIN_CONTACT } from "@/lib/site-settings";
import { formatVnd, useLocale, useT } from "@/i18n";

interface LandingProps {
  imagePriceVnd: number;
  signupImages: number;
}

export default function Landing({ imagePriceVnd, signupImages }: LandingProps) {
  const t = useT();
  const { locale } = useLocale();

  const features = [
    { title: t("landing.feature1Title"), desc: t("landing.feature1Desc") },
    { title: t("landing.feature2Title"), desc: t("landing.feature2Desc") },
    { title: t("landing.feature3Title"), desc: t("landing.feature3Desc") },
    { title: t("landing.feature4Title"), desc: t("landing.feature4Desc") },
    { title: t("landing.feature5Title"), desc: t("landing.feature5Desc") },
    { title: t("landing.feature6Title"), desc: t("landing.feature6Desc") },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-4 px-4 py-2">
          <span className="text-lg font-semibold tracking-tight text-zinc-100">IMG Studio</span>
          <div className="flex items-center gap-2">
            <LanguageSwitcher size="sm" />
            <Link
              href="/login"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              {t("landing.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
          <span className="inline-block rounded-full border border-blue-900/50 bg-blue-950/30 px-3 py-1 text-xs font-medium text-blue-200">
            {t("landing.badge", { count: signupImages })}
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
            {t("landing.heroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            {t("landing.heroSubtitle")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login?tab=register"
              className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 sm:w-auto"
            >
              {t("landing.ctaPrimary")}
            </Link>
            <Link
              href="/login"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 sm:w-auto"
            >
              {t("landing.ctaSecondary")}
            </Link>
          </div>
          <p className="mt-4 text-xs text-zinc-600">{t("landing.ctaHint", { count: signupImages })}</p>
        </section>

        <section className="border-t border-zinc-900 bg-zinc-950/40">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <h2 className="text-center text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
              {t("landing.featuresTitle")}
            </h2>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6"
                >
                  <h3 className="text-base font-medium text-zinc-100">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-900">
          <div className="mx-auto max-w-3xl px-4 py-16">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
                {t("landing.pricingTitle")}
              </h2>
              <p className="mt-4">
                <span className="text-4xl font-semibold text-zinc-50">{formatVnd(imagePriceVnd, locale)}</span>
                <span className="ml-2 text-sm text-zinc-500">{t("landing.pricingUnit")}</span>
              </p>
              <ul className="mx-auto mt-6 max-w-md space-y-3 text-left">
                {[
                  t("landing.pricingPoint1"),
                  t("landing.pricingPoint2"),
                  t("landing.pricingPoint3", { count: signupImages }),
                ].map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-zinc-400">
                    <span className="mt-0.5 shrink-0 text-blue-400">✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-900 bg-zinc-950/40">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {t("landing.finalCtaTitle")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
              {t("landing.finalCtaSubtitle", { count: signupImages })}
            </p>
            <Link
              href="/login?tab=register"
              className="mt-8 inline-block rounded-xl bg-blue-600 px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              {t("landing.finalCtaButton")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-4 text-center text-xs text-zinc-500">
          <Link
            href="/terms"
            className="text-zinc-400 underline-offset-2 hover:text-zinc-100 hover:underline"
          >
            {t("common.termsOfService")}
          </Link>
          <span className="text-zinc-700">·</span>
          <span>
            {t("common.contactAdmin")}{" "}
            <a
              href={ADMIN_CONTACT.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 underline-offset-2 hover:text-zinc-100 hover:underline"
            >
              @{ADMIN_CONTACT.telegramHandle}
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
