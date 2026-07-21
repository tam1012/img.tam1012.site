import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import { createRecaptchaToken } from "./token-factory.js";
import {
  UPSTREAM_FETCH_TIMEOUT_MS,
  formatUpstreamRejected,
} from "./upstream-errors.js";

// Verified Phase 1 contract for Flow image generation.
export const FLOW_IMAGE_ENDPOINT =
  "https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages";

// Verified 2026-07-18 image-edit probe: upload then reference by name.
export const FLOW_UPLOAD_IMAGE_ENDPOINT = "https://aisandbox-pa.googleapis.com/v1/flow/uploadImage";

// Verified 2026-07-21 from Flow app bundle: 2K/4K is post-generate upsample, not generate param.
export const FLOW_UPSAMPLE_IMAGE_ENDPOINT = "https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage";

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024" | string;

/** Client resolution tier. Flow generate is always base; 2K/4K = upsampleImage. */
export type FlowImageResolution = "1K" | "2K" | "4K" | string;

export type FlowImageModelName = "NARWHAL" | "GEM_PIX_2" | "HARBOR_SEAL";

export type FlowImageInput = {
  imageInputType: "IMAGE_INPUT_TYPE_REFERENCE";
  name: string;
};

export type FlowImageUpload = {
  data: Buffer;
  mimeType: string;
  fileName?: string;
};

export function mapImageModel(model: string): FlowImageModelName {
  const m = model.trim().toLowerCase();
  // Nano Banana 2 / Gemini 3.1 Flash Image
  if (
    m === "flow-nano-banana-2" ||
    m === "narwhal" ||
    m === "nano-banana-2" ||
    m === "nano_banana_2"
  ) {
    return "NARWHAL";
  }
  // Nano Banana Pro / Gemini 3 Pro Image (Precise Mode in Flow UI)
  if (
    m === "flow-nano-banana-pro" ||
    m === "gem_pix_2" ||
    m === "gem-pix-2" ||
    m === "nano-banana-pro" ||
    m === "nano_banana_pro" ||
    m === "harbor_seal" ||
    m === "harbor-seal"
  ) {
    return "GEM_PIX_2";
  }
  throw new Error("FLOW_INVALID_REQUEST");
}

/**
 * Map UI ratio / legacy WxH size → Flow imageAspectRatio enum.
 * Flow supports 5 ratios (bundle 2026-07-21), not just 3 buckets.
 */
export function mapAspectRatio(size: ImageSize): string {
  const s = String(size || "").trim();
  // Exact UI ratios (preferred)
  if (s === "1:1") return "IMAGE_ASPECT_RATIO_SQUARE";
  if (s === "16:9") return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  if (s === "9:16") return "IMAGE_ASPECT_RATIO_PORTRAIT";
  if (s === "4:3") return "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE";
  if (s === "3:4") return "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR";
  // Near-ratios used in app (2:3≈portrait, 3:2≈landscape) — no dedicated enum
  if (s === "2:3") return "IMAGE_ASPECT_RATIO_PORTRAIT";
  if (s === "3:2") return "IMAGE_ASPECT_RATIO_LANDSCAPE";

  // Legacy OpenAI-style sizes from older client
  if (s === "1024x1024") return "IMAGE_ASPECT_RATIO_SQUARE";
  if (s === "1792x1024") return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  if (s === "1024x1792") return "IMAGE_ASPECT_RATIO_PORTRAIT";

  // Fallback: width x height → nearest of 5 Flow ratios by aspect value
  const m = s.match(/^(\d+)x(\d+)$/i);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!w || !h) return "IMAGE_ASPECT_RATIO_SQUARE";
    const r = w / h;
    const candidates: Array<{ enum: string; value: number }> = [
      { enum: "IMAGE_ASPECT_RATIO_PORTRAIT", value: 9 / 16 },
      { enum: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR", value: 3 / 4 },
      { enum: "IMAGE_ASPECT_RATIO_SQUARE", value: 1 },
      { enum: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE", value: 4 / 3 },
      { enum: "IMAGE_ASPECT_RATIO_LANDSCAPE", value: 16 / 9 },
    ];
    let best = candidates[0];
    let bestDist = Math.abs(r - best.value);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(r - candidates[i].value);
      if (d < bestDist) {
        best = candidates[i];
        bestDist = d;
      }
    }
    return best.enum;
  }
  return "IMAGE_ASPECT_RATIO_SQUARE";
}

/** 1K = no upsample; 2K/4K → upsampleImage targetResolution. */
export function mapUpsampleResolution(resolution?: FlowImageResolution | null): string | null {
  const r = String(resolution || "1K").trim().toUpperCase();
  if (r === "2K" || r === "2") return "UPSAMPLE_IMAGE_RESOLUTION_2K";
  if (r === "4K" || r === "4") return "UPSAMPLE_IMAGE_RESOLUTION_4K";
  return null;
}

export type GenerateImageInput = {
  prompt: string;
  model?: string;
  size?: ImageSize;
  /** 1K (default) | 2K | 4K — 2K/4K triggers post-generate upsampleImage. */
  resolution?: FlowImageResolution;
  n?: number;
  projectId: string;
  siteKey: string;
  action?: string;
  accessToken: string;
  page: Page;
  /** When set, request becomes image edit / reference generation. */
  imageInputs?: FlowImageInput[];
};

export type GeneratedImage = {
  b64_json?: string;
  bytes: number;
  mediaId?: string;
};

function countMedia(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as {
      imagePanels?: Array<{ generatedImages?: unknown[] }>;
      generatedImages?: unknown[];
      media?: unknown[];
      responses?: Array<{ generatedImages?: unknown[] }>;
    };
    let count = (parsed.imagePanels ?? []).reduce(
      (sum, panel) => sum + (panel.generatedImages?.length ?? 0),
      0,
    );
    if (count === 0 && Array.isArray(parsed.generatedImages)) count = parsed.generatedImages.length;
    if (count === 0 && Array.isArray(parsed.media)) count = parsed.media.length;
    if (count === 0 && Array.isArray(parsed.responses)) {
      count = parsed.responses.reduce((s, r) => s + (r.generatedImages?.length ?? 0), 0);
    }
    if (count === 0 && /fifeUrl|generatedImage|mediaGenerationId/.test(raw)) count = 1;
    return count;
  } catch {
    return 0;
  }
}

function extractFifeUrls(raw: string): string[] {
  const urls = new Set<string>();
  const re = /https:\/\/[^"\\]+\bfife[^"\\]*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) urls.add(m[0].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&"));
  // Also walk JSON for fifeUrl fields.
  try {
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (/fifeurl/i.test(k) && typeof v === "string" && v.startsWith("http")) urls.add(v);
        else walk(v);
      }
    };
    walk(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return [...urls];
}

/** mediaGenerationId values from generate response (needed for upsampleImage). */
export function extractMediaGenerationIds(raw: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const id = v.trim();
    if (!id || id.length < 8 || id.length > 300) return;
    if (/ya29\.|Bearer|http/i.test(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  // Prefer exact field from generate payload.
  const re = /"mediaGenerationId"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) push(m[1]);
  if (ids.length > 0) return ids;
  // Fallback walk JSON.
  try {
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const obj = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" && /mediaGenerationId|mediaId/i.test(k)) push(v);
        else walk(v);
      }
    };
    walk(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return ids;
}

async function fetchUrlAsBase64(page: Page, url: string): Promise<string | null> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }, url);
}

/**
 * Post-generate upsample (Flow download quality 2K/4K).
 * Body shape from Flow app bundle 2026-07-21:
 * { clientContext, mediaId, requestContext, targetResolution }
 */
export async function upsampleFlowImage(input: {
  page: Page;
  accessToken: string;
  projectId: string;
  siteKey: string;
  action?: string;
  mediaId: string;
  targetResolution: string;
}): Promise<{ b64_json: string; bytes: number }> {
  const mediaId = input.mediaId?.trim();
  if (!mediaId) throw new Error("FLOW_INVALID_REQUEST");
  const targetResolution = input.targetResolution?.trim();
  if (!targetResolution) throw new Error("FLOW_INVALID_REQUEST");
  const action = input.action ?? "IMAGE_GENERATION";

  let token: string;
  try {
    token = await createRecaptchaToken(input.page, { siteKey: input.siteKey, action });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("FLOW_RECAPTCHA_UNAVAILABLE")) throw err;
    throw new Error("FLOW_RECAPTCHA_FAILED");
  }

  const result = await input.page.evaluate(
    async ([endpointUrl, bearer, tokenValue, project, media, target, timeoutMs]) => {
      const sessionId = crypto.randomUUID?.() || `s-${Date.now()}`;
      const body = {
        clientContext: {
          recaptchaContext: {
            token: tokenValue,
            applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
          },
          projectId: project,
          tool: "PINHOLE",
          sessionId,
        },
        mediaId: media,
        requestContext: {},
        targetResolution: target,
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const raw = await res.text();
        return { status: res.status, raw };
      } catch (err) {
        const aborted =
          (err instanceof Error && err.name === "AbortError") ||
          (typeof DOMException !== "undefined" &&
            err instanceof DOMException &&
            err.name === "AbortError");
        if (aborted) return { status: 0, raw: "FETCH_TIMEOUT" };
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    [
      FLOW_UPSAMPLE_IMAGE_ENDPOINT,
      input.accessToken,
      token,
      input.projectId,
      mediaId,
      targetResolution,
      UPSTREAM_FETCH_TIMEOUT_MS,
    ] as const,
  );

  if (result.status === 401) throw new Error("FLOW_REAUTH_REQUIRED");
  if (result.status === 403) {
    if (/recaptcha|captcha|UNUSUAL_ACTIVITY|PERMISSION_DENIED/i.test(result.raw)) {
      throw new Error("FLOW_RECAPTCHA_FAILED");
    }
    throw new Error("FLOW_REAUTH_REQUIRED");
  }
  if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
  if (result.status !== 200) {
    throw new Error(formatUpstreamRejected(result.status, result.raw));
  }

  const urls = extractFifeUrls(result.raw);
  if (urls.length === 0) throw new Error("FLOW_UPSTREAM_REJECTED");
  const bin = await fetchUrlAsBase64(input.page, urls[0]);
  if (!bin) throw new Error("FLOW_UPSTREAM_REJECTED");
  return { b64_json: bin, bytes: Math.floor((bin.length * 3) / 4) };
}

/** Extract media name/id from uploadImage response without assuming a single schema. */
export function extractUploadedImageName(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const candidates: string[] = [];
    const visit = (node: unknown, parentKey = "") => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, parentKey);
        return;
      }
      const obj = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" && v.length >= 8 && v.length <= 200) {
          if (
            /^(name|mediaId|media_id|imageId|image_id|id|mediaGenerationId)$/i.test(k) ||
            (/name/i.test(k) && /media|image/i.test(parentKey + k))
          ) {
            // Prefer UUID-looking or media path values; still accept plain ids.
            if (!/ya29\.|Bearer|http/i.test(v)) candidates.push(v);
          }
        } else {
          visit(v, k);
        }
      }
    };
    visit(parsed);
    // Prefer UUID-shaped names first (matches probe observation).
    const uuid = candidates.find((c) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c),
    );
    if (uuid) return uuid;
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function extensionForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "png";
}

export async function uploadFlowImage(input: {
  page: Page;
  accessToken: string;
  projectId: string;
  image: FlowImageUpload;
}): Promise<string> {
  const mimeType = (input.image.mimeType || "image/png").split(";")[0].trim() || "image/png";
  const fileName =
    input.image.fileName?.trim() ||
    `${randomUUID()}.${extensionForMime(mimeType)}`;
  const imageBytes = input.image.data.toString("base64");
  if (!imageBytes) throw new Error("FLOW_INVALID_REQUEST");

  const result = await input.page.evaluate(
    async ([endpointUrl, bearer, project, bytes, mime, name, timeoutMs]) => {
      const body = {
        clientContext: {
          projectId: project,
          tool: "PINHOLE",
        },
        imageBytes: bytes,
        mimeType: mime,
        fileName: name,
        isUserUploaded: true,
        isHidden: false,
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const raw = await res.text();
        return { status: res.status, raw };
      } catch (err) {
        const aborted =
          (err instanceof Error && err.name === "AbortError") ||
          (typeof DOMException !== "undefined" &&
            err instanceof DOMException &&
            err.name === "AbortError");
        if (aborted) return { status: 0, raw: "FETCH_TIMEOUT" };
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    [
      FLOW_UPLOAD_IMAGE_ENDPOINT,
      input.accessToken,
      input.projectId,
      imageBytes,
      mimeType,
      fileName,
      UPSTREAM_FETCH_TIMEOUT_MS,
    ] as const,
  );

  if (result.status === 401) throw new Error("FLOW_REAUTH_REQUIRED");
  if (result.status === 403) {
    if (/recaptcha|captcha|UNUSUAL_ACTIVITY|PERMISSION_DENIED/i.test(result.raw)) {
      throw new Error("FLOW_RECAPTCHA_FAILED");
    }
    throw new Error("FLOW_REAUTH_REQUIRED");
  }
  if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
  if (result.status !== 200) {
    throw new Error(formatUpstreamRejected(result.status, result.raw));
  }
  const name = extractUploadedImageName(result.raw);
  if (!name) throw new Error("FLOW_UPSTREAM_REJECTED");
  return name;
}

export async function generateFlowImages(input: GenerateImageInput): Promise<{
  status: number;
  images: GeneratedImage[];
}> {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error("FLOW_INVALID_REQUEST");
  const n = Math.min(Math.max(input.n ?? 1, 1), 4);
  const imageModelName = mapImageModel(input.model ?? "flow-nano-banana-2");
  const imageAspectRatio = mapAspectRatio(input.size ?? "1024x1024");
  const upsampleTarget = mapUpsampleResolution(input.resolution);
  const action = input.action ?? "IMAGE_GENERATION";
  const imageInputs = input.imageInputs ?? [];

  let recaptchaFailures = 0;
  let lastStatus = 0;
  let lastRaw = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    let token: string;
    try {
      token = await createRecaptchaToken(input.page, { siteKey: input.siteKey, action });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // Script chưa sẵn: không đốt thêm attempt như execute fail — ném thẳng để route map soft cooldown.
      if (msg.includes("FLOW_RECAPTCHA_UNAVAILABLE")) throw err;
      recaptchaFailures += 1;
      if (recaptchaFailures >= 2) throw new Error("FLOW_RECAPTCHA_FAILED");
      continue;
    }

    const endpoint = FLOW_IMAGE_ENDPOINT.replace("{projectId}", input.projectId);
    const result = await input.page.evaluate(
      async ([
        endpointUrl,
        bearer,
        tokenValue,
        project,
        model,
        aspect,
        text,
        count,
        refs,
        timeoutMs,
      ]) => {
        const sessionId = crypto.randomUUID?.() || `s-${Date.now()}`;
        const batchId = crypto.randomUUID?.() || `b-${Date.now()}`;
        const clientContext = {
          recaptchaContext: {
            token: tokenValue,
            applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
          },
          projectId: project,
          tool: "PINHOLE",
          sessionId,
        };
        const requests = Array.from({ length: count }, () => ({
          clientContext,
          imageModelName: model,
          imageAspectRatio: aspect,
          structuredPrompt: { parts: [{ text }] },
          seed: Math.floor(Math.random() * 2_000_000_000),
          imageInputs: refs,
        }));
        const body = {
          clientContext,
          mediaGenerationContext: { batchId },
          useNewMedia: true,
          requests,
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(endpointUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const raw = await res.text();
          return { status: res.status, raw };
        } catch (err) {
          const aborted =
            (err instanceof Error && err.name === "AbortError") ||
            (typeof DOMException !== "undefined" &&
              err instanceof DOMException &&
              err.name === "AbortError");
          if (aborted) return { status: 0, raw: "FETCH_TIMEOUT" };
          throw err;
        } finally {
          clearTimeout(timer);
        }
      },
      [
        endpoint,
        input.accessToken,
        token,
        input.projectId,
        imageModelName,
        imageAspectRatio,
        prompt,
        n,
        imageInputs,
        UPSTREAM_FETCH_TIMEOUT_MS,
      ] as const,
    );

    lastStatus = result.status;
    lastRaw = result.raw;

    // 403 reCAPTCHA (PUBLIC_ERROR_UNUSUAL_ACTIVITY) ≠ session hết hạn.
    // Map nhầm sang FLOW_REAUTH_REQUIRED sẽ giết cả pool.
    if (result.status === 401) throw new Error("FLOW_REAUTH_REQUIRED");
    if (result.status === 403) {
      if (/recaptcha|captcha|UNUSUAL_ACTIVITY|PERMISSION_DENIED/i.test(result.raw)) {
        recaptchaFailures += 1;
        if (attempt === 0) continue;
        throw new Error("FLOW_RECAPTCHA_FAILED");
      }
      throw new Error("FLOW_REAUTH_REQUIRED");
    }
    if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
    if (result.status === 200) {
      const mediaIds = extractMediaGenerationIds(result.raw);
      const urls = extractFifeUrls(result.raw);
      const images: GeneratedImage[] = [];

      // If user asked 2K/4K: upsample each mediaId (Flow download quality path).
      // On upsample failure for a single image, fall back to base generate bytes.
      if (upsampleTarget && mediaIds.length > 0) {
        for (let i = 0; i < Math.min(n, mediaIds.length); i++) {
          try {
            const up = await upsampleFlowImage({
              page: input.page,
              accessToken: input.accessToken,
              projectId: input.projectId,
              siteKey: input.siteKey,
              action,
              mediaId: mediaIds[i],
              targetResolution: upsampleTarget,
            });
            images.push({ ...up, mediaId: mediaIds[i] });
          } catch {
            const url = urls[i];
            if (!url) continue;
            const bin = await fetchUrlAsBase64(input.page, url);
            if (bin) {
              images.push({
                b64_json: bin,
                bytes: Math.floor((bin.length * 3) / 4),
                mediaId: mediaIds[i],
              });
            }
          }
        }
      } else {
        for (let i = 0; i < urls.slice(0, n).length; i++) {
          const url = urls[i];
          const bin = await fetchUrlAsBase64(input.page, url);
          if (bin) {
            images.push({
              b64_json: bin,
              bytes: Math.floor((bin.length * 3) / 4),
              mediaId: mediaIds[i],
            });
          }
        }
      }

      if (images.length === 0 && countMedia(result.raw) > 0) {
        // Upstream succeeded but URL extract failed — still report opaque success count via empty b64 is wrong.
        throw new Error("FLOW_UPSTREAM_REJECTED");
      }
      if (images.length === 0) throw new Error("FLOW_UPSTREAM_REJECTED");
      return { status: 200, images };
    }
    // Non-200: only retry once when it looks like recaptcha rejection.
    if (attempt === 0 && /recaptcha|captcha|precondition/i.test(result.raw)) {
      recaptchaFailures += 1;
      continue;
    }
    break;
  }

  throw new Error(
    lastStatus || lastRaw
      ? formatUpstreamRejected(lastStatus, lastRaw)
      : "FLOW_UPSTREAM_REJECTED",
  );
}

export async function editFlowImages(input: {
  prompt: string;
  model?: string;
  size?: ImageSize;
  resolution?: FlowImageResolution;
  n?: number;
  projectId: string;
  siteKey: string;
  action?: string;
  accessToken: string;
  page: Page;
  images: FlowImageUpload[];
}): Promise<{ status: number; images: GeneratedImage[] }> {
  if (!input.images?.length) throw new Error("FLOW_INVALID_REQUEST");
  if (input.images.length > 8) throw new Error("FLOW_INVALID_REQUEST");

  const imageInputs: FlowImageInput[] = [];
  for (const image of input.images) {
    const name = await uploadFlowImage({
      page: input.page,
      accessToken: input.accessToken,
      projectId: input.projectId,
      image,
    });
    imageInputs.push({
      imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
      name,
    });
  }

  return generateFlowImages({
    prompt: input.prompt,
    model: input.model,
    size: input.size,
    resolution: input.resolution,
    n: input.n ?? 1,
    projectId: input.projectId,
    siteKey: input.siteKey,
    action: input.action,
    accessToken: input.accessToken,
    page: input.page,
    imageInputs,
  });
}
