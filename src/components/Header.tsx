"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AccountMenu, { AccountMenuData } from "@/components/AccountMenu";

const NAV_LINKS = [
  { href: "/generate", label: "Tạo ảnh" },
  { href: "/edit", label: "Chỉnh sửa" },
  { href: "/video", label: "Tạo video" },
  { href: "/gallery", label: "Thư viện" },
  { href: "/billing", label: "Nạp tiền" },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<AccountMenuData | null>(null);

  const fetchMe = useCallback(() => {
    fetch("/api/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.user) setMe(data);
      });
  }, []);

  useEffect(() => {
    fetchMe();
    window.addEventListener("wallet-refresh", fetchMe);
    return () => window.removeEventListener("wallet-refresh", fetchMe);
  }, [fetchMe]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link href="/generate" className="shrink-0 text-lg font-semibold tracking-tight text-zinc-100">
          IMG Studio
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex" aria-label="Điều hướng chính">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="md:hidden">
          <AccountMenu me={me} onLogout={handleLogout} compact />
        </div>
        <div className="hidden md:block">
          <AccountMenu me={me} onLogout={handleLogout} />
        </div>
      </div>
    </header>
  );
}
