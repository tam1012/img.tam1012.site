import { describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { createScheduler, nextAccountStatus } from "./scheduler.js";

function seed(
  db: ReturnType<typeof openDatabase>,
  id: string,
  status: string,
  lastUsed: string | null,
) {
  db.prepare(
    `INSERT INTO accounts (id, alias, encrypted_storage_state, status, active_leases, last_used_at, created_at, updated_at)
     VALUES (?, ?, 'enc', ?, 0, ?, datetime('now'), datetime('now'))`,
  ).run(id, id, status, lastUsed);
}

describe("scheduler", () => {
  it("round robins only healthy accounts", () => {
    const db = openDatabase(":memory:");
    const t1 = new Date(Date.now() - 60_000).toISOString();
    const t2 = new Date(Date.now() - 30_000).toISOString();
    seed(db, "a", "healthy", t1);
    seed(db, "b", "cooldown", t1);
    seed(db, "c", "healthy", t2);
    const scheduler = createScheduler(db, 1);
    expect(scheduler.acquire("image").accountId).toBe("a");
    scheduler.release("a");
    expect(scheduler.acquire("image").accountId).toBe("c");
    db.close();
  });

  it("pins a video job to one account until terminal", () => {
    const db = openDatabase(":memory:");
    seed(db, "a", "healthy", null);
    const scheduler = createScheduler(db, 1);
    const lease = scheduler.acquire("video");
    scheduler.bindJob("job-1", lease.accountId);
    expect(scheduler.accountForJob("job-1")).toBe(lease.accountId);
    scheduler.markJobTerminal("job-1");
    expect(scheduler.accountForJob("job-1")).toBeNull();
    db.close();
  });

  it("maps http and recaptcha failures", () => {
    expect(nextAccountStatus(401, 0)).toEqual({ status: "reauth_required" });
    expect(nextAccountStatus(429, 0)).toMatchObject({ status: "cooldown" });
    expect(nextAccountStatus(200, 2)).toEqual({ status: "blocked" });
  });

  it("throws FLOW_POOL_UNAVAILABLE when empty", () => {
    const db = openDatabase(":memory:");
    const scheduler = createScheduler(db, 1);
    expect(() => scheduler.acquire("image")).toThrow(/FLOW_POOL_UNAVAILABLE/);
    db.close();
  });
});
