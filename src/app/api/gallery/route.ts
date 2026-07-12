import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listImages, countImages } from "@/lib/storage";

const PAGE_SIZE = 32;

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const requestedPage = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10) || 1);
  const isAdmin = user.role === "admin";
  const requestedUserId = req.nextUrl.searchParams.get("user_id") || undefined;
  const requestedScope = req.nextUrl.searchParams.get("scope");

  let targetUserId: string | undefined;
  let scope: "mine" | "all" = "mine";

  if (isAdmin) {
    if (requestedUserId) {
      targetUserId = requestedUserId;
      scope = requestedUserId === user.id ? "mine" : "all";
    } else if (requestedScope === "all") {
      targetUserId = undefined;
      scope = "all";
    } else {
      // Default admin feed = own images only (intentional behavior change).
      targetUserId = user.id;
      scope = "mine";
    }
  } else {
    // Non-admin: always own images; ignore client scope/user_id.
    targetUserId = user.id;
    scope = "mine";
  }

  const total = await countImages(targetUserId);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;
  const images = await listImages(PAGE_SIZE, offset, targetUserId);

  return NextResponse.json({
    images,
    page,
    totalPages,
    total,
    scope,
    viewer_role: user.role,
  });
}
