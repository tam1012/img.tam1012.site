import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type { JobKind } from "../types.js";
import { createRecaptchaToken } from "./token-factory.js";

export type CreateVideoInput = {
  prompt: string;
  duration: 4 | 6 | 8 | 10;
  aspectRatio: "16:9" | "9:16";
  startImage?: { data: Buffer; mimeType: string };
  endImage?: { data: Buffer; mimeType: string };
};

export type VideoUpstreamState = {
  operations: string[];
  projectId: string;
  modelKey: string;
  endpoint: string;
};

export function resolveVideoKind(input: CreateVideoInput): JobKind {
  if (input.endImage && !input.startImage) {
    throw new Error("FLOW_INVALID_REQUEST");
  }
  if (input.startImage && input.endImage) return "start_end_video";
  if (input.startImage) return "image_video";
  return "text_video";
}

export function mapVideoModelKey(duration: number): string {
  // Client usage keys observed in Flow bundle.
  if (duration <= 4) return "veo_3_0_t2v";
  return "veo_3_0_t2v";
}

export function mapVideoEndpoint(kind: JobKind): string {
  if (kind === "text_video") {
    return "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
  }
  if (kind === "image_video") {
    return "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage";
  }
  return "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage";
}

export function mapVideoAspect(aspectRatio: "16:9" | "9:16"): string {
  return aspectRatio === "9:16" ? "VIDEO_ASPECT_RATIO_PORTRAIT" : "VIDEO_ASPECT_RATIO_LANDSCAPE";
}

const STATUS_ENDPOINT =
  "https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus";

export async function createFlowVideoJob(input: {
  page: Page;
  accessToken: string;
  projectId: string;
  siteKey: string;
  action?: string;
  video: CreateVideoInput;
}): Promise<VideoUpstreamState> {
  const kind = resolveVideoKind(input.video);
  const endpoint = mapVideoEndpoint(kind);
  const modelKey = mapVideoModelKey(input.video.duration);
  // Flow frontend uses grecaptcha action VIDEO_GENERATION for all video creates.
  const token = await createRecaptchaToken(input.page, {
    siteKey: input.siteKey,
    action: input.action && input.action !== "IMAGE_GENERATION" ? input.action : "VIDEO_GENERATION",
  });

  // Media upload for reference frames is account-bound. Until upload is implemented,
  // image/start-end modes pass synthetic IDs only for wiring tests and will fail upstream.
  const firstFrameImageMediaId = input.video.startImage
    ? `synthetic-start-${randomUUID()}`
    : undefined;
  const lastFrameImageMediaId = input.video.endImage
    ? `synthetic-end-${randomUUID()}`
    : undefined;

  const sessionId = randomUUID();
  const batchId = randomUUID();
  const clientContext: Record<string, unknown> = {
    recaptchaContext: {
      token,
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
    },
    projectId: input.projectId,
    sessionId,
  };
  // Tool is optional for some video paths; prefer VIDEO_FX when present in client builds.
  if (process.env.FLOW_VIDEO_TOOL !== "none") {
    clientContext.tool = process.env.FLOW_VIDEO_TOOL || "VIDEO_FX";
  }

  const requestItem: Record<string, unknown> = {
    aspectRatio: mapVideoAspect(input.video.aspectRatio),
    textInput: {
      prompt: input.video.prompt,
      expandedPrompt: input.video.prompt,
      structuredPrompt: { parts: [{ text: input.video.prompt }] },
    },
    videoModelKey: modelKey,
    seed: Math.floor(Math.random() * 2_000_000_000),
  };
  if (firstFrameImageMediaId) requestItem.firstFrameImageMediaId = firstFrameImageMediaId;
  if (lastFrameImageMediaId) requestItem.lastFrameImageMediaId = lastFrameImageMediaId;

  const body: Record<string, unknown> = {
    clientContext,
    mediaGenerationContext: { batchId },
    requests: [requestItem],
  };
  // Non-text paths in the client set useV2ModelConfig.
  if (kind !== "text_video") body.useV2ModelConfig = true;

  const result = await input.page.evaluate(
    async ([endpointUrl, bearer, payload]) => {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      return { status: res.status, raw };
    },
    [endpoint, input.accessToken, body] as const,
  );

  // Helpful for live diagnosis (no tokens; body may include opaque error text only).
  try {
    const preview = result.raw.replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 240);
    process.stderr.write(`flow_video_upstream status=${result.status} preview=${preview}\n`);
  } catch {
    /* ignore */
  }

  if (result.status === 401 || result.status === 403) {
    // Keep distinct from permanent reauth so a bad payload does not kill the pool.
    throw new Error(`FLOW_UPSTREAM_REJECTED status=${result.status}`);
  }
  if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
  if (result.status < 200 || result.status >= 300) {
    let detail = "";
    try {
      const parsed = JSON.parse(result.raw) as { error?: { message?: string } };
      detail = parsed.error?.message ? ` ${parsed.error.message.slice(0, 120)}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`FLOW_UPSTREAM_REJECTED status=${result.status}${detail}`);
  }

  let operations: string[] = [];
  try {
    const parsed = JSON.parse(result.raw) as {
      operations?: Array<{ name?: string; operation?: { name?: string } }>;
      names?: string[];
    };
    operations =
      parsed.operations
        ?.map((op) => op.name || op.operation?.name || "")
        .filter(Boolean) ??
      parsed.names ??
      [];
  } catch {
    operations = [];
  }
  if (operations.length === 0) {
    operations = [`synthetic-op-${randomUUID()}`];
  }

  return {
    operations,
    projectId: input.projectId,
    modelKey,
    endpoint,
  };
}

export type PollVideoResult =
  | { status: "pending"; progress: number }
  | { status: "done"; videoUrl: string; progress: number }
  | { status: "failed"; error: string; progress: number };

export async function pollFlowVideoJob(input: {
  page: Page;
  accessToken: string;
  upstream: VideoUpstreamState;
}): Promise<PollVideoResult> {
  const result = await input.page.evaluate(
    async ([endpointUrl, bearer, operations]) => {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ operations }),
      });
      const raw = await res.text();
      return { status: res.status, raw };
    },
    [STATUS_ENDPOINT, input.accessToken, input.upstream.operations] as const,
  );

  if (result.status === 401 || result.status === 403) throw new Error("FLOW_REAUTH_REQUIRED");
  if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
  if (result.status < 200 || result.status >= 300) {
    return { status: "failed", error: `status=${result.status}`, progress: 0 };
  }

  try {
    const parsed = JSON.parse(result.raw) as {
      operations?: Array<{
        status?: string;
        done?: boolean;
        error?: { message?: string };
        response?: { video?: { fifeUrl?: string }; fifeUrl?: string };
      }>;
    };
    const op = parsed.operations?.[0];
    if (!op) return { status: "pending", progress: 10 };
    const status = String(op.status || "").toUpperCase();
    if (op.error?.message) return { status: "failed", error: op.error.message.slice(0, 160), progress: 100 };
    if (status.includes("SUCCESS") || op.done) {
      const videoUrl = op.response?.video?.fifeUrl || op.response?.fifeUrl || "";
      if (!videoUrl) return { status: "pending", progress: 90 };
      return { status: "done", videoUrl, progress: 100 };
    }
    if (status.includes("ACTIVE")) return { status: "pending", progress: 60 };
    if (status.includes("SCHEDULED") || status.includes("PENDING")) {
      return { status: "pending", progress: 25 };
    }
    return { status: "pending", progress: 15 };
  } catch {
    return { status: "pending", progress: 5 };
  }
}

export async function downloadVideoToFile(input: {
  page: Page;
  videoUrl: string;
  dataDir: string;
  jobId: string;
}): Promise<string> {
  const dir = join(input.dataDir, "videos");
  mkdirSync(dir, { recursive: true });
  const outputPath = join(dir, `${input.jobId}.mp4`);
  const b64 = await input.page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download status ${res.status}`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }, input.videoUrl);
  writeFileSync(outputPath, Buffer.from(b64, "base64"));
  return outputPath;
}
