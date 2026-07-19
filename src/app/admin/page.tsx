"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import MessageComposer from "@/components/admin/MessageComposer";
import { formatLedgerType } from "@/lib/pricing";

interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  role: "admin" | "user";
  status: "active" | "blocked";
  balance_vnd: number;
  remaining_images: number;
  image_count: number;
  created_at: string;
}

interface LedgerItem {
  id: string;
  type: string;
  amount_vnd: number;
  balance_after_vnd: number;
  note: string | null;
  created_at: string;
}

type SortKey = "name" | "balance_vnd" | "remaining_images" | "image_count" | "created_at";
type SortDir = "asc" | "desc";

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("vi-VN", { hour12: false });
}

function userLabel(user: AdminUser) {
  return user.display_name || user.email || user.phone || user.id.slice(0, 8);
}

function sortValue(user: AdminUser, key: SortKey): string | number {
  if (key === "name") return userLabel(user).toLocaleLowerCase("vi");
  if (key === "created_at") return user.created_at;
  return user[key];
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [amount, setAmount] = useState("1000");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [siteNotice, setSiteNotice] = useState("");
  const [noticeDraft, setNoticeDraft] = useState("");
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [noticeMsg, setNoticeMsg] = useState("");
  const [confirmAction, setConfirmAction] = useState<"toggle_status" | null>(null);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (res.ok) setUsers(data.users);
    else setError(data.error || "Không tải được danh sách user");
    setLoading(false);
  }, []);

  const fetchNotice = useCallback(async () => {
    const res = await fetch("/api/admin/site-notice");
    const data = await res.json();
    if (res.ok) {
      const value = data.notice || "";
      setSiteNotice(value);
      setNoticeDraft(value);
    }
  }, []);

  async function fetchUser(id: string) {
    setDetailLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không tải được user");
      setSelected(data.user);
      setLedger(data.ledger);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không tải được user");
      setSelected(null);
      setLedger([]);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setLedger([]);
    setConfirmAction(null);
  }

  useEffect(() => {
    fetchUsers();
    fetchNotice();
  }, [fetchUsers, fetchNotice]);

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("vi");
    const filtered = !q
      ? users
      : users.filter((user) => {
          const hay = [
            user.display_name,
            user.email,
            user.phone,
            user.id,
            user.role,
            user.status,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("vi");
          return hay.includes(q);
        });

    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "vi", { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [users, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // Số liệu mặc định cao → thấp; tên A→Z
    setSortDir(key === "name" ? "asc" : "desc");
  }

  function sortMark(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  async function handleAdjust(mode: "topup" | "adjust") {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      const key = crypto.randomUUID();
      const res = await fetch(`/api/admin/users/${selected.id}/wallet-adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ amount_vnd: Number(amount), note, mode, idempotency_key: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNote("");
      await fetchUsers();
      await fetchUser(selected.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không cập nhật được ví");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleBlock() {
    if (!selected || statusSaving) return;
    const nextStatus = selected.status === "blocked" ? "active" : "blocked";
    setStatusSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchUsers();
      await fetchUser(selected.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái");
    } finally {
      setStatusSaving(false);
      setConfirmAction(null);
    }
  }

  async function handleSaveNotice() {
    if (noticeSaving) return;
    setNoticeSaving(true);
    setNoticeMsg("");
    setError("");
    try {
      const res = await fetch("/api/admin/site-notice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notice: noticeDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không lưu được ghi chú");
      const value = data.notice || "";
      setSiteNotice(value);
      setNoticeDraft(value);
      setNoticeMsg(value ? "Đã lưu ghi chú cho toàn site." : "Đã xoá ghi chú (banner ẩn).");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không lưu được ghi chú");
    } finally {
      setNoticeSaving(false);
    }
  }

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-zinc-100">Admin · Users & ví tiền</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/stats" className="px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700">
              Thống kê
            </Link>
            <Link href="/admin/logs" className="px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700">
              Nhật ký
            </Link>
            <button
              type="button"
              onClick={() => {
                fetchUsers();
                fetchNotice();
              }}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            >
              Làm mới
            </button>
          </div>
        </div>
        {error && <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">Ghi chú toàn site</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Hiện banner dưới header cho mọi user đã đăng nhập. URL http/https sẽ thành link bấm được. Để trống rồi Lưu để ẩn.
              </p>
            </div>
            {siteNotice ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">đang bật</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">đang ẩn</span>
            )}
          </div>
          <textarea
            value={noticeDraft}
            onChange={(e) => setNoticeDraft(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
            placeholder="VD: Tối nay 22h bảo trì 15 phút. Cần hỗ trợ nhắn Telegram @ThongThaiTuaThanTien"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-600">{noticeDraft.length}/500</span>
            <div className="flex items-center gap-2">
              {noticeMsg && <span className="text-xs text-emerald-400">{noticeMsg}</span>}
              <button
                type="button"
                onClick={() => setNoticeDraft("")}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 cursor-pointer"
              >
                Xoá nội dung
              </button>
              <button
                type="button"
                onClick={handleSaveNotice}
                disabled={noticeSaving}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-xs text-white cursor-pointer disabled:cursor-not-allowed"
              >
                {noticeSaving ? "Đang lưu..." : "Lưu ghi chú"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">Thông báo tới người dùng</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Gửi cho toàn bộ tài khoản đang hoạt động. Mỗi user nhận trong biểu tượng chuông trên cùng.
            </p>
          </div>
          <MessageComposer target="broadcast" />
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-zinc-800">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên, email, SĐT, id..."
              className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [SortKey, SortDir];
                setSortKey(key);
                setSortDir(dir);
              }}
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="created_at:desc">Mới tạo trước</option>
              <option value="created_at:asc">Cũ tạo trước</option>
              <option value="name:asc">Tên A → Z</option>
              <option value="name:desc">Tên Z → A</option>
              <option value="balance_vnd:desc">Số dư cao → thấp</option>
              <option value="balance_vnd:asc">Số dư thấp → cao</option>
              <option value="remaining_images:desc">Ảnh còn nhiều → ít</option>
              <option value="remaining_images:asc">Ảnh còn ít → nhiều</option>
              <option value="image_count:desc">Đã tạo nhiều → ít</option>
              <option value="image_count:asc">Đã tạo ít → nhiều</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner" />
            </div>
          ) : visibleUsers.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500">{users.length === 0 ? "Chưa có user" : "Không có user khớp tìm kiếm"}</p>
          ) : (
            <>
              <div className="px-4 py-2 text-xs text-zinc-600 border-b border-zinc-800">
                {visibleUsers.length}/{users.length} user · bấm để xem chi tiết
              </div>

              {/* Mobile: card dọc, không kéo ngang */}
              <div className="md:hidden divide-y divide-zinc-800">
                {visibleUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => fetchUser(user.id)}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-800/50 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-100 truncate">{userLabel(user)}</p>
                        <p className="text-xs text-zinc-600 truncate">{user.email || user.phone || user.id}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-zinc-400">{user.role}</span>
                        {user.status === "blocked" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">đã khoá</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">
                      <span className="text-zinc-200">{formatVnd(user.balance_vnd)}</span>
                      <span className="text-zinc-600"> · </span>
                      còn {user.remaining_images} ảnh
                      <span className="text-zinc-600"> · </span>
                      đã tạo {user.image_count}
                    </p>
                  </button>
                ))}
              </div>

              {/* Desktop: bảng đầy đủ */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-950 text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        <button type="button" onClick={() => toggleSort("name")} className="hover:text-zinc-300 cursor-pointer">
                          User{sortMark("name")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Role</th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button type="button" onClick={() => toggleSort("balance_vnd")} className="hover:text-zinc-300 cursor-pointer">
                          Số dư{sortMark("balance_vnd")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button type="button" onClick={() => toggleSort("remaining_images")} className="hover:text-zinc-300 cursor-pointer">
                          Ảnh còn{sortMark("remaining_images")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button type="button" onClick={() => toggleSort("image_count")} className="hover:text-zinc-300 cursor-pointer">
                          Đã tạo{sortMark("image_count")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {visibleUsers.map((user) => (
                      <tr
                        key={user.id}
                        onClick={() => fetchUser(user.id)}
                        className="hover:bg-zinc-800/50 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <p className="text-zinc-200">{userLabel(user)}</p>
                          <p className="text-xs text-zinc-600">{user.email || user.phone || user.id}</p>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {user.role}
                          {user.status === "blocked" ? " · đã khoá" : ""}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-200">{formatVnd(user.balance_vnd)}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">{user.remaining_images}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">{user.image_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>

      <Modal
        open={selected !== null || detailLoading}
        onClose={closeDetail}
        title={selected ? userLabel(selected) : "Chi tiết user"}
        size="lg"
      >
        {detailLoading && !selected ? (
          <div className="flex justify-center py-10">
            <span className="spinner" />
          </div>
        ) : selected ? (
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">{selected.role}</span>
                {selected.status === "blocked" && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">đã khoá</span>
                )}
              </div>
              <p className="text-xs text-zinc-600 mt-1">
                {selected.email || selected.phone || selected.id} · Tạo {formatDate(selected.created_at)}
              </p>
              <p className="text-sm text-zinc-400 mt-3">
                Số dư hiện tại: <span className="text-zinc-100">{formatVnd(selected.balance_vnd)}</span>
                <span className="text-zinc-600"> · </span>
                còn {selected.remaining_images} ảnh
                <span className="text-zinc-600"> · </span>
                đã tạo {selected.image_count}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction("toggle_status")}
                  disabled={statusSaving}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-500 text-xs text-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                >
                  {statusSaving ? "Đang lưu..." : selected.status === "blocked" ? "Mở khoá" : "Khoá tài khoản"}
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-2">Gửi tin nhắn</h3>
              <MessageComposer target={selected.id} />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Số tiền VND</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Ghi chú</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Nạp thủ công chuyển khoản"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleAdjust("topup")}
                  disabled={saving || Number(amount) <= 0}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-sm text-white cursor-pointer disabled:cursor-not-allowed"
                >
                  Cộng tiền
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjust("adjust")}
                  disabled={saving || Number(amount) === 0}
                  className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-500 text-sm text-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                >
                  Điều chỉnh
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-2">Ledger</h3>
              {ledger.length === 0 ? (
                <p className="text-sm text-zinc-600">Chưa có giao dịch</p>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800">
                  {ledger.map((item) => (
                    <div key={item.id} className="py-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-400">{formatLedgerType(item.type)}</span>
                        <span className={item.amount_vnd >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {item.amount_vnd >= 0 ? "+" : ""}
                          {formatVnd(item.amount_vnd)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600">
                        {formatDate(item.created_at)}
                        {item.note ? ` · ${item.note}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmAction !== null && selected !== null}
        title={selected?.status === "blocked" ? "Mở khoá tài khoản?" : "Khoá tài khoản?"}
        description={
          selected
            ? selected.status === "blocked"
              ? `User “${userLabel(selected)}” sẽ có thể đăng nhập và sử dụng dịch vụ trở lại.`
              : `User “${userLabel(selected)}” sẽ không thể đăng nhập cho đến khi được mở khoá.`
            : undefined
        }
        confirmLabel={selected?.status === "blocked" ? "Mở khoá" : "Khoá tài khoản"}
        tone={selected?.status !== "blocked" ? "danger" : "default"}
        loading={statusSaving}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleToggleBlock}
      />
    </AppShell>
  );
}
