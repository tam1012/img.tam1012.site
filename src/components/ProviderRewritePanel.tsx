"use client";

import { useCallback, useEffect, useState } from "react";

type ApplyTo = "generate" | "edit" | "both";
type DisplayMode = "requested" | "actual";

export type RewriteRule = {
  id: string;
  enabled: boolean;
  fromProviderId: string;
  toProviderId: string;
  applyTo: ApplyTo;
  displayMode: DisplayMode;
};

export type RewriteConfig = {
  enabled: boolean;
  rules: RewriteRule[];
};

type ProviderOption = {
  id: string;
  name: string;
  model: string;
  api_type?: string;
};

function newRuleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRule(providers: ProviderOption[]): RewriteRule {
  const from = providers[0]?.id || "";
  const to = providers.find((p) => p.id !== from)?.id || providers[1]?.id || from;
  return {
    id: newRuleId(),
    enabled: true,
    fromProviderId: from,
    toProviderId: to,
    applyTo: "both",
    displayMode: "requested",
  };
}

function providerLabel(p: ProviderOption) {
  return `${p.name} · ${p.model}`;
}

export default function ProviderRewritePanel({ providers }: { providers: ProviderOption[] }) {
  const [config, setConfig] = useState<RewriteConfig>({ enabled: false, rules: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/provider-rewrite");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không tải được cấu hình rewrite");
      setConfig(data.config || { enabled: false, rules: [] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không tải được cấu hình rewrite");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateRule(id: string, patch: Partial<RewriteRule>) {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    setSavedAt(null);
  }

  function addRule() {
    if (providers.length < 2) {
      setError("Cần ít nhất 2 provider để tạo rule rewrite");
      return;
    }
    setConfig((prev) => ({ ...prev, rules: [...prev.rules, emptyRule(providers)] }));
    setSavedAt(null);
    setError("");
  }

  function removeRule(id: string) {
    setConfig((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== id) }));
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/provider-rewrite", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không lưu được");
      setConfig(data.config);
      setSavedAt(new Date().toLocaleTimeString("vi-VN", { hour12: false }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không lưu được");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Điều hướng provider (rewrite)</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            User vẫn chọn model cũ; hệ thống có thể chạy ngầm sang model đích. Mặc định tắt — bật khi cần
            (ví dụ Vertex gần hết quota). Gallery mặc định hiện tên model user chọn; nhật ký admin/stats
            luôn ghi model thật.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <span className="spinner" />
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => {
                  setConfig((prev) => ({ ...prev, enabled: e.target.checked }));
                  setSavedAt(null);
                }}
                className="rounded border-zinc-600 cursor-pointer"
              />
              Bật rewrite toàn hệ thống
            </label>

            {config.rules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-4 text-sm text-zinc-500">
                Chưa có rule. Thêm rule (vd: Gemini 3 Pro Image → Flow · Nano Banana Pro) rồi bật khi cần.
              </div>
            ) : (
              <div className="space-y-3">
                {config.rules.map((rule, idx) => (
                  <div key={rule.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                          className="rounded border-zinc-600 cursor-pointer"
                        />
                        Rule {idx + 1} {rule.enabled ? "đang bật" : "tắt"}
                      </label>
                      <button
                        type="button"
                        onClick={() => removeRule(rule.id)}
                        className="px-2 py-1 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded cursor-pointer"
                      >
                        Xoá
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">User chọn (nguồn)</label>
                        <select
                          value={rule.fromProviderId}
                          onChange={(e) => updateRule(rule.id, { fromProviderId: e.target.value })}
                          className="w-full px-2.5 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                        >
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {providerLabel(p)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">Chạy thật (đích)</label>
                        <select
                          value={rule.toProviderId}
                          onChange={(e) => updateRule(rule.id, { toProviderId: e.target.value })}
                          className="w-full px-2.5 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                        >
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {providerLabel(p)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">Áp dụng</label>
                        <select
                          value={rule.applyTo}
                          onChange={(e) => updateRule(rule.id, { applyTo: e.target.value as ApplyTo })}
                          className="w-full px-2.5 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                        >
                          <option value="both">Tạo ảnh + chỉnh sửa</option>
                          <option value="generate">Chỉ tạo ảnh</option>
                          <option value="edit">Chỉ chỉnh sửa</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">Gallery hiện</label>
                        <select
                          value={rule.displayMode}
                          onChange={(e) =>
                            updateRule(rule.id, { displayMode: e.target.value as DisplayMode })
                          }
                          className="w-full px-2.5 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                        >
                          <option value="requested">Tên model user chọn (mặc định)</option>
                          <option value="actual">Tên model thật đã chạy</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
            {savedAt && !error && (
              <p className="text-xs text-emerald-400/90">Đã lưu lúc {savedAt}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={addRule}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm transition-colors cursor-pointer"
              >
                + Thêm rule
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {saving ? "Đang lưu..." : "Lưu rewrite"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
