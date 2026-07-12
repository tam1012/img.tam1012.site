"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AppShell from "@/components/AppShell";
import ImagePresetChips from "@/components/ImagePresetChips";
import PromptRefineControls from "@/components/PromptRefineControls";

interface Provider {
  id: string;
  name: string;
  is_default: boolean;
  max_resolution?: "2K" | "4K";
}

interface ResultImage {
  id: string;
  url: string;
  prompt: string;
  provider_name: string;
  model: string;
}

interface BatchResult {
  images: ResultImage[];
  charged_vnd: number;
  count: number;
  partial?: boolean;
  status?: string;
  retry_after_ms?: number;
}

interface PromptItem {
  prompt: string;
  provider_name: string;
  model: string;
  created_at: string;
}

interface MeData {
  user: { role: "admin" | "user" };
  wallet: {
    balance_vnd: number;
    image_price_vnd: number;
    remaining_images: number;
  };
}

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonSafe(res: Response): Promise<Partial<BatchResult> & { error?: string }> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

function normalizeBatchResult(data: Partial<BatchResult>): BatchResult {
  if (!Array.isArray(data.images)) {
    throw new Error("Server trả về dữ liệu ảnh không hợp lệ");
  }
  return {
    images: data.images,
    charged_vnd: Number(data.charged_vnd) || 0,
    count: Number(data.count) || data.images.length,
    partial: Boolean(data.partial),
  };
}

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [quality, setQuality] = useState("high");
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState("");
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [me, setMe] = useState<MeData | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"webp" | "jpg">("webp");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inFlightRef = useRef(false);
  const selectedProvider = providers.find((p) => p.id === providerId);
  const isLimitedTo2K = selectedProvider?.max_resolution === "2K";
  const walletReady = me !== null;
  const totalCost = (me?.wallet.image_price_vnd ?? 100) * count;
  const canAfford = walletReady && (me.user.role === "admin" || me.wallet.balance_vnd >= totalCost);

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

  const fetchMe = useCallback(async () => {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (res.ok) setMe(data);
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchPrompts();
    fetchMe();
  }, [fetchProviders, fetchPrompts, fetchMe]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (p) setPrompt(p);
  }, []);

  useEffect(() => {
    if (isLimitedTo2K && resolution === "4K") {
      setResolution("2K");
    }
  }, [isLimitedTo2K, resolution]);

  async function handleGenerate() {
    if (inFlightRef.current || !prompt.trim() || !providerId || !walletReady) return;
    if (!canAfford) {
      setError("Số dư không đủ, vui lòng liên hệ admin để nạp tiền.");
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    setError("");
    setResult(null);

    const key = crypto.randomUUID();
    const request = {
      prompt: prompt.trim(),
      provider_id: providerId,
      aspect_ratio: aspectRatio,
      resolution,
      quality,
      count,
      idempotency_key: key,
    };

    try {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 12 * 60 * 1000) {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(request),
        });
        const data = await readJsonSafe(res);

        if (res.status === 202 || data.status === "processing") {
          await sleep(Math.min(Math.max(Number(data.retry_after_ms) || 1500, 800), 5000));
          continue;
        }
        if (!res.ok) throw new Error(data.error || `Lỗi tạo ảnh (HTTP ${res.status})`);

        const nextResult = normalizeBatchResult(data);
        setResult(nextResult);
        void fetchPrompts().catch(() => undefined);
        void fetchMe().catch(() => undefined);
        window.dispatchEvent(new Event("wallet-refresh"));
        return;
      }
      throw new Error("Ảnh vẫn đang xử lý quá lâu. Vui lòng kiểm tra lại thư viện sau ít phút.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      inFlightRef.current = false;
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

  function resetResult() {
    setResult(null);
    textareaRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (providers.length === 0) {
    return (
      <AppShell>
        <main className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-zinc-400 mb-2">Chưa có AI provider nào</p>
          <p className="text-sm text-zinc-500 mb-4">Thêm provider trong phần Cài đặt để bắt đầu tạo ảnh</p>
          <a href="/settings" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors inline-block">
            Đi tới Cài đặt
          </a>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-4">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mô tả hình ảnh bạn muốn tạo..."
            rows={4}
            disabled={loading}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors resize-none text-[15px] leading-relaxed disabled:opacity-70 disabled:cursor-not-allowed"
            autoFocus
          />

          <PromptRefineControls
            prompt={prompt}
            onPromptChange={setPrompt}
            mode="generate"
            aspectRatio={aspectRatio}
            resolution={resolution}
            disabled={loading}
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

          <ImagePresetChips
            aspectRatio={aspectRatio}
            resolution={resolution}
            maxResolution={selectedProvider?.max_resolution}
            disabled={loading}
            onSelect={(nextAspectRatio, nextResolution) => {
              setAspectRatio(nextAspectRatio);
              setResolution(nextResolution);
            }}
          />

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left cursor-pointer"
            >
              <span className="text-sm text-zinc-300">{showAdvanced ? "▾" : "▸"} Tuỳ chọn nâng cao</span>
              <span className="truncate text-xs text-zinc-600">
                {selectedProvider?.name} · {aspectRatio} · {resolution} · {count} ảnh
              </span>
            </button>
            {showAdvanced && (
              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 px-4 py-4">
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  Provider
                  <select
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    disabled={loading}
                    className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <Select label="Tỷ lệ" value={aspectRatio} onChange={setAspectRatio} options={[
                  { value: "1:1", label: "Vuông (1:1)" },
                  { value: "3:2", label: "Ngang (3:2)" },
                  { value: "4:3", label: "Ngang cổ điển (4:3)" },
                  { value: "16:9", label: "Ngang rộng (16:9)" },
                  { value: "2:3", label: "Dọc (2:3)" },
                  { value: "3:4", label: "Dọc cổ điển (3:4)" },
                  { value: "9:16", label: "Dọc cao (9:16)" },
                ]} disabled={loading} />
                <Select label="Độ phân giải" value={resolution} onChange={setResolution} options={[
                  { value: "1K", label: "1K (1024px)" },
                  { value: "1.5K", label: "1.5K (1536px)" },
                  { value: "2K", label: "2K (2048px)" },
                  ...(!isLimitedTo2K ? [{ value: "4K", label: "4K (3840px)" }] : []),
                ]} disabled={loading} />
                <Select label="Chất lượng" value={quality} onChange={setQuality} options={[
                  { value: "standard", label: "Tiêu chuẩn" },
                  { value: "high", label: "Cao" },
                ]} disabled={loading} />
                <Select label="Số lượng" value={String(count)} onChange={(v) => setCount(Number(v))} options={[
                  { value: "1", label: "1 ảnh" },
                  { value: "2", label: "2 ảnh" },
                  { value: "3", label: "3 ảnh" },
                  { value: "4", label: "4 ảnh" },
                  { value: "5", label: "5 ảnh" },
                  { value: "6", label: "6 ảnh" },
                  { value: "7", label: "7 ảnh" },
                  { value: "8", label: "8 ảnh" },
                  { value: "9", label: "9 ảnh" },
                  { value: "10", label: "10 ảnh" },
                ]} disabled={loading} />
                <p className="w-full text-xs text-zinc-600">Cùng giá · “Cao” có thể chậm hơn và chi tiết hơn, tuỳ model.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
            <span>
              {count > 1
                ? `${formatVnd(me?.wallet.image_price_vnd ?? 100)}/ảnh × ${count} = ${formatVnd(totalCost)}`
                : `Giá: ${formatVnd(me?.wallet.image_price_vnd ?? 100)}/ảnh`}
            </span>
            <span>{!walletReady ? "Đang tải số dư..." : me.user.role === "admin" ? "Admin miễn phí" : `Còn ${me.wallet.remaining_images} ảnh`}</span>
          </div>
          {walletReady && !canAfford && (
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              Số dư không đủ{count > 1 ? ` để tạo ${count} ảnh` : ""}, vui lòng liên hệ admin để nạp tiền.
            </div>
          )}
          {walletReady && me.user.role !== "admin" && canAfford && me.wallet.remaining_images > 0 && me.wallet.remaining_images <= 3 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs text-zinc-400">
              Còn {me.wallet.remaining_images} ảnh. Liên hệ admin để nạp thêm khi cần.
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim() || !providerId || !walletReady || !canAfford}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-xl transition-colors text-sm font-medium cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                {count > 1 ? `Đang tạo ${count} ảnh...` : "Đang tạo ảnh..."}
              </span>
            ) : (
              count > 1 ? `Tạo ${count} ảnh` : "Tạo ảnh"
            )}
          </button>
          {loading && resolution === "4K" && (
            <p className="text-xs text-zinc-500 text-center">Ảnh độ phân giải cao có thể mất 30-60 giây</p>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          {result && result.images.length > 0 && (
            <div className="space-y-3 pt-4">
              {result.partial && (
                <p className="text-xs text-amber-400">Một số ảnh bị lỗi, chỉ tạo được {result.images.length} ảnh</p>
              )}
              <div className={result.images.length === 1 ? "" : "grid grid-cols-2 gap-3"}>
                {result.images.map((img) => (
                  <div key={img.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <a href={`/api/images/${img.id}`} target="_blank" rel="noopener noreferrer" title="Mở ảnh trong tab mới">
                      <img src={img.url} alt={img.prompt} className="w-full cursor-zoom-in" />
                    </a>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-[10px] text-zinc-500">{img.provider_name} · {img.model}</span>
                      <div className="flex items-center gap-1">
                        <div className="inline-flex items-center gap-0.5 rounded-md bg-zinc-800 p-0.5">
                          <button onClick={() => setDownloadFormat("webp")}
                            className={`px-1.5 py-1 rounded text-[10px] transition-colors cursor-pointer ${downloadFormat === "webp" ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-700"}`}>
                            WebP
                          </button>
                          <button onClick={() => setDownloadFormat("jpg")}
                            className={`px-1.5 py-1 rounded text-[10px] transition-colors cursor-pointer ${downloadFormat === "jpg" ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-700"}`}>
                            JPG
                          </button>
                        </div>
                        <a
                          href={downloadFormat === "jpg" ? `/api/images/${img.id}?format=jpg` : img.url}
                          download={`img-${img.id}.${downloadFormat}`}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-md text-[10px] text-zinc-300 transition-colors"
                        >
                          Tải
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {result.images.length} ảnh · {result.charged_vnd > 0 ? formatVnd(result.charged_vnd) : "Miễn phí"}
                </span>
                <button
                  onClick={resetResult}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors cursor-pointer"
                >
                  Tạo ảnh khác
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-600 text-center mt-8">Ctrl+Enter để tạo ảnh nhanh</p>
      </main>
    </AppShell>
  );
}

function Select({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed">
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}
