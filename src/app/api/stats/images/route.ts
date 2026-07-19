import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getImageStats } from "@/lib/image-stats";

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const isAdmin = user.role === "admin";
  const requestedScope = req.nextUrl.searchParams.get("scope");
  const model = req.nextUrl.searchParams.get("model");
  const from = parseDate(req.nextUrl.searchParams.get("from"));
  const to = parseDate(req.nextUrl.searchParams.get("to"));

  let scope: "mine" | "all" = "mine";
  let userId: string | undefined = user.id;

  if (isAdmin && requestedScope === "all") {
    scope = "all";
    userId = undefined;
  } else {
    scope = "mine";
    userId = user.id;
  }

  // Khoảng tùy chỉnh chỉ cho admin xem toàn site — tránh user soi production stats.
  const allowCustom = isAdmin && scope === "all" && from && to;

  const stats = await getImageStats({
    userId,
    scope,
    model: model && model !== "all" ? model : null,
    from: allowCustom ? from : null,
    to: allowCustom ? to : null,
  });

  return NextResponse.json(stats);
}
