import { NextRequest, NextResponse } from "next/server";
import { getPayos } from "@/lib/payos";
import { creditWalletPayos } from "@/lib/wallet";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body không hợp lệ" }, { status: 400 });
  }

  let data;
  try {
    data = await getPayos().webhooks.verify(body as never);
  } catch {
    return NextResponse.json({ error: "Chữ ký không hợp lệ" }, { status: 400 });
  }

  if (data.code !== "00") {
    return NextResponse.json({ success: true });
  }

  const order = await prisma.payosOrder.findUnique({ where: { orderCode: data.orderCode } });
  if (!order || order.amountVnd !== data.amount) {
    // Order thiếu / amount lệch: ack 200, không credit, không 500.
    return NextResponse.json({ success: true });
  }

  try {
    await creditWalletPayos(order.userId, order.amountVnd, order.orderCode);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "credit failed";
    console.error("[payos/webhook] credit failed", data.orderCode, message);
    return NextResponse.json({ error: "Tạm thời không xử lý được" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
