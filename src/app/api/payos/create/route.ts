import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findPackage, getPayos, getBaseUrl } from "@/lib/payos";
import { quotaFromBalance } from "@/lib/pricing";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const pkg = findPackage(String(body.package_id || ""));
    if (!pkg) {
      return NextResponse.json({ error: "Gói nạp không hợp lệ" }, { status: 400 });
    }

    const order = await prisma.payosOrder.create({
      data: { userId: user.id, amountVnd: pkg.amountVnd },
    });

    const payos = getPayos();
    const images = quotaFromBalance(pkg.amountVnd);
    const baseUrl = getBaseUrl();

    const link = await payos.paymentRequests.create({
      orderCode: order.orderCode,
      amount: pkg.amountVnd,
      description: `IMG ${images} anh`,
      returnUrl: `${baseUrl}/billing?payos=success`,
      cancelUrl: `${baseUrl}/billing?payos=cancel`,
    });

    await prisma.payosOrder.update({
      where: { orderCode: order.orderCode },
      data: { paymentLinkId: link.paymentLinkId },
    });

    return NextResponse.json({ checkoutUrl: link.checkoutUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo link thanh toán";
    if (message === "PAYOS_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Chưa cấu hình PayOS trên server" }, { status: 503 });
    }
    return NextResponse.json({ error: "Không tạo được link thanh toán" }, { status: 500 });
  }
}
