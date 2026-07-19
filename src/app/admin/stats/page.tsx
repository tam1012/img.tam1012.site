"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";

type ModelStatRow = {
  model: string;
  total: number;
  generate: number;
  edit: number;
};

type PeriodStat = {
  key: "day" | "week" | "month" | "custom";
  label: string;
  from?: string;
  to?: string;
  total: number;
  generate: number;
  edit: number;
  by_model: ModelStatRow[];
};

type ImageStatsResponse = {
  timezone: string;
  scope: "mine" | "all";
  model: string | null;
  models: string[];
  periods: PeriodStat[];
};

type RequestLogSummary = {
  total: number;
  completed: number;
  failed: number;
  processing: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
};

type PeriodTab = "day" | "week" | "month" | "custom";

function vnToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(rate: number | null) {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

export default function AdminStatsPage() {
  const [period, setPeriod] = useState<PeriodTab>("day");
  const [customFrom, setCustomFrom] = useState(() => {
    // Mặc định khoảng tùy chỉnh = 7 ngày gần nhất (kể cả hôm nay).
    const now = new Date();
    const shifted = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return shifted.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  });
  const [customTo, setCustomTo] = useState(() => vnToday());
  const [model, setModel] = useState("all");
  const [imageStats, setImageStats] = useState<ImageStatsResponse | null>(null);
  const [requestSummary, setRequestSummary] = useState<RequestLogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const imageParams = new URLSearchParams({ scope: "all" });
      if (model !== "all") imageParams.set("model", model);

      if (period === "custom") {
        if (!customFrom || !customTo) {
          throw new Error("Chọn đủ ngày bắt đầu và kết thúc.");
        }
        if (customFrom > customTo) {
          throw new Error("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
        }
        imageParams.set("from", `${customFrom}T00:00:00+07:00`);
        imageParams.set("to", `${customTo}T23:59:59.999+07:00`);
      }

      const imageRes = await fetch(`/api/stats/images?${imageParams.toString()}`);
      const imageJson = await imageRes.json().catch(() => null);
      if (!imageRes.ok) throw new Error(imageJson?.error || "Không tải được thống kê ảnh");
      const stats = imageJson as ImageStatsResponse;
      setImageStats(stats);

      // Request health dùng đúng mốc from/to của kỳ ảnh để 2 khối cùng kỳ.
      const picked =
        period === "custom"
          ? stats.periods.find((p) => p.key === "custom") || stats.periods[0]
          : stats.periods.find((p) => p.key === period) || null;

      let reqFromIso: string;
      let reqToIso: string;
      if (picked?.from && picked?.to) {
        reqFromIso = picked.from;
        reqToIso = picked.to;
      } else if (period === "custom") {
        reqFromIso = `${customFrom}T00:00:00+07:00`;
        reqToIso = `${customTo}T23:59:59.999+07:00`;
      } else {
        reqFromIso = `${vnToday()}T00:00:00+07:00`;
        reqToIso = `${vnToday()}T23:59:59.999+07:00`;
      }

      const reqParams = new URLSearchParams({
        page: "1",
        page_size: "1",
        from: reqFromIso,
        to: reqToIso,
      });
      const reqRes = await fetch(`/api/admin/request-log?${reqParams.toString()}`);
      const reqJson = await reqRes.json().catch(() => null);
      if (!reqRes.ok) throw new Error(reqJson?.error || "Không tải được sức khỏe request");
      setRequestSummary((reqJson?.summary as RequestLogSummary) || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không tải được thống kê");
      setImageStats(null);
      setRequestSummary(null);
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo, model]);

  useEffect(() => {
    load();
  }, [load]);

  const activePeriod: PeriodStat | null = useMemo(() => {
    if (!imageStats?.periods?.length) return null;
    if (period === "custom") {
      return imageStats.periods.find((p) => p.key === "custom") || imageStats.periods[0];
    }
    return imageStats.periods.find((p) => p.key === period) || null;
  }, [imageStats, period]);

  const periodLabel =
    period === "day"
      ? "Hôm nay"
      : period === "week"
        ? "Tuần này (Thứ 2 → nay)"
        : period === "month"
          ? "Tháng này"
          : customFrom && customTo
            ? `${customFrom} → ${customTo}`
            : "Tùy chỉnh";

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Admin · Thống kê</h1>
            <p className="text-xs text-zinc-500 mt-1">
              Sản lượng ảnh đã tạo (không tụt khi xoá gallery) + sức khỏe request. Múi giờ Asia/Ho_Chi_Minh.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin" className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300">
              Users
            </Link>
            <Link href="/admin/logs" className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300">
              Nhật ký
            </Link>
            <button
              type="button"
              onClick={load}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 cursor-pointer"
            >
              Làm mới
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["day", "Hôm nay"],
                  ["week", "Tuần"],
                  ["month", "Tháng"],
                  ["custom", "Tùy chỉnh"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
                    period === key
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {period === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <span className="text-zinc-600 text-sm">–</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
              >
                <option value="all">Tất cả model</option>
                {(imageStats?.models || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-600">{periodLabel}</span>
            </div>
          </div>

          {loading && !imageStats ? (
            <div className="flex justify-center py-10">
              <span className="spinner" />
            </div>
          ) : activePeriod ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <KpiCard label="Sản lượng ảnh" value={String(activePeriod.total)} hint="Đã tạo thành công" />
                <KpiCard label="Tạo mới" value={String(activePeriod.generate)} />
                <KpiCard label="Chỉnh sửa" value={String(activePeriod.edit)} />
              </div>

              <div>
                <h2 className="text-sm font-medium text-zinc-200 mb-2">Theo model</h2>
                {activePeriod.by_model.length === 0 ? (
                  <p className="text-sm text-zinc-500">Chưa có ảnh trong kỳ này.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-zinc-800">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-950 text-zinc-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Model</th>
                          <th className="px-3 py-2 text-right font-medium">Tổng</th>
                          <th className="px-3 py-2 text-right font-medium">Tạo</th>
                          <th className="px-3 py-2 text-right font-medium">Sửa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {activePeriod.by_model.map((row) => (
                          <tr key={row.model}>
                            <td className="px-3 py-2 text-zinc-200">{row.model}</td>
                            <td className="px-3 py-2 text-right text-zinc-100 font-medium">{row.total}</td>
                            <td className="px-3 py-2 text-right text-zinc-400">{row.generate}</td>
                            <td className="px-3 py-2 text-right text-zinc-400">{row.edit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">Sức khỏe request</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Mọi request tạo/sửa ảnh + video trong kỳ · gồm cả fail / đang chạy
              </p>
            </div>
            <Link href="/admin/logs" className="text-xs text-blue-400 hover:text-blue-300 shrink-0">
              Xem nhật ký →
            </Link>
          </div>

          {loading && !requestSummary ? (
            <div className="flex justify-center py-8">
              <span className="spinner" />
            </div>
          ) : requestSummary ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <KpiCard label="Tổng request" value={String(requestSummary.total)} compact />
              <KpiCard label="Thành công" value={String(requestSummary.completed)} tone="emerald" compact />
              <KpiCard label="Thất bại" value={String(requestSummary.failed)} tone="red" compact />
              <KpiCard label="Tỷ lệ OK" value={formatPercent(requestSummary.success_rate)} compact />
              <KpiCard label="Thời gian TB" value={formatDuration(requestSummary.avg_duration_ms)} compact />
            </div>
          ) : null}
        </section>
      </main>
    </AppShell>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald" | "red";
  compact?: boolean;
}) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "red"
        ? "text-red-300"
        : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 font-semibold ${compact ? "text-xl" : "text-2xl"} ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-zinc-600">{hint}</p> : null}
    </div>
  );
}
