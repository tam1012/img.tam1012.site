import { NextRequest, NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/auth";
import { getWalletSummary } from "@/lib/wallet";
import {
  UserGenerationLimitError,
  withUserGenerationLimit,
} from "@/lib/rate-limit";
import { normalizeIdempotencyKey } from "@/lib/image-options";
import { editSingleImage, MAX_EDIT_UPLOAD_LABEL } from "@/lib/edit-image";

export const maxDuration = 300;

function uploadTooLargeResponse() {
  return NextResponse.json(
    { error: `Ảnh tải lên quá lớn. Vui lòng dùng ảnh dưới ${MAX_EDIT_UPLOAD_LABEL} mỗi lần chỉnh sửa.` },
    { status: 413 }
  );
}

export async function POST(req: NextRequest) {
  const user = await requireUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "API key không hợp lệ hoặc đã thu hồi" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Failed to parse body as FormData")) {
      return uploadTooLargeResponse();
    }
    return NextResponse.json({ error: "Body phải là multipart/form-data" }, { status: 400 });
  }

  const imageEntries = formData.getAll("images") as File[];
  const prompt = formData.get("prompt") as string;
  const providerId = (formData.get("provider_id") as string) || (formData.get("providerId") as string);
  const aspectRatio = (formData.get("aspect_ratio") as string) || "auto";
  const resolution = (formData.get("resolution") as string) || "1K";
  const quality = (formData.get("quality") as string) || "standard";
  const clientKey = normalizeIdempotencyKey(
    req.headers.get("Idempotency-Key") ||
      (formData.get("idempotency_key") as string) ||
      (formData.get("idempotencyKey") as string),
  );

  if (!clientKey) {
    return NextResponse.json({ error: "Thiếu header Idempotency-Key" }, { status: 400 });
  }

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
        clientKey,
      });

      if (!result.ok) {
        if (result.code === "processing") {
          return NextResponse.json(
            { error: result.error, status: "processing", retry_after_ms: 1500 },
            { status: 202 },
          );
        }
        return NextResponse.json({ error: result.error, status: result.code || "error" }, { status: result.status });
      }

      const wallet = await getWalletSummary(user.id);
      const img = result.image;

      return NextResponse.json({
        id: img.id,
        status: "completed",
        prompt: img.prompt,
        provider_name: img.provider_name,
        model: img.model,
        aspect_ratio: img.aspect_ratio,
        resolution: img.resolution,
        quality: img.quality,
        cost_vnd: result.chargedVnd,
        balance_vnd: wallet.balance_vnd,
        url: `/api/v1/images/${img.id}/file`,
        created_at: img.created_at,
        reused: result.reused,
      });
    });
  } catch (e: unknown) {
    if (e instanceof UserGenerationLimitError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
