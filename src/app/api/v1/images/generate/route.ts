import { NextRequest, NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/auth";
import { generateSingleImage } from "@/lib/generate-image";
import { getWalletSummary } from "@/lib/wallet";
import {
  UserGenerationLimitError,
  withUserGenerationLimit,
} from "@/lib/rate-limit";
import { normalizeIdempotencyKey } from "@/lib/image-options";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await requireUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "API key không hợp lệ hoặc đã thu hồi" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const prompt = body.prompt;
    const providerId = body.provider_id || body.providerId;
    const aspectRatio = body.aspect_ratio || body.aspectRatio || "1:1";
    const resolution = body.resolution || "1K";
    const quality = body.quality || "standard";
    const clientKey = normalizeIdempotencyKey(
      req.headers.get("Idempotency-Key") || body.idempotency_key || body.idempotencyKey,
    );

    if (!clientKey) {
      return NextResponse.json({ error: "Thiếu header Idempotency-Key" }, { status: 400 });
    }

    // MVP: chỉ 1 ảnh / request (batch để sau).
    if (body.count != null && Number(body.count) !== 1) {
      return NextResponse.json(
        { error: "API v1 hiện chỉ hỗ trợ tạo 1 ảnh mỗi request (count=1)" },
        { status: 400 },
      );
    }

    return await withUserGenerationLimit(user.id, 1, async () => {
      const result = await generateSingleImage(user, {
        prompt: typeof prompt === "string" ? prompt : "",
        providerId: typeof providerId === "string" ? providerId : "",
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
    const message = e instanceof Error ? e.message : "Lỗi tạo ảnh";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
