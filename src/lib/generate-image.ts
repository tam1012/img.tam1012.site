import {
  completeImageRecord,
  createImageRecordOnce,
  failImageRecord,
  getImageByIdempotencyKey,
  getProviderById,
  ImageRecord,
  ProviderConfig,
} from "@/lib/db";
import { imageIdempotencyKey, normalizeIdempotencyKey, validateImageOptions } from "@/lib/image-options";
import { generateImage, computePixelSize } from "@/lib/providers";
import { getImagePriceVnd } from "@/lib/pricing";
import { debitForImage, refundForImage, INSUFFICIENT_BALANCE } from "@/lib/wallet";
import { saveImageFile } from "@/lib/storage";

export type GenerateUser = {
  id: string;
  role: string;
  balanceVnd: number;
};

export type GenerateSingleInput = {
  prompt: string;
  providerId: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  clientKey: string;
};

export type GenerateSingleOk = {
  ok: true;
  image: ImageRecord;
  chargedVnd: number;
  reused: boolean;
};

export type GenerateSingleErr = {
  ok: false;
  status: number;
  error: string;
  code?: "processing" | "failed" | "insufficient_balance";
};

export type GenerateSingleResult = GenerateSingleOk | GenerateSingleErr;

/** Tạo đúng 1 ảnh (shared cho web /api/generate và public /api/v1). */
export async function generateSingleImage(
  user: GenerateUser,
  input: GenerateSingleInput,
): Promise<GenerateSingleResult> {
  const prompt = input.prompt?.trim() || "";
  const aspectRatio = input.aspectRatio || "1:1";
  const resolution = input.resolution || "1K";
  const quality = input.quality || "standard";
  const clientKey = normalizeIdempotencyKey(input.clientKey);

  if (!clientKey) {
    return { ok: false, status: 400, error: "Thiếu Idempotency-Key" };
  }
  const optionError = validateImageOptions(aspectRatio, resolution, quality);
  if (optionError) {
    return { ok: false, status: 400, error: optionError };
  }
  if (!prompt) {
    return { ok: false, status: 400, error: "Vui lòng nhập mô tả" };
  }
  if (!input.providerId) {
    return { ok: false, status: 400, error: "Vui lòng chọn provider" };
  }

  const provider = await getProviderById(input.providerId);
  if (!provider) {
    return { ok: false, status: 404, error: "Provider không tồn tại" };
  }
  if (provider.api_type === "chatgpt_bridge" && user.role !== "admin") {
    return { ok: false, status: 403, error: "Provider này chỉ dành cho admin." };
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

  const requestKey = imageIdempotencyKey(user.id, "generate", clientKey);
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
      error: "Yêu cầu tạo ảnh đã thất bại, vui lòng thử lại với Idempotency-Key mới",
      code: "failed",
    };
  }

  const { width, height } = computePixelSize(aspectRatio, resolution);
  const { record: image, created } = await createImageRecordOnce({
    userId: user.id,
    prompt,
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
      error: "Yêu cầu tạo ảnh đã thất bại, vui lòng thử lại với Idempotency-Key mới",
      code: "failed",
    };
  }

  let charged = false;
  try {
    if (user.role !== "admin") {
      await debitForImage(user.id, image.id, price);
      charged = true;
    }

    const results = await generateImage(provider as ProviderConfig, {
      prompt,
      width,
      height,
      quality: quality as "standard" | "high",
      aspectRatio,
      resolution,
    });
    const result = results[0];
    const file = await saveImageFile(image.id, result.data, result.mimeType);
    const record = await completeImageRecord(image.id, {
      filename: file.filename,
      mimeType: file.mimeType,
      model: result.model,
    });

    return {
      ok: true,
      image: record,
      chargedVnd: charged ? price : 0,
      reused: false,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo ảnh";
    if (message === INSUFFICIENT_BALANCE) {
      await failImageRecord(image.id, message).catch(() => undefined);
      return {
        ok: false,
        status: 402,
        error: "Số dư không đủ, vui lòng liên hệ admin để nạp tiền",
        code: "insufficient_balance",
      };
    }
    await failImageRecord(image.id, message).catch(() => undefined);
    if (charged) await refundForImage(user.id, image.id, price, message).catch(() => undefined);
    return {
      ok: false,
      status: 500,
      error: charged ? `${message}. Đã hoàn tiền.` : message,
    };
  }
}
