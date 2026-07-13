import { NextRequest, NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/auth";
import { getImage } from "@/lib/storage";
import { getWalletSummary } from "@/lib/wallet";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "API key không hợp lệ hoặc đã thu hồi" }, { status: 401 });
  }

  const { id } = await params;
  const record = await getImage(id);
  if (!record || record.status === "deleted" || record.deleted_at) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }
  if (user.role !== "admin" && record.user_id !== user.id) {
    return NextResponse.json({ error: "Không có quyền xem ảnh này" }, { status: 403 });
  }

  const wallet = await getWalletSummary(user.id);

  return NextResponse.json({
    id: record.id,
    status: record.status,
    prompt: record.prompt,
    provider_name: record.provider_name,
    model: record.model,
    aspect_ratio: record.aspect_ratio,
    resolution: record.resolution,
    quality: record.quality,
    cost_vnd: record.cost_vnd,
    balance_vnd: wallet.balance_vnd,
    url: `/api/v1/images/${record.id}/file`,
    created_at: record.created_at,
  });
}
