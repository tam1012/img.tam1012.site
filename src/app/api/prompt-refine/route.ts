import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { refinePrompt } from "@/lib/prompt-refine";
import { promptRefineRateLimiter } from "@/lib/prompt-refine-rate-limit";

const MODES = new Set(["generate", "edit", "video"]);

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (!promptRefineRateLimiter.allow(user.id)) {
    return NextResponse.json({ error: "Bạn đã dùng gợi ý quá nhanh. Vui lòng thử lại sau một phút." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "Vui lòng nhập mô tả" }, { status: 400 });
    }

    const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : "generate";
    const refinedPrompt = await refinePrompt(prompt, {
      aspectRatio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : undefined,
      resolution: typeof body.resolution === "string" ? body.resolution : undefined,
      mode,
    });
    return NextResponse.json({ prompt: refinedPrompt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Không thể cải thiện prompt lúc này";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
