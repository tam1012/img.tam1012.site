import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountRepository } from "../accounts/repository.js";
import type { Scheduler } from "../accounts/scheduler.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import type { BridgeConfig } from "../config.js";
import { editFlowImages, generateFlowImages } from "../flow/image.js";
import { readSession } from "../flow/session-broker.js";
import { requireApiKey } from "./auth.js";

const FLOW_IMAGE_MODELS = [
  "flow-nano-banana-2",
  "flow-nano-banana-pro",
  "NARWHAL",
  "GEM_PIX_2",
  "HARBOR_SEAL",
] as const;

const imageRequest = z.object({
  model: z.enum(FLOW_IMAGE_MODELS).default("flow-nano-banana-2"),
  prompt: z.string().min(1).max(20_000),
  size: z.string().default("1024x1024"),
  n: z.number().int().min(1).max(4).default(1),
  response_format: z.enum(["b64_json", "url"]).default("b64_json"),
});

const editImageBody = z.object({
  model: z.enum(FLOW_IMAGE_MODELS).default("flow-nano-banana-2"),
  prompt: z.string().min(1).max(20_000),
  size: z.string().default("1024x1024"),
  n: z.number().int().min(1).max(4).default(1),
  response_format: z.enum(["b64_json", "url"]).default("b64_json"),
  images: z
    .array(
      z.object({
        b64_json: z.string().min(1),
        mime_type: z.string().min(3).max(100).default("image/png"),
      }),
    )
    .min(1)
    .max(8),
});

export function registerImageRoutes(
  app: FastifyInstance,
  deps: {
    config: BridgeConfig;
    accounts: AccountRepository;
    scheduler: Scheduler;
    browsers: BrowserWorkerPool;
  },
) {
  async function withAccountSession<T>(
    accountId: string,
    run: (ctx: {
      page: Awaited<ReturnType<BrowserWorkerPool["forAccount"]>>["page"];
      accessToken: string;
      projectId: string;
      siteKey: string;
    }) => Promise<T>,
    opts?: { proxy?: boolean },
  ): Promise<T> {
    const account = deps.accounts.get(accountId);
    if (!account?.projectId || !(account.siteKey || deps.config.recaptchaSiteKey)) {
      throw new Error("FLOW_REAUTH_REQUIRED");
    }
    const browser = await deps.browsers.forAccount(account.id, { proxy: opts?.proxy !== false });
    const session = await readSession(browser.page);
    const result = await run({
      page: browser.page,
      accessToken: session.accessToken,
      projectId: account.projectId,
      siteKey: account.siteKey || deps.config.recaptchaSiteKey!,
    });
    await browser.persist().catch(() => undefined);
    return result;
  }

  // Chạy generate ảnh với account đã được acquire. Không xử lý error mapping.
  async function doGenerate(accountId: string, body: z.infer<typeof imageRequest>, proxyOpts?: { proxy?: boolean }) {
    return withAccountSession(accountId, (ctx) =>
      generateFlowImages({
        page: ctx.page,
        accessToken: ctx.accessToken,
        projectId: ctx.projectId,
        siteKey: ctx.siteKey,
        action: deps.config.recaptchaAction,
        prompt: body.prompt,
        model: body.model,
        size: body.size,
        n: body.n,
      }),
    proxyOpts);
  }

  async function doEdit(accountId: string, body: z.infer<typeof editImageBody>, proxyOpts?: { proxy?: boolean }) {
    return withAccountSession(accountId, (ctx) =>
      editFlowImages({
        page: ctx.page,
        accessToken: ctx.accessToken,
        projectId: ctx.projectId,
        siteKey: ctx.siteKey,
        action: deps.config.recaptchaAction,
        prompt: body.prompt,
        model: body.model,
        size: body.size,
        n: body.n,
        images: body.images.map((img, index) => {
          const mime = (img.mime_type || "image/png").split(";")[0].trim() || "image/png";
          return {
            data: Buffer.from(img.b64_json, "base64"),
            mimeType: mime,
            fileName: `edit-${index + 1}.${mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png"}`,
          };
        }),
      }),
    proxyOpts);
  }

  function errorStatus(message: string): number {
    if (message.includes("FLOW_UNAUTHORIZED")) return 401;
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
      // Script chưa sẵn / page cold — cooldown ngắn, không đốt pool 15 phút.
      deps.scheduler.applyCooldown(accountId, 60_000, "recaptcha_unavailable");
    } else if (message.includes("FLOW_RECAPTCHA_FAILED")) {
      // Risk score / unusual activity tạm thời — 3 phút thay vì 15 phút quota.
      deps.scheduler.applyCooldown(accountId, 3 * 60_000, "recaptcha");
    }
  }

  async function runWithLease(
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    work: (accountId: string, opts?: { proxy?: boolean }) => Promise<{ images: Array<{ b64_json?: string }> }>,
  ) {
    let leaseAccountId: string | null = null;
    try {
      const lease = deps.scheduler.acquire("image");
      leaseAccountId = lease.accountId;
      const result = await work(leaseAccountId, { proxy: true });
      deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
      return {
        created: Math.floor(Date.now() / 1000),
        data: result.images.map((img) => ({ b64_json: img.b64_json })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "FLOW_UPSTREAM_REJECTED";

      // Auto-fallback: proxy recaptcha fail → retry same account WITHOUT proxy (direct egress).
      if (isRecaptchaError(message) && leaseAccountId) {
        try {
          const result = await work(leaseAccountId, { proxy: false });
          deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
          return {
            created: Math.floor(Date.now() / 1000),
            data: result.images.map((img) => ({ b64_json: img.b64_json })),
          };
        } catch (directError) {
          const directMessage =
            directError instanceof Error ? directError.message : "FLOW_UPSTREAM_REJECTED";
          recordError(leaseAccountId, directMessage);
          // fall through to reauth fallback below
        }
      }

      // reauth / reCAPTCHA fallback: thử 1 account healthy khác (đã proxy, lần 2 trực tiếp).
      if (isRetryableAccountError(message) && leaseAccountId) {
        recordError(leaseAccountId, message);
        deps.scheduler.release(leaseAccountId);
        leaseAccountId = null;

        try {
          const retryLease = deps.scheduler.acquire("image");
          leaseAccountId = retryLease.accountId;
          // Try direct first on fallback — proxy already failed on prior account.
          let result;
          try {
            result = await work(leaseAccountId, { proxy: false });
          } catch {
            result = await work(leaseAccountId, { proxy: true });
          }
          deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
          return {
            created: Math.floor(Date.now() / 1000),
            data: result.images.map((img) => ({ b64_json: img.b64_json })),
          };
        } catch (retryError) {
          const retryMessage =
            retryError instanceof Error ? retryError.message : "FLOW_UPSTREAM_REJECTED";
          if (leaseAccountId) recordError(leaseAccountId, retryMessage);
          const code = retryMessage.split(" ")[0];
          return reply.code(errorStatus(retryMessage)).send({ error: { message: code, code } });
        }
      }

      if (leaseAccountId) recordError(leaseAccountId, message);
      const code = message.split(" ")[0];
      return reply.code(errorStatus(message)).send({ error: { message: code, code } });
    } finally {
      if (leaseAccountId) deps.scheduler.release(leaseAccountId);
    }
  }

  app.post("/v1/images/generations", async (request, reply) => {
    requireApiKey(request, deps.config.apiKey);
    const body = imageRequest.parse(request.body ?? {});
    if (body.response_format === "url") {
      return reply
        .code(400)
        .send({ error: { message: "only b64_json is supported", code: "FLOW_INVALID_REQUEST" } });
    }
    return runWithLease(reply, (accountId, o) => doGenerate(accountId, body, o));
  });

  app.post("/v1/images/edits", async (request, reply) => {
    requireApiKey(request, deps.config.apiKey);
    const body = editImageBody.parse(request.body ?? {});
    if (body.response_format === "url") {
      return reply
        .code(400)
        .send({ error: { message: "only b64_json is supported", code: "FLOW_INVALID_REQUEST" } });
    }
    // Reject empty decoded buffers early
    for (const img of body.images) {
      if (!Buffer.from(img.b64_json, "base64").length) {
        return reply
          .code(400)
          .send({ error: { message: "empty image", code: "FLOW_INVALID_REQUEST" } });
      }
    }
    return runWithLease(reply, (accountId, o) => doEdit(accountId, body, o));
  });
}
