import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getRole } from "@/lib/auth";
import { getProviderById, countImagesByCreatorToday } from "@/lib/db";
import { editImage, computePixelSize } from "@/lib/providers";
import { saveImage } from "@/lib/storage";

const GUEST_DAILY_QUOTA = 50;
const MAX_EDIT_UPLOAD_BYTES = 9.5 * 1024 * 1024;
const MAX_EDIT_UPLOAD_LABEL = "9.5MB";

function uploadTooLargeResponse() {
  return NextResponse.json(
    { error: `Ảnh tải lên quá lớn. Vui lòng dùng ảnh dưới ${MAX_EDIT_UPLOAD_LABEL} mỗi lần chỉnh sửa.` },
    { status: 413 }
  );
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const role = await getRole();

  if (role === "guest" && countImagesByCreatorToday("guest") >= GUEST_DAILY_QUOTA) {
    return NextResponse.json({ error: `Đã đạt giới hạn ${GUEST_DAILY_QUOTA} ảnh/ngày cho tài khoản khách` }, { status: 403 });
  }

  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("Failed to parse body as FormData")) {
        return uploadTooLargeResponse();
      }
      throw err;
    }
    const imageEntries = formData.getAll("images") as File[];
    const prompt = formData.get("prompt") as string;
    const providerId = formData.get("provider_id") as string;
    const aspectRatio = (formData.get("aspect_ratio") as string) || "1:1";
    const resolution = (formData.get("resolution") as string) || "1K";
    const quality = (formData.get("quality") as string) || "standard";

    if (!imageEntries || imageEntries.length === 0) {
      return NextResponse.json({ error: "Vui lòng chọn ảnh gốc" }, { status: 400 });
    }
    const uploadSize = imageEntries.reduce((sum, file) => sum + file.size, 0);
    if (uploadSize > MAX_EDIT_UPLOAD_BYTES) {
      return uploadTooLargeResponse();
    }
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả chỉnh sửa" }, { status: 400 });
    }
    if (!providerId) {
      return NextResponse.json({ error: "Vui lòng chọn provider" }, { status: 400 });
    }

    const provider = getProviderById(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
    }

    const images = await Promise.all(
      imageEntries.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "image/png",
      }))
    );
    const { width, height } = computePixelSize(aspectRatio, resolution);
    const result = await editImage(provider, {
      images,
      prompt: prompt.trim(),
      width,
      height,
      quality: quality as "standard" | "high",
      aspectRatio,
      resolution,
    });

    const record = await saveImage(result.data, result.mimeType, {
      prompt: prompt.trim(),
      editPrompt: prompt.trim(),
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
    const message = e instanceof Error ? e.message : "Lỗi chỉnh sửa ảnh";
    const status = message.startsWith("Chỉnh sửa ảnh thất bại") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
