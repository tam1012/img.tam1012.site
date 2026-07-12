import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listVideoAccounts } from "@/lib/video";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Chỉ admin được xem tài khoản" }, { status: 403 });
  }

  return NextResponse.json({ accounts: listVideoAccounts() });
}
