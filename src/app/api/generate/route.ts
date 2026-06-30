import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getRole } from "@/lib/auth";
import { getProviderById, countImagesByCreatorToday } from "@/lib/db";
import { generateImage, computePixelSize } from "@/lib/providers";
import { saveImage } from "@/lib/storage";

const GUEST_DAILY_QUOTA = 50;

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const role = await getRole();

  if (role === "guest" && countImagesByCreatorToday("guest") >= GUEST_DAILY_QUOTA) {
    return NextResponse.json({ error: `Đã đạt giới hạn ${GUEST_DAILY_QUOTA} ảnh/ngày cho tài khoản khách` }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { prompt, provider_id, aspect_ratio = "1:1", resolution = "1K", quality = "standard" } = body;

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

    const { width, height } = computePixelSize(aspect_ratio, resolution);
    const result = await generateImage(provider, { prompt: prompt.trim(), width, height, quality, aspectRatio: aspect_ratio, resolution });

    const record = await saveImage(result.data, result.mimeType, {
      prompt: prompt.trim(),
      providerId: provider.id,
      providerName: provider.name,
      model: result.model,
      size: `${width}x${height}`,
      quality,
      createdBy: role || "admin",
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
