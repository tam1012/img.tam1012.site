import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getImageStats } from "@/lib/image-stats";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const isAdmin = user.role === "admin";
  const requestedScope = req.nextUrl.searchParams.get("scope");
  const model = req.nextUrl.searchParams.get("model");

  let scope: "mine" | "all" = "mine";
  let userId: string | undefined = user.id;

  if (isAdmin && requestedScope === "all") {
    scope = "all";
    userId = undefined;
  } else {
    scope = "mine";
    userId = user.id;
  }

  const stats = await getImageStats({
    userId,
    scope,
    model: model && model !== "all" ? model : null,
  });

  return NextResponse.json(stats);
}
