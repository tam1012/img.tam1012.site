import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getRole } from "@/lib/auth";
import { listImages, countImages } from "@/lib/storage";

const PAGE_SIZE = 32;

export async function GET(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const role = await getRole();
  const creator = role === "guest" ? "guest" : undefined;

  const requestedPage = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10) || 1);

  const total = countImages(creator);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;
  const images = listImages(PAGE_SIZE, offset, creator);

  return NextResponse.json({ images, page, totalPages, total });
}
