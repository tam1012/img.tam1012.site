import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { normalizeIdempotencyKey } from "@/lib/image-options";
import {
  UserGenerationLimitError,
  withUserGenerationLimit,
} from "@/lib/rate-limit";
import { editSingleImage, MAX_EDIT_UPLOAD_LABEL } from "@/lib/edit-image";

function uploadTooLargeResponse() {
  return NextResponse.json(
    { error: `Ảnh tải lên quá lớn. Vui lòng dùng ảnh dưới ${MAX_EDIT_UPLOAD_LABEL} mỗi lần chỉnh sửa.` },
    { status: 413 }
  );
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

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
  const aspectRatio = (formData.get("aspect_ratio") as string) || "auto";
  const resolution = (formData.get("resolution") as string) || "1K";
  const quality = (formData.get("quality") as string) || "standard";
  const clientKey = normalizeIdempotencyKey(
    req.headers.get("Idempotency-Key") ||
      (formData.get("idempotency_key") as string) ||
      (formData.get("idempotencyKey") as string),
  );

  const images = await Promise.all(
    (imageEntries || []).map(async (file) => ({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "image/png",
    }))
  );

  try {
    return await withUserGenerationLimit(user.id, 1, async () => {
      const result = await editSingleImage(user, {
        prompt: typeof prompt === "string" ? prompt : "",
        providerId: typeof providerId === "string" ? providerId : "",
        images,
        aspectRatio,
        resolution,
        quality,
        clientKey: clientKey || "",
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      const record = result.image;
      return NextResponse.json({
        id: record.id,
        url: `/api/images/${record.id}`,
        prompt: record.prompt,
        provider_name: record.provider_name,
        model: record.model,
        created_at: record.created_at,
        status: record.status,
        charged_vnd: result.chargedVnd,
      });
    });
  } catch (e: unknown) {
    if (e instanceof UserGenerationLimitError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
