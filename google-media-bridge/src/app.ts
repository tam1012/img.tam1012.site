import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { join } from "node:path";
import { createAccountRepository } from "./accounts/repository.js";
import { createScheduler } from "./accounts/scheduler.js";
import { createBrowserWorkerPool } from "./browser/worker.js";
import type { BridgeConfig } from "./config.js";
import { registerAdminRoutes } from "./http/admin-routes.js";
import { registerHealthRoutes } from "./http/health-routes.js";
import { registerImageRoutes } from "./http/image-routes.js";
import { registerVideoRoutes } from "./http/video-routes.js";
import { createJobPoller } from "./jobs/poller.js";
import { createJobRepository } from "./jobs/repository.js";
import { createKeepalive } from "./accounts/keepalive.js";
import { openDatabase, type BridgeDatabase } from "./store/database.js";

export type BridgeApp = {
  app: ReturnType<typeof Fastify>;
  db: BridgeDatabase;
  close: () => Promise<void>;
};

export async function buildApp(config: BridgeConfig): Promise<BridgeApp> {
  const dbPath = join(config.dataDir, "bridge.sqlite");
  const db = openDatabase(dbPath);
  const accounts = createAccountRepository(db);
  const jobs = createJobRepository(db);
  const scheduler = createScheduler(db, config.maxAccountConcurrency);
  const browsers = createBrowserWorkerPool({
    chromiumPath: config.chromiumPath,
    vaultKey: config.vaultKey,
    accounts,
    proxyUrl: config.proxyUrl,
  });

  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "body.bundle",
          "body.prompt",
          "body.start_image_b64",
          "body.end_image_b64",
        ],
        remove: true,
      },
    },
    // Edit may send multiple base64 images (upload + prompt) in one JSON body.
    bodyLimit: 20 * 1024 * 1024,
  });

  await app.register(multipart, {
    limits: {
      files: 2,
      fileSize: Math.floor(9.5 * 1024 * 1024),
    },
  });

  registerHealthRoutes(app, { accounts, jobs });
  registerImageRoutes(app, { config, accounts, scheduler, browsers });
  registerVideoRoutes(app, { config, accounts, scheduler, browsers, jobs });
  registerAdminRoutes(app, { config, accounts, browsers });

  const poller = createJobPoller({
    jobs,
    poll: async (jobId) => {
      const decorated = app as typeof app & {
        flowPollVideoJob?: (id: string) => Promise<void>;
      };
      if (decorated.flowPollVideoJob) await decorated.flowPollVideoJob(jobId);
    },
  });
  poller.start();

  const keepalive = createKeepalive({
    accounts,
    browsers,
    intervalMs: config.keepaliveIntervalMs,
    log: (msg) => app.log.info(msg),
  });
  keepalive.start();

  return {
    app,
    db,
    async close() {
      await keepalive.stop();
      await poller.stop();
      await browsers.close();
      await app.close();
      db.close();
    },
  };
}
