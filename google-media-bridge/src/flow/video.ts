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
  modelKey?: string;
  startImage?: { data: Buffer; mimeType: string };
  endImage?: { data: Buffer; mimeType: string };
};

export type VideoUpstreamState = {
  operations: string[];
  projectId: string;
  modelKey: string;
  endpoint: string;
  // Raw operation names/workflows captured from create response for polling.
  workflows?: string[];
  rawCreateKeys?: string[];
};

export function resolveVideoKind(input: CreateVideoInput): JobKind {
  if (input.endImage && !input.startImage) {
    throw new Error("FLOW_INVALID_REQUEST");
  }
  if (input.startImage && input.endImage) return "start_end_video";
  if (input.startImage) return "image_video";
  return "text_video";
}

const MODEL_KEY_MAP: Record<string, string> = {
  "flow-veo-3.1-fast": "veo_3_1_t2v_fast",
  "flow-veo-3.1-lite": "veo_3_1_t2v_lite",
  "flow-veo-3.1-quality": "veo_3_1_t2v_quality",
  "flow-video-fast-4s": "abra_t2v_4s",
};

// Omni Flash mã hoá thời lượng vào model key (abra_t2v_4s/6s/8s/10s; i2v khi có ảnh đầu vào).
export function mapVideoModelKey(model?: string, duration?: 4 | 6 | 8 | 10, kind?: JobKind): string {
  if (model === "flow-omni-flash") {
    const prefix = kind === "image_video" || kind === "start_end_video" ? "abra_i2v" : "abra_t2v";
    return `${prefix}_${duration ?? 4}s`;
  }
  if (model && MODEL_KEY_MAP[model]) return MODEL_KEY_MAP[model];
  return "veo_3_1_t2v_fast";
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
  const modelKey = mapVideoModelKey(input.video.modelKey, input.video.duration, kind);

  let recaptchaFailures = 0;
  let lastStatus = 0;
  let lastRaw = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    // Flow frontend uses grecaptcha action VIDEO_GENERATION for all video creates.
    let token: string;
    try {
      token = await createRecaptchaToken(input.page, {
        siteKey: input.siteKey,
        action: input.action && input.action !== "IMAGE_GENERATION" ? input.action : "VIDEO_GENERATION",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // Script chưa sẵn: không đốt thêm attempt — ném thẳng để route map soft cooldown.
      if (msg.includes("FLOW_RECAPTCHA_UNAVAILABLE")) throw err;
      recaptchaFailures += 1;
      if (recaptchaFailures >= 2) throw new Error("FLOW_RECAPTCHA_FAILED");
      continue;
    }

    // Media upload for reference frames is account-bound. Until upload is implemented,
    // image/start-end modes pass synthetic IDs only for wiring tests and will fail upstream.
    const firstFrameImageMediaId = input.video.startImage
      ? `synthetic-start-${randomUUID()}`
      : undefined;
    const lastFrameImageMediaId = input.video.endImage
      ? `synthetic-end-${randomUUID()}`
      : undefined;

    const sessionId = `;${Date.now()}`;
    const batchId = randomUUID();
    // Captured live UI shape (text video):
    // clientContext: projectId, tool=PINHOLE, userPaygateTier, sessionId, recaptchaContext
    // mediaGenerationContext: batchId, audioFailurePreference
    // requests[0]: aspectRatio, textInput.structuredPrompt, videoModelKey, seed, metadata
    // useV2ModelConfig: true
    const clientContext: Record<string, unknown> = {
      projectId: input.projectId,
      tool: "PINHOLE",
      userPaygateTier: process.env.FLOW_VIDEO_PAYGATE_TIER || "PAYGATE_TIER_ONE",
      sessionId,
      recaptchaContext: {
        token,
        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
      },
    };

    const requestItem: Record<string, unknown> = {
      aspectRatio: mapVideoAspect(input.video.aspectRatio),
      textInput: {
        structuredPrompt: { parts: [{ text: input.video.prompt }] },
      },
      videoModelKey: modelKey,
      seed: Math.floor(Math.random() * 100_000),
      metadata: {},
    };
    if (firstFrameImageMediaId) requestItem.firstFrameImageMediaId = firstFrameImageMediaId;
    if (lastFrameImageMediaId) requestItem.lastFrameImageMediaId = lastFrameImageMediaId;

    const body: Record<string, unknown> = {
      clientContext,
      mediaGenerationContext: {
        batchId,
        audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
      },
      requests: [requestItem],
      useV2ModelConfig: true,
    };

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

    lastStatus = result.status;
    lastRaw = result.raw;

    // Helpful for live diagnosis (no tokens; body may include opaque error text only).
    try {
      const preview = result.raw.replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 240);
      process.stderr.write(`flow_video_upstream status=${result.status} preview=${preview}\n`);
    } catch {
      /* ignore */
    }

    // 401: access token thực sự hết hạn — reauth required.
    if (result.status === 401) {
      throw new Error("FLOW_REAUTH_REQUIRED");
    }
    // 403 cần phân biệt reCAPTCHA (risk score / unusual activity) với permission thật.
    if (result.status === 403) {
      if (/recaptcha|captcha|UNUSUAL_ACTIVITY|PERMISSION_DENIED/i.test(result.raw)) {
        recaptchaFailures += 1;
        if (attempt === 0) continue;
        throw new Error("FLOW_RECAPTCHA_FAILED");
      }
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
    let workflows: string[] = [];
    let rawCreateKeys: string[] = [];
  try {
    const parsed = JSON.parse(result.raw) as {
      operations?: Array<{ name?: string; operation?: { name?: string } } | string>;
      names?: string[];
      workflows?: Array<{ name?: string; workflowId?: string }>;
      media?: Array<Record<string, unknown>> | Record<string, unknown>;
    };
    rawCreateKeys = Object.keys(parsed);
    operations =
      parsed.operations
        ?.map((op) => {
          if (typeof op === "string") return op;
          return op.name || op.operation?.name || "";
        })
        .filter(Boolean) ??
      parsed.names ??
      [];
    workflows =
      parsed.workflows
        ?.map((w) => w.name || w.workflowId || "")
        .filter(Boolean) ?? [];

    const mediaItems = Array.isArray(parsed.media)
      ? parsed.media
      : parsed.media
        ? [parsed.media]
        : [];
    const mediaNames = mediaItems
      .map((m) =>
        String(
          m.name ||
            m.mediaGenerationId ||
            m.operationName ||
            m.workflowId ||
            "",
        ),
      )
      .filter(Boolean);
    try {
      const mediaShape = mediaItems.map((m) => Object.keys(m).sort());
      process.stderr.write(
        `flow_video_media_shape=${JSON.stringify(mediaShape)} mediaNames=${mediaNames.length}\n`,
      );
    } catch {
      /* ignore */
    }

    // Prefer media operation/generation names for status polling; workflow names alone return "Video not found".
    if (mediaNames.length > 0) {
      operations = mediaNames;
    } else if (operations.length === 0 && workflows.length > 0) {
      operations = [...workflows];
    }
    if (workflows.length === 0 && mediaNames.length > 0) {
      workflows = mediaNames;
    }
  } catch {
    operations = [];
  }
  if (operations.length === 0) {
    operations = [`synthetic-op-${randomUUID()}`];
  }

  try {
    process.stderr.write(
      `flow_video_create_keys=${JSON.stringify(rawCreateKeys)} ops=${operations.length} workflows=${workflows.length}\n`,
    );
  } catch {
    /* ignore */
  }

    return {
      operations,
      workflows,
      rawCreateKeys,
      projectId: input.projectId,
      modelKey,
      endpoint,
    };
  }

  throw new Error(
    lastStatus ? `FLOW_UPSTREAM_REJECTED status=${lastStatus}` : "FLOW_RECAPTCHA_FAILED",
  );
}

export type PollVideoResult =
  | { status: "pending"; progress: number }
  | { status: "done"; videoUrl: string; progress: number }
  | { status: "failed"; error: string; progress: number };

function collectHttpUrls(node: unknown, acc: string[] = [], depth = 0): string[] {
  if (depth > 8 || node == null) return acc;
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node)) acc.push(node);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectHttpUrls(item, acc, depth + 1);
    return acc;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectHttpUrls(v, acc, depth + 1);
    }
  }
  return acc;
}

function pickVideoUrl(urls: string[]): string {
  return (
    urls.find((u) => /fife|googlevideo|videoplayback|flow-content|\.mp4(?:\?|$)|mh\//i.test(u)) ||
    urls.find((u) => /\.mp4/i.test(u)) ||
    ""
  );
}

/**
 * Parse one status-check JSON body into a poll result.
 * Returns null when the body is empty/wrong shape so caller can try another payload.
 * (Bug cũ: HTTP 200 + operations rỗng → return pending ngay, bỏ qua payload đúng.)
 */
export function interpretPollResponse(raw: string): PollVideoResult | null {
  let parsed: {
    operations?: Array<Record<string, unknown>>;
    error?: { message?: string; status?: string };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }

  // Top-level API error (hiếm, thường đã bị HTTP non-2xx).
  if (parsed.error?.message && !parsed.operations?.length) {
    return {
      status: "failed",
      error: String(parsed.error.message).slice(0, 160),
      progress: 100,
    };
  }

  const op = parsed.operations?.[0];
  if (!op || typeof op !== "object") return null;

  const nested = (op.operation && typeof op.operation === "object"
    ? (op.operation as Record<string, unknown>)
    : undefined) as
    | {
        done?: boolean;
        error?: { message?: string };
        response?: unknown;
        metadata?: { status?: string; video?: { fifeUrl?: string; url?: string } };
      }
    | undefined;

  const status = String(
    op.status ||
      (op.metadata as { status?: string } | undefined)?.status ||
      nested?.metadata?.status ||
      "",
  ).toUpperCase();
  const done = Boolean(op.done || nested?.done);
  const errMsg =
    (op.error as { message?: string } | undefined)?.message || nested?.error?.message || "";

  const response = (op.response || nested?.response || {}) as {
    video?: { fifeUrl?: string; url?: string };
    fifeUrl?: string;
    generatedVideos?: Array<{ fifeUrl?: string; url?: string }>;
    media?: Array<{ video?: { fifeUrl?: string }; fifeUrl?: string; status?: string }>;
  };
  const metadataVideo =
    nested?.metadata?.video ||
    (op.metadata as { video?: { fifeUrl?: string; url?: string } } | undefined)?.video;

  const directUrl =
    metadataVideo?.fifeUrl ||
    metadataVideo?.url ||
    response.video?.fifeUrl ||
    response.video?.url ||
    response.fifeUrl ||
    response.generatedVideos?.[0]?.fifeUrl ||
    response.generatedVideos?.[0]?.url ||
    response.media?.[0]?.video?.fifeUrl ||
    response.media?.[0]?.fifeUrl ||
    "";

  const foundUrl = directUrl || pickVideoUrl(collectHttpUrls(parsed));

  // Fail terminal: failed status, or error message with fail/error/done.
  if (
    status.includes("MEDIA_GENERATION_STATUS_FAILED") ||
    (status.includes("FAIL") && !status.includes("FAILURE_PREFERENCE")) ||
    status.includes("ERROR") ||
    status.includes("CANCEL")
  ) {
    return {
      status: "failed",
      error: (errMsg || status || "PUBLIC_ERROR_UNKNOWN").slice(0, 160),
      progress: 100,
    };
  }
  if (
    errMsg &&
    (done ||
      /HIGH_TRAFFIC|DANGER_FILTER|UNUSUAL|SAFETY|BLOCK|REJECT|PUBLIC_ERROR/i.test(errMsg))
  ) {
    return { status: "failed", error: errMsg.slice(0, 160), progress: 100 };
  }

  if (
    status.includes("SUCCESS") ||
    status.includes("MEDIA_GENERATION_STATUS_SUCCESSFUL") ||
    (done && foundUrl)
  ) {
    if (!foundUrl) return { status: "pending", progress: 90 };
    return { status: "done", videoUrl: foundUrl, progress: 100 };
  }
  // URL already present and not failed → complete.
  if (foundUrl && !status.includes("FAIL") && !status.includes("ERROR")) {
    return { status: "done", videoUrl: foundUrl, progress: 100 };
  }
  if (done && !foundUrl && !errMsg) {
    return { status: "pending", progress: 85 };
  }
  if (
    status.includes("ACTIVE") ||
    status.includes("RUNNING") ||
    status.includes("MEDIA_GENERATION_STATUS_ACTIVE")
  ) {
    return { status: "pending", progress: 60 };
  }
  if (
    status.includes("SCHEDULED") ||
    status.includes("PENDING") ||
    status.includes("QUEUED") ||
    status.includes("MEDIA_GENERATION_STATUS_SCHEDULED") ||
    status.includes("MEDIA_GENERATION_STATUS_PENDING")
  ) {
    return { status: "pending", progress: 25 };
  }

  // Có operation object nhưng status lạ / rỗng: vẫn coi là tín hiệu hữu ích.
  if (status || errMsg || foundUrl || done) {
    return { status: "pending", progress: 15 };
  }
  return null;
}

export async function pollFlowVideoJob(input: {
  page: Page;
  accessToken: string;
  upstream: VideoUpstreamState;
}): Promise<PollVideoResult> {
  const operations = input.upstream.operations.filter(Boolean);
  const workflows = (input.upstream.workflows ?? []).filter(Boolean);
  const projectId = input.upstream.projectId;
  const clientContext = { projectId, tool: "PINHOLE" as const };

  // Ưu tiên shape live Omni/Veo (logs production): operations[].operation.name + status + mediaGenerationId.
  // Các shape rỗng 200 phải CONTINUE, không return sớm (bug cũ làm job kẹt progress 5/10).
  const payloads: unknown[] = [
    {
      clientContext,
      operations: operations.map((name) => ({ operation: { name } })),
    },
    {
      clientContext,
      operations: operations.map((name) => ({ name })),
    },
    {
      clientContext,
      media: operations.map((name) => ({ name, projectId })),
    },
    { operations: operations.map((name) => ({ operation: { name } })) },
    { operations: operations.map((name) => ({ name })) },
    { operations },
    {
      clientContext,
      media: (workflows.length ? workflows : operations).map((name) => ({ name, projectId })),
    },
    { workflows: workflows.map((name) => ({ name })) },
    { workflowIds: workflows.length ? workflows : operations },
    { operationIds: operations },
    { names: operations },
  ];

  let lastStatus = 0;
  let lastRaw = "";
  let bestPending: PollVideoResult | null = null;

  for (const payload of payloads) {
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
      [STATUS_ENDPOINT, input.accessToken, payload] as const,
    );
    lastStatus = result.status;
    lastRaw = result.raw;

    // 401: token chết. 403 trên poll thường là payload/permission — thử shape khác, không reauth ngay.
    if (result.status === 401) throw new Error("FLOW_REAUTH_REQUIRED");
    if (result.status === 429) throw new Error("FLOW_QUOTA_EXCEEDED");
    if (result.status === 403) continue;
    if (result.status < 200 || result.status >= 300) continue;

    try {
      const parsedPreview = JSON.parse(result.raw) as unknown;
      const keyWalk = (node: unknown, prefix = "", depth = 0): string[] => {
        if (depth > 3 || !node || typeof node !== "object") return [];
        if (Array.isArray(node)) {
          return node.length ? keyWalk(node[0], `${prefix}[]`, depth + 1) : [`${prefix}:[]`];
        }
        const out: string[] = [];
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          const path = prefix ? `${prefix}.${k}` : k;
          out.push(path);
          if (v && typeof v === "object") out.push(...keyWalk(v, path, depth + 1));
        }
        return out;
      };
      process.stderr.write(
        `flow_video_poll_keys=${JSON.stringify(keyWalk(parsedPreview).slice(0, 80))}\n`,
      );
    } catch {
      /* ignore */
    }

    const interpreted = interpretPollResponse(result.raw);
    if (!interpreted) continue;

    if (interpreted.status === "done" || interpreted.status === "failed") {
      try {
        process.stderr.write(
          `flow_video_poll_result status=${interpreted.status} progress=${interpreted.progress}\n`,
        );
      } catch {
        /* ignore */
      }
      return interpreted;
    }

    // Giữ pending “tốt nhất” (progress cao hơn = payload hiểu status rõ hơn).
    if (
      !bestPending ||
      (interpreted.status === "pending" &&
        bestPending.status === "pending" &&
        interpreted.progress > bestPending.progress)
    ) {
      bestPending = interpreted;
    }
  }

  if (bestPending) return bestPending;

  try {
    const preview = lastRaw.replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 240);
    process.stderr.write(`flow_video_poll_upstream status=${lastStatus} preview=${preview}\n`);
  } catch {
    /* ignore */
  }
  // Transient poll payload mismatch should not kill the job immediately.
  return {
    status: "pending",
    progress: lastStatus ? 5 : 1,
  };
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
