import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSiteNotice } from "@/lib/site-settings";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const data = await getSiteNotice();
  return NextResponse.json(data);
}
