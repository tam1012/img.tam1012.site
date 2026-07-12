import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publicUser } from "@/lib/users";
import { getWalletSummary } from "@/lib/wallet";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const wallet = await getWalletSummary(user.id);
  return NextResponse.json({
    user: publicUser(user),
    wallet,
  });
}
