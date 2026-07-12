import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getUniquePrompts } from "@/lib/storage";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const prompts = await getUniquePrompts(30, user.role === "admin" ? undefined : user.id);
  return NextResponse.json({ prompts });
}
