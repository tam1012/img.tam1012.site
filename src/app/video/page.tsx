"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PromptRefineControls from "@/components/PromptRefineControls";

interface VideoItem {
  id: string;
  prompt: string;
  model: string;
  aspect_ratio: string;
  resolution: string;
  duration_seconds: number;
  mode: "text" | "image";
  created_at: string;
  url: string;
  thumbnail_url?: string;
}

interface AccountItem {
  id: string;
  project_id: string;
}

interface WalletInfo {
  balance_vnd: number;
  video_price_vnd: number;
  remaining_videos: number;
}

const ALL_MODEL_OPTIONS = [
  "veo-3.1-generate-001",
  "veo-3.1-fast-generate-001",
  "veo-3.0-generate-001",
  "veo-3.0-fast-generate-001",
  "veo-2.0-generate-001",
  "grok-imagine-video",
  "grok-imagine-video-1.5-preview",
] as const;

const MODEL_META: Record<string, { title: string; blurb: string }> = {
  "veo-3.1-generate-001": { title: "Veo 3.1", blurb: "Chất lượng cao, hỗ trợ âm thanh" },
  "veo-3.1-fast-generate-001": { title: "Veo 3.1 Fast", blurb: "Nhanh hơn, hỗ trợ âm thanh" },
  "veo-3.0-generate-001": { title: "Veo 3.0", blurb: "Model ổn định thế hệ trước" },
  "veo-3.0-fast-generate-001": { title: "Veo 3.0 Fast", blurb: "Ưu tiên tốc độ" },
  "veo-2.0-generate-001": { title: "Veo 2.0", blurb: "Tương thích 720p" },
  "grok-imagine-video": { title: "Grok Video", blurb: "Tạo video từ mô tả" },
  "grok-imagine-video-1.5-preview": { title: "Grok Video 1.5", blurb: "Tạo chuyển động từ ảnh" },
};

const PUBLIC_MODELS = new Set([
  "veo-3.1-generate-001",
  "grok-imagine-video",
  "grok-imagine-video-1.5-preview",
]);

const XAI_MODELS = new Set(["grok-imagine-video", "grok-imagine-video-1.5-preview"]);
const XAI_IMAGE_ONLY = "grok-imagine-video-1.5-preview";
const XAI_TEXT_ONLY = "grok-imagine-video";
const DEFAULT_MODEL = "veo-3.1-generate-001";

const RESOLUTIONS_BY_MODEL: Record<string, { value: string; label: string }[]> = {
  "veo-3.1-generate-001": [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
  ],
  "veo-3.1-fast-generate-001": [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
  ],
  "veo-3.0-generate-001": [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ],
  "veo-3.0-fast-generate-001": [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ],
  "veo-2.0-generate-001": [{ value: "720p", label: "720p" }],
};

const ASPECT_OPTIONS = [
  { value: "16:9", label: "Ngang (16:9)" },
  { value: "9:16", label: "Dọc (9:16)" },
];

const DURATION_OPTIONS = [
  { value: "5", label: "5 giây" },
  { value: "8", label: "8 giây" },
];

const XAI_DURATION_OPTIONS = [
  { value: "5", label: "5 giây" },
  { value: "8", label: "8 giây" },
  { value: "10", label: "10 giây" },
  { value: "12", label: "12 giây" },
  { value: "15", label: "15 giây" },
];

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

function modelTitle(model: string) {
  return MODEL_META[model]?.title || model;
}

export default function VideoPage() {
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [duration, setDuration] = useState("5");
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VideoItem | null>(null);
  const [error, setError] = useState("");

  const isAdmin = role === "admin";
  const roleModelOptions = useMemo(
    () => isAdmin ? ALL_MODEL_OPTIONS : ALL_MODEL_OPTIONS.filter((item) => PUBLIC_MODELS.has(item)),
    [isAdmin]
  );
  const modelOptions = useMemo(
    () => roleModelOptions.filter((item) => mode === "text" ? item !== XAI_IMAGE_ONLY : item !== XAI_TEXT_ONLY),
    [mode, roleModelOptions]
  );
  const resolutionOptions = useMemo(() => {
    const options = RESOLUTIONS_BY_MODEL[model] || [];
    return isAdmin ? options : options.filter((item) => item.value !== "4k");
  }, [model, isAdmin]);
  const isXai = XAI_MODELS.has(model);
  const durationOptions = isXai ? XAI_DURATION_OPTIONS : DURATION_OPTIONS;
  const canAfford = isAdmin || (wallet !== null && wallet.balance_vnd >= wallet.video_price_vnd);

  useEffect(() => {
    if (resolutionOptions.length > 0 && !resolutionOptions.some((item) => item.value === resolution)) {
      setResolution(resolutionOptions[0].value);
    }
  }, [resolutionOptions, resolution]);

  useEffect(() => {
    if (model === XAI_IMAGE_ONLY) setMode("image");
    else if (model === XAI_TEXT_ONLY) setMode("text");
  }, [model]);

  useEffect(() => {
    if (!durationOptions.some((item) => item.value === duration)) {
      setDuration(durationOptions[0].value);
    }
  }, [durationOptions, duration]);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/video/accounts");
    if (res.ok) {
      const data = await res.json();
      const list: AccountItem[] = data.accounts || [];
      setAccounts(list);
      if (list.length > 0) setAccount((current) => current || list[0].id);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    const res = await fetch("/api/me");
    const data = res.ok ? await res.json() : null;
    if (!data?.user) return;
    setRole(data.user.role);
    if (data.wallet) setWallet(data.wallet);
    if (data.user.role === "admin") await fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  function selectMode(nextMode: "text" | "image") {
    setMode(nextMode);
    if (nextMode === "text" && model === XAI_IMAGE_ONLY) setModel(DEFAULT_MODEL);
    if (nextMode === "image" && model === XAI_TEXT_ONLY) setModel(DEFAULT_MODEL);
  }

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setImageFile(file);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(file ? URL.createObjectURL(file) : "");
  }

  async function handleGenerate() {
    if (loading) return;
    if (mode === "image" && !imageFile) {
      setError("Vui lòng chọn ảnh gốc");
      return;
    }
    if (!prompt.trim() && mode === "text") {
      setError("Vui lòng nhập mô tả");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.set("prompt", prompt.trim());
      form.set("model", model);
      form.set("aspectRatio", aspectRatio);
      form.set("resolution", resolution);
      form.set("duration", duration);
      if (isAdmin && account) form.set("account", account);
      if (mode === "image" && imageFile) form.set("image", imageFile);

      const res = await fetch("/api/video/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      await fetchMe();
      window.dispatchEvent(new Event("wallet-refresh"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(url: string, filename: string) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Tải video thất bại");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tải video thất bại");
    }
  }

  if (role === null) {
    return (
      <AppShell>
        <main className="max-w-3xl mx-auto px-4 py-16 text-center text-zinc-500 text-sm">
          Đang tải...
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="space-y-5">
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">Bắt đầu từ</p>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton active={mode === "text"} title="Từ mô tả" description="Biến ý tưởng thành video" onClick={() => selectMode("text")} disabled={loading} />
              <ModeButton active={mode === "image"} title="Từ ảnh" description="Tạo chuyển động cho ảnh" onClick={() => selectMode("image")} disabled={loading} />
            </div>
          </section>

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={mode === "image" ? "Mô tả chuyển động cho video (tuỳ chọn)..." : "Mô tả video bạn muốn tạo..."}
            rows={4}
            disabled={loading}
            className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none transition-colors placeholder-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 disabled:opacity-70"
            autoFocus
          />

          <PromptRefineControls
            prompt={prompt}
            onPromptChange={setPrompt}
            mode="video"
            aspectRatio={aspectRatio}
            resolution={resolution}
            disabled={loading}
          />

          {mode === "image" && (
            <div className="space-y-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-3">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={loading}
                className="block w-full text-sm text-zinc-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-sm file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer disabled:opacity-60"
              />
              {imagePreview && (
                <div className="max-w-xs overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Ảnh gốc" className="w-full" />
                </div>
              )}
            </div>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">Chọn model</p>
              <span className="text-xs text-zinc-600">{modelOptions.length} lựa chọn phù hợp</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {modelOptions.map((item) => {
                const meta = MODEL_META[item];
                const active = model === item;
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setModel(item)}
                    disabled={loading}
                    className={`rounded-xl border p-3 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? "border-blue-500/70 bg-blue-500/10"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/70"
                    }`}
                  >
                    <span className={`block text-sm font-medium ${active ? "text-blue-100" : "text-zinc-200"}`}>{meta.title}</span>
                    <span className="mt-1 block text-xs text-zinc-500">{meta.blurb}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            {resolutionOptions.length > 0 && (
              <Select label="Chất lượng" value={resolution} onChange={setResolution} options={resolutionOptions} disabled={loading} />
            )}
            <Select label="Tỷ lệ" value={aspectRatio} onChange={setAspectRatio} options={ASPECT_OPTIONS} disabled={loading} />
            <Select label="Thời lượng" value={duration} onChange={setDuration} options={durationOptions} disabled={loading} />
          </div>

          {isAdmin && !isXai && accounts.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm text-zinc-400 cursor-pointer"
              >
                <span>{showAdvanced ? "▾" : "▸"} Tuỳ chọn quản trị</span>
                <span className="truncate text-xs text-zinc-600">{accounts.find((item) => item.id === account)?.project_id || "Tài khoản mặc định"}</span>
              </button>
              {showAdvanced && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <Select
                    label="Tài khoản Vertex"
                    value={account}
                    onChange={setAccount}
                    options={accounts.map((item) => ({ value: item.id, label: item.project_id }))}
                    disabled={loading}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
            <span>{isAdmin ? "Chi phí: miễn phí" : `${formatVnd(wallet?.video_price_vnd ?? 0)} / video`}</span>
            <span>{isAdmin ? "Admin" : wallet ? `Còn ${wallet.remaining_videos} video` : "Đang tải số dư..."}</span>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !canAfford || (mode === "text" && !prompt.trim()) || (mode === "image" && !imageFile)}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Đang tạo video...
              </span>
            ) : !canAfford ? "Số dư không đủ" : "Tạo video"}
          </button>
          {loading && (
            <p className="text-center text-xs text-zinc-500">Có thể mất 2–10 phút. Vui lòng không đóng trang.</p>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
          )}

          {result && (
            <div className="space-y-3 pt-4">
              <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                <video src={result.url} controls className="w-full" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">
                  {modelTitle(result.model)} · {result.resolution || "mặc định"} · {result.aspect_ratio} · {result.duration_seconds}s
                </span>
                <button onClick={() => handleDownload(result.url, `video-${result.id}.mp4`)} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 cursor-pointer">
                  Tải về
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function ModeButton({ active, title, description, onClick, disabled }: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
        active ? "border-blue-500/70 bg-blue-500/10" : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
      }`}
    >
      <span className={`block text-sm font-medium ${active ? "text-blue-100" : "text-zinc-200"}`}>{title}</span>
      <span className="mt-1 block text-xs text-zinc-500">{description}</span>
    </button>
  );
}

function Select({ label, value, onChange, options, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
