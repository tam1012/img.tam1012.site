"use client";

import { useState } from "react";
import { useT } from "@/i18n";

interface MessageComposerProps {
  /** "broadcast" để gửi tất cả, hoặc userId cụ thể để gửi 1 người. */
  target: "broadcast" | string;
  onSent?: (info: { recipients: number }) => void;
}

export default function MessageComposer({ target, onSent }: MessageComposerProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const isBroadcast = target === "broadcast";

  async function handleSend() {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody || sending) return;

    setSending(true);
    setMsg(null);
    try {
      const url = isBroadcast
        ? "/api/admin/broadcast"
        : `/api/admin/users/${target}/message`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, body: trimmedBody }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Lỗi gửi" });
        return;
      }
      const recipients = data.recipients ?? 1;
      setMsg({
        kind: "ok",
        text: isBroadcast ? t("inbox.sentTo", { count: recipients }) : t("inbox.sentToUser"),
      });
      setTitle("");
      setBody("");
      onSent?.({ recipients });
    } catch {
      setMsg({ kind: "err", text: "Lỗi gửi" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">{t("inbox.composeTitle")}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 200))}
          maxLength={200}
          placeholder={t("inbox.composeTitle")}
          className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">{t("inbox.composeBody")}</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 2000))}
          maxLength={2000}
          rows={3}
          placeholder={t("inbox.composeBody")}
          className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
        />
        <div className="mt-1 text-right text-xs text-zinc-600">{body.length}/2000</div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          {msg && (
            <span className={msg.kind === "ok" ? "text-xs text-emerald-400" : "text-xs text-red-400"}>
              {msg.text}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !title.trim() || !body.trim()}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-xs text-white cursor-pointer disabled:cursor-not-allowed"
        >
          {sending ? t("inbox.sending") : isBroadcast ? t("inbox.sendAll") : t("inbox.sendToUser")}
        </button>
      </div>
    </div>
  );
}
