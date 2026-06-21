import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { saveImage } from "@/lib/storage";

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const prompt = formData.get("prompt") as string;
    const providerName = formData.get("provider") as string;
    const size = (formData.get("size") as string) || "square";

    if (!imageFile) {
      return NextResponse.json({ error: "Vui lòng chọn ảnh gốc" }, { status: 400 });
    }
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả chỉnh sửa" }, { status: 400 });
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const provider = getProvider(providerName);
    const result = await provider.edit({
      image: imageBuffer,
      imageMimeType: imageFile.type || "image/png",
      prompt: prompt.trim(),
      size: size as "square" | "landscape" | "portrait",
    });

    const record = saveImage(result.data, result.mimeType, {
      prompt: prompt.trim(),
      editPrompt: prompt.trim(),
      provider: providerName,
      model: result.model,
      size,
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
    const message = e instanceof Error ? e.message : "Lỗi chỉnh sửa ảnh";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
