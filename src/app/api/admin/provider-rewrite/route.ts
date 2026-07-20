import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listProviders } from "@/lib/db";
import {
  getProviderRewriteConfig,
  setProviderRewriteConfig,
} from "@/lib/provider-rewrite";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }
  const config = await getProviderRewriteConfig();
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const providers = await listProviders();
    const providerIds = new Set(providers.map((p) => p.id));
    const result = await setProviderRewriteConfig(body?.config ?? body, admin.id, providerIds);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, config: result.config });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Không lưu được cấu hình rewrite";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
