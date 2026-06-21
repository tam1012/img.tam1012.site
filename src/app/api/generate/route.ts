import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { saveImage } from "@/lib/storage";

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, provider: providerName, size = "square", quality = "standard" } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả" }, { status: 400 });
    }

    const provider = getProvider(providerName);
    const result = await provider.generate({ prompt: prompt.trim(), size, quality });

    const record = saveImage(result.data, result.mimeType, {
      prompt: prompt.trim(),
      provider: providerName,
      model: result.model,
      size,
      quality,
    });

    return NextResponse.json({
      id: record.id,
      url: `/api/images/${record.id}`,
      prompt: record.prompt,
      provider: record.provider,
      model: record.model,
      created_at: record.created_at,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo ảnh";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
