import type { ProviderConfig } from "./db";

const ASPECT_RATIOS = new Set(["1:1", "3:2", "4:3", "16:9", "2:3", "3:4", "9:16"]);
const RESOLUTIONS = new Set(["1K", "1.5K", "2K", "4K"]);
const QUALITIES = new Set(["standard", "high"]);

export function validateImageOptions(aspectRatio: string, resolution: string, quality: string): string | null {
  if (!ASPECT_RATIOS.has(aspectRatio)) return "Tỷ lệ ảnh không hợp lệ";
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
  if (provider.api_type === "flow") return 0;
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
