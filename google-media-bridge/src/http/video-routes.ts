import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccountRepository } from "../accounts/repository.js";
import type { Scheduler } from "../accounts/scheduler.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import type { BridgeConfig } from "../config.js";
import { readSession } from "../flow/session-broker.js";
import {
  createFlowVideoJob,
  downloadVideoToFile,
  pollFlowVideoJob,
  resolveVideoKind,
  type CreateVideoInput,
  type VideoUpstreamState,
} from "../flow/video.js";
import type { JobRepository } from "../jobs/repository.js";
import { encryptJSON, decryptJSON } from "../security/vault.js";
import { requireApiKey } from "./auth.js";

const FLOW_VIDEO_MODELS = [
  "flow-video-fast-4s",
  "flow-omni-flash",
  "flow-veo-3.1-fast",
  "flow-veo-3.1-lite",
  "flow-veo-3.1-quality",
] as const;

const videoBody = z.object({
  model: z.enum([...FLOW_VIDEO_MODELS, "grok-imagine-video"]).default("flow-veo-3.1-fast"),
  prompt: z.string().min(1).max(20_000),
  duration: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)]).default(4),
  aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
  size: z.string().optional(),
});

function mapAspect(size?: string, aspect?: "16:9" | "9:16"): "16:9" | "9:16" {
  if (aspect) return aspect;
  if (size === "9:16" || size === "720x1280") return "9:16";
  return "16:9";
}

export function registerVideoRoutes(
  app: FastifyInstance,
  deps: {
    config: BridgeConfig;
    accounts: AccountRepository;
    scheduler: Scheduler;
    browsers: BrowserWorkerPool;
    jobs: JobRepository;
  },
) {
  // --- Helpers (same pattern as image-routes.ts) ---

  function errorStatus(message: string): number {
    if (message.includes("FLOW_POOL_UNAVAILABLE")) return 503;
    if (message.includes("FLOW_INVALID_REQUEST")) return 400;
    if (
      message.includes("FLOW_RECAPTCHA_FAILED") ||
      message.includes("FLOW_RECAPTCHA_UNAVAILABLE")
    ) {
      return 502;
    }
    return 502;
  }

  function isRecaptchaError(message: string): boolean {
    return (
      message.includes("FLOW_RECAPTCHA_FAILED") ||
      message.includes("FLOW_RECAPTCHA_UNAVAILABLE")
    );
  }

  function isRetryableAccountError(message: string): boolean {
    return message.includes("FLOW_REAUTH_REQUIRED") || isRecaptchaError(message);
  }

  function recordError(accountId: string, message: string): void {
    if (message.includes("FLOW_REAUTH_REQUIRED")) {
      deps.scheduler.applyHttpResult(accountId, 401, 0);
    } else if (message.includes("FLOW_QUOTA_EXCEEDED")) {
      deps.scheduler.applyHttpResult(accountId, 429, 0);
    } else if (message.includes("FLOW_RECAPTCHA_UNAVAILABLE")) {
      deps.scheduler.applyCooldown(accountId, 60_000, "recaptcha_unavailable");
    } else if (message.includes("FLOW_RECAPTCHA_FAILED")) {
      deps.scheduler.applyCooldown(accountId, 3 * 60_000, "recaptcha");
    }
  }

  async function createVideoOnAccount(
    accountId: string,
    video: CreateVideoInput,
    opts?: { proxy?: boolean },
  ) {
    const account = deps.accounts.get(accountId);
    if (!account?.projectId || !(account.siteKey || deps.config.recaptchaSiteKey)) {
      throw new Error("FLOW_REAUTH_REQUIRED");
    }
    const browser = await deps.browsers.forAccount(account.id, { proxy: opts?.proxy !== false });
    const session = await readSession(browser.page);
    const upstream = await createFlowVideoJob({
      page: browser.page,
      accessToken: session.accessToken,
      projectId: account.projectId,
      siteKey: account.siteKey || deps.config.recaptchaSiteKey!,
      action: "VIDEO_GENERATION",
      video,
    });
    await browser.persist().catch(() => undefined);
    return { upstream, accountId: account.id };
  }

  async function createVideo(
    request: FastifyRequest,
    reply: FastifyReply,
    video: CreateVideoInput,
  ) {
    requireApiKey(request, deps.config.apiKey);
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey =
      (typeof idempotencyHeader === "string" && idempotencyHeader) || randomUUID();

    const existing = deps.jobs.getByIdempotencyKey(idempotencyKey);
    if (existing) return { request_id: existing.id };

    let leaseAccountId: string | null = null;
    try {
      const lease = deps.scheduler.acquire("video");
      leaseAccountId = lease.accountId;

      let result: { upstream: VideoUpstreamState; accountId: string } | undefined;
      try {
        result = await createVideoOnAccount(leaseAccountId, video, { proxy: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "FLOW_UPSTREAM_REJECTED";

        // Auto-fallback: proxy recaptcha fail → same account direct.
        if (isRecaptchaError(msg)) {
          try {
            result = await createVideoOnAccount(leaseAccountId, video, { proxy: false });
            deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
          } catch (directError) {
            const directMsg =
              directError instanceof Error ? directError.message : "FLOW_UPSTREAM_REJECTED";
            recordError(leaseAccountId, directMsg);
          }
        }

        // reauth / reCAPTCHA fallback: thử account khác.
        if (!result && isRetryableAccountError(msg)) {
          recordError(leaseAccountId, msg);
          deps.scheduler.release(leaseAccountId);
          leaseAccountId = null;

          try {
            const retryLease = deps.scheduler.acquire("video");
            leaseAccountId = retryLease.accountId;
            // Try direct first on fallback — proxy already failed on prior account.
            try {
              result = await createVideoOnAccount(leaseAccountId, video, { proxy: false });
            } catch {
              result = await createVideoOnAccount(leaseAccountId, video, { proxy: true });
            }
            deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
          } catch (retryError) {
            const retryMsg =
              retryError instanceof Error ? retryError.message : "FLOW_UPSTREAM_REJECTED";
            if (leaseAccountId) recordError(leaseAccountId, retryMsg);
            const code = retryMsg.startsWith("FLOW_") ? retryMsg.split(" ")[0] : "FLOW_UPSTREAM_REJECTED";
            return reply.code(errorStatus(retryMsg)).send({ error: { message: code, code } });
          }
        }

        if (!result) throw error; // re-throw original if nothing worked
      }

      if (!result) throw new Error("FLOW_UPSTREAM_REJECTED");

      deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
      const kind = resolveVideoKind(video);
      const jobId = randomUUID();
      deps.scheduler.bindJob(jobId, result.accountId);
      deps.jobs.create({
        id: jobId,
        idempotencyKey,
        kind,
        accountId: result.accountId,
        encryptedUpstreamState: encryptJSON(deps.config.vaultKey, result.upstream),
      });
      deps.jobs.update(jobId, { status: "scheduled", progress: 5 });
      return { request_id: jobId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "FLOW_UPSTREAM_REJECTED";
      if (leaseAccountId) recordError(leaseAccountId, message);
      const code = message.startsWith("FLOW_") ? message.split(" ")[0] : "FLOW_UPSTREAM_REJECTED";
      return reply.code(errorStatus(message)).send({ error: { message: code, code } });
    } finally {
      if (leaseAccountId) deps.scheduler.release(leaseAccountId);
    }
  }

  app.post("/v1/videos/generations", async (request, reply) => {
    const body = videoBody.parse(request.body ?? {});
    return createVideo(request, reply, {
      prompt: body.prompt,
      duration: body.duration,
      aspectRatio: mapAspect(body.size, body.aspect_ratio),
      modelKey: body.model,
    });
  });

  app.post("/v1/videos/edits", async (request, reply) => {
    const body = z
      .object({
        model: z.enum([...FLOW_VIDEO_MODELS, "grok-imagine-video"]).default("flow-veo-3.1-fast"),
        prompt: z.string().min(1).max(20_000),
        duration: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)]).default(4),
        aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
        start_image_b64: z.string().min(1),
        end_image_b64: z.string().optional(),
        start_image_mime: z.string().default("image/png"),
        end_image_mime: z.string().default("image/png"),
      })
      .parse(request.body ?? {});

    return createVideo(request, reply, {
      prompt: body.prompt,
      duration: body.duration,
      aspectRatio: body.aspect_ratio,
      modelKey: body.model,
      startImage: {
        data: Buffer.from(body.start_image_b64, "base64"),
        mimeType: body.start_image_mime,
      },
      endImage: body.end_image_b64
        ? { data: Buffer.from(body.end_image_b64, "base64"), mimeType: body.end_image_mime }
        : undefined,
    });
  });

  app.get("/v1/videos/:id", async (request, reply) => {
    requireApiKey(request, deps.config.apiKey);
    const { id } = request.params as { id: string };
    const job = deps.jobs.get(id);
    if (!job) return reply.code(404).send({ error: { message: "not found" } });
    if (job.status === "completed") {
      return { request_id: job.id, status: "done", progress: 100 };
    }
    if (job.status === "failed") {
      return {
        request_id: job.id,
        status: "failed",
        progress: job.progress,
        error: job.errorCode || "FLOW_UPSTREAM_REJECTED",
      };
    }
    return { request_id: job.id, status: "pending", progress: job.progress };
  });

  app.get("/v1/videos/:id/content", async (request, reply) => {
    requireApiKey(request, deps.config.apiKey);
    const { id } = request.params as { id: string };
    const job = deps.jobs.get(id);
    if (!job?.outputPath || !existsSync(job.outputPath)) {
      return reply.code(404).send({ error: { message: "content not ready" } });
    }
    reply.header("content-type", "video/mp4");
    return reply.send(createReadStream(job.outputPath));
  });

  async function pollOne(jobId: string): Promise<void> {
    const job = deps.jobs.get(jobId);
    if (!job || !job.encryptedUpstreamState) return;
    if (job.status === "completed" || job.status === "failed") return;
    const account = deps.accounts.get(job.accountId);
    if (!account) {
      deps.jobs.update(jobId, {
        status: "failed",
        errorCode: "FLOW_REAUTH_REQUIRED",
        errorMessage: "account missing",
        progress: 100,
      });
      deps.scheduler.markJobTerminal(jobId);
      return;
    }
    const upstream = decryptJSON<VideoUpstreamState>(
      deps.config.vaultKey,
      job.encryptedUpstreamState,
    );
    const browser = await deps.browsers.forAccount(account.id);
    // Poll chỉ cần token; bỏ verify scope qua googleapis để tránh reauth giả (blip mạng).
    const session = await readSession(browser.page, { verifyScope: false });
    const polled = await pollFlowVideoJob({
      page: browser.page,
      accessToken: session.accessToken,
      upstream,
    });
    if (polled.status === "pending") {
      deps.jobs.update(jobId, { status: "active", progress: polled.progress });
      return;
    }
    if (polled.status === "failed") {
      deps.jobs.update(jobId, {
        status: "failed",
        errorCode: "FLOW_UPSTREAM_REJECTED",
        errorMessage: polled.error,
        progress: 100,
      });
      deps.scheduler.markJobTerminal(jobId);
      return;
    }
    const outputPath = await downloadVideoToFile({
      page: browser.page,
      videoUrl: polled.videoUrl,
      dataDir: deps.config.dataDir,
      jobId,
    });
    deps.jobs.update(jobId, {
      status: "completed",
      outputPath,
      progress: 100,
      errorCode: null,
      errorMessage: null,
    });
    deps.scheduler.markJobTerminal(jobId);
    await browser.persist().catch(() => undefined);
  }

  (app as FastifyInstance & { flowPollVideoJob?: typeof pollOne }).flowPollVideoJob = pollOne;
}
