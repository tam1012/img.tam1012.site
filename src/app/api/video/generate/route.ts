import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  generateVideo,
  VIDEO_MODELS,
  DEFAULT_VIDEO_MODEL,
  VIDEO_ASPECT_RATIOS,
  DEFAULT_VIDEO_ACCOUNT,
  isValidVideoAccount,
  isValidResolution,
  VIDEO_RESOLUTIONS_BY_MODEL,
  isXaiModel,
  isXaiImageToVideoOnly,
  isXaiTextToVideoOnly,
  isPublicVideoModel,
  getAllowedVideoDurations,
  createVideoRecord,
  completeVideoRecord,
  failVideoRecord,
} from "@/lib/video";
import { getVideoPriceVnd } from "@/lib/pricing";
import { debitForVideo, refundForVideo, INSUFFICIENT_BALANCE } from "@/lib/wallet";
import { isGenerateRateLimited } from "@/lib/rate-limit";

export const maxDuration = 600;

const MAX_IMAGE_UPLOAD_BYTES = 9.5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (isGenerateRateLimited(user.id)) {
    return NextResponse.json({ error: "Bạn thao tác quá nhanh, vui lòng thử lại sau" }, { status: 429 });
  }

  let videoId: string | null = null;
  let charged = false;
  const videoPrice = getVideoPriceVnd();

  if (user.role !== "admin" && user.balanceVnd < videoPrice) {
    return NextResponse.json({ error: "Số dư không đủ, vui lòng nạp thêm" }, { status: 402 });
  }

  try {
    const formData = await req.formData();
    const prompt = ((formData.get("prompt") as string) || "").trim();
    const model = (formData.get("model") as string) || DEFAULT_VIDEO_MODEL;
    const aspectRatio = (formData.get("aspectRatio") as string) || "16:9";
    const durationRaw = Number(formData.get("duration"));
    const requestedAccount = (formData.get("account") as string) || DEFAULT_VIDEO_ACCOUNT;
    const account = user.role === "admin" ? requestedAccount : DEFAULT_VIDEO_ACCOUNT;
    const imageFile = formData.get("image") as File | null;

    if (!VIDEO_MODELS.includes(model as (typeof VIDEO_MODELS)[number])) {
      return NextResponse.json({ error: "Model không hợp lệ" }, { status: 400 });
    }
    if (user.role !== "admin" && !isPublicVideoModel(model)) {
      return NextResponse.json({ error: "Model này chỉ dành cho admin" }, { status: 403 });
    }
    if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio as (typeof VIDEO_ASPECT_RATIOS)[number])) {
      return NextResponse.json({ error: "Tỷ lệ khung hình không hợp lệ" }, { status: 400 });
    }

    const xai = isXaiModel(model);

    if (!xai && !isValidVideoAccount(account)) {
      return NextResponse.json({ error: "Tài khoản Vertex không hợp lệ" }, { status: 400 });
    }

    const allowedDurations = getAllowedVideoDurations(model);
    const duration = allowedDurations.includes(durationRaw)
      ? durationRaw
      : (allowedDurations.includes(8) ? 8 : allowedDurations[0]);

    let resolution = "";
    if (!xai) {
      resolution = (formData.get("resolution") as string) || VIDEO_RESOLUTIONS_BY_MODEL[model]?.[0] || "720p";
      if (!isValidResolution(model, resolution)) {
        return NextResponse.json({ error: `Chất lượng ${resolution} không hỗ trợ cho model này` }, { status: 400 });
      }
      if (user.role !== "admin" && resolution === "4k") {
        return NextResponse.json({ error: "Chất lượng 4K chỉ dành cho admin" }, { status: 403 });
      }
    }

    if (isXaiImageToVideoOnly(model) && (!imageFile || imageFile.size === 0)) {
      return NextResponse.json({ error: "Model này chỉ hỗ trợ tạo video từ ảnh" }, { status: 400 });
    }
    if (isXaiTextToVideoOnly(model) && imageFile && imageFile.size > 0) {
      return NextResponse.json({ error: "Model này chỉ hỗ trợ tạo video từ mô tả" }, { status: 400 });
    }
    if (!prompt && !imageFile) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả hoặc chọn ảnh" }, { status: 400 });
    }

    let image: { data: string; mimeType: string } | undefined;
    if (imageFile && imageFile.size > 0) {
      if (imageFile.size > MAX_IMAGE_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Ảnh tải lên quá lớn (tối đa 9.5MB)" }, { status: 413 });
      }
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      image = { data: buffer.toString("base64"), mimeType: imageFile.type || "image/jpeg" };
    }

    const mode: "text" | "image" = image ? "image" : "text";
    const costVnd = user.role === "admin" ? 0 : videoPrice;

    const video = await createVideoRecord({
      userId: user.id,
      prompt,
      model,
      aspectRatio,
      resolution,
      durationSeconds: duration,
      mode,
      account: xai ? "xai" : account,
      costVnd,
    });
    videoId = video.id;

    if (user.role !== "admin") {
      await debitForVideo(user.id, video.id, videoPrice);
      charged = true;
    }

    const result = await generateVideo({ prompt, model, aspectRatio, resolution, duration, account, image, videoId: video.id });
    await completeVideoRecord(video.id, `${video.id}.mp4`, result.account);

    return NextResponse.json({
      ...result,
      charged_vnd: charged ? videoPrice : 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi tạo video";
    if (videoId) await failVideoRecord(videoId, message).catch(() => undefined);
    if (charged && videoId) await refundForVideo(user.id, videoId, videoPrice, message).catch(() => undefined);
    if (message === INSUFFICIENT_BALANCE) {
      return NextResponse.json({ error: "Số dư không đủ, vui lòng nạp thêm" }, { status: 402 });
    }
    return NextResponse.json({ error: charged ? `${message}. Đã hoàn tiền.` : message }, { status: 500 });
  }
}
