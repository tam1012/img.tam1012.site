import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { quotaFromBalance } from "@/lib/pricing";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    include: {
      wallet: true,
      // "Đã tạo" = sản lượng bất biến (ImageUsage), không phụ thuộc user xóa gallery.
      _count: { select: { imageUsages: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    users: users.map((user) => {
      const balance = user.wallet?.balanceVnd ?? 0;
      return {
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
      };
    }),
  });
}
