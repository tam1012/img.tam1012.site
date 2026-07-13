import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createApiKeyForUser, listApiKeysForUser } from "@/lib/api-keys";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const keys = await listApiKeysForUser(user.id);
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name : undefined;
    const { key, plainKey } = await createApiKeyForUser(user.id, name);
    return NextResponse.json({
      key,
      // Chỉ trả plain key đúng 1 lần lúc tạo.
      secret: plainKey,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Không tạo được API key";
    const status = message.includes("tối đa") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
