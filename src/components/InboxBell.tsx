"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import Modal from "@/components/ui/Modal";
type Message = {
  id: string;
  title: string;
  body: string;
  scope: "single" | "broadcast";
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return locale === "vi" ? "vừa xong" : "just now";
  if (min < 60) return locale === "vi" ? `${min} phút trước` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === "vi" ? `${hr} giờ trước` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return locale === "vi" ? `${day} ngày trước` : `${day}d ago`;
}

export default function InboxBell({ visible }: { visible: boolean }) {
  const t = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Message | null>(null);
  const locale = typeof window !== "undefined" ? document.documentElement.lang || "vi" : "vi";
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      setUnread(data.unread_count || 0);
    } catch {
      // bỏ qua lỗi poll
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchMessages();
    timerRef.current = setInterval(fetchMessages, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible, fetchMessages]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const markOneRead = useCallback(
    async (msg: Message) => {
      setOpen(false);
      setActive(msg);
      if (msg.is_read) return;
      try {
        await fetch(`/api/messages/${msg.id}/read`, { method: "POST" });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, is_read: true, read_at: new Date().toISOString() } : m)),
        );
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        // bỏ qua
      }
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/messages/read-all", { method: "POST" });
      setMessages((prev) => prev.map((m) => ({ ...m, is_read: true })));
      setUnread(0);
    } catch {
      // bỏ qua
    }
  }, []);

  if (!visible) return null;

  return (
    <>
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("inbox.title")}
          className="relative flex min-h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
        >
          {/* chuông */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
        {open && !active && (
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
              <span className="text-sm font-semibold text-zinc-100">{t("inbox.title")}</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs text-zinc-400 hover:text-zinc-100 cursor-pointer"
                >
                  {t("inbox.markAllRead")}
                </button>
              )}
            </div>
              <div className="max-h-96 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-zinc-500">{t("inbox.empty")}</div>
                ) : (
                  messages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => markOneRead(m)}
                      className={`block w-full border-b border-zinc-800/60 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/50 cursor-pointer ${m.is_read ? "" : "bg-zinc-800/30"}`}
                    >
                      <div className="flex items-center gap-2">
                        {!m.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />}
                        <span className={`truncate text-sm ${m.is_read ? "text-zinc-400" : "font-semibold text-zinc-100"}`}>
                          {m.title}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                          {relativeTime(m.created_at, locale)}
                        </span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{m.body}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
        )}
      </div>

      <Modal open={!!active} onClose={() => setActive(null)} title={active?.title} size="sm">
        {active && (
          <>
            <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                {active.scope === "broadcast" ? t("inbox.labelBroadcast") : t("inbox.labelSingle")}
              </span>
              <span>{relativeTime(active.created_at, locale)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-zinc-200">{active.body}</p>
          </>
        )}
      </Modal>
    </>
  );
}
