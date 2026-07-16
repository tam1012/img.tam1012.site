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

  it("tolerates transient reauth, only fails after consecutive streak", async () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO accounts (id, alias, encrypted_storage_state, status, active_leases, created_at, updated_at)
       VALUES ('acc-1', 'flow-01', 'enc', 'healthy', 0, datetime('now'), datetime('now'))`,
    ).run();
    const jobs = createJobRepository(db);
    db.prepare(
      `INSERT INTO jobs (id, idempotency_key, kind, status, account_id, progress, created_at, updated_at)
       VALUES ('job-r', 'idem-r', 'text_video', 'active', 'acc-1', 60, ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString());

    const poller = createJobPoller({
      jobs,
      timeoutMs: 10 * 60_000,
      maxConsecutiveReauth: 3,
      poll: async () => {
        throw new Error("FLOW_REAUTH_REQUIRED");
      },
    });

    // 2 blip đầu: job vẫn còn sống (không bị giết).
    await poller.tick();
    expect(jobs.get("job-r")?.status).not.toBe("failed");
    await poller.tick();
    expect(jobs.get("job-r")?.status).not.toBe("failed");
    // Nhịp thứ 3 liên tiếp: mới coi là hỏng thật.
    await poller.tick();
    expect(jobs.get("job-r")?.status).toBe("failed");
    expect(jobs.get("job-r")?.errorCode).toBe("FLOW_REAUTH_REQUIRED");
    await poller.stop();
    db.close();
  });

  it("resets reauth streak after a successful poll", async () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO accounts (id, alias, encrypted_storage_state, status, active_leases, created_at, updated_at)
       VALUES ('acc-1', 'flow-01', 'enc', 'healthy', 0, datetime('now'), datetime('now'))`,
    ).run();
    const jobs = createJobRepository(db);
    db.prepare(
      `INSERT INTO jobs (id, idempotency_key, kind, status, account_id, progress, created_at, updated_at)
       VALUES ('job-s', 'idem-s', 'text_video', 'active', 'acc-1', 60, ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString());

    let calls = 0;
    const poller = createJobPoller({
      jobs,
      timeoutMs: 10 * 60_000,
      maxConsecutiveReauth: 3,
      // Lỗi, lỗi, thành công, lỗi, lỗi — chưa đủ 3 lần LIÊN TIẾP nên không được fail.
      poll: async () => {
        calls += 1;
        if (calls === 3) return;
        throw new Error("FLOW_REAUTH_REQUIRED");
      },
    });

    for (let i = 0; i < 5; i++) await poller.tick();
    expect(jobs.get("job-s")?.status).not.toBe("failed");
    await poller.stop();
    db.close();
  });
});
