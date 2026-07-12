import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getWalletSummary } from "@/lib/wallet";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  return NextResponse.json({ wallet: await getWalletSummary(user.id) });
}
