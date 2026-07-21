import type { ProviderConfig } from "./db";
import sharp from "sharp";

const ASPECT_RATIOS = new Set(["1:1", "3:2", "4:3", "16:9", "2:3", "3:4", "9:16"]);
/** Edit-only: "auto" is accepted by API, then resolved to a concrete ratio. */
const ASPECT_RATIOS_WITH_AUTO = new Set([...ASPECT_RATIOS, "auto"]);
// 1.5K bị loại: Gemini/Vertex chỉ nhận imageSize 1K/2K/4K → 1.5K gây 400 INVALID_ARGUMENT.
const RESOLUTIONS = new Set(["1K", "2K", "4K"]);
const QUALITIES = new Set(["standard", "high"]);

/** Supported edit/generate ratios with numeric width/height value. */
const RATIO_CANDIDATES: Array<{ label: string; value: number }> = [
  { label: "9:16", value: 9 / 16 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
];

/**
 * Detect nearest supported aspect ratio from an image buffer.
 * Used when edit is called with aspect_ratio=auto or omitted.
 */
export async function detectAspectRatio(buffer: Buffer): Promise<string> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return "1:1";

  const ratio = width / height;
  let best = RATIO_CANDIDATES[0];
  let bestDist = Math.abs(ratio - best.value);
  for (let i = 1; i < RATIO_CANDIDATES.length; i++) {
    const candidate = RATIO_CANDIDATES[i];
    const dist = Math.abs(ratio - candidate.value);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best.label;
}

export function validateImageOptions(aspectRatio: string, resolution: string, quality: string): string | null {
  if (!ASPECT_RATIOS_WITH_AUTO.has(aspectRatio)) return "Tỷ lệ ảnh không hợp lệ";
  if (!RESOLUTIONS.has(resolution)) return "Độ phân giải không hợp lệ";
  if (!QUALITIES.has(quality)) return "Chất lượng không hợp lệ";
  return null;
}

function isOpenAICompatModelFamily(model: string, family: "gemini" | "imagen") {
  const m = model.toLowerCase();
  return new RegExp(`(^|[\\/_.:-])${family}($|[\\/_.:-])`).test(m);
}

export function maxEditImagesForProvider(provider: ProviderConfig) {
  if (provider.api_type === "chatgpt_bridge") return 0;
  // Flow Nano Banana 2 / Pro: upload multiple references then generate.
  if (provider.api_type === "flow") return 8;
  if (provider.api_type !== "openai") return 8;
  if (isOpenAICompatModelFamily(provider.model, "gemini")) return 8;
  if (/gpt-image/i.test(provider.model)) return 8;
  return 1;
}

/** Độ phân giải tối đa UI được phép hiện cho provider này. */
export function maxResolutionForProvider(provider: ProviderConfig): "2K" | "4K" {
  const model = provider.model || "";
  if (provider.api_type === "flow") return "2K";
  if (/grok-imagine-image/i.test(model) || model.toLowerCase().includes("wan2.7-image")) {
    return "2K";
  }
  return "4K";
}

export function normalizeIdempotencyKey(value: string | null | undefined) {
  const key = value?.trim();
  if (!key || key.length > 120) return null;
  const normalized = key.replace(/[^a-zA-Z0-9._:-]/g, "");
  return normalized || null;
}

export function imageIdempotencyKey(userId: string, action: "generate" | "edit", key: string) {
  return `image:${userId}:${action}:${key}`;
}

export function walletIdempotencyKey(adminId: string, action: "topup" | "adjust", key: string) {
  return `admin-${action}:${adminId}:${key}`;
}
