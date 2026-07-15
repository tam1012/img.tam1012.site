"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n";

type ModelStatRow = {
  model: string;
  total: number;
  generate: number;
  edit: number;
};

type PeriodStat = {
  key: "day" | "week" | "month";
  label: string;
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

type Props = {
  scope?: "mine" | "all";
  title?: string;
  className?: string;
};

export default function ImageStatsPanel({ scope = "mine", title, className = "" }: Props) {
  const t = useT();
  const [data, setData] = useState<ImageStatsResponse | null>(null);
  const [model, setModel] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const resolvedTitle = title ?? t("stats.title");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope });
      if (model && model !== "all") params.set("model", model);
      const res = await fetch(`/api/stats/images?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || t("stats.loadFailed"));
        setData(null);
        return;
      }
      setData(json as ImageStatsResponse);
    } catch {
      setError(t("stats.loadFailed"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scope, model, t]);

  useEffect(() => {
    load();
  }, [load]);

  const models = data?.models || [];

  function periodLabel(key: PeriodStat["key"], fallback: string) {
    if (key === "day") return t("stats.today");
    if (key === "week") return t("stats.thisWeek");
    if (key === "month") return t("stats.thisMonth");
    return fallback;
  }

  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 space-y-4 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">{resolvedTitle}</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {t("stats.subtitle", { scope: scope === "all" ? t("stats.scopeAll") : t("stats.scopeMine") })}
            {data?.model ? t("stats.modelFilter", { model: data.model }) : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
          >
            <option value="all">{t("stats.allModels")}</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 cursor-pointer"
          >
            {t("stats.refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-6">
          <span className="spinner" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.periods.map((p) => (
              <div key={p.key} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-zinc-500">{periodLabel(p.key, p.label)}</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">{p.total}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {t("stats.generateEdit", { generate: p.generate, edit: p.edit })}
                </p>
              </div>
            ))}
          </div>

          {data.periods.some((p) => p.by_model.length > 0) && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-zinc-500">
                  <tr className="border-b border-zinc-800">
                    <th className="py-2 pr-3 text-left font-medium">Model</th>
                    {data.periods.map((p) => (
                      <th key={p.key} className="py-2 px-2 text-right font-medium">
                        {periodLabel(p.key, p.label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {mergeModels(data.periods).map((modelName) => (
                    <tr key={modelName}>
                      <td className="py-2 pr-3 text-zinc-300">{modelName}</td>
                      {data.periods.map((p) => {
                        const row = p.by_model.find((m) => m.model === modelName);
                        return (
                          <td key={p.key} className="py-2 px-2 text-right text-zinc-400">
                            {row ? row.total : 0}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function mergeModels(periods: PeriodStat[]): string[] {
  const set = new Set<string>();
  for (const p of periods) {
    for (const row of p.by_model) set.add(row.model);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
