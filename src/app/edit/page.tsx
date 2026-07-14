"use client";

import { useState, useEffect, useRef, useCallback, DragEvent } from "react";
import AppShell from "@/components/AppShell";
import ImagePresetChips from "@/components/ImagePresetChips";
import PromptRefineControls from "@/components/PromptRefineControls";

interface Provider {
  id: string;
  name: string;
  is_default: boolean;
  max_edit_images?: number;
  max_resolution?: "2K" | "4K";
}

interface Result {
  id: string;
  url: string;
  prompt: string;
  provider_name: string;
  model: string;
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

const MAX_EDIT_UPLOAD_BYTES = 9.5 * 1024 * 1024;
const MAX_EDIT_UPLOAD_LABEL = "9.5MB";
const LIMITED_2K_MESSAGE = "Model này chỉ hỗ trợ tối đa 2K. Vui lòng chọn 2K hoặc thấp hơn.";
const ALL_RESOLUTION_OPTIONS = [
  { value: "1K", label: "1K (1024px)" },
  { value: "1.5K", label: "1.5K (1536px)" },
  { value: "2K", label: "2K (2048px)" },
  { value: "4K", label: "4K (3840px)" },
];

function totalFileSize(files: File[]) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

export default function EditPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [resolution, setResolution] = useState("1K");
  const [quality, setQuality] = useState("high");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"webp" | "jpg">("webp");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [me, setMe] = useState<MeData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedProvider = providers.find((p) => p.id === providerId);
  const maxEditImages = selectedProvider?.max_edit_images ?? 8;
  const isLimitedTo2K = selectedProvider?.max_resolution === "2K";
  const resolutionOptions = isLimitedTo2K
    ? ALL_RESOLUTION_OPTIONS.filter((opt) => opt.value !== "4K")
    : ALL_RESOLUTION_OPTIONS;
  const walletReady = me !== null;
  const canAfford = walletReady && (me.user.role === "admin" || me.wallet.balance_vnd >= me.wallet.image_price_vnd);

  const fetchProviders = useCallback(async () => {
    const res = await fetch("/api/providers");
    const data = await res.json();
    if (res.ok && data.providers.length > 0) {
      setProviders(data.providers);
      const def = data.providers.find((p: Provider) => p.is_default) || data.providers[0];
      setProviderId(def.id);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (res.ok) setMe(data);
  }, []);

  useEffect(() => { fetchProviders(); fetchMe(); }, [fetchProviders, fetchMe]);

  useEffect(() => {
    if (isLimitedTo2K && resolution === "4K") {
      setResolution("2K");
      setError(LIMITED_2K_MESSAGE);
    }
  }, [isLimitedTo2K, resolution]);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });

  function addFiles(files: File[]) {
    const validFiles = files.filter((f) => f.type.startsWith("image/"));
    if (validFiles.length === 0) {
      setError("Vui lòng chọn file ảnh");
      return;
    }
    const nextFiles = [...imageFiles, ...validFiles];
    if (nextFiles.length > maxEditImages) {
      setError(`Provider này chỉ hỗ trợ chỉnh sửa tối đa ${maxEditImages} ảnh mỗi lần.`);
      return;
    }
    if (totalFileSize(nextFiles) > MAX_EDIT_UPLOAD_BYTES) {
      setError(`Tổng dung lượng ảnh tải lên quá lớn. Vui lòng dùng ảnh dưới ${MAX_EDIT_UPLOAD_LABEL} mỗi lần chỉnh sửa.`);
      return;
    }
    setError("");
    setImageFiles(nextFiles);
    for (const file of validFiles) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    }
  }

  function removeImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  }

  async function handleEdit() {
    if (imageFiles.length === 0 || !prompt.trim() || loading || !providerId) return;
    if (totalFileSize(imageFiles) > MAX_EDIT_UPLOAD_BYTES) {
      setError(`Tổng dung lượng ảnh tải lên quá lớn. Vui lòng dùng ảnh dưới ${MAX_EDIT_UPLOAD_LABEL} mỗi lần chỉnh sửa.`);
      return;
    }
    if (isLimitedTo2K && resolution === "4K") {
      setError(LIMITED_2K_MESSAGE);
      return;
    }
    if (imageFiles.length > maxEditImages) {
      setError(`Provider này chỉ hỗ trợ chỉnh sửa tối đa ${maxEditImages} ảnh mỗi lần.`);
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    for (const file of imageFiles) {
      formData.append("images", file);
    }
    formData.append("prompt", prompt.trim());
    formData.append("provider_id", providerId);
    formData.append("aspect_ratio", aspectRatio);
    formData.append("resolution", resolution);
    formData.append("quality", quality);

    const key = crypto.randomUUID();
    formData.append("idempotency_key", key);

    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      fetchMe();
      window.dispatchEvent(new Event("wallet-refresh"));
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
      <AppShell>
        <main className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-zinc-400 mb-2">Chưa có AI provider nào</p>
          <p className="text-sm text-zinc-500 mb-4">Thêm provider trong phần Cài đặt để bắt đầu</p>
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
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer overflow-hidden ${
              dragging ? "border-blue-500 bg-blue-500/5"
                : imagePreviews.length > 0 ? "border-zinc-700" : "border-zinc-700 hover:border-zinc-600 bg-zinc-900"
            }`}
          >
            {imagePreviews.length > 0 ? (
              <div className="p-3">
                <div className={`grid gap-2 ${imagePreviews.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
                  {imagePreviews.map((preview, i) => (
                    <div key={i} className="relative group">
                      <img src={preview} alt={`Ảnh ${i + 1}`} className={`w-full rounded-lg object-contain ${imagePreviews.length === 1 ? "max-h-96" : "max-h-48"}`} />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-red-600 rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 text-center mt-2">Click để thêm ảnh · Ctrl+V để dán</p>
              </div>
            ) : (
              <div className="py-16 text-center">
                <svg className="mx-auto h-10 w-10 text-zinc-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                <p className="text-sm text-zinc-400">Kéo thả ảnh vào đây, click để chọn, hoặc Ctrl+V để dán</p>
                <p className="text-xs text-zinc-600 mt-1">PNG, JPG, WEBP · Có thể chọn nhiều ảnh</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" multiple={maxEditImages > 1} className="hidden"
              onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length > 0) addFiles(files); e.target.value = ""; }} />
          </div>

          <p className="text-xs text-zinc-600">
            {selectedProvider?.name} · tối đa {maxEditImages} ảnh · tổng dung lượng dưới {MAX_EDIT_UPLOAD_LABEL}
          </p>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mô tả cách bạn muốn chỉnh sửa ảnh..."
            rows={3}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors resize-none text-[15px] leading-relaxed"
          />

          <PromptRefineControls
            prompt={prompt}
            onPromptChange={setPrompt}
            mode="edit"
            aspectRatio={aspectRatio}
            resolution={resolution}
            disabled={loading}
          />

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
              <span className="truncate text-xs text-zinc-600">{selectedProvider?.name} · {aspectRatio} · {resolution}</span>
            </button>
            {showAdvanced && (
              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 px-4 py-4">
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  Provider
                  <select value={providerId} onChange={(e) => setProviderId(e.target.value)}
                    className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-sm cursor-pointer">
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <Select label="Tỷ lệ" value={aspectRatio} onChange={setAspectRatio} options={[
                  { value: "auto", label: "Tự động" },
                  { value: "1:1", label: "Vuông (1:1)" },
                  { value: "3:2", label: "Ngang (3:2)" },
                  { value: "4:3", label: "Ngang cổ điển (4:3)" },
                  { value: "16:9", label: "Ngang rộng (16:9)" },
                  { value: "2:3", label: "Dọc (2:3)" },
                  { value: "3:4", label: "Dọc cổ điển (3:4)" },
                  { value: "9:16", label: "Dọc cao (9:16)" },
                ]} />
                <Select label="Độ phân giải" value={resolution} onChange={setResolution} options={resolutionOptions} />
                <Select label="Chất lượng" value={quality} onChange={setQuality} options={[
                  { value: "standard", label: "Tiêu chuẩn" },
                  { value: "high", label: "Cao" },
                ]} />
                <p className="w-full text-xs text-zinc-600">Cùng giá · “Cao” có thể chậm hơn và chi tiết hơn, tuỳ model.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
            <span>Giá: {formatVnd(me?.wallet.image_price_vnd ?? 100)}/ảnh</span>
            <span>{!walletReady ? "Đang tải số dư..." : me.user.role === "admin" ? "Admin miễn phí" : `Còn ${me.wallet.remaining_images} ảnh`}</span>
          </div>
          {walletReady && !canAfford && (
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              Số dư không đủ, vui lòng liên hệ admin để nạp tiền.
            </div>
          )}
          {walletReady && me.user.role !== "admin" && canAfford && me.wallet.remaining_images > 0 && me.wallet.remaining_images <= 3 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs text-zinc-400">
              Còn {me.wallet.remaining_images} ảnh. Liên hệ admin để nạp thêm khi cần.
            </div>
          )}
          {imageFiles.length > maxEditImages && (
            <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              Provider này chỉ hỗ trợ tối đa {maxEditImages} ảnh. Vui lòng xoá bớt ảnh trước khi chỉnh sửa.
            </div>
          )}

          <button
            onClick={handleEdit}
            disabled={loading || imageFiles.length === 0 || imageFiles.length > maxEditImages || !prompt.trim() || !providerId || !walletReady || !canAfford}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-xl transition-colors text-sm font-medium cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Đang chỉnh sửa...
              </span>
            ) : `Chỉnh sửa ảnh${imageFiles.length > 1 ? ` (${imageFiles.length} ảnh)` : ""}`}
          </button>
          {loading && resolution === "4K" && (
            <p className="text-xs text-zinc-500 text-center">Ảnh độ phân giải cao có thể mất 30-60 giây</p>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{error}</div>
          )}

          {result && (
            <div className="space-y-3 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {imagePreviews.length > 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <p className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">Ảnh gốc{imagePreviews.length > 1 ? ` (${imagePreviews.length})` : ""}</p>
                    <div className={imagePreviews.length > 1 ? "grid grid-cols-2 gap-1 p-1" : ""}>
                      {imagePreviews.map((p, i) => (
                        <img key={i} src={p} alt={`Gốc ${i + 1}`} className="w-full" />
                      ))}
                    </div>
                  </div>
                )}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <p className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">Kết quả</p>
                  <a href={`/api/images/${result.id}`} target="_blank" rel="noopener noreferrer" title="Mở ảnh trong tab mới">
                    <img src={result.url} alt={result.prompt} className="w-full cursor-zoom-in" />
                  </a>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{result.provider_name} · {result.model}</span>
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
                    href={downloadFormat === "jpg" ? `/api/images/${result.id}?format=jpg` : result.url}
                    download={`img-edit-${result.id}.${downloadFormat}`}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors">
                    Tải về
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-600 text-center mt-8">Ctrl+Enter để chỉnh sửa nhanh · Ctrl+V để dán ảnh</p>
      </main>
    </AppShell>
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
