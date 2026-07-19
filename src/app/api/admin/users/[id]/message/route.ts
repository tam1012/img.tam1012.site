import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDirectMessage } from "@/lib/messages";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title : "";
    const text = typeof body.body === "string" ? body.body : "";
    if (!title.trim() || !text.trim()) {
      return NextResponse.json({ error: "Thiếu tiêu đề hoặc nội dung" }, { status: 400 });
    }

    const message = await createDirectMessage({
      userId: id,
      title,
      body: text,
      createdBy: admin.id,
    });
    return NextResponse.json({ ok: true, message });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi gửi tin nhắn";
    const status = message.includes("Không tìm thấy") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
