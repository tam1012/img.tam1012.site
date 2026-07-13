import { NextRequest, NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/auth";
import { maxResolutionForProvider } from "@/lib/image-options";
import { listProviders } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "API key không hợp lệ hoặc đã thu hồi" }, { status: 401 });
  }

  let providers = await listProviders();
  if (user.role !== "admin") {
    providers = providers.filter((p) => p.api_type !== "chatgpt_bridge" && p.enabled !== false);
  } else {
    providers = providers.filter((p) => p.enabled !== false);
  }

  return NextResponse.json({
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      is_default: p.is_default,
      max_resolution: maxResolutionForProvider(p),
    })),
  });
}
