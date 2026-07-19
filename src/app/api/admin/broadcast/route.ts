import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createBroadcast } from "@/lib/messages";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title : "";
    const text = typeof body.body === "string" ? body.body : "";
    if (!title.trim() || !text.trim()) {
      return NextResponse.json({ error: "Thiếu tiêu đề hoặc nội dung" }, { status: 400 });
    }

    const recipients = await createBroadcast({ title, body: text, createdBy: admin.id });
    return NextResponse.json({ ok: true, recipients });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi gửi thông báo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
