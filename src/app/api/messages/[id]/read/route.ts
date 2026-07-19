import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { markRead } from "@/lib/messages";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await markRead(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi đánh dấu đã đọc";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
