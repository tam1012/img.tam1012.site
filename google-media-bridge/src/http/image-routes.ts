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
  model: z.enum(["flow-nano-banana-2", "NARWHAL"]).default("flow-nano-banana-2"),
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
  app.post("/v1/images/generations", async (request, reply) => {
    requireApiKey(request, deps.config.apiKey);
    const body = imageRequest.parse(request.body ?? {});
    if (body.response_format === "url") {
      return reply.code(400).send({ error: { message: "only b64_json is supported", code: "FLOW_INVALID_REQUEST" } });
    }

    let leaseAccountId: string | null = null;
    try {
      const lease = deps.scheduler.acquire("image");
      leaseAccountId = lease.accountId;
      const account = deps.accounts.get(lease.accountId);
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
      deps.scheduler.applyHttpResult(account.id, 200, 0);
      return {
        created: Math.floor(Date.now() / 1000),
        data: result.images.map((img) => ({ b64_json: img.b64_json })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "FLOW_UPSTREAM_REJECTED";
      if (leaseAccountId) {
        if (message.includes("FLOW_REAUTH_REQUIRED")) {
          deps.scheduler.applyHttpResult(leaseAccountId, 401, 0);
        } else if (message.includes("FLOW_QUOTA_EXCEEDED")) {
          deps.scheduler.applyHttpResult(leaseAccountId, 429, 0);
        } else if (message.includes("FLOW_RECAPTCHA_FAILED")) {
          deps.scheduler.applyHttpResult(leaseAccountId, 200, 2);
        }
      }
      const status = message.includes("FLOW_UNAUTHORIZED")
        ? 401
        : message.includes("FLOW_POOL_UNAVAILABLE")
          ? 503
          : message.includes("FLOW_INVALID_REQUEST")
            ? 400
            : 502;
      return reply.code(status).send({ error: { message: message.split(" ")[0], code: message.split(" ")[0] } });
    } finally {
      if (leaseAccountId) deps.scheduler.release(leaseAccountId);
    }
  });
}
