"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import AppShell from "@/components/AppShell";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import { formatDateTime, formatVnd, useLocale, useT, type MessageKey } from "@/i18n";

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

const LEDGER_KEYS = new Set([
  "topup_manual",
  "topup_payos",
  "charge_image",
  "refund_image",
  "charge_video",
  "refund_video",
  "adjust_manual",
]);

export default function BillingPage() {
  const t = useT();
  const { locale } = useLocale();
  const money = (value: number) => formatVnd(value, locale);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"success" | "cancel" | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<(typeof PACKAGES)[number] | null>(null);
  const exitRef = useRef<(() => void) | null>(null);
  const embedSectionRef = useRef<HTMLElement | null>(null);

  const price = wallet?.image_price_vnd ?? 100;
  const isAdmin = role === "admin";

  function ledgerLabel(type: string) {
    if (LEDGER_KEYS.has(type)) {
      return t(`ledger.${type}` as MessageKey);
    }
    return type;
  }

  const refreshWallet = useCallback(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.wallet) setWallet(data.wallet);
        if (data.user?.role === "admin" || data.user?.role === "user") setRole(data.user.role);
      });
    fetch("/api/wallet/ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
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
        setActivePackage(null);
      },
      onCancel: () => {
        setNotice("cancel");
        setCheckoutUrl(null);
        setActivePackage(null);
      },
    });
    exitRef.current = exit;
    open(true);
    requestAnimationFrame(() => {
      embedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => {
      exit();
      exitRef.current = null;
    };
  }, [checkoutUrl, refreshWallet]);

  function closeCheckout() {
    exitRef.current?.();
    setCheckoutUrl(null);
    setActivePackage(null);
  }

  async function buyPackage(id: string) {
    if (loadingId || checkoutUrl) return;
    const pkg = PACKAGES.find((item) => item.id === id) ?? null;
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
        setActivePackage(pkg);
        setCheckoutUrl(data.checkoutUrl);
      } else {
        window.location.href = data.checkoutUrl;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("billing.createLinkFailed"));
      setActivePackage(null);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <AppShell>
      <Script src={PAYOS_SCRIPT} strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-lg font-semibold text-zinc-100 mb-4">{t("billing.title")}</h1>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label={t("billing.balance")} value={money(wallet?.balance_vnd ?? 0)} />
            <Stat label={t("billing.imagePrice")} value={money(price)} />
            <Stat
              label={t("billing.remainingImages")}
              value={t("billing.imagesUnit", { count: wallet?.remaining_images ?? 0 })}
            />
            <Stat label={t("billing.videoPrice")} value={money(wallet?.video_price_vnd ?? 1500)} />
            <Stat
              label={t("billing.remainingVideos")}
              value={t("billing.videosUnit", { count: wallet?.remaining_videos ?? 0 })}
            />
          </div>
        </section>

        {isAdmin && (
          <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 px-4 py-3 text-sm text-blue-100/90">
            {t("billing.adminNote")}
          </div>
        )}

        {notice === "success" && (
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            {t("billing.paySuccess")}
          </div>
        )}
        {notice === "cancel" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
            {t("billing.payCancel")}
          </div>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">{t("billing.choosePackage")}</h2>
          <p className="text-sm text-zinc-400">{t("billing.choosePackageHint")}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PACKAGES.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => buyPackage(pkg.id)}
                disabled={loadingId !== null || checkoutUrl !== null}
                className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <p className="text-base font-semibold text-zinc-100">{money(pkg.amountVnd)}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {t("billing.imagesUnit", { count: Math.floor(pkg.amountVnd / price) })}
                </p>
                {loadingId === pkg.id && <p className="text-xs text-zinc-500 mt-1">{t("billing.creatingLink")}</p>}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>

        {checkoutUrl && (
          <section ref={embedSectionRef} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-zinc-200">{t("billing.scanQr")}</h2>
                <p className="text-xs text-zinc-500 mt-1">{t("billing.scanQrHint")}</p>
                {activePackage && (
                  <p className="text-xs text-zinc-400 mt-2">
                    {t("billing.activePackage")}
                    <span className="text-zinc-200 font-medium">{money(activePackage.amountVnd)}</span>
                    {" · "}
                    {t("billing.imagesUnit", { count: Math.floor(activePackage.amountVnd / price) })}
                  </p>
                )}
              </div>
              <button
                onClick={closeCheckout}
                className="shrink-0 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
            </div>
            <div className="flex justify-center">
              <div className="w-full max-w-[380px] rounded-xl overflow-hidden border border-zinc-700 bg-white shadow-sm">
                <div
                  id="payos-embed"
                  className="w-full h-[500px] sm:h-[520px] [&_iframe]:!block [&_iframe]:!h-full [&_iframe]:!w-full [&_iframe]:border-0"
                />
              </div>
            </div>
            <p className="text-center text-xs text-zinc-500">
              {t("billing.cantScan")}{" "}
              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-300 hover:text-white underline-offset-2 hover:underline"
              >
                {t("billing.openPayos")}
              </a>
            </p>
          </section>
        )}

        <ApiKeysPanel />

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-sm font-medium text-zinc-200 mb-2">{t("billing.needHelp")}</h2>
          <p className="text-sm text-zinc-400">
            {t("common.contactAdmin")}{" "}
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
          <h2 className="text-sm font-medium text-zinc-200 mb-3">{t("billing.ledger")}</h2>
          {ledger.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("billing.noLedger")}</p>
          ) : (
            <div className="divide-y divide-zinc-800">
              {ledger.map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <div>
                    <p className="text-zinc-300">{ledgerLabel(item.type)}</p>
                    <p className="text-xs text-zinc-600">
                      {formatDateTime(item.created_at, locale)}
                      {item.note ? ` · ${item.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={item.amount_vnd >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {item.amount_vnd >= 0 ? "+" : ""}
                      {money(item.amount_vnd)}
                    </p>
                    <p className="text-xs text-zinc-600">
                      {t("billing.balanceAfter", { amount: money(item.balance_after_vnd) })}
                    </p>
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
