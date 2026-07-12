import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listVideosByUser } from "@/lib/video";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const videos = await listVideosByUser(user.id, user.role === "admin");
  return NextResponse.json({ videos });
}