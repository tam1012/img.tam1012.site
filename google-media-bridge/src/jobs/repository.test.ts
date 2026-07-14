import { describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { createJobRepository } from "./repository.js";

describe("job repository", () => {
  it("stores account id and does not reassign", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO accounts (id, alias, encrypted_storage_state, status, active_leases, created_at, updated_at)
       VALUES ('acc-1', 'flow-01', 'enc', 'healthy', 0, datetime('now'), datetime('now'))`,
    ).run();
    const jobs = createJobRepository(db);
    const created = jobs.create({
      id: "job-1",
      idempotencyKey: "idem-1",
      kind: "text_video",
      accountId: "acc-1",
    });
    expect(created.accountId).toBe("acc-1");
    const again = jobs.create({
      id: "job-2",
      idempotencyKey: "idem-1",
      kind: "text_video",
      accountId: "acc-other",
    });
    expect(again.id).toBe("job-1");
    expect(again.accountId).toBe("acc-1");
    const updated = jobs.update("job-1", { status: "scheduled", progress: 10 });
    expect(updated.accountId).toBe("acc-1");
    expect(updated.status).toBe("scheduled");
    db.close();
  });
});
