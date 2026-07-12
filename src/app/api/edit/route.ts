import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getProviderById, createImageRecord, completeImageRecord, failImageRecord, getImageByIdempotencyKey } from "@/lib/db";
import { imageIdempotencyKey, maxEditImagesForProvider, normalizeIdempotencyKey, validateImageOptions } from "@/lib/image-options";
import { editImage, computePixelSize } from "@/lib/providers";
import { getImagePriceVnd } from "@/lib/pricing";
import { debitForImage, refundForImage, INSUFFICIENT_BALANCE } from "@/lib/wallet";
import { saveImageFile } from "@/lib/storage";

const MAX_EDIT_UPLOAD_BYTES = 9.5 * 1024 * 1024;
const MAX_EDIT_UPLOAD_LABEL = "9.5MB";
const LIMITED_2K_MESSAGE = "Model này chỉ hỗ trợ chỉnh sửa tối đa 2K. Vui lòng chọn 2K hoặc thấp hơn.";

function isWan27ImageModel(model: string) {
  return model.toLowerCase().includes("wan2.7-image");
}

function isGrokImagineImageModel(model: string) {
  return /grok-imagine-image/i.test(model);
}

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

  let imageId: string | null = null;
  let charged = false;
  const price = getImagePriceVnd();

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
    const clientKey = normalizeIdempotencyKey(req.headers.get("Idempotency-Key") || (formData.get("idempotency_key") as string) || (formData.get("idempotencyKey") as string));
    if (!clientKey) {
      return NextResponse.json({ error: "Thiếu Idempotency-Key" }, { status: 400 });
    }
    const requestKey = imageIdempotencyKey(user.id, "edit", clientKey);
    const existing = await getImageByIdempotencyKey(requestKey, user.id);
    if (existing) {
      if (existing.status !== "completed" || !existing.filename) {
        return NextResponse.json({ error: "Yêu cầu này đang xử lý hoặc đã thất bại, vui lòng kiểm tra lại thư viện." }, { status: 409 });
      }
      return NextResponse.json({
        id: existing.id,
        url: `/api/images/${existing.id}`,
        prompt: existing.prompt,
        provider_name: existing.provider_name,
        model: existing.model,
        created_at: existing.created_at,
        status: existing.status,
        charged_vnd: existing.cost_vnd,
      });
    }

    const optionError = validateImageOptions(aspectRatio, resolution, quality);
    if (optionError) {
      return NextResponse.json({ error: optionError }, { status: 400 });
    }

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

    const provider = await getProviderById(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
    }

    if (provider.api_type === "chatgpt_bridge") {
      return NextResponse.json(
        { error: "Provider ChatGPT Web Bridge chưa hỗ trợ chỉnh sửa ảnh." },
        { status: 400 }
      );
    }
    if ((isWan27ImageModel(provider.model) || isGrokImagineImageModel(provider.model)) && resolution === "4K") {
      return NextResponse.json({ error: LIMITED_2K_MESSAGE }, { status: 400 });
    }
    const maxEditImages = maxEditImagesForProvider(provider);
    if (imageEntries.length > maxEditImages) {
      return NextResponse.json({ error: `Provider này chỉ hỗ trợ chỉnh sửa tối đa ${maxEditImages} ảnh mỗi lần.` }, { status: 400 });
    }

    const images = await Promise.all(
      imageEntries.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "image/png",
      }))
    );
    const { width, height } = computePixelSize(aspectRatio, resolution);
    const image = await createImageRecord({
      userId: user.id,
      prompt: prompt.trim(),
      editPrompt: prompt.trim(),
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      aspectRatio,
      resolution,
      width,
      height,
      quality,
      costVnd: user.role === "admin" ? 0 : price,
      idempotencyKey: requestKey,
    });
    imageId = image.id;

    if (user.role !== "admin") {
      await debitForImage(user.id, image.id, price);
      charged = true;
    }

    const result = await editImage(provider, {
      images,
      prompt: prompt.trim(),
      width,
      height,
      quality: quality as "standard" | "high",
      aspectRatio,
      resolution,
    });

    const file = await saveImageFile(image.id, result.data, result.mimeType);
    const record = await completeImageRecord(image.id, { filename: file.filename, mimeType: file.mimeType, model: result.model });

    return NextResponse.json({
      id: record.id,
      url: `/api/images/${record.id}`,
      prompt: record.prompt,
      provider_name: record.provider_name,
      model: record.model,
      created_at: record.created_at,
      charged_vnd: charged ? price : 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi chỉnh sửa ảnh";
    if (imageId) await failImageRecord(imageId, message).catch(() => undefined);
    if (charged && imageId) await refundForImage(user.id, imageId, price, message).catch(() => undefined);
    if (message === INSUFFICIENT_BALANCE) {
      return NextResponse.json({ error: "Số dư không đủ, vui lòng liên hệ admin để nạp tiền" }, { status: 402 });
    }
    const status = message.startsWith("Chỉnh sửa ảnh thất bại") ? 400 : 500;
    return NextResponse.json({ error: charged ? `${message}. Đã hoàn tiền.` : message }, { status });
  }
}
