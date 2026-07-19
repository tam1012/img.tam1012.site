"use client";

import Link from "next/link";
import { ADMIN_CONTACT } from "@/lib/site-settings";
import { useT } from "@/i18n";

export default function SiteFooter() {
  const t = useT();
  return (
    <footer className="mt-auto border-t border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3 text-center text-xs text-zinc-500">
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
  );
}
