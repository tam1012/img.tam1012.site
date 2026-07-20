import {
  completeImageRecord,
  createImageRecordOnce,
  failImageRecord,
  getImageByIdempotencyKey,
  getProviderById,
  ImageRecord,
  ProviderConfig,
} from "@/lib/db";
import {
  imageIdempotencyKey,
  maxEditImagesForProvider,
  normalizeIdempotencyKey,
  validateImageOptions,
  detectAspectRatio,
} from "@/lib/image-options";
import { editImage, computePixelSize } from "@/lib/providers";
import { getImagePriceVnd } from "@/lib/pricing";
import {
  clampResolutionForProvider,
  resolveProviderRoute,
} from "@/lib/provider-rewrite";
import { debitForImage, refundForImage, INSUFFICIENT_BALANCE } from "@/lib/wallet";
import { saveImageFile } from "@/lib/storage";
import type { GenerateUser } from "@/lib/generate-image";

export const MAX_EDIT_UPLOAD_BYTES = 9.5 * 1024 * 1024;
export const MAX_EDIT_UPLOAD_LABEL = "9.5MB";
const LIMITED_2K_MESSAGE = "Model này chỉ hỗ trợ chỉnh sửa tối đa 2K. Vui lòng chọn 2K hoặc thấp hơn.";

function isWan27ImageModel(model: string) {
  return model.toLowerCase().includes("wan2.7-image");
}

function isGrokImagineImageModel(model: string) {
  return /grok-imagine-image/i.test(model);
}

export type EditImageInput = {
  buffer: Buffer;
  mimeType: string;
};

export type EditSingleInput = {
  prompt: string;
  providerId: string;
  images: EditImageInput[];
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  clientKey: string;
};

export type EditSingleOk = {
  ok: true;
  image: ImageRecord;
  chargedVnd: number;
  reused: boolean;
};

export type EditSingleErr = {
  ok: false;
  status: number;
  error: string;
  code?: "processing" | "failed" | "insufficient_balance" | "upload_too_large";
};

export type EditSingleResult = EditSingleOk | EditSingleErr;

/** Chỉnh sửa đúng 1 ảnh (shared cho web /api/edit và public /api/v1). */
export async function editSingleImage(
  user: GenerateUser,
  input: EditSingleInput,
): Promise<EditSingleResult> {
  const prompt = input.prompt?.trim() || "";
  const rawAspect = (input.aspectRatio || "auto").trim() || "auto";
  let resolution = input.resolution || "1K";
  const quality = input.quality || "standard";
  const clientKey = normalizeIdempotencyKey(input.clientKey);

  if (!clientKey) {
    return { ok: false, status: 400, error: "Thiếu Idempotency-Key" };
  }

  const requestKey = imageIdempotencyKey(user.id, "edit", clientKey);
  const existing = await getImageByIdempotencyKey(requestKey, user.id);
  if (existing) {
    if (existing.status === "completed" && existing.filename) {
      return { ok: true, image: existing, chargedVnd: existing.cost_vnd, reused: true };
    }
    if (existing.status === "processing") {
      return {
        ok: false,
        status: 202,
        error: "Yêu cầu đang xử lý, vui lòng thử lại sau",
        code: "processing",
      };
    }
    return {
      ok: false,
      status: 409,
      error: "Yêu cầu chỉnh sửa đã thất bại, vui lòng thử lại với Idempotency-Key mới",
      code: "failed",
    };
  }

  // Need source images before auto ratio detection.
  if (!input.images || input.images.length === 0) {
    return { ok: false, status: 400, error: "Vui lòng chọn ảnh gốc" };
  }

  let aspectRatio = rawAspect;
  if (aspectRatio === "auto") {
    try {
      aspectRatio = await detectAspectRatio(input.images[0].buffer);
    } catch {
      aspectRatio = "1:1";
    }
  }

  const optionError = validateImageOptions(aspectRatio, resolution, quality);
  if (optionError) {
    return { ok: false, status: 400, error: optionError };
  }
  const uploadSize = input.images.reduce((sum, img) => sum + img.buffer.length, 0);
  if (uploadSize > MAX_EDIT_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Ảnh tải lên quá lớn. Vui lòng dùng ảnh dưới ${MAX_EDIT_UPLOAD_LABEL} mỗi lần chỉnh sửa.`,
      code: "upload_too_large",
    };
  }
  if (!prompt) {
    return { ok: false, status: 400, error: "Vui lòng nhập mô tả chỉnh sửa" };
  }
  if (!input.providerId) {
    return { ok: false, status: 400, error: "Vui lòng chọn provider" };
  }

  const requested = await getProviderById(input.providerId);
  if (!requested) {
    return { ok: false, status: 404, error: "Provider không tồn tại" };
  }

  const route = await resolveProviderRoute(requested, "edit");
  const provider = route.actual as ProviderConfig;

  if (provider.api_type === "chatgpt_bridge") {
    return { ok: false, status: 400, error: "Provider ChatGPT Web Bridge chưa hỗ trợ chỉnh sửa ảnh." };
  }
  resolution = clampResolutionForProvider(provider, resolution);
  if ((isWan27ImageModel(provider.model) || isGrokImagineImageModel(provider.model)) && resolution === "4K") {
    return { ok: false, status: 400, error: LIMITED_2K_MESSAGE };
  }
  const maxEditImages = maxEditImagesForProvider(provider);
  if (input.images.length > maxEditImages) {
    return {
      ok: false,
      status: 400,
      error: `Provider này chỉ hỗ trợ chỉnh sửa tối đa ${maxEditImages} ảnh mỗi lần.`,
    };
  }

  const price = getImagePriceVnd();
  if (user.role !== "admin" && user.balanceVnd < price) {
    return {
      ok: false,
      status: 402,
      error: "Số dư không đủ, vui lòng liên hệ admin để nạp tiền",
      code: "insufficient_balance",
    };
  }

  const { width, height } = computePixelSize(aspectRatio, resolution);
  const { record: image, created } = await createImageRecordOnce({
    userId: user.id,
    prompt,
    editPrompt: prompt,
    providerId: route.display.providerId,
    providerName: route.display.providerName,
    model: route.display.model,
    logModel: route.actualMeta.model,
    logProviderName: route.actualMeta.providerName,
    aspectRatio,
    resolution,
    width,
    height,
    quality,
    costVnd: user.role === "admin" ? 0 : price,
    idempotencyKey: requestKey,
  });

  if (!created) {
    if (image.status === "completed" && image.filename) {
      return { ok: true, image, chargedVnd: image.cost_vnd, reused: true };
    }
    if (image.status === "processing") {
      return {
        ok: false,
        status: 202,
        error: "Yêu cầu đang xử lý, vui lòng thử lại sau",
        code: "processing",
      };
    }
    return {
      ok: false,
      status: 409,
      error: "Yêu cầu chỉnh sửa đã thất bại, vui lòng thử lại với Idempotency-Key mới",
      code: "failed",
    };
  }

  let charged = false;
  try {
    if (user.role !== "admin") {
      await debitForImage(user.id, image.id, price);
      charged = true;
    }

    const result = await editImage(provider, {
      images: input.images,
      prompt,
      width,
      height,
      quality: quality as "standard" | "high",
      aspectRatio,
      resolution,
    });
    const file = await saveImageFile(image.id, result.data, result.mimeType);
    const record = await completeImageRecord(image.id, {
      filename: file.filename,
      mimeType: file.mimeType,
      model: route.display.model,
      usageModel: route.actualMeta.model,
      usageProviderName: route.actualMeta.providerName,
    });

    return { ok: true, image: record, chargedVnd: charged ? price : 0, reused: false };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi chỉnh sửa ảnh";
    await failImageRecord(image.id, message).catch(() => undefined);
    if (message === INSUFFICIENT_BALANCE) {
      return {
        ok: false,
        status: 402,
        error: "Số dư không đủ, vui lòng liên hệ admin để nạp tiền",
        code: "insufficient_balance",
      };
    }
    if (charged) await refundForImage(user.id, image.id, price, message).catch(() => undefined);
    const status = message.startsWith("Chỉnh sửa ảnh thất bại") ? 400 : 500;
    return { ok: false, status, error: charged ? `${message}. Đã hoàn tiền.` : message };
  }
}
