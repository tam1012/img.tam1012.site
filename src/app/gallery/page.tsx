"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ImageStatsPanel from "@/components/ImageStatsPanel";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import VideoLibrary from "@/components/VideoLibrary";
import { formatDateShort, useLocale, useT } from "@/i18n";

interface ImageRecord {
  id: string;
  prompt: string;
  edit_prompt: string | null;
  provider_name: string;
  model: string;
  size: string | null;
  created_at: string;
  user_label?: string | null;
  cost_vnd?: number;
}

type GalleryScope = "mine" | "all";
type ConfirmState =
  | { type: "idle" }
  | { type: "delete_one"; image: ImageRecord }
  | { type: "bulk_soft" }
  | { type: "bulk_hard" }
  | { type: "hard_all_mine" };

export default function GalleryPage() {
  const t = useT();
  const { locale } = useLocale();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ImageRecord | null>(null);
  const [expandPrompt, setExpandPrompt] = useState(false);
  const [expandEdit, setExpandEdit] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [role, setRole] = useState("");
  const [scope, setScope] = useState<GalleryScope>("mine");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [downloadFormat, setDownloadFormat] = useState<"webp" | "jpg">("webp");
  const [mediaTab, setMediaTab] = useState<"image" | "video">("image");

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({ type: "idle" });

  const isAdmin = role === "admin";
  const showUserLabel = isAdmin && scope === "all";
  const canBulkManage = !isAdmin || scope === "mine";
  const hardKeyword = t("gallery.confirmHardKeyword");

  const fetchImages = useCallback(async (p: number, nextScope: GalleryScope) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/gallery?page=${p}&scope=${nextScope}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || t("gallery.loadFailed"));
        return;
      }
      setImages(data.images);
      setTotalPages(data.totalPages);
      setPage(data.page);
      setTotal(Number(data.total) || 0);
      if (data.scope === "mine" || data.scope === "all") setScope(data.scope);
      if (data.viewer_role === "admin" || data.viewer_role === "user") setRole(data.viewer_role);
    } catch {
      setError(t("gallery.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchImages(1, "mine");
  }, [fetchImages]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user?.role) setRole(d.user.role);
      });
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelected(null);
        setExpandPrompt(false);
        setExpandEdit(false);
        setCopied(false);
      }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    clearSelection();
  }

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    clearSelection();
    fetchImages(p, scope);
  }

  function switchScope(next: GalleryScope) {
    if (next === scope) return;
    setScope(next);
    setSelected(null);
    setExpandPrompt(false);
    setExpandEdit(false);
    setCopied(false);
    exitSelectMode();
    window.scrollTo({ top: 0, behavior: "smooth" });
    fetchImages(1, next);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    setSelectedIds(new Set(images.map((img) => img.id)));
  }

  async function deleteOne(img: ImageRecord) {
    setDeletingId(img.id);
    setError("");
    try {
      const res = await fetch(`/api/images/${img.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || t("gallery.deleteFailed"));
        return;
      }

      setSelected(null);
      setExpandPrompt(false);
      setExpandEdit(false);
      setCopied(false);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(img.id);
        return next;
      });
      const nextPage = images.length === 1 && page > 1 ? page - 1 : page;
      await fetchImages(nextPage, scope);
    } finally {
      setDeletingId(null);
      setConfirmState({ type: "idle" });
    }
  }

  async function handleBulkSoftDelete() {
    if (!canBulkManage || selectedIds.size === 0 || bulkBusy) return;

    setBulkBusy(true);
    setError("");
    try {
      const res = await fetch("/api/images/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "soft", ids: [...selectedIds] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || t("gallery.bulkDeleteFailed"));
        return;
      }
      clearSelection();
      setSelected(null);
      await fetchImages(page, scope);
    } catch {
      setError(t("gallery.bulkDeleteFailed"));
    } finally {
      setBulkBusy(false);
      setConfirmState({ type: "idle" });
    }
  }

  async function handleBulkHardDeleteSelected() {
    if (!canBulkManage || selectedIds.size === 0 || bulkBusy) return;

    setBulkBusy(true);
    setError("");
    try {
      const res = await fetch("/api/images/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "hard", ids: [...selectedIds] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || t("gallery.hardBulkFailed"));
        return;
      }
      clearSelection();
      setSelected(null);
      await fetchImages(1, scope);
    } catch {
      setError(t("gallery.hardBulkFailed"));
    } finally {
      setBulkBusy(false);
      setConfirmState({ type: "idle" });
    }
  }

  async function handleHardDeleteAllMine() {
    if (!canBulkManage || bulkBusy) return;

    setBulkBusy(true);
    setError("");
    try {
      const res = await fetch("/api/images/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "hard_all_mine", confirm: "XOA" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || t("gallery.hardAllFailed"));
        return;
      }
      exitSelectMode();
      setSelected(null);
      await fetchImages(1, "mine");
    } catch {
      setError(t("gallery.hardAllFailed"));
    } finally {
      setBulkBusy(false);
      setConfirmState({ type: "idle" });
    }
  }

  async function handleConfirm() {
    if (confirmState.type === "delete_one") {
      await deleteOne(confirmState.image);
    } else if (confirmState.type === "bulk_soft") {
      await handleBulkSoftDelete();
    } else if (confirmState.type === "bulk_hard") {
      await handleBulkHardDeleteSelected();
    } else if (confirmState.type === "hard_all_mine") {
      await handleHardDeleteAllMine();
    }
  }

  function onCardClick(img: ImageRecord) {
    if (selectMode && canBulkManage) {
      toggleSelect(img.id);
      return;
    }
    setSelected(img);
  }

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
            <button
              type="button"
              onClick={() => setMediaTab("image")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                mediaTab === "image" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t("gallery.images")}
            </button>
            <button
              type="button"
              onClick={() => setMediaTab("video")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                mediaTab === "video" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t("gallery.videos")}
            </button>
          </div>
          {isAdmin && mediaTab === "image" ? (
            <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
              <button
                type="button"
                onClick={() => switchScope("mine")}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                  scope === "mine" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t("gallery.mine")}
              </button>
              <button
                type="button"
                onClick={() => switchScope("all")}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                  scope === "all" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t("gallery.all")}
              </button>
            </div>
          ) : null}
        </div>

        {mediaTab === "video" ? (
          <VideoLibrary />
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <div className="mb-4">
              <ImageStatsPanel
                scope={isAdmin && scope === "all" ? "all" : "mine"}
                title={isAdmin && scope === "all" ? t("gallery.statsAll") : t("gallery.statsMine")}
              />
            </div>

            {canBulkManage && (
              <div className="mb-6 flex flex-wrap items-center gap-2">
                {!selectMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectMode(true)}
                      disabled={loading || images.length === 0}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-sm text-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {t("gallery.multiSelect")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmState({ type: "hard_all_mine" })}
                      disabled={bulkBusy || total === 0}
                      className="px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/70 border border-red-900/50 disabled:opacity-40 text-sm text-red-200 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {t("gallery.hardDeleteAll")}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-zinc-400">{t("gallery.selectedCount", { count: selectedIds.size })}</span>
                    <button
                      type="button"
                      onClick={selectAllOnPage}
                      disabled={bulkBusy || images.length === 0}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {t("gallery.selectPage")}
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      disabled={bulkBusy || selectedIds.size === 0}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-300 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {t("gallery.clearSelection")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmState({ type: "bulk_soft" })}
                      disabled={bulkBusy || selectedIds.size === 0}
                      className="px-3 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-900/60 disabled:opacity-40 text-xs text-red-200 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {bulkBusy ? t("common.deleting") : t("gallery.deleteSelected")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmState({ type: "bulk_hard" })}
                      disabled={bulkBusy || selectedIds.size === 0}
                      className="px-3 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-900/60 disabled:opacity-40 text-xs text-red-200 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {t("gallery.hardDeleteSelected")}
                    </button>
                    <button
                      type="button"
                      onClick={exitSelectMode}
                      disabled={bulkBusy}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-400 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {t("gallery.exitSelect")}
                    </button>
                  </>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <span className="spinner" />
              </div>
            ) : images.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-zinc-500">
                  {isAdmin && scope === "all" ? t("gallery.emptyAll") : t("gallery.empty")}
                </p>
                {!(isAdmin && scope === "all") && (
                  <p className="text-sm text-zinc-600 mt-1">{t("gallery.emptyHint")}</p>
                )}
              </div>
            ) : (
              <>
                {selectMode && canBulkManage && (
                  <p className="mb-3 text-xs text-zinc-500">{t("gallery.selectHint")}</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {images.map((img) => {
                    const checked = selectedIds.has(img.id);
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => onCardClick(img)}
                        className={`group relative bg-zinc-900 border rounded-xl overflow-hidden aspect-square cursor-pointer ${
                          checked ? "border-blue-500 ring-2 ring-blue-500/40" : "border-zinc-800"
                        }`}
                      >
                        <img
                          src={`/api/images/${img.id}?thumb=1`}
                          alt={img.prompt}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                        {selectMode && canBulkManage && (
                          <span
                            className={`absolute top-2 left-2 w-5 h-5 rounded border flex items-center justify-center text-[11px] ${
                              checked
                                ? "bg-blue-600 border-blue-400 text-white"
                                : "bg-black/50 border-zinc-500 text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <p className="text-xs text-zinc-200 line-clamp-2">{img.prompt}</p>
                            <p className="text-[10px] text-zinc-400 mt-1">
                              {img.provider_name}
                              {showUserLabel && img.user_label ? ` · ${img.user_label}` : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-8">
                    <button
                      onClick={() => goToPage(page - 1)}
                      disabled={page <= 1}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-zinc-300 transition-colors cursor-pointer"
                    >
                      ←
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                      .reduce<(number | "...")[]>((acc, p, i, arr) => {
                        if (i > 0 && p - arr[i - 1] > 1) acc.push("...");
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((item, i) =>
                        item === "..." ? (
                          <span key={`dots-${i}`} className="px-2 text-zinc-500 text-sm">
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            onClick={() => goToPage(item as number)}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                              item === page ? "bg-zinc-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                            }`}
                          >
                            {item}
                          </button>
                        )
                      )}
                    <button
                      onClick={() => goToPage(page + 1)}
                      disabled={page >= totalPages}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-zinc-300 transition-colors cursor-pointer"
                    >
                      →
                    </button>
                  </div>
                )}
              </>
            )}

            {selected && (
              <div
                className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-4"
                onClick={() => {
                  setSelected(null);
                  setExpandPrompt(false);
                  setExpandEdit(false);
                  setCopied(false);
                }}
              >
                <div
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden max-w-3xl w-full h-[90vh] max-h-full flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex-1 min-h-0 flex items-center justify-center bg-zinc-950 p-2">
                    <a
                      href={`/api/images/${selected.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full max-h-full"
                      title={t("common.openInNewTab")}
                    >
                      <img
                        src={`/api/images/${selected.id}`}
                        alt={selected.prompt}
                        className="max-w-full max-h-full object-contain cursor-zoom-in"
                        decoding="async"
                      />
                    </a>
                  </div>
                  <div className="p-4 border-t border-zinc-800 space-y-2 shrink-0">
                    <div>
                      <p className={`text-sm text-zinc-200 ${expandPrompt ? "max-h-32 overflow-y-auto" : "line-clamp-2"}`}>
                        {selected.prompt}
                      </p>
                      {selected.prompt.length > 100 && (
                        <button
                          onClick={() => setExpandPrompt(!expandPrompt)}
                          className="text-xs text-zinc-400 hover:text-zinc-300 mt-1 cursor-pointer"
                        >
                          {expandPrompt ? t("gallery.collapse") : t("gallery.expand")}
                        </button>
                      )}
                    </div>
                    {selected.edit_prompt && (
                      <div>
                        <p className={`text-xs text-zinc-400 ${expandEdit ? "max-h-32 overflow-y-auto" : "line-clamp-2"}`}>
                          <span className="text-zinc-500">{t("gallery.editPrefix")}</span>
                          {selected.edit_prompt}
                        </p>
                        {selected.edit_prompt.length > 100 && (
                          <button
                            onClick={() => setExpandEdit(!expandEdit)}
                            className="text-xs text-zinc-500 hover:text-zinc-400 mt-1 cursor-pointer"
                          >
                            {expandEdit ? t("gallery.collapse") : t("gallery.expand")}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-zinc-500">
                        {selected.provider_name} · {selected.model}
                        {showUserLabel && selected.user_label ? ` · ${selected.user_label}` : ""} ·{" "}
                        {formatDateShort(selected.created_at, locale)}
                      </span>
                      <div className="flex gap-2 flex-wrap justify-end">
                        <button
                          onClick={() => setConfirmState({ type: "delete_one", image: selected })}
                          disabled={deletingId === selected.id}
                          className="px-3 py-1.5 bg-red-950/70 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed border border-red-900/60 rounded-lg text-xs text-red-200 transition-colors cursor-pointer"
                        >
                          {deletingId === selected.id ? t("common.deleting") : t("common.delete")}
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(selected.prompt);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors cursor-pointer"
                        >
                          {copied ? "Copied!" : "Copy prompt"}
                        </button>
                        <button
                          onClick={() => router.push(`/generate?prompt=${encodeURIComponent(selected.prompt)}`)}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors cursor-pointer"
                        >
                          {t("gallery.recreate")}
                        </button>
                        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 p-0.5">
                          <button
                            onClick={() => setDownloadFormat("webp")}
                            className={`px-2 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                              downloadFormat === "webp" ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-700"
                            }`}
                          >
                            WebP
                          </button>
                          <button
                            onClick={() => setDownloadFormat("jpg")}
                            className={`px-2 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                              downloadFormat === "jpg" ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-700"
                            }`}
                          >
                            JPG
                          </button>
                        </div>
                        <a
                          href={
                            downloadFormat === "jpg"
                              ? `/api/images/${selected.id}?format=jpg`
                              : `/api/images/${selected.id}`
                          }
                          download={`img-${selected.id}.${downloadFormat}`}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                        >
                          {t("common.download")}
                        </a>
                        <button
                          onClick={() => {
                            setSelected(null);
                            setExpandPrompt(false);
                            setExpandEdit(false);
                            setCopied(false);
                          }}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors cursor-pointer"
                        >
                          {t("common.close")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <ConfirmDialog
              open={confirmState.type !== "idle"}
              title={
                confirmState.type === "delete_one"
                  ? t("gallery.confirmDeleteOneTitle")
                  : confirmState.type === "bulk_soft"
                    ? t("gallery.confirmBulkSoftTitle", { count: selectedIds.size })
                    : confirmState.type === "bulk_hard"
                      ? t("gallery.confirmBulkHardTitle", { count: selectedIds.size })
                      : t("gallery.confirmHardAllTitle")
              }
              description={
                confirmState.type === "delete_one"
                  ? t("gallery.confirmDeleteOneDesc")
                  : confirmState.type === "bulk_soft"
                    ? t("gallery.confirmBulkSoftDesc")
                    : confirmState.type === "bulk_hard"
                      ? t("gallery.confirmBulkHardDesc")
                      : t("gallery.confirmHardAllDesc", { count: total })
              }
              confirmLabel={
                confirmState.type === "bulk_hard" || confirmState.type === "hard_all_mine"
                  ? t("gallery.hardDelete")
                  : t("common.delete")
              }
              tone="danger"
              requireText={
                confirmState.type === "bulk_hard" || confirmState.type === "hard_all_mine" ? hardKeyword : undefined
              }
              loading={deletingId !== null || bulkBusy}
              onCancel={() => setConfirmState({ type: "idle" })}
              onConfirm={handleConfirm}
            />
          </>
        )}
      </main>
    </AppShell>
  );
}
