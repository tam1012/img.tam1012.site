import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountRepository } from "../accounts/repository.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import type { BridgeConfig } from "../config.js";
import { readSession } from "../flow/session-broker.js";
import {
  decryptEnrollment,
  type EncryptedEnrollment,
} from "../security/enrollment.js";
import { encryptJSON } from "../security/vault.js";
import { requireAdminKey } from "./auth.js";

const enrollmentBody = z.object({
  bundle: z.object({
    version: z.literal(1),
    encryptedKey: z.string(),
    iv: z.string(),
    authTag: z.string(),
    ciphertext: z.string(),
  }),
  projectId: z.string().min(1).optional(),
  siteKey: z.string().min(1).optional(),
  alias: z.string().min(1).max(64).optional(),
});

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: {
    config: BridgeConfig;
    accounts: AccountRepository;
    browsers: BrowserWorkerPool;
  },
) {
  function privateKeyPem(): string {
    return readFileSync(deps.config.enrollmentPrivateKeyFile, "utf8");
  }

  app.post("/admin/v1/enrollments", async (request, reply) => {
    requireAdminKey(request, deps.config.adminKey);
    const body = enrollmentBody.parse(request.body ?? {});
    const payload = decryptEnrollment(body.bundle as EncryptedEnrollment, privateKeyPem());
    const encryptedStorageState = encryptJSON(deps.config.vaultKey, payload.storageState);
    const id = randomUUID();
    const alias = body.alias || deps.accounts.nextAlias();
    const account = deps.accounts.insert({
      id,
      alias,
      encryptedStorageState,
      status: "healthy",
      projectId: body.projectId ?? null,
      siteKey: body.siteKey ?? deps.config.recaptchaSiteKey ?? null,
    });
    return reply.code(201).send({
      id: account.id,
      alias: account.alias,
      status: account.status,
    });
  });

  app.put("/admin/v1/accounts/:id/enrollment", async (request, reply) => {
    requireAdminKey(request, deps.config.adminKey);
    const { id } = request.params as { id: string };
    const existing = deps.accounts.get(id);
    if (!existing) return reply.code(404).send({ error: { message: "not found" } });
    const body = enrollmentBody.parse(request.body ?? {});
    const payload = decryptEnrollment(body.bundle as EncryptedEnrollment, privateKeyPem());
    const encryptedStorageState = encryptJSON(deps.config.vaultKey, payload.storageState);
    deps.accounts.updateStorageState(id, encryptedStorageState);
    if (body.projectId || body.siteKey) {
      deps.accounts.setProjectMeta(
        id,
        body.projectId ?? existing.projectId,
        body.siteKey ?? existing.siteKey,
      );
    }
    deps.accounts.setStatus(id, "healthy", { failureCode: null, cooldownUntil: null });
    await deps.browsers.invalidate(id);
    const account = deps.accounts.get(id)!;
    return { id: account.id, alias: account.alias, status: account.status };
  });

  app.post("/admin/v1/accounts/:id/verify", async (request, reply) => {
    requireAdminKey(request, deps.config.adminKey);
    const { id } = request.params as { id: string };
    const account = deps.accounts.get(id);
    if (!account) return reply.code(404).send({ error: { message: "not found" } });
    try {
      const browser = await deps.browsers.forAccount(id);
      const session = await readSession(browser.page);
      await browser.persist().catch(() => undefined);
      deps.accounts.markVerified(id);
      return {
        id,
        alias: account.alias,
        status: "healthy",
        authenticated: session.summary.authenticated,
        hasAisandbox: session.summary.hasAisandbox,
        tokenFamily: session.summary.tokenFamily,
      };
    } catch {
      deps.accounts.setStatus(id, "reauth_required", { failureCode: "FLOW_REAUTH_REQUIRED" });
      return reply.code(409).send({
        id,
        alias: account.alias,
        status: "reauth_required",
        error: "FLOW_REAUTH_REQUIRED",
      });
    }
  });

  app.post("/admin/v1/accounts/:id/disable", async (request, reply) => {
    requireAdminKey(request, deps.config.adminKey);
    const { id } = request.params as { id: string };
    if (!deps.accounts.get(id)) return reply.code(404).send({ error: { message: "not found" } });
    deps.accounts.setStatus(id, "disabled");
    await deps.browsers.invalidate(id);
    return { id, status: "disabled" };
  });

  app.post("/admin/v1/accounts/:id/enable", async (request, reply) => {
    requireAdminKey(request, deps.config.adminKey);
    const { id } = request.params as { id: string };
    if (!deps.accounts.get(id)) return reply.code(404).send({ error: { message: "not found" } });
    deps.accounts.setStatus(id, "healthy", { failureCode: null, cooldownUntil: null });
    return { id, status: "healthy" };
  });

  app.delete("/admin/v1/accounts/:id", async (request, reply) => {
    requireAdminKey(request, deps.config.adminKey);
    const { id } = request.params as { id: string };
    if (!deps.accounts.get(id)) return reply.code(404).send({ error: { message: "not found" } });
    await deps.browsers.invalidate(id);
    deps.accounts.delete(id);
    return reply.code(204).send();
  });

  app.get("/admin/v1/accounts", async (request) => {
    requireAdminKey(request, deps.config.adminKey);
    return {
      accounts: deps.accounts.list().map((a) => ({
        id: a.id,
        alias: a.alias,
        status: a.status,
        activeLeases: a.activeLeases,
        lastVerifiedAt: a.lastVerifiedAt,
        lastUsedAt: a.lastUsedAt,
        failureCode: a.failureCode,
        // never projectId/siteKey/token in list if considered sensitive — projectId is runtime id.
        hasProject: Boolean(a.projectId),
        hasSiteKey: Boolean(a.siteKey),
      })),
    };
  });
}
