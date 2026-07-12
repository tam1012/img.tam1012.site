"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

interface RequestLogRow {
  id: string;
  kind: "generate" | "edit" | "video";
  model: string;
  provider_name: string | null;
  account: string | null;
  user_label: string;
  user_id: string;
  status: "processing" | "completed" | "failed" | "deleted";
  duration_ms: number | null;
  cost_vnd: number;
  aspect_ratio: string | null;
  resolution: string | null;
  error_message: string | null;
  batch_id: string | null;
  created_at: string;
}

interface RequestLogSummary {
  total: number;
  completed: number;
  failed: number;
  processing: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
}

interface RequestLogResult {
  rows: RequestLogRow[];
  total: number;
  page: number;
  page_size: number;
  models: string[];
  summary: RequestLogSummary;
}

const KIND_LABEL: Record<RequestLogRow["kind"], string> = {
  generate: "Tạo ảnh",
  edit: "Sửa ảnh",
  video: "Video",
};

const STATUS_LABEL: Record<RequestLogRow["status"], string> = {
  processing: "Đang chạy",
  completed: "Thành công",
  failed: "Thất bại",
  deleted: "Đã xoá",
};

const STATUS_CLASS: Record<RequestLogRow["status"], string> = {
  processing: "bg-amber-500/15 text-amber-300",
  completed: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  deleted: "bg-zinc-700/40 text-zinc-400",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("vi-VN", { hour12: false });
}

function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

export default function AdminLogsPage() {
  const [data, setData] = useState<RequestLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [model, setModel] = useState("all");
  const [page, setPage] = useState(1);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (kind !== "all") params.set("kind", kind);
      if (status !== "all") params.set("status", status);
      if (model !== "all") params.set("model", model);
      params.set("page", String(page));
      const res = await fetch(`/api/admin/request-log?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Không tải được nhật ký");
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không tải được nhật ký");
    } finally {
      setLoading(false);
    }
  }, [kind, status, model, page]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  // Đổi bộ lọc thì về trang 1.
  useEffect(() => { setPage(1); }, [kind, status, model]);

  const summary = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-100">Admin · Nhật ký request</h1>
          <button onClick={fetchLog} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700 cursor-pointer">
            Làm mới
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Toàn bộ request tạo/sửa ảnh và tạo video, gồm cả request đi thẳng nhà cung cấp (không qua proxy).
          Thời gian tạo là ước lượng theo thời điểm bắt đầu và hoàn tất.
        </p>

        {error && <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryCard label="Tổng request" value={String(summary.total)} />
            <SummaryCard label="Thành công" value={String(summary.completed)} tone="emerald" />
            <SummaryCard label="Thất bại" value={String(summary.failed)} tone="red" />
            <SummaryCard label="Tỷ lệ thành công" value={summary.success_rate == null ? "—" : `${Math.round(summary.success_rate * 100)}%`} />
            <SummaryCard label="Thời gian TB" value={formatDuration(summary.avg_duration_ms)} />
          </div>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-zinc-800">
            <select value={kind} onChange={(e) => setKind(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              <option value="all">Tất cả loại</option>
              <option value="generate">Tạo ảnh</option>
              <option value="edit">Sửa ảnh</option>
              <option value="video">Video</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              <option value="all">Tất cả trạng thái</option>
              <option value="completed">Thành công</option>
              <option value="failed">Thất bại</option>
              <option value="processing">Đang chạy</option>
              <option value="deleted">Đã xoá</option>
            </select>
            <select value={model} onChange={(e) => setModel(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              <option value="all">Tất cả model</option>
              {data?.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><span className="spinner" /></div>
          ) : !data || data.rows.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500">Không có request khớp bộ lọc.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="px-4 py-2 text-xs text-zinc-600 border-b border-zinc-800">
                {data.total} request · trang {data.page}/{totalPages}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-zinc-950 text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Thời gian</th>
                    <th className="px-4 py-3 text-left font-medium">Loại</th>
                    <th className="px-4 py-3 text-left font-medium">Model</th>
                    <th className="px-4 py-3 text-left font-medium">User</th>
                    <th className="px-4 py-3 text-left font-medium">Trạng thái</th>
                    <th className="px-4 py-3 text-right font-medium">Thời gian tạo</th>
                    <th className="px-4 py-3 text-right font-medium">Giá</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {data.rows.map((row) => (
                    <tr key={`${row.kind}-${row.id}`} className="hover:bg-zinc-800/50 align-top">
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3 text-zinc-300">
                        {KIND_LABEL[row.kind]}
                        {row.batch_id && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500">batch</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-zinc-200">{row.model}</p>
                        <p className="text-xs text-zinc-600">
                          {row.provider_name || (row.account ? `account ${row.account}` : "")}
                          {row.resolution ? ` · ${row.resolution}` : ""}
                          {row.aspect_ratio ? ` · ${row.aspect_ratio}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{row.user_label}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_CLASS[row.status]}`}>
                          {STATUS_LABEL[row.status]}
                        </span>
                        {row.status === "failed" && row.error_message && (
                          <p className="text-xs text-red-400/70 mt-1 max-w-xs break-words">{row.error_message}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-400 whitespace-nowrap">{formatDuration(row.duration_ms)}</td>
                      <td className="px-4 py-3 text-right text-zinc-400 whitespace-nowrap">{formatVnd(row.cost_vnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700 disabled:text-zinc-600 cursor-pointer disabled:cursor-not-allowed"
                >
                  Trước
                </button>
                <span className="text-xs text-zinc-500">Trang {page}/{totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700 disabled:text-zinc-600 cursor-pointer disabled:cursor-not-allowed"
                >
                  Sau
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "red" }) {
  const valueClass = tone === "emerald" ? "text-emerald-300" : tone === "red" ? "text-red-300" : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 ${valueClass}`}>{value}</p>
    </div>
  );
}
