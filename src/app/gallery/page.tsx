"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";

interface ImageRecord {
  id: string;
  prompt: string;
  edit_prompt: string | null;
  provider_name: string;
  model: string;
  size: string | null;
  created_at: string;
}

export default function GalleryPage() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ImageRecord | null>(null);
  const [expandPrompt, setExpandPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [role, setRole] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchImages = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/gallery?page=${p}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Không tải được thư viện ảnh");
        return;
      }
      setImages(data.images);
      setTotalPages(data.totalPages);
      setPage(data.page);
    } catch {
      setError("Không tải được thư viện ảnh");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchImages(1); }, [fetchImages]);

  useEffect(() => {
    fetch("/api/auth").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.role) setRole(d.role);
    });
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) { if (e.key === "Escape") { setSelected(null); setExpandPrompt(false); setCopied(false); } }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    fetchImages(p);
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  async function handleDelete(img: ImageRecord) {
    if (!confirm("Xóa ảnh này khỏi thư viện?")) return;
    setDeletingId(img.id);
    try {
      const res = await fetch(`/api/images/${img.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Không xóa được ảnh");
        return;
      }

      setSelected(null);
      setExpandPrompt(false);
      setCopied(false);
      const nextPage = images.length === 1 && page > 1 ? page - 1 : page;
      await fetchImages(nextPage);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><span className="spinner" /></div>
        ) : images.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-500">Chưa có ảnh nào</p>
            <p className="text-sm text-zinc-600 mt-1">Bắt đầu tạo ảnh ở tab &quot;Tạo ảnh&quot;</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {images.map((img) => (
                <button key={img.id} onClick={() => setSelected(img)}
                  className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden aspect-square cursor-pointer">
                  <img src={`/api/images/${img.id}`} alt={img.prompt} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="text-xs text-zinc-200 line-clamp-2">{img.prompt}</p>
                      <p className="text-[10px] text-zinc-400 mt-1">{img.provider_name}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button onClick={() => goToPage(page - 1)} disabled={page <= 1}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-zinc-300 transition-colors cursor-pointer">
                  ←
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | "...")[]>((acc, p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1]) > 1) acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === "..." ? (
                      <span key={`dots-${i}`} className="px-2 text-zinc-500 text-sm">…</span>
                    ) : (
                      <button key={item} onClick={() => goToPage(item as number)}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                          item === page
                            ? "bg-zinc-600 text-white"
                            : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                        }`}>
                        {item}
                      </button>
                    )
                  )}
                <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-zinc-300 transition-colors cursor-pointer">
                  →
                </button>
              </div>
            )}
          </>
        )}

        {selected && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setSelected(null); setExpandPrompt(false); setCopied(false); }}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden max-w-3xl w-full h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex-1 min-h-0 flex items-center justify-center bg-zinc-950 p-2">
                <a href={`/api/images/${selected.id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex max-w-full max-h-full" title="Mở ảnh trong tab mới">
                  <img src={`/api/images/${selected.id}`} alt={selected.prompt} className="max-w-full max-h-full object-contain cursor-zoom-in" />
                </a>
              </div>
              <div className="p-4 border-t border-zinc-800 space-y-2 shrink-0">
                <div>
                  <p className={`text-sm text-zinc-200 ${expandPrompt ? "max-h-32 overflow-y-auto" : "line-clamp-2"}`}>{selected.prompt}</p>
                  {selected.prompt.length > 100 && (
                    <button onClick={() => setExpandPrompt(!expandPrompt)}
                      className="text-xs text-zinc-400 hover:text-zinc-300 mt-1 cursor-pointer">
                      {expandPrompt ? "Thu gọn" : "Xem thêm"}
                    </button>
                  )}
                </div>
                {selected.edit_prompt && (
                  <p className="text-xs text-zinc-400">Chỉnh sửa: {selected.edit_prompt}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-zinc-500">
                    {selected.provider_name} · {selected.model} · {formatDate(selected.created_at)}
                  </span>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {role === "admin" && (
                      <button onClick={() => handleDelete(selected)} disabled={deletingId === selected.id}
                        className="px-3 py-1.5 bg-red-950/70 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed border border-red-900/60 rounded-lg text-xs text-red-200 transition-colors cursor-pointer">
                        {deletingId === selected.id ? "Đang xóa..." : "Xóa"}
                      </button>
                    )}
                    <button onClick={() => {
                        navigator.clipboard.writeText(selected.prompt);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors cursor-pointer">
                      {copied ? "Copied!" : "Copy prompt"}
                    </button>
                    <button onClick={() => router.push(`/generate?prompt=${encodeURIComponent(selected.prompt)}`)}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors cursor-pointer">
                      Tạo lại
                    </button>
                    <a href={`/api/images/${selected.id}`} download={`img-${selected.id}.png`}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors">
                      Tải về
                    </a>
                    <button onClick={() => { setSelected(null); setExpandPrompt(false); setCopied(false); }}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors cursor-pointer">
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
