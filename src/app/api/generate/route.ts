import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getProviderById,
  createImageRecordOnce,
  completeImageRecord,
  failImageRecord,
  getImageByIdempotencyKey,
  getImagesByBatchId,
  ProviderConfig,
  ImageRecord,
} from "@/lib/db";
import { imageIdempotencyKey, normalizeIdempotencyKey, validateImageOptions } from "@/lib/image-options";
import { generateImage, computePixelSize } from "@/lib/providers";
import { getImagePriceVnd } from "@/lib/pricing";
import { debitForBatch, refundForBatch, INSUFFICIENT_BALANCE } from "@/lib/wallet";
import { saveImageFile } from "@/lib/storage";
import { isGenerateRateLimited } from "@/lib/rate-limit";
import { generateSingleImage } from "@/lib/generate-image";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (isGenerateRateLimited(user.id)) {
    return NextResponse.json({ error: "Bạn thao tác quá nhanh, vui lòng thử lại sau" }, { status: 429 });
  }

  const price = getImagePriceVnd();

  try {
    const body = await req.json();
    const { prompt, provider_id, aspect_ratio = "1:1", resolution = "1K", quality = "standard" } = body;
    const count = Math.min(Math.max(1, Math.floor(Number(body.count) || 1)), 10);
    const clientKey = normalizeIdempotencyKey(
      req.headers.get("Idempotency-Key") || body.idempotency_key || body.idempotencyKey,
    );
    if (!clientKey) {
      return NextResponse.json({ error: "Thiếu Idempotency-Key" }, { status: 400 });
    }

    const optionError = validateImageOptions(aspect_ratio, resolution, quality);
    if (optionError) {
      return NextResponse.json({ error: optionError }, { status: 400 });
    }
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả" }, { status: 400 });
    }
    if (!provider_id) {
      return NextResponse.json({ error: "Vui lòng chọn provider" }, { status: 400 });
    }

    const provider = await getProviderById(provider_id);
    if (!provider) {
      return NextResponse.json({ error: "Provider không tồn tại" }, { status: 404 });
    }
    if (provider.api_type === "chatgpt_bridge" && user.role !== "admin") {
      return NextResponse.json({ error: "Provider này chỉ dành cho admin." }, { status: 403 });
    }
    if (user.role !== "admin" && user.balanceVnd < price * count) {
      return NextResponse.json({ error: "Số dư không đủ, vui lòng liên hệ admin để nạp tiền" }, { status: 402 });
    }

    if (count === 1) {
      const result = await generateSingleImage(user, {
        prompt: prompt.trim(),
        providerId: provider_id,
        aspectRatio: aspect_ratio,
        resolution,
        quality,
        clientKey,
      });
      if (!result.ok) {
        if (result.code === "processing") {
          return processingResponse();
        }
        if (result.code === "failed") {
          return failedResponse(result.error);
        }
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        images: [imagePayload(result.image)],
        charged_vnd: result.chargedVnd,
        count: 1,
      });
    }

    return handleBatch(user, provider, {
      prompt: prompt.trim(),
      aspect_ratio,
      resolution,
      quality,
      clientKey,
      price,
      count,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo ảnh";
    if (message === INSUFFICIENT_BALANCE) {
      return NextResponse.json({ error: "Số dư không đủ, vui lòng liên hệ admin để nạp tiền" }, { status: 402 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface GenOptions {
  prompt: string;
  aspect_ratio: string;
  resolution: string;
  quality: string;
  clientKey: string;
  price: number;
}

interface UserInfo {
  id: string;
  role: string;
}

function imagePayload(img: ImageRecord) {
  return {
    id: img.id,
    url: `/api/images/${img.id}`,
    prompt: img.prompt,
    provider_name: img.provider_name,
    model: img.model,
    created_at: img.created_at,
  };
}

function processingResponse() {
  return NextResponse.json({ status: "processing", retry_after_ms: 1500, images: [], count: 0 }, { status: 202 });
}

function failedResponse(message = "Yêu cầu tạo ảnh đã thất bại, vui lòng thử lại.") {
  return NextResponse.json({ error: message, status: "failed", images: [], count: 0 }, { status: 409 });
}

function batchExistingResponse(images: ImageRecord[]) {
  if (images.some((img) => img.status === "processing")) return processingResponse();
  const completed = images.filter((img) => img.status === "completed" && img.filename);
  if (completed.length === 0) return failedResponse("Yêu cầu tạo ảnh hàng loạt đã thất bại, vui lòng thử lại.");
  return NextResponse.json({
    images: completed.map(imagePayload),
    charged_vnd: completed.reduce((sum, img) => sum + img.cost_vnd, 0),
    count: completed.length,
    partial: completed.length < images.length,
  });
}

async function existingBatchResponse(batchId: string) {
  return batchExistingResponse(await getImagesByBatchId(batchId));
}

async function handleBatch(
  user: UserInfo,
  provider: ProviderConfig,
  opts: GenOptions & { count: number },
) {
  const batchId = randomUUID();
  const requestKey = imageIdempotencyKey(user.id, "generate", opts.clientKey);

  const existingFirst = await getImageByIdempotencyKey(`${requestKey}_0`, user.id);
  if (existingFirst?.batch_id) return existingBatchResponse(existingFirst.batch_id);

  const { width, height } = computePixelSize(opts.aspect_ratio, opts.resolution);
  const imageRecords = [];
  for (let i = 0; i < opts.count; i++) {
    const { record, created } = await createImageRecordOnce({
      userId: user.id,
      prompt: opts.prompt,
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      aspectRatio: opts.aspect_ratio,
      resolution: opts.resolution,
      width,
      height,
      quality: opts.quality,
      costVnd: user.role === "admin" ? 0 : opts.price,
      idempotencyKey: `${requestKey}_${i}`,
      batchId,
    });
    if (!created && record.batch_id) return existingBatchResponse(record.batch_id);
    imageRecords.push(record);
  }

  let charged = false;
  const totalPrice = opts.price * opts.count;
  try {
    if (user.role !== "admin") {
      await debitForBatch(user.id, batchId, opts.count, opts.price);
      charged = true;
    }

    const results = await generateImage(provider, {
      prompt: opts.prompt,
      width,
      height,
      quality: opts.quality as "standard" | "high",
      aspectRatio: opts.aspect_ratio,
      resolution: opts.resolution,
      count: opts.count,
    });

    const completedImages = [];
    for (let i = 0; i < results.length && i < imageRecords.length; i++) {
      try {
        const file = await saveImageFile(imageRecords[i].id, results[i].data, results[i].mimeType);
        const record = await completeImageRecord(imageRecords[i].id, {
          filename: file.filename,
          mimeType: file.mimeType,
          model: results[i].model,
        });
        completedImages.push(record);
      } catch {
        await failImageRecord(imageRecords[i].id, "Lỗi lưu ảnh").catch(() => undefined);
      }
    }
    for (let i = results.length; i < imageRecords.length; i++) {
      await failImageRecord(imageRecords[i].id, "Provider trả về ít ảnh hơn yêu cầu").catch(() => undefined);
    }

    const failedCount = opts.count - completedImages.length;
    if (charged && failedCount > 0 && completedImages.length > 0) {
      await refundForBatch(user.id, batchId, failedCount * opts.price, `${failedCount}/${opts.count} ảnh thất bại`).catch(
        () => undefined,
      );
    }

    if (completedImages.length === 0) {
      if (charged) await refundForBatch(user.id, batchId, totalPrice, "Tất cả ảnh thất bại").catch(() => undefined);
      throw new Error("Không tạo được ảnh nào");
    }

    return NextResponse.json({
      images: completedImages.map(imagePayload),
      charged_vnd: charged ? completedImages.length * opts.price : 0,
      count: completedImages.length,
      partial: failedCount > 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo ảnh";
    for (const rec of imageRecords) {
      await failImageRecord(rec.id, message).catch(() => undefined);
    }
    if (charged) await refundForBatch(user.id, batchId, totalPrice, message).catch(() => undefined);
    throw new Error(charged ? `${message}. Đã hoàn tiền.` : message);
  }
}
