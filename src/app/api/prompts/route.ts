import { NextResponse } from "next/server";
import { requireAuth, getRole } from "@/lib/auth";
import { getUniquePrompts } from "@/lib/storage";

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const role = await getRole();
  const creator = role === "guest" ? "guest" : undefined;
  const prompts = getUniquePrompts(30, creator);

  return NextResponse.json({ prompts });
}
