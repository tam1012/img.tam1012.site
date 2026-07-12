import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { normalizeIdempotencyKey, walletIdempotencyKey } from "@/lib/image-options";
import { adjustWalletManual, creditWalletManual, INSUFFICIENT_BALANCE } from "@/lib/wallet";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const amountVnd = Number(body.amount_vnd ?? body.amountVnd);
    const note = body.note;
    const mode = body.mode || (amountVnd > 0 ? "topup" : "adjust");
    const key = normalizeIdempotencyKey(req.headers.get("Idempotency-Key") || body.idempotency_key || body.idempotencyKey);
    if (!key) {
      return NextResponse.json({ error: "Thiếu Idempotency-Key" }, { status: 400 });
    }
    if (mode !== "topup" && mode !== "adjust") {
      return NextResponse.json({ error: "Loại điều chỉnh không hợp lệ" }, { status: 400 });
    }

    const ledgerKey = walletIdempotencyKey(admin.id, mode, key);
    const wallet = mode === "topup"
      ? await creditWalletManual(id, amountVnd, admin.id, ledgerKey, note)
      : await adjustWalletManual(id, amountVnd, admin.id, ledgerKey, note);

    return NextResponse.json({ ok: true, wallet: { balance_vnd: wallet.balanceVnd } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi cập nhật ví";
    const status = message === INSUFFICIENT_BALANCE ? 400 : 500;
    return NextResponse.json({ error: message === INSUFFICIENT_BALANCE ? "Số dư không đủ để trừ" : message }, { status });
  }
}
