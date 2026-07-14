"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface Provider {
  id: string;
  name: string;
  api_type: string;
  base_url: string;
  api_key: string;
  model: string;
  is_default: boolean;
  max_edit_images?: number;
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    api_type: "openai",
    base_url: "",
    api_key: "",
    model: "",
    is_default: false,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (res.ok) setProviders(data.providers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  function resetForm() {
    setForm({ name: "", api_type: "openai", base_url: "", api_key: "", model: "", is_default: false });
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  function startEdit(p: Provider) {
    setForm({
      name: p.name,
      api_type: p.api_type,
      base_url: p.base_url,
      api_key: "",
      model: p.model,
      is_default: p.is_default,
    });
    setEditingId(p.id);
    setShowForm(true);
    setError("");
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.model.trim()) {
      setError("Vui lòng nhập tên và model");
      return;
    }
    if (form.api_type === "chatgpt_bridge" && !form.base_url.trim()) {
      setError("ChatGPT Web Bridge bắt buộc có Base URL");
      return;
    }
    const existing = editingId ? providers.find((provider) => provider.id === editingId) : null;
    const needsNewKey = form.api_type !== "vertex" && form.api_type !== "flow" && (
      !editingId
      || !existing
      || existing.api_type === "vertex"
      || (form.api_type === "chatgpt_bridge" && existing.api_type !== "chatgpt_bridge")
    );
    if (needsNewKey && !form.api_key.trim()) {
      setError("Vui lòng nhập API key hoặc token thật cho provider này");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const url = editingId ? `/api/providers/${editingId}` : "/api/providers";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resetForm();
      fetchProviders();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deletingId) return;
    setDeletingId(deleteTarget.id);
    setError("");
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Không xoá được provider");
      setDeleteTarget(null);
      await fetchProviders();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không xoá được provider");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSetDefault(id: string) {
    await fetch(`/api/providers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    fetchProviders();
  }

  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-zinc-100">AI Providers</h1>
          {!showForm && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              + Thêm provider
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><span className="spinner" /></div>
        ) : providers.length === 0 && !showForm ? (
          <div className="text-center py-16 bg-zinc-900 border border-zinc-800 rounded-xl">
            <p className="text-zinc-400 mb-2">Chưa có provider nào</p>
            <p className="text-sm text-zinc-500 mb-4">Thêm provider AI để bắt đầu tạo ảnh</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors cursor-pointer"
            >
              + Thêm provider đầu tiên
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-100">{p.name}</span>
                      {p.is_default && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">mặc định</span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-500 mt-1">
                      {p.api_type === "vertex"
                        ? "Google Vertex AI"
                        : p.api_type === "gemini"
                          ? "Gemini"
                          : p.api_type === "chatgpt_bridge"
                            ? "ChatGPT Web Bridge"
                            : p.api_type === "flow"
                              ? "Google Flow Bridge"
                              : "OpenAI"} · {p.model}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {p.api_type === "vertex"
                        ? "Service account lưu trên server"
                        : p.api_type === "flow"
                          ? "Credential qua env FLOW_BRIDGE_* / FLOW_IMAGE_ROUTE"
                          : "Thông tin xác thực: ••••••••"}
                    </p>
                    {p.base_url && (
                      <p className="text-xs text-zinc-600 mt-0.5 truncate">{p.base_url}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-3 shrink-0">
                    {!p.is_default && (
                      <button
                        onClick={() => handleSetDefault(p.id)}
                        title="Đặt làm mặc định"
                        className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer text-xs"
                      >
                        ★
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(p)}
                      className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                    >
                      Sửa
                    </button>
                    <button
                      onClick={() => setDeleteTarget(p)}
                      disabled={deletingId === p.id}
                      className="px-2 py-1 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === p.id ? "Đang xoá..." : "Xoá"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="mt-6 bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-medium text-zinc-300">
              {editingId ? "Sửa provider" : "Thêm provider mới"}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Tên hiển thị</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: My OpenAI, Google AI..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Loại API</label>
                <select
                  value={form.api_type}
                  onChange={(e) => setForm({ ...form, api_type: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                >
                  <option value="openai">OpenAI-compatible</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="vertex">Google Vertex AI</option>
                  <option value="chatgpt_bridge">ChatGPT Web Bridge</option>
                  <option value="flow">Google Flow Bridge</option>
                </select>
              </div>
            </div>

            {(form.api_type === "openai" || form.api_type === "chatgpt_bridge") && (
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Base URL {form.api_type === "chatgpt_bridge" ? "(bắt buộc)" : "(để trống nếu dùng OpenAI gốc)"}</label>
                <input
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  placeholder={form.api_type === "chatgpt_bridge" ? "http://127.0.0.1:8456" : "https://api.openai.com/v1"}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
            )}

            {form.api_type === "flow" && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
                Flow dùng env <code className="text-zinc-400">FLOW_IMAGE_ROUTE</code> +{" "}
                <code className="text-zinc-400">FLOW_BRIDGE_*</code> trên server. Model gợi ý:{" "}
                <code className="text-zinc-400">flow-nano-banana-2</code>,{" "}
                <code className="text-zinc-400">flow-nano-banana-pro</code>.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {form.api_type !== "vertex" && form.api_type !== "flow" ? (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">{form.api_type === "chatgpt_bridge" ? "Token bridge" : "API Key"}</label>
                  <input
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder={editingId ? "Để trống nếu không đổi" : form.api_type === "chatgpt_bridge" ? "Token từ BRIDGE_ADMIN_TOKEN" : "sk-..."}
                    type="password"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              ) : form.api_type === "vertex" ? (
                <div className="sm:col-span-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
                  Vertex AI dùng service account JSON trên server, không nhập API key ở đây.
                </div>
              ) : (
                <div className="sm:col-span-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
                  Flow không cần API key trong form provider.
                </div>
              )}
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Model</label>
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="VD: gpt-image-1, gemini-2.0-flash-exp"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                className="rounded border-zinc-600 cursor-pointer"
              />
              Đặt làm provider mặc định
            </label>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {saving ? "Đang lưu..." : editingId ? "Cập nhật" : "Thêm provider"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors cursor-pointer"
              >
                Huỷ
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 p-4 bg-zinc-900/50 border border-zinc-800/50 rounded-xl">
          <p className="text-xs text-zinc-500 leading-relaxed">
            <strong className="text-zinc-400">OpenAI-compatible:</strong> dùng cho OpenAI, Azure OpenAI, các proxy/relay API tương thích định dạng OpenAI.
            Để trống Base URL nếu dùng OpenAI gốc.
          </p>
          <p className="text-xs text-zinc-500 leading-relaxed mt-2">
            <strong className="text-zinc-400">Google Gemini:</strong> dùng cho Google AI Studio (Imagen, Gemini).
            Chỉ cần API key và tên model.
          </p>
          <p className="text-xs text-zinc-500 leading-relaxed mt-2">
            <strong className="text-zinc-400">ChatGPT Web Bridge:</strong> provider thử nghiệm nội bộ, gọi service bridge chạy trên VPS. Cần Base URL và token. Không hỗ trợ chỉnh sửa ảnh.
          </p>
        </div>
      </main>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Xoá provider?"
        description={deleteTarget ? `Provider “${deleteTarget.name}” sẽ bị xoá khỏi hệ thống. Hành động này không thể hoàn tác.` : undefined}
        confirmLabel="Xoá provider"
        tone="danger"
        loading={deletingId !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </AppShell>
  );
}
