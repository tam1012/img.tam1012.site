import { describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { createJobPoller } from "./poller.js";
import { createJobRepository } from "./repository.js";

describe("job poller", () => {
  it("marks timed out jobs failed", async () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO accounts (id, alias, encrypted_storage_state, status, active_leases, created_at, updated_at)
       VALUES ('acc-1', 'flow-01', 'enc', 'healthy', 0, datetime('now'), datetime('now'))`,
    ).run();
    const jobs = createJobRepository(db);
    db.prepare(
      `INSERT INTO jobs (id, idempotency_key, kind, status, account_id, progress, created_at, updated_at)
       VALUES ('job-old', 'idem-old', 'text_video', 'active', 'acc-1', 10, ?, ?)`,
    ).run(new Date(Date.now() - 11 * 60_000).toISOString(), new Date().toISOString());

    const polled: string[] = [];
    const poller = createJobPoller({
      jobs,
      timeoutMs: 10 * 60_000,
      poll: async (id) => {
        polled.push(id);
      },
    });
    await poller.tick();
    expect(jobs.get("job-old")?.status).toBe("failed");
    expect(jobs.get("job-old")?.errorCode).toBe("FLOW_JOB_TIMEOUT");
    expect(polled).toEqual([]);
    await poller.stop();
    db.close();
  });
});
