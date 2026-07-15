"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PromptRefineControls from "@/components/PromptRefineControls";
import { formatVnd, useLocale, useT, type MessageKey } from "@/i18n";

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

const MODEL_TITLE: Record<string, string> = {
  "veo-3.1-generate-001": "Veo 3.1",
  "veo-3.1-fast-generate-001": "Veo 3.1 Fast",
  "veo-3.0-generate-001": "Veo 3.0",
  "veo-3.0-fast-generate-001": "Veo 3.0 Fast",
  "veo-2.0-generate-001": "Veo 2.0",
  "grok-imagine-video": "Grok Video",
  "grok-imagine-video-1.5-preview": "Grok Video 1.5",
};

const MODEL_BLURB_KEY: Record<string, MessageKey> = {
  "veo-3.1-generate-001": "video.blurbVeo31",
  "veo-3.1-fast-generate-001": "video.blurbVeo31Fast",
  "veo-3.0-generate-001": "video.blurbVeo30",
  "veo-3.0-fast-generate-001": "video.blurbVeo30Fast",
  "veo-2.0-generate-001": "video.blurbVeo20",
  "grok-imagine-video": "video.blurbGrok",
  "grok-imagine-video-1.5-preview": "video.blurbGrok15",
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

function modelTitle(model: string) {
  return MODEL_TITLE[model] || model;
}

export default function VideoPage() {
  const t = useT();
  const { locale } = useLocale();
  const money = (value: number) => formatVnd(value, locale);
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
    () => (isAdmin ? ALL_MODEL_OPTIONS : ALL_MODEL_OPTIONS.filter((item) => PUBLIC_MODELS.has(item))),
    [isAdmin]
  );
  const modelOptions = useMemo(
    () => roleModelOptions.filter((item) => (mode === "text" ? item !== XAI_IMAGE_ONLY : item !== XAI_TEXT_ONLY)),
    [mode, roleModelOptions]
  );
  const resolutionOptions = useMemo(() => {
    const options = RESOLUTIONS_BY_MODEL[model] || [];
    return isAdmin ? options : options.filter((item) => item.value !== "4k");
  }, [model, isAdmin]);
  const isXai = XAI_MODELS.has(model);
  const durationOptions = useMemo(() => {
    const values = isXai ? ["5", "8", "10", "12", "15"] : ["5", "8"];
    return values.map((n) => ({ value: n, label: t("video.seconds", { n }) }));
  }, [isXai, t]);
  const canAfford = isAdmin || (wallet !== null && wallet.balance_vnd >= wallet.video_price_vnd);
  const aspectOptions = [
    { value: "16:9", label: t("common.ratioLandscape169Short") },
    { value: "9:16", label: t("common.ratioPortrait916Short") },
  ];

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
      setError(t("video.needImage"));
      return;
    }
    if (!prompt.trim() && mode === "text") {
      setError(t("video.needPrompt"));
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
      setError(e instanceof Error ? e.message : t("common.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(url: string, filename: string) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(t("video.downloadFailed"));
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
      setError(e instanceof Error ? e.message : t("video.downloadFailed"));
    }
  }

  if (role === null) {
    return (
      <AppShell>
        <main className="max-w-3xl mx-auto px-4 py-16 text-center text-zinc-500 text-sm">{t("common.loading")}</main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="space-y-5">
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">{t("video.startFrom")}</p>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === "text"}
                title={t("video.fromText")}
                description={t("video.fromTextDesc")}
                onClick={() => selectMode("text")}
                disabled={loading}
              />
              <ModeButton
                active={mode === "image"}
                title={t("video.fromImage")}
                description={t("video.fromImageDesc")}
                onClick={() => selectMode("image")}
                disabled={loading}
              />
            </div>
          </section>

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={mode === "image" ? t("video.placeholderImage") : t("video.placeholderText")}
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
                  <img src={imagePreview} alt={t("video.sourceAlt")} className="w-full" />
                </div>
              )}
            </div>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">{t("video.chooseModel")}</p>
              <span className="text-xs text-zinc-600">{t("video.modelChoices", { count: modelOptions.length })}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {modelOptions.map((item) => {
                const active = model === item;
                const blurbKey = MODEL_BLURB_KEY[item];
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
                    <span className={`block text-sm font-medium ${active ? "text-blue-100" : "text-zinc-200"}`}>
                      {modelTitle(item)}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">{blurbKey ? t(blurbKey) : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            {resolutionOptions.length > 0 && (
              <Select
                label={t("common.quality")}
                value={resolution}
                onChange={setResolution}
                options={resolutionOptions}
                disabled={loading}
              />
            )}
            <Select label={t("common.aspectRatio")} value={aspectRatio} onChange={setAspectRatio} options={aspectOptions} disabled={loading} />
            <Select label={t("video.duration")} value={duration} onChange={setDuration} options={durationOptions} disabled={loading} />
          </div>

          {isAdmin && !isXai && accounts.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm text-zinc-400 cursor-pointer"
              >
                <span>
                  {showAdvanced ? "▾" : "▸"} {t("video.adminOptions")}
                </span>
                <span className="truncate text-xs text-zinc-600">
                  {accounts.find((item) => item.id === account)?.project_id || t("video.defaultAccount")}
                </span>
              </button>
              {showAdvanced && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <Select
                    label={t("video.vertexAccount")}
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
            <span>
              {isAdmin ? t("video.freeCost") : t("video.pricePerVideo", { price: money(wallet?.video_price_vnd ?? 0) })}
            </span>
            <span>
              {isAdmin
                ? t("common.admin")
                : wallet
                  ? t("common.remainingVideos", { count: wallet.remaining_videos })
                  : t("common.balanceLoading")}
            </span>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !canAfford || (mode === "text" && !prompt.trim()) || (mode === "image" && !imageFile)}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                {t("video.creating")}
              </span>
            ) : !canAfford ? (
              t("video.insufficient")
            ) : (
              t("video.create")
            )}
          </button>
          {loading && <p className="text-center text-xs text-zinc-500">{t("video.waitHint")}</p>}

          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}

          {result && (
            <div className="space-y-3 pt-4">
              <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                <video src={result.url} controls className="w-full" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">
                  {modelTitle(result.model)} · {result.resolution || t("common.default")} · {result.aspect_ratio} ·{" "}
                  {result.duration_seconds}s
                </span>
                <button
                  onClick={() => handleDownload(result.url, `video-${result.id}.mp4`)}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 cursor-pointer"
                >
                  {t("common.download")}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function ModeButton({
  active,
  title,
  description,
  onClick,
  disabled,
}: {
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

function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
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
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
