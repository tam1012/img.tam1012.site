import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { quotaFromBalance } from "@/lib/pricing";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      ledger: { orderBy: { createdAt: "desc" }, take: 100 },
      // "Đã tạo" = sản lượng bất biến (ImageUsage), không phụ thuộc user xóa gallery.
      _count: { select: { imageUsages: true } },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User không tồn tại" }, { status: 404 });
  }

  const balance = user.wallet?.balanceVnd ?? 0;
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      display_name: user.displayName,
      role: user.role,
      status: user.status,
      balance_vnd: balance,
      remaining_images: quotaFromBalance(balance),
      image_count: user._count.imageUsages,
      created_at: user.createdAt.toISOString(),
    },
    ledger: user.ledger.map((item) => ({
      id: item.id,
      type: item.type,
      amount_vnd: item.amountVnd,
      balance_after_vnd: item.balanceAfterVnd,
      related_image_id: item.relatedImageId,
      note: item.note,
      created_at: item.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "Không thể tự đổi trạng thái tài khoản của chính mình" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const status = body.status;
  if (status !== "active" && status !== "blocked") {
    return NextResponse.json({ error: "Trạng thái không hợp lệ" }, { status: 400 });
  }

  const result = await prisma.user.updateMany({ where: { id }, data: { status } });
  if (result.count === 0) {
    return NextResponse.json({ error: "User không tồn tại" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  // Hard-delete user bị gỡ: phá audit trail (ledger/ảnh/usage). Dùng block thay thế.
  void params;
  return NextResponse.json(
    { error: "Không hỗ trợ xoá user. Hãy dùng khoá tài khoản (block)." },
    { status: 405 }
  );
}
