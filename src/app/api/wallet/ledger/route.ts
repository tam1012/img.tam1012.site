import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const ledger = await prisma.walletLedger.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    ledger: ledger.map((item: any) => ({
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
