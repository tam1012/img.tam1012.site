import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountRepository } from "../accounts/repository.js";
import type { Scheduler } from "../accounts/scheduler.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import type { BridgeConfig } from "../config.js";
import { generateFlowImages } from "../flow/image.js";
import { readSession } from "../flow/session-broker.js";
import { requireApiKey } from "./auth.js";

const imageRequest = z.object({
  model: z
    .enum([
      "flow-nano-banana-2",
      "flow-nano-banana-pro",
      "NARWHAL",
      "GEM_PIX_2",
      "HARBOR_SEAL",
    ])
    .default("flow-nano-banana-2"),
  prompt: z.string().min(1).max(20_000),
  size: z.string().default("1024x1024"),
  n: z.number().int().min(1).max(4).default(1),
  response_format: z.enum(["b64_json", "url"]).default("b64_json"),
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
  // Chạy generate ảnh với account đã được acquire. Không xử lý error mapping.
  async function doGenerate(accountId: string, body: z.infer<typeof imageRequest>) {
    const account = deps.accounts.get(accountId);
    if (!account?.projectId || !(account.siteKey || deps.config.recaptchaSiteKey)) {
      throw new Error("FLOW_REAUTH_REQUIRED");
    }
    const browser = await deps.browsers.forAccount(account.id);
    const session = await readSession(browser.page);
    const result = await generateFlowImages({
      page: browser.page,
      accessToken: session.accessToken,
      projectId: account.projectId,
      siteKey: account.siteKey || deps.config.recaptchaSiteKey!,
      action: deps.config.recaptchaAction,
      prompt: body.prompt,
      model: body.model,
      size: body.size,
      n: body.n,
    });
    await browser.persist().catch(() => undefined);
    return result;
  }

  function errorStatus(message: string): number {
    if (message.includes("FLOW_UNAUTHORIZED")) return 401;
    if (message.includes("FLOW_POOL_UNAVAILABLE")) return 503;
    if (message.includes("FLOW_INVALID_REQUEST")) return 400;
    return 502;
  }

  function recordError(accountId: string, message: string): void {
    if (message.includes("FLOW_REAUTH_REQUIRED")) {
      deps.scheduler.applyHttpResult(accountId, 401, 0);
    } else if (message.includes("FLOW_QUOTA_EXCEEDED")) {
      deps.scheduler.applyHttpResult(accountId, 429, 0);
    } else if (message.includes("FLOW_RECAPTCHA_FAILED")) {
      deps.scheduler.applyHttpResult(accountId, 200, 2);
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

    let leaseAccountId: string | null = null;
    try {
      const lease = deps.scheduler.acquire("image");
      leaseAccountId = lease.accountId;
      const result = await doGenerate(leaseAccountId, body);
      deps.scheduler.applyHttpResult(leaseAccountId, 200, 0);
      return {
        created: Math.floor(Date.now() / 1000),
        data: result.images.map((img) => ({ b64_json: img.b64_json })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "FLOW_UPSTREAM_REJECTED";

      // Nếu lỗi reauth, thử fallback sang một account healthy khác.
      if (message.includes("FLOW_REAUTH_REQUIRED") && leaseAccountId) {
        recordError(leaseAccountId, message);
        deps.scheduler.release(leaseAccountId);
        leaseAccountId = null;

        // Thử tối đa 1 account fallback.
        try {
          const retryLease = deps.scheduler.acquire("image");
          leaseAccountId = retryLease.accountId;
          const result = await doGenerate(leaseAccountId, body);
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
          return reply
            .code(errorStatus(retryMessage))
            .send({ error: { message: code, code } });
        }
      }

      if (leaseAccountId) recordError(leaseAccountId, message);
      const code = message.split(" ")[0];
      return reply.code(errorStatus(message)).send({ error: { message: code, code } });
    } finally {
      if (leaseAccountId) deps.scheduler.release(leaseAccountId);
    }
  });
}
