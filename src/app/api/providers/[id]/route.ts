import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProviderById, updateProvider, deleteProvider } from "@/lib/db";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const existing = getProviderById(id);
  if (!existing) {
    return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.name?.trim()) updates.name = body.name.trim();
    if (body.api_type) updates.api_type = body.api_type;
    if (body.base_url !== undefined) updates.base_url = body.base_url.trim();
    if (body.api_key?.trim() && !body.api_key.startsWith("****")) {
      updates.api_key = body.api_key.trim();
    }
    if (body.model?.trim()) updates.model = body.model.trim();
    if (body.is_default !== undefined) updates.is_default = body.is_default;

    updateProvider(id, updates);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Lỗi cập nhật provider" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  if (!deleteProvider(id)) {
    return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
