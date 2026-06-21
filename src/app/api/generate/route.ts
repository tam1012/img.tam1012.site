import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProviderById } from "@/lib/db";
import { generateImage } from "@/lib/providers";
import { saveImage } from "@/lib/storage";

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, provider_id, size = "square", quality = "standard" } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả" }, { status: 400 });
    }
    if (!provider_id) {
      return NextResponse.json({ error: "Vui lòng chọn provider" }, { status: 400 });
    }

    const provider = getProviderById(provider_id);
    if (!provider) {
      return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
    }

    const result = await generateImage(provider, { prompt: prompt.trim(), size, quality });

    const record = saveImage(result.data, result.mimeType, {
      prompt: prompt.trim(),
      providerId: provider.id,
      providerName: provider.name,
      model: result.model,
      size,
      quality,
    });

    return NextResponse.json({
      id: record.id,
      url: `/api/images/${record.id}`,
      prompt: record.prompt,
      provider_name: record.provider_name,
      model: record.model,
      created_at: record.created_at,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo ảnh";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
