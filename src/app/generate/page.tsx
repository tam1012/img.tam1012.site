"use client";

import { useState, useEffect, useCallback } from "react";
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

interface PromptItem {
  prompt: string;
  provider_name: string;
  model: string;
  created_at: string;
}

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [quality, setQuality] = useState("high");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fetchProviders = useCallback(async () => {
    const res = await fetch("/api/providers");
    const data = await res.json();
    if (res.ok && data.providers.length > 0) {
      setProviders(data.providers);
      const def = data.providers.find((p: Provider) => p.is_default) || data.providers[0];
      setProviderId(def.id);
    }
  }, []);

  const fetchPrompts = useCallback(async () => {
    const res = await fetch("/api/prompts");
    const data = await res.json();
    if (res.ok) setPrompts(data.prompts);
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchPrompts();
  }, [fetchProviders, fetchPrompts]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (p) setPrompt(p);
  }, []);

  async function handleGenerate() {
    if (!prompt.trim() || loading || !providerId) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), provider_id: providerId, aspect_ratio: aspectRatio, resolution, quality }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      fetchPrompts();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }

  function usePrompt(p: string) {
    setPrompt(p);
    setShowHistory(false);
  }

  if (providers.length === 0) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-zinc-400 mb-2">Chưa có AI provider nào</p>
          <p className="text-sm text-zinc-500 mb-4">Thêm provider trong phần Cài đặt để bắt đầu tạo ảnh</p>
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
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mô tả hình ảnh bạn muốn tạo..."
            rows={4}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors resize-none text-[15px] leading-relaxed"
            autoFocus
          />

          {/* Prompt history toggle */}
          {prompts.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                {showHistory ? "▾ Ẩn lịch sử prompt" : "▸ Lịch sử prompt"} ({prompts.length})
              </button>
              {showHistory && (
                <div className="mt-2 max-h-48 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/50">
                  {prompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => usePrompt(p.prompt)}
                      className="w-full text-left px-4 py-2.5 hover:bg-zinc-800/50 transition-colors cursor-pointer group"
                    >
                      <p className="text-sm text-zinc-300 line-clamp-2 group-hover:text-zinc-100">{p.prompt}</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {p.provider_name} · {p.model}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Provider
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <Select label="Tỷ lệ" value={aspectRatio} onChange={setAspectRatio} options={[
              { value: "1:1", label: "Vuông (1:1)" },
              { value: "3:2", label: "Ngang (3:2)" },
              { value: "16:9", label: "Ngang rộng (16:9)" },
              { value: "2:3", label: "Dọc (2:3)" },
              { value: "9:16", label: "Dọc cao (9:16)" },
            ]} />
            <Select label="Độ phân giải" value={resolution} onChange={setResolution} options={[
              { value: "1K", label: "1K (1024px)" },
              { value: "1.5K", label: "1.5K (1536px)" },
              { value: "2K", label: "2K (2048px)" },
              { value: "4K", label: "4K (3840px)" },
            ]} />
            <Select label="Chất lượng" value={quality} onChange={setQuality} options={[
              { value: "standard", label: "Tiêu chuẩn" },
              { value: "high", label: "Cao" },
            ]} />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim() || !providerId}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-xl transition-colors text-sm font-medium cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Đang tạo ảnh...
              </span>
            ) : (
              "Tạo ảnh"
            )}
          </button>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-3 pt-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <img src={result.url} alt={result.prompt} className="w-full" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {result.provider_name} · {result.model}
                </span>
                <a
                  href={result.url}
                  download={`img-${result.id}.png`}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
                >
                  Tải về
                </a>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-600 text-center mt-8">Ctrl+Enter để tạo ảnh nhanh</p>
      </main>
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer">
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}
