"use client";

import { useState } from "react";
import Header from "@/components/Header";

interface Result {
  id: string;
  url: string;
  prompt: string;
  provider: string;
  model: string;
}

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("google");
  const [size, setSize] = useState("square");
  const [quality, setQuality] = useState("high");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), provider, size, quality }),
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
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
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

          <div className="flex flex-wrap items-center gap-3">
            <Select
              label="Provider"
              value={provider}
              onChange={setProvider}
              options={[
                { value: "google", label: "Google Gemini" },
                { value: "openai", label: "OpenAI" },
              ]}
            />
            <Select
              label="Kích thước"
              value={size}
              onChange={setSize}
              options={[
                { value: "square", label: "Vuông (1:1)" },
                { value: "landscape", label: "Ngang (3:2)" },
                { value: "portrait", label: "Dọc (2:3)" },
              ]}
            />
            <Select
              label="Chất lượng"
              value={quality}
              onChange={setQuality}
              options={[
                { value: "standard", label: "Tiêu chuẩn" },
                { value: "high", label: "Cao" },
              ]}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
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
                <img
                  src={result.url}
                  alt={result.prompt}
                  className="w-full"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {result.provider === "google" ? "Google Gemini" : "OpenAI"} · {result.model}
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

        <p className="text-xs text-zinc-600 text-center mt-8">
          Ctrl+Enter để tạo ảnh nhanh
        </p>
      </main>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
