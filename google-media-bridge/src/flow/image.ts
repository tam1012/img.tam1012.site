import type { Page } from "playwright-core";
import { createRecaptchaToken } from "./token-factory.js";

// Verified Phase 1 contract for Flow image generation.
export const FLOW_IMAGE_ENDPOINT =
  "https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages";

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024" | string;

export type FlowImageModelName = "NARWHAL" | "GEM_PIX_2" | "HARBOR_SEAL";

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

export function mapAspectRatio(size: ImageSize): string {
  const s = String(size || "").trim();
  if (s === "1024x1792" || s === "9:16" || s === "3:4" || s === "2:3") {
    return "IMAGE_ASPECT_RATIO_PORTRAIT";
  }
  if (s === "1792x1024" || s === "16:9" || s === "4:3" || s === "3:2") {
    return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  }
  if (s === "1:1" || s === "1024x1024") {
    return "IMAGE_ASPECT_RATIO_SQUARE";
  }
  // Fallback: width x height
  const m = s.match(/^(\d+)x(\d+)$/i);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (h > w) return "IMAGE_ASPECT_RATIO_PORTRAIT";
    if (w > h) return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  }
  return "IMAGE_ASPECT_RATIO_SQUARE";
}

export type GenerateImageInput = {
  prompt: string;
  model?: string;
  size?: ImageSize;
  n?: number;
  projectId: string;
  siteKey: string;
  action?: string;
  accessToken: string;
  page: Page;
};

export type GeneratedImage = {
  b64_json?: string;
  bytes: number;
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

export async function generateFlowImages(input: GenerateImageInput): Promise<{
  status: number;
  images: GeneratedImage[];
}> {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error("FLOW_INVALID_REQUEST");
  const n = Math.min(Math.max(input.n ?? 1, 1), 4);
  const imageModelName = mapImageModel(input.model ?? "flow-nano-banana-2");
  const imageAspectRatio = mapAspectRatio(input.size ?? "1024x1024");
  const action = input.action ?? "IMAGE_GENERATION";

  let recaptchaFailures = 0;
  let lastStatus = 0;
  let lastRaw = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    let token: string;
    try {
      token = await createRecaptchaToken(input.page, { siteKey: input.siteKey, action });
    } catch {
      recaptchaFailures += 1;
      if (recaptchaFailures >= 2) throw new Error("FLOW_RECAPTCHA_FAILED");
      continue;
    }

    const endpoint = FLOW_IMAGE_ENDPOINT.replace("{projectId}", input.projectId);
    const result = await input.page.evaluate(
      async ([endpointUrl, bearer, tokenValue, project, model, aspect, text, count]) => {
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
          imageInputs: [] as unknown[],
        }));
        const body = {
          clientContext,
          mediaGenerationContext: { batchId },
          useNewMedia: true,
          requests,
        };
        const res = await fetch(endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify(body),
        });
        const raw = await res.text();
        return { status: res.status, raw };
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
      const urls = extractFifeUrls(result.raw);
      const images: GeneratedImage[] = [];
      for (const url of urls.slice(0, n)) {
        const bin = await input.page.evaluate(async (u) => {
          const r = await fetch(u);
          if (!r.ok) return null;
          const buf = await r.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        }, url);
        if (bin) images.push({ b64_json: bin, bytes: Math.floor((bin.length * 3) / 4) });
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
    lastStatus ? `FLOW_UPSTREAM_REJECTED status=${lastStatus}` : "FLOW_UPSTREAM_REJECTED",
  );
}
