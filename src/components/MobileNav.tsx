"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AccountMenuData } from "@/components/AccountMenu";
import LanguageSwitcher from "@/i18n/LanguageSwitcher";
import { formatVnd, useLocale, useT } from "@/i18n";

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<AccountMenuData | null>(null);
  const t = useT();
  const { locale } = useLocale();

  const primaryLinks = [
    { href: "/generate", label: t("nav.mobileGenerate"), icon: "spark" as const },
    { href: "/edit", label: t("nav.mobileEdit"), icon: "edit" as const },
    { href: "/video", label: t("nav.mobileVideo"), icon: "video" as const },
    { href: "/gallery", label: t("nav.mobileGallery"), icon: "gallery" as const },
  ];

  useEffect(() => {
    function fetchMe() {
      fetch("/api/me")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user) setMe(data);
        });
    }
    fetchMe();
    window.addEventListener("wallet-refresh", fetchMe);
    return () => window.removeEventListener("wallet-refresh", fetchMe);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const role = me?.user.role || "user";
  const name = me?.user.display_name || me?.user.email || me?.user.phone || t("nav.account");

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label={t("nav.mainMobile")}>
        <div className="mx-auto grid min-h-16 max-w-lg grid-cols-5">
          {primaryLinks.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${active ? "text-zinc-100" : "text-zinc-500"}`}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-blue-500" />}
                <NavIcon name={link.icon} />
                <span>{link.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            className="flex flex-col items-center justify-center gap-1 text-[10px] text-zinc-500 transition-colors hover:text-zinc-200 cursor-pointer"
          >
            <NavIcon name="more" />
            <span>{t("nav.more")}</span>
          </button>
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-[80] md:hidden">
          <button type="button" aria-label={t("nav.closeMenu")} onClick={() => setOpen(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default" />
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={t("nav.accountMenu")} className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-800 bg-zinc-900 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl shadow-black">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-700" />
            <div className="mb-3 flex items-start justify-between gap-4 border-b border-zinc-800 pb-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{name}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {role === "admin"
                    ? t("nav.adminFree")
                    : me
                      ? t("nav.walletSummary", {
                          balance: formatVnd(me.wallet.balance_vnd, locale),
                          images: me.wallet.remaining_images,
                          videos: me.wallet.remaining_videos,
                        })
                      : t("common.balanceLoading")}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("nav.closeMenu")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer">
                ×
              </button>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <span className="text-xs text-zinc-400">{t("lang.label")}</span>
              <LanguageSwitcher size="sm" />
            </div>
            <div className="space-y-1">
              <SheetLink href="/billing" label={t("nav.billing")} />
              {role === "admin" && (
                <>
                  <SheetLink href="/settings" label={t("nav.settings")} />
                  <SheetLink href="/admin" label={t("nav.admin")} />
                  <SheetLink href="/admin/logs" label={t("nav.adminLogs")} />
                </>
              )}
              <button type="button" onClick={handleLogout} className="w-full rounded-xl px-3 py-3 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10 cursor-pointer">
                {t("nav.logout")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SheetLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block rounded-xl px-3 py-3 text-sm text-zinc-200 transition-colors hover:bg-zinc-800">
      {label}
    </Link>
  );
}

function NavIcon({ name }: { name: "spark" | "edit" | "video" | "gallery" | "more" }) {
  const common = "h-5 w-5";
  if (name === "spark")
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Zm6 10 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13Z" />
      </svg>
    );
  if (name === "edit")
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.9 3.8a2.1 2.1 0 0 1 3 3L8.5 18.2 4 19.5l1.3-4.5L16.9 3.8Z" />
      </svg>
    );
  if (name === "video")
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="14" height="14" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m17 10 4-2v8l-4-2" />
      </svg>
    );
  if (name === "gallery")
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 15-5-5L5 21" />
      </svg>
    );
  return (
    <svg className={common} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}
