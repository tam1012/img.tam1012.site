import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { markAllRead } from "@/lib/messages";

export async function POST() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const updated = await markAllRead(user.id);
    return NextResponse.json({ ok: true, updated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi đánh dấu đã đọc";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
