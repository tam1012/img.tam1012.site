import type { BridgeDatabase } from "../store/database.js";
import { nowIso } from "../store/database.js";
import type { AccountStatus } from "../types.js";

export function nextAccountStatus(
  httpStatus: number,
  recaptchaFailures: number,
): { status: AccountStatus; cooldownMs?: number } {
  if (httpStatus === 401 || httpStatus === 403) return { status: "reauth_required" };
  if (httpStatus === 429) return { status: "cooldown", cooldownMs: 15 * 60_000 };
  if (recaptchaFailures >= 2) return { status: "blocked" };
  return { status: "healthy" };
}

export type SchedulerLease = {
  accountId: string;
  kind: "image" | "video";
};

export function createScheduler(db: BridgeDatabase, maxConcurrency = 1) {
  const jobBindings = new Map<string, string>();

  function expireCooldowns(now: string): void {
    db.prepare(
      `UPDATE accounts
       SET status = 'healthy', cooldown_until = NULL, updated_at = ?
       WHERE status = 'cooldown' AND cooldown_until IS NOT NULL AND cooldown_until <= ?`,
    ).run(now, now);
  }

  return {
    acquire(kind: "image" | "video"): SchedulerLease {
      const now = nowIso();
      const tx = db.transaction(() => {
        expireCooldowns(now);
        const row = db
          .prepare(
            `SELECT id, active_leases FROM accounts
             WHERE status IN ('healthy', 'busy')
               AND active_leases < ?
             ORDER BY COALESCE(last_used_at, '1970-01-01T00:00:00.000Z') ASC, alias ASC
             LIMIT 1`,
          )
          .get(maxConcurrency) as { id: string; active_leases: number } | undefined;

        if (!row) {
          const err = new Error("FLOW_POOL_UNAVAILABLE");
          (err as Error & { code: string }).code = "FLOW_POOL_UNAVAILABLE";
          throw err;
        }

        const nextLeases = row.active_leases + 1;
        const status = nextLeases >= maxConcurrency ? "busy" : "healthy";
        db.prepare(
          `UPDATE accounts
           SET active_leases = ?, status = ?, last_used_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(nextLeases, status, now, now, row.id);
        return { accountId: row.id, kind };
      });
      return tx();
    },

    release(accountId: string): void {
      const now = nowIso();
      db.transaction(() => {
        const row = db
          .prepare(`SELECT active_leases, status FROM accounts WHERE id = ?`)
          .get(accountId) as { active_leases: number; status: AccountStatus } | undefined;
        if (!row) return;
        const next = Math.max(0, row.active_leases - 1);
        // Only flip busy→healthy when no terminal/cooldown status has superseded it.
        let status: AccountStatus = row.status;
        if (row.status === "busy" || row.status === "healthy") {
          status = next >= maxConcurrency ? "busy" : "healthy";
        }
        db.prepare(
          `UPDATE accounts SET active_leases = ?, status = ?, updated_at = ? WHERE id = ?`,
        ).run(next, status, now, accountId);
      })();
    },

    bindJob(jobId: string, accountId: string): void {
      jobBindings.set(jobId, accountId);
    },

    accountForJob(jobId: string): string | null {
      return jobBindings.get(jobId) ?? null;
    },

    markJobTerminal(jobId: string): void {
      jobBindings.delete(jobId);
    },

    applyHttpResult(accountId: string, httpStatus: number, recaptchaFailures = 0): void {
      const result = nextAccountStatus(httpStatus, recaptchaFailures);
      const now = nowIso();
      const cooldownUntil =
        result.status === "cooldown" && result.cooldownMs
          ? new Date(Date.now() + result.cooldownMs).toISOString()
          : null;
      db.prepare(
        `UPDATE accounts
         SET status = ?, cooldown_until = ?, failure_code = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        result.status,
        cooldownUntil,
        result.status === "healthy" ? null : result.status,
        now,
        accountId,
      );
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
