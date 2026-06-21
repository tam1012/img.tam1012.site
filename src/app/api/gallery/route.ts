import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listImages } from "@/lib/storage";
import { getAvailableProviders } from "@/lib/providers";

export async function GET(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const images = listImages(limit, offset);
  const providers = getAvailableProviders();

  return NextResponse.json({ images, providers });
}
