import type { FastifyInstance } from "fastify";
import type { AccountRepository } from "../accounts/repository.js";
import type { JobRepository } from "../jobs/repository.js";

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    accounts: AccountRepository;
    jobs: JobRepository;
  },
) {
  app.get("/health", async () => {
    const counts = deps.accounts.countByStatus();
    const resumable = deps.jobs.listResumable().length;
    return {
      ok: true,
      accounts: counts,
      resumableJobs: resumable,
    };
  });

  app.get("/v1/models", async () => {
    return {
      object: "list",
      data: [
        { id: "flow-nano-banana-2", object: "model", owned_by: "google-flow-bridge" },
        { id: "flow-nano-banana-pro", object: "model", owned_by: "google-flow-bridge" },
        { id: "flow-video-fast-4s", object: "model", owned_by: "google-flow-bridge" },
      ],
    };
  });
}
