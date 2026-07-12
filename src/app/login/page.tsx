"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

type Tab = "login" | "register";

const DOMAIN_BANNER_KEY = "imgstudio.hideDomainBanner";

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showDomainBanner, setShowDomainBanner] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      if (localStorage.getItem(DOMAIN_BANNER_KEY) !== "1") {
        setShowDomainBanner(true);
      }
    } catch {
      setShowDomainBanner(true);
    }
  }, []);

  function dismissDomainBanner() {
    try {
      localStorage.setItem(DOMAIN_BANNER_KEY, "1");
    } catch {
      // localStorage có thể bị chặn; vẫn ẩn banner trong phiên hiện tại
    }
    setShowDomainBanner(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(tab === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          tab === "login"
            ? { identifier, password }
            : { email, phone, display_name: displayName, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/generate");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = tab === "login"
    ? identifier.trim() && password
    : (email.trim() || phone.trim()) && password.length >= 8;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-center text-zinc-100 mb-4 tracking-tight">
          IMG Studio
        </h1>
        {showDomainBanner && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
            <p className="flex-1 text-center text-xs leading-relaxed text-zinc-400">
              IMG Studio đã chuyển sang domain mới imgstudio.site. Tài khoản, số dư, ảnh và video của bạn vẫn được giữ nguyên.
            </p>
            <button
              type="button"
              onClick={dismissDomainBanner}
              aria-label="Đóng thông báo domain"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}
        <div className="mb-3 grid grid-cols-2 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => { setTab("login"); setError(""); }}
            className={`rounded-lg py-2 text-sm transition-colors cursor-pointer ${tab === "login" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => { setTab("register"); setError(""); }}
            className={`rounded-lg py-2 text-sm transition-colors cursor-pointer ${tab === "register" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Đăng ký
          </button>
        </div>
        <form onSubmit={handleSubmit} className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 space-y-4">
          {tab === "login" ? (
            <div>
              <label htmlFor="identifier" className="block text-sm text-zinc-400 mb-2">
                Email hoặc số điện thoại
              </label>
              <input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                placeholder="a@example.com hoặc 09..."
                autoFocus
              />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="displayName" className="block text-sm text-zinc-400 mb-2">Tên hiển thị</label>
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 100))}
                  maxLength={100}
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                  placeholder="Tên của Anh (chữ, số; tối đa 100 ký tự)"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm text-zinc-400 mb-2">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                  placeholder="a@example.com"
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm text-zinc-400 mb-2">Số điện thoại</label>
                <input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                  placeholder="Có thể để trống nếu đã nhập email"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="password" className="block text-sm text-zinc-400 mb-2">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                placeholder={tab === "register" ? "Tối thiểu 8 ký tự" : "Nhập mật khẩu"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            {tab === "register" && password.length >= 1 && password.length < 8 && (
              <p className="mt-1.5 text-xs text-zinc-500">Mật khẩu tối thiểu 8 ký tự</p>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors text-sm font-medium cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? "Đang xử lý..." : tab === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>
          {tab === "register" && (
            <p className="text-center text-xs text-zinc-500">Tạo tài khoản nhận ngay 10 ảnh miễn phí</p>
          )}
        </form>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Liên hệ admin: Telegram{" "}
          <a
            href="https://t.me/ThongThaiTuaThanTien"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-zinc-100 underline-offset-2 hover:underline"
          >
            @ThongThaiTuaThanTien
          </a>
        </p>
      </div>
    </div>
  );
}
