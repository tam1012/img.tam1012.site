"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

const NAV_LINKS = [
  { href: "/generate", label: "Tạo ảnh" },
  { href: "/edit", label: "Chỉnh sửa" },
  { href: "/gallery", label: "Thư viện" },
  { href: "/settings", label: "Cài đặt", adminOnly: true },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.role) setRole(d.role);
    });
  }, []);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  const links = NAV_LINKS.filter((l) => !l.adminOnly || role === "admin");

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/generate" className="text-lg font-semibold text-zinc-100 tracking-tight">
          IMG Studio
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                pathname === link.href
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {role === "guest" && (
            <span className="px-2 py-1 text-[10px] text-zinc-500 bg-zinc-800/50 rounded">Khách</span>
          )}
          <button
            onClick={handleLogout}
            className="ml-3 px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            Đăng xuất
          </button>
        </nav>
      </div>
    </header>
  );
}
