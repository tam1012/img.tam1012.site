"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatVnd, useLocale, useT } from "@/i18n";

export interface AccountMenuData {
  user: {
    display_name: string | null;
    email: string | null;
    phone: string | null;
    role: "admin" | "user";
  };
  wallet: {
    balance_vnd: number;
    remaining_images: number;
    remaining_videos: number;
  };
}

interface AccountMenuProps {
  me: AccountMenuData | null;
  onLogout: () => void | Promise<void>;
  compact?: boolean;
}

export default function AccountMenu({ me, onLogout, compact = false }: AccountMenuProps) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const t = useT();
  const { locale } = useLocale();

  const role = me?.user.role || "user";
  const name = me?.user.display_name || me?.user.email || me?.user.phone || t("nav.account");
  const triggerLabel = compact
    ? role === "admin"
      ? t("nav.admin")
      : me
        ? t("nav.imagesShort", { count: me.wallet.remaining_images })
        : t("nav.account")
    : name;

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex max-w-48 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 cursor-pointer"
      >
        <span className="truncate">{triggerLabel}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-[70] mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40">
          <div className="border-b border-zinc-800 px-4 py-3">
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
          <div className="p-1.5">
            <MenuLink href="/billing" label={t("nav.billing")} />
            <MenuLink href="/docs/api" label={t("nav.apiDocs")} />
            {role === "admin" && (
              <>
                <MenuLink href="/settings" label={t("nav.settings")} />
                <MenuLink href="/admin" label={t("nav.admin")} />
                <MenuLink href="/admin/stats" label={t("nav.adminStats")} />
                <MenuLink href="/admin/logs" label={t("nav.adminLogs")} />
              </>
            )}
          </div>
          <div className="border-t border-zinc-800 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void onLogout()}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200 cursor-pointer"
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} role="menuitem" className="block rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
      {label}
    </Link>
  );
}
