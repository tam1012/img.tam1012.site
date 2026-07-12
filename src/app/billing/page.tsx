"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import AppShell from "@/components/AppShell";
import { formatLedgerType } from "@/lib/pricing";

interface Wallet {
  balance_vnd: number;
  image_price_vnd: number;
  video_price_vnd: number;
  remaining_images: number;
  remaining_videos: number;
}

interface LedgerItem {
  id: string;
  type: string;
  amount_vnd: number;
  balance_after_vnd: number;
  note: string | null;
  created_at: string;
}

type PayOSConfig = {
  RETURN_URL: string;
  ELEMENT_ID: string;
  CHECKOUT_URL: string;
  onSuccess?: (event: unknown) => void;
  onCancel?: (event: unknown) => void;
  onExit?: (event: unknown) => void;
};

declare global {
  interface Window {
    PayOSCheckout?: {
      usePayOS: (config: PayOSConfig) => { open: (embedded?: boolean) => void; exit: () => void };
    };
  }
}

const PAYOS_SCRIPT = "https://cdn.payos.vn/payos-checkout/v1/stable/payos-initialize.js";

const PACKAGES = [
  { id: "p10k", amountVnd: 10000 },
  { id: "p20k", amountVnd: 20000 },
  { id: "p50k", amountVnd: 50000 },
  { id: "p100k", amountVnd: 100000 },
];

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("vi-VN", { hour12: false });
}

export default function BillingPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"success" | "cancel" | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const exitRef = useRef<(() => void) | null>(null);

  const price = wallet?.image_price_vnd ?? 100;
  const isAdmin = role === "admin";

  const refreshWallet = useCallback(() => {
    fetch("/api/me").then((r) => r.json()).then((data) => {
      if (data.wallet) setWallet(data.wallet);
      if (data.user?.role === "admin" || data.user?.role === "user") setRole(data.user.role);
    });
    fetch("/api/wallet/ledger").then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (data?.ledger) setLedger(data.ledger);
    });
  }, []);

  useEffect(() => {
    refreshWallet();
    if (window.PayOSCheckout) setScriptReady(true);
  }, [refreshWallet]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("payos");
    if (status === "success" || status === "cancel") {
      setNotice(status);
      window.history.replaceState({}, "", "/billing");
    }
  }, []);

  useEffect(() => {
    if (!checkoutUrl || !window.PayOSCheckout) return;
    const { open, exit } = window.PayOSCheckout.usePayOS({
      RETURN_URL: `${window.location.origin}/billing?payos=success`,
      ELEMENT_ID: "payos-embed",
      CHECKOUT_URL: checkoutUrl,
      onSuccess: () => {
        setNotice("success");
        refreshWallet();
        setCheckoutUrl(null);
      },
      onCancel: () => {
        setNotice("cancel");
        setCheckoutUrl(null);
      },
    });
    exitRef.current = exit;
    open(true);
    return () => {
      exit();
      exitRef.current = null;
    };
  }, [checkoutUrl, refreshWallet]);

  async function buyPackage(id: string) {
    if (loadingId || checkoutUrl) return;
    setLoadingId(id);
    setError("");
    setNotice(null);
    try {
      const res = await fetch("/api/payos/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (scriptReady && window.PayOSCheckout) {
        setCheckoutUrl(data.checkoutUrl);
      } else {
        window.location.href = data.checkoutUrl;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không tạo được link thanh toán");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <AppShell>
      <Script src={PAYOS_SCRIPT} strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-lg font-semibold text-zinc-100 mb-4">Số dư và nạp tiền</h1>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Số dư" value={formatVnd(wallet?.balance_vnd ?? 0)} />
            <Stat label="Giá mỗi ảnh" value={formatVnd(price)} />
            <Stat label="Còn tạo được ảnh" value={`${wallet?.remaining_images ?? 0} ảnh`} />
            <Stat label="Giá mỗi video" value={formatVnd(wallet?.video_price_vnd ?? 5000)} />
            <Stat label="Còn tạo được video" value={`${wallet?.remaining_videos ?? 0} video`} />
          </div>
        </section>

        {isAdmin && (
          <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 px-4 py-3 text-sm text-blue-100/90">
            Tài khoản admin không bị trừ tiền khi tạo ảnh/video. Gói nạp bên dưới chủ yếu để test PayOS.
          </div>
        )}

        {notice === "success" && (
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            Thanh toán thành công. Số dư sẽ được cộng trong vài giây, làm mới trang nếu chưa thấy.
          </div>
        )}
        {notice === "cancel" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
            Bạn đã huỷ thanh toán. Chưa có khoản nạp nào được thực hiện.
          </div>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">Chọn gói nạp</h2>
          <p className="text-sm text-zinc-400">
            Chọn một gói để thanh toán qua PayOS (quét mã QR chuyển khoản). Số dư và số ảnh sẽ tự cộng ngay sau khi thanh toán thành công.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PACKAGES.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => buyPackage(pkg.id)}
                disabled={loadingId !== null || checkoutUrl !== null}
                className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <p className="text-base font-semibold text-zinc-100">{formatVnd(pkg.amountVnd)}</p>
                <p className="text-xs text-zinc-500 mt-1">{Math.floor(pkg.amountVnd / price)} ảnh</p>
                {loadingId === pkg.id && <p className="text-xs text-zinc-500 mt-1">Đang tạo link...</p>}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>

        {checkoutUrl && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Quét mã QR để thanh toán</h2>
              <button
                onClick={() => setCheckoutUrl(null)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors cursor-pointer"
              >
                Huỷ
              </button>
            </div>
            <div id="payos-embed" className="w-full min-h-[640px] [&_iframe]:!w-full [&_iframe]:!min-h-[640px] [&_iframe]:border-0" />
          </section>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-sm font-medium text-zinc-200 mb-2">Cần hỗ trợ?</h2>
          <p className="text-sm text-zinc-400">
            Liên hệ admin: Telegram{" "}
            <a
              href="https://t.me/ThongThaiTuaThanTien"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-200 hover:text-white underline-offset-2 hover:underline"
            >
              @ThongThaiTuaThanTien
            </a>
          </p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-sm font-medium text-zinc-200 mb-3">Lịch sử giao dịch</h2>
          {ledger.length === 0 ? (
            <p className="text-sm text-zinc-500">Chưa có giao dịch</p>
          ) : (
            <div className="divide-y divide-zinc-800">
              {ledger.map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <div>
                    <p className="text-zinc-300">{formatLedgerType(item.type)}</p>
                    <p className="text-xs text-zinc-600">{formatDate(item.created_at)}{item.note ? ` · ${item.note}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={item.amount_vnd >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {item.amount_vnd >= 0 ? "+" : ""}{formatVnd(item.amount_vnd)}
                    </p>
                    <p className="text-xs text-zinc-600">Còn {formatVnd(item.balance_after_vnd)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-100">{value}</p>
    </div>
  );
}
