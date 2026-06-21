import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listProviders, addProvider, ProviderConfig } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return "****" + key.slice(-4);
}

function sanitizeProvider(p: ProviderConfig) {
  return { ...p, api_key: maskKey(p.api_key) };
}

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const providers = listProviders().map(sanitizeProvider);
  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, api_type, base_url, api_key, model, is_default } = body;

    if (!name?.trim()) return NextResponse.json({ error: "Vui lòng nhập tên" }, { status: 400 });
    if (!api_key?.trim()) return NextResponse.json({ error: "Vui lòng nhập API key" }, { status: 400 });
    if (!model?.trim()) return NextResponse.json({ error: "Vui lòng nhập tên model" }, { status: 400 });

    const provider: ProviderConfig = {
      id: uuidv4(),
      name: name.trim(),
      api_type: api_type || "openai",
      base_url: base_url?.trim() || "",
      api_key: api_key.trim(),
      model: model.trim(),
      is_default: is_default || false,
      created_at: new Date().toISOString(),
    };

    addProvider(provider);
    return NextResponse.json({ provider: sanitizeProvider(provider) });
  } catch {
    return NextResponse.json({ error: "Lỗi thêm provider" }, { status: 500 });
  }
}
