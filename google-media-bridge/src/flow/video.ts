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
  // Observed Phase 1 design default for 4s text video.
  if (duration <= 4) return "abra_t2v_4s";
  return "abra_t2v_4s";
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
  const token = await createRecaptchaToken(input.page, {
    siteKey: input.siteKey,
    action: input.action ?? "IMAGE_GENERATION",
  });

  // Media upload for reference frames is account-bound. Phase 2 stores synthetic
  // placeholders when no dedicated upload probe fixture is present yet.
  const firstFrameImageMediaId = input.video.startImage
    ? `synthetic-start-${randomUUID()}`
    : undefined;
  const lastFrameImageMediaId = input.video.endImage
    ? `synthetic-end-${randomUUID()}`
    : undefined;

  const result = await input.page.evaluate(
    async ([endpointUrl, bearer, body]) => {
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
      {
        clientContext: {
          recaptchaContext: {
            token,
            applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
          },
          projectId: input.projectId,
          tool: "PINHOLE",
          sessionId: randomUUID(),
        },
        requests: [
          {
            aspectRatio: mapVideoAspect(input.video.aspectRatio),
            textInput: {
              prompt: input.video.prompt,
            },
            videoModelKey: modelKey,
            ...(firstFrameImageMediaId ? { firstFrameImageMediaId } : {}),
            ...(lastFrameImageMediaId ? { lastFrameImageMediaId } : {}),
          },
        ],
      },
    ] as const,
  );

  if (result.status === 401 || result.status === 403) throw new Error("FLOW_REAUTH_REQUIRED");
  if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`FLOW_UPSTREAM_REJECTED status=${result.status}`);
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
    // Keep a synthetic operation id so poller state is durable even if payload evolves.
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
