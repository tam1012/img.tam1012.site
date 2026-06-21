import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getUniquePrompts } from "@/lib/storage";

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const prompts = getUniquePrompts(30);
  return NextResponse.json({ prompts });
}
