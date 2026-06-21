"use client";

import { useState, useEffect, useRef, useCallback, DragEvent } from "react";
import Header from "@/components/Header";

interface Provider {
  id: string;
  name: string;
  is_default: boolean;
}

interface Result {
  id: string;
  url: string;
  prompt: string;
  provider_name: string;
  model: string;
}

export default function EditPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("square");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProviders = useCallback(async () => {
    const res = await fetch("/api/providers");
    const data = await res.json();
    if (res.ok && data.providers.length > 0) {
      setProviders(data.providers);
      const def = data.providers.find((p: Provider) => p.is_default) || data.providers[0];
      setProviderId(def.id);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Vui lòng chọn file ảnh");
      return;
    }
    setImageFile(file);
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleEdit() {
    if (!imageFile || !prompt.trim() || loading || !providerId) return;
    setLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("image", imageFile);
    formData.append("prompt", prompt.trim());
    formData.append("provider_id", providerId);
    formData.append("size", size);

    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleEdit();
  }

  if (providers.length === 0) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-zinc-400 mb-2">Chưa có AI provider nào</p>
          <p className="text-sm text-zinc-500 mb-4">Thêm provider trong phần Cài đặt để bắt đầu</p>
          <a href="/settings" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors inline-block">
            Đi tới Cài đặt
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer overflow-hidden ${
              dragging ? "border-blue-500 bg-blue-500/5"
                : imagePreview ? "border-zinc-700" : "border-zinc-700 hover:border-zinc-600 bg-zinc-900"
            }`}
          >
            {imagePreview ? (
              <div className="relative">
                <img src={imagePreview} alt="Ảnh gốc" className="w-full max-h-96 object-contain" />
                <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-sm text-white bg-zinc-800/80 px-3 py-1.5 rounded-lg">Đổi ảnh</span>
                </div>
              </div>
            ) : (
              <div className="py-16 text-center">
                <svg className="mx-auto h-10 w-10 text-zinc-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                <p className="text-sm text-zinc-400">Kéo thả ảnh vào đây hoặc click để chọn</p>
                <p className="text-xs text-zinc-600 mt-1">PNG, JPG, WEBP</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mô tả cách bạn muốn chỉnh sửa ảnh..."
            rows={3}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors resize-none text-[15px] leading-relaxed"
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Provider
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer">
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Kích thước
              <select value={size} onChange={(e) => setSize(e.target.value)}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer">
                <option value="square">Vuông (1:1)</option>
                <option value="landscape">Ngang (3:2)</option>
                <option value="portrait">Dọc (2:3)</option>
              </select>
            </label>
          </div>

          <button
            onClick={handleEdit}
            disabled={loading || !imageFile || !prompt.trim() || !providerId}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-xl transition-colors text-sm font-medium cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Đang chỉnh sửa...
              </span>
            ) : "Chỉnh sửa ảnh"}
          </button>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{error}</div>
          )}

          {result && (
            <div className="space-y-3 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {imagePreview && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <p className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">Ảnh gốc</p>
                    <img src={imagePreview} alt="Gốc" className="w-full" />
                  </div>
                )}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <p className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">Kết quả</p>
                  <img src={result.url} alt={result.prompt} className="w-full" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{result.provider_name} · {result.model}</span>
                <a href={result.url} download={`img-edit-${result.id}.png`}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors">
                  Tải về
                </a>
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-600 text-center mt-8">Ctrl+Enter để chỉnh sửa nhanh</p>
      </main>
    </div>
  );
}
