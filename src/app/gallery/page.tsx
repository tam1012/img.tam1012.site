"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";

interface ImageRecord {
  id: string;
  prompt: string;
  edit_prompt: string | null;
  provider: string;
  model: string;
  size: string | null;
  created_at: string;
}

export default function GalleryPage() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ImageRecord | null>(null);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch("/api/gallery");
      const data = await res.json();
      if (res.ok) setImages(data.images);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="spinner" />
          </div>
        ) : images.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-500">Chưa có ảnh nào</p>
            <p className="text-sm text-zinc-600 mt-1">Bắt đầu tạo ảnh ở tab &quot;Tạo ảnh&quot;</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {images.map((img) => (
              <button
                key={img.id}
                onClick={() => setSelected(img)}
                className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden aspect-square cursor-pointer"
              >
                <img
                  src={`/api/images/${img.id}`}
                  alt={img.prompt}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs text-zinc-200 line-clamp-2">{img.prompt}</p>
                    <p className="text-[10px] text-zinc-400 mt-1">
                      {img.provider === "google" ? "Gemini" : "OpenAI"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Modal */}
        {selected && (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <div
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden max-w-3xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="overflow-auto flex-1">
                <img
                  src={`/api/images/${selected.id}`}
                  alt={selected.prompt}
                  className="w-full"
                />
              </div>
              <div className="p-4 border-t border-zinc-800 space-y-2">
                <p className="text-sm text-zinc-200">{selected.prompt}</p>
                {selected.edit_prompt && (
                  <p className="text-xs text-zinc-400">Chỉnh sửa: {selected.edit_prompt}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-zinc-500">
                    {selected.provider === "google" ? "Google Gemini" : "OpenAI"} · {selected.model} · {formatDate(selected.created_at)}
                  </span>
                  <div className="flex gap-2">
                    <a
                      href={`/api/images/${selected.id}`}
                      download={`img-${selected.id}.png`}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                    >
                      Tải về
                    </a>
                    <button
                      onClick={() => setSelected(null)}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors cursor-pointer"
                    >
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
