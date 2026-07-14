import type { BridgeConfig } from "../config.js";
import type { JobRepository } from "./repository.js";

export type VideoPollFn = (jobId: string) => Promise<void>;

export function createJobPoller(deps: {
  jobs: JobRepository;
  poll: VideoPollFn;
  intervalMs?: number;
  timeoutMs?: number;
}) {
  const intervalMs = deps.intervalMs ?? 5_000;
  const timeoutMs = deps.timeoutMs ?? 10 * 60_000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    const jobs = deps.jobs.listResumable();
    for (const job of jobs) {
      const age = Date.now() - new Date(job.createdAt).getTime();
      if (age > timeoutMs) {
        deps.jobs.update(job.id, {
          status: "failed",
          errorCode: "FLOW_JOB_TIMEOUT",
          errorMessage: "timeout",
          progress: 100,
        });
        continue;
      }
      try {
        await deps.poll(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "poll failed";
        if (message.includes("FLOW_REAUTH_REQUIRED")) {
          deps.jobs.update(job.id, {
            status: "failed",
            errorCode: "FLOW_REAUTH_REQUIRED",
            errorMessage: "reauth required",
            progress: 100,
          });
        }
      }
    }
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      // unref so tests/process can exit if nothing else is running
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
