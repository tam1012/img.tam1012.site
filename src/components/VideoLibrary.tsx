"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useT } from "@/i18n";

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

const MODEL_TITLES: Record<string, string> = {
  "veo-3.1-generate-001": "Veo 3.1",
  "veo-3.1-fast-generate-001": "Veo 3.1 Fast",
  "veo-3.0-generate-001": "Veo 3.0",
  "veo-3.0-fast-generate-001": "Veo 3.0 Fast",
  "veo-2.0-generate-001": "Veo 2.0",
  "grok-imagine-video": "Grok Video",
  "grok-imagine-video-1.5-preview": "Grok Video 1.5",
};

function modelTitle(model: string) {
  return MODEL_TITLES[model] || model;
}

export default function VideoLibrary() {
  const t = useT();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmVideo, setConfirmVideo] = useState<VideoItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/video/list");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || t("videoLib.loadFailed"));
        return;
      }
      setVideos(data.videos || []);
    } catch {
      setError(t("videoLib.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchVideos();
  }, [fetchVideos]);

  async function handleDownload(url: string, filename: string) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(t("videoLib.downloadFailed"));
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
      setError(e instanceof Error ? e.message : t("videoLib.downloadFailed"));
    }
  }

  async function handleDelete() {
    if (!confirmVideo || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/video/${confirmVideo.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || t("videoLib.deleteFailed"));
        return;
      }
      if (playingId === confirmVideo.id) setPlayingId(null);
      setVideos((prev) => prev.filter((v) => v.id !== confirmVideo.id));
    } catch {
      setError(t("videoLib.deleteFailed"));
    } finally {
      setDeleting(false);
      setConfirmVideo(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {videos.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-500">{t("videoLib.empty")}</p>
          <p className="text-sm text-zinc-600 mt-1">{t("videoLib.emptyHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {videos.map((video) => (
            <div key={video.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              {playingId === video.id ? (
                <video src={video.url} controls autoPlay className="w-full aspect-video bg-black" />
              ) : (
                <button
                  type="button"
                  onClick={() => setPlayingId(video.id)}
                  aria-label={t("videoLib.play", { title: modelTitle(video.model) })}
                  className="group relative flex aspect-video w-full items-center justify-center bg-zinc-800 cursor-pointer"
                >
                  {video.thumbnail_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnail_url}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(event) => {
                        (event.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/10">
                    <svg
                      className="h-12 w-12 text-white/70 drop-shadow transition-colors group-hover:text-white/90"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </button>
              )}
              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-xs text-zinc-300">{video.prompt || t("videoLib.noPrompt")}</p>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {modelTitle(video.model)} · {video.resolution || t("common.default")} · {video.aspect_ratio} ·{" "}
                    {video.duration_seconds}s · {video.mode === "image" ? t("videoLib.fromImage") : t("videoLib.fromText")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void handleDownload(video.url, `video-${video.id}.mp4`)}
                    className="p-1.5 text-zinc-500 transition-colors hover:text-zinc-300 cursor-pointer"
                    title={t("videoLib.download")}
                    aria-label={t("videoLib.downloadAria")}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0-4-4m4 4 4-4M4 18h16" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setConfirmVideo(video)}
                    className="p-1.5 text-zinc-500 transition-colors hover:text-red-400 cursor-pointer"
                    title={t("videoLib.delete")}
                    aria-label={t("videoLib.deleteAria")}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmVideo !== null}
        title={t("videoLib.confirmTitle")}
        description={t("videoLib.confirmDesc")}
        confirmLabel={t("videoLib.hardDelete")}
        tone="danger"
        loading={deleting}
        onCancel={() => setConfirmVideo(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}
