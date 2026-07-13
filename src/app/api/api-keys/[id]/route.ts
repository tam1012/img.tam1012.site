import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { revokeApiKeyForUser } from "@/lib/api-keys";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const key = await revokeApiKeyForUser(user.id, id);
  if (!key) {
    return NextResponse.json({ error: "Không tìm thấy API key" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, key });
}
