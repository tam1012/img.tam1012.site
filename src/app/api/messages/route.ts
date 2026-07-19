import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listMessagesForUser, countUnread } from "@/lib/messages";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const [messages, unreadCount] = await Promise.all([
    listMessagesForUser(user.id, { limit: 50 }),
    countUnread(user.id),
  ]);

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      scope: m.scope,
      is_read: m.isRead,
      read_at: m.readAt,
      created_at: m.createdAt,
    })),
    unread_count: unreadCount,
  });
}
