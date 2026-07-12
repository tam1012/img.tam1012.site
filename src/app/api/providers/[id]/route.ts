import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getProviderById, updateProvider, deleteProvider, ProviderConfig } from "@/lib/db";

function isApiType(value: string): value is ProviderConfig["api_type"] {
  return value === "openai" || value === "gemini" || value === "vertex" || value === "chatgpt_bridge";
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await getProviderById(id);
  if (!existing) {
    return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const updates: Partial<ProviderConfig> = {};

    if (body.name?.trim()) updates.name = body.name.trim();
    if (body.api_type !== undefined) {
      if (!isApiType(body.api_type)) return NextResponse.json({ error: "Loại API không hợp lệ" }, { status: 400 });
      updates.api_type = body.api_type;
    }
    if (body.base_url !== undefined) updates.base_url = body.base_url.trim();
    if (body.api_key !== undefined && body.api_key.trim() && !body.api_key.startsWith("****")) {
      updates.api_key = body.api_key.trim();
    }
    if (body.model?.trim()) updates.model = body.model.trim();
    if (body.is_default !== undefined) updates.is_default = body.is_default;

    const nextApiType = (updates.api_type ?? existing.api_type) as ProviderConfig["api_type"];
    const nextApiKey = updates.api_key !== undefined ? String(updates.api_key) : existing.api_key;
    const nextBaseUrl = updates.base_url !== undefined ? String(updates.base_url) : existing.base_url;
    if (nextApiType === "chatgpt_bridge") {
      if (existing.api_type !== "chatgpt_bridge" && updates.api_key === undefined) {
        return NextResponse.json({ error: "Khi đổi sang ChatGPT Web Bridge, vui lòng nhập token bridge thật." }, { status: 400 });
      }
      if (!nextApiKey) return NextResponse.json({ error: "Provider ChatGPT Web Bridge cần token." }, { status: 400 });
      if (!nextBaseUrl) return NextResponse.json({ error: "Provider ChatGPT Web Bridge cần Base URL." }, { status: 400 });
    } else if (nextApiType !== "vertex" && !nextApiKey) {
      return NextResponse.json({ error: "Provider không phải Vertex thì bắt buộc có API key thật" }, { status: 400 });
    }
    if (nextApiType === "vertex") {
      updates.api_key = "";
    }

    await updateProvider(id, updates);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Lỗi cập nhật provider" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await deleteProvider(id))) {
    return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
