"use client";

import { FormEvent, useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  requireText?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Xác nhận",
  cancelLabel = "Huỷ",
  tone = "default",
  requireText,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open, requireText]);

  const canConfirm = !loading && (!requireText || typed.trim() === requireText);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canConfirm) void onConfirm();
  }

  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm" disableOverlayClose={loading}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {description && <p className="text-sm leading-relaxed text-zinc-400">{description}</p>}
        {requireText && (
          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">
              Gõ <strong className="font-semibold text-zinc-300">{requireText}</strong> để xác nhận
            </label>
            <input
              data-autofocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            data-autofocus={!requireText ? true : undefined}
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500 cursor-pointer ${
              tone === "danger" ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {loading ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
