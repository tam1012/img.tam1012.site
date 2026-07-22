import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountRepository } from "../accounts/repository.js";
import type { Scheduler } from "../accounts/scheduler.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import type { BridgeConfig } from "../config.js";
import { editFlowImages, generateFlowImages } from "../flow/image.js";
import { readSession } from "../flow/session-broker.js";
import {
  ACCOUNT_RETRY_BASE_DELAY_MS,
  EDIT_MAX_ACCOUNT_ATTEMPTS,
  GENERATE_MAX_ACCOUNT_ATTEMPTS,
  TRANSIENT_UPSTREAM_COOLDOWN_MS,
  isBrowserTransientError,
  isContentBlockedError,
  isRetryableAccountError,
  isTransientUpstreamError,
  publicFlowError,
  sleep,
} from "../flow/upstream-errors.js";
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
  // Prefer aspect ratio string (1:1, 16:9, 9:16, 4:3, 3:4). WxH still accepted for legacy.
  size: z.string().default("1:1"),
  // Flow: 1K = base generate; 2K/4K = post upsampleImage (UI download quality).
  resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
  n: z.number().int().min(1).max(4).default(1),
  response_format: z.enum(["b64_json", "url"]).default("b64_json"),
});

const editImageBody = z.object({
  model: z.enum(FLOW_IMAGE_MODELS).default("flow-nano-banana-2"),
  prompt: z.string().min(1).max(20_000),
  size: z.string().default("1:1"),
  resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
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
        resolution: body.resolution,
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
        resolution: body.resolution,
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
    // Content safety: 422 — app không còn báo 502 "sập" oan.
    if (isContentBlockedError(message)) return 422;
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

  function accountLabel(accountId: string): string {
    return deps.accounts.get(accountId)?.alias || accountId.slice(0, 8);
  }

  function recordError(accountId: string, message: string): void {
    // Content filter theo prompt/ảnh — không cooldown account (account vẫn tốt).
    if (isContentBlockedError(message)) return;

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
    } else if (isTransientUpstreamError(message) || isBrowserTransientError(message)) {
      // Google nghẽn / browser blip — không reauth; cooldown ngắn để ưu tiên account khác.
      deps.scheduler.applyCooldown(
        accountId,
        TRANSIENT_UPSTREAM_COOLDOWN_MS,
        isBrowserTransientError(message) ? "browser_transient" : "upstream_transient",
      );
    }
  }

  function toSuccess(images: Array<{ b64_json?: string }>) {
    return {
      created: Math.floor(Date.now() / 1000),
      data: images.map((img) => ({ b64_json: img.b64_json })),
    };
  }

  /**
   * Thuê account → chạy work → khi lỗi tạm (nghẽn/reCAPTCHA/reauth/browser)
   * thì cooldown account hỏng và thử account healthy khác (tối đa maxAccountAttempts).
   * Edit dùng 3 account vì upload+reference hay dính high-traffic.
   */
  async function runWithLease(
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    work: (
      accountId: string,
      opts?: { proxy?: boolean },
    ) => Promise<{ images: Array<{ b64_json?: string }> }>,
    opts?: { maxAccountAttempts?: number; kind?: "generate" | "edit" },
  ) {
    const maxAttempts = opts?.maxAccountAttempts ?? GENERATE_MAX_ACCOUNT_ATTEMPTS;
    const kind = opts?.kind ?? "generate";
    let leaseAccountId: string | null = null;
    let lastMessage = "FLOW_UPSTREAM_REJECTED";

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const lease = deps.scheduler.acquire("image");
          leaseAccountId = lease.accountId;
        } catch (acquireError) {
          const acquireMessage =
            acquireError instanceof Error ? acquireError.message : "FLOW_POOL_UNAVAILABLE";
          lastMessage = acquireMessage;
          console.warn(
            `[flow-image] ${kind} acquire_failed attempt=${attempt}/${maxAttempts} err=${acquireMessage}`,
          );
          break;
        }

        const alias = accountLabel(leaseAccountId);
        let attemptMessage = lastMessage;

        try {
          const result = await work(leaseAccountId, { proxy: true });
          deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
          if (attempt > 1) {
            console.info(
              `[flow-image] ${kind} recovered attempt=${attempt}/${maxAttempts} account=${alias}`,
            );
          }
          return toSuccess(result.images);
        } catch (error) {
          attemptMessage =
            error instanceof Error ? error.message : "FLOW_UPSTREAM_REJECTED";

          // Proxy reCAPTCHA fail → cùng account, direct egress 1 lần.
          if (isRecaptchaError(attemptMessage)) {
            try {
              const result = await work(leaseAccountId, { proxy: false });
              deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
              console.info(
                `[flow-image] ${kind} recovered via direct proxy-fallback account=${alias}`,
              );
              return toSuccess(result.images);
            } catch (directError) {
              attemptMessage =
                directError instanceof Error
                  ? directError.message
                  : "FLOW_UPSTREAM_REJECTED";
            }
          }

          lastMessage = attemptMessage;
          recordError(leaseAccountId, attemptMessage);
          console.warn(
            `[flow-image] ${kind} fail attempt=${attempt}/${maxAttempts} account=${alias} err=${attemptMessage.slice(0, 180)}`,
          );

          deps.scheduler.release(leaseAccountId);
          leaseAccountId = null;

          const canRetry =
            attempt < maxAttempts && isRetryableAccountError(attemptMessage);
          if (!canRetry) break;

          // Nghẽn Google / browser: nghỉ ngắn trước khi đụng account khác.
          if (
            isTransientUpstreamError(attemptMessage) ||
            isBrowserTransientError(attemptMessage) ||
            isRecaptchaError(attemptMessage)
          ) {
            const delay = ACCOUNT_RETRY_BASE_DELAY_MS * attempt;
            console.info(
              `[flow-image] ${kind} retry_delay=${delay}ms next_attempt=${attempt + 1}/${maxAttempts}`,
            );
            await sleep(delay);
          }
        }
      }

      const pub = publicFlowError(lastMessage);
      return reply.code(errorStatus(lastMessage)).send({ error: pub });
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
    return runWithLease(reply, (accountId, o) => doGenerate(accountId, body, o), {
      maxAccountAttempts: GENERATE_MAX_ACCOUNT_ATTEMPTS,
      kind: "generate",
    });
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
    return runWithLease(reply, (accountId, o) => doEdit(accountId, body, o), {
      maxAccountAttempts: EDIT_MAX_ACCOUNT_ATTEMPTS,
      kind: "edit",
    });
  });
}
