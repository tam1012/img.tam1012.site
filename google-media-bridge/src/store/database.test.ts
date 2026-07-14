import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("database", () => {
  it("persists account and enforces unique job idempotency key", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-db-"));
    temps.push(dir);
    const path = join(dir, "bridge.sqlite");

    const db1 = openDatabase(path);
    db1.prepare(
      `INSERT INTO accounts (id, alias, encrypted_storage_state, status, active_leases, created_at, updated_at)
       VALUES (?, ?, ?, 'healthy', 0, ?, ?)`,
    ).run("acc-1", "flow-01", "enc", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
    db1.prepare(
      `INSERT INTO jobs (id, idempotency_key, kind, status, account_id, progress, created_at, updated_at)
       VALUES (?, ?, 'text_video', 'queued', ?, 0, ?, ?)`,
    ).run("job-1", "idem-1", "acc-1", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
    db1.close();

    const db2 = openDatabase(path);
    const account = db2.prepare(`SELECT alias FROM accounts WHERE id = ?`).get("acc-1") as {
      alias: string;
    };
    expect(account.alias).toBe("flow-01");
    expect(() =>
      db2
        .prepare(
          `INSERT INTO jobs (id, idempotency_key, kind, status, account_id, progress, created_at, updated_at)
           VALUES (?, ?, 'text_video', 'queued', ?, 0, ?, ?)`,
        )
        .run("job-2", "idem-1", "acc-1", "2026-07-15T00:00:01.000Z", "2026-07-15T00:00:01.000Z"),
    ).toThrow();
    db2.close();
  });
});
