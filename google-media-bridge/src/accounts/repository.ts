import type { BridgeDatabase } from "../store/database.js";
import { nowIso } from "../store/database.js";
import type { AccountRecord, AccountStatus } from "../types.js";

type AccountRow = {
  id: string;
  alias: string;
  encrypted_storage_state: string;
  status: AccountStatus;
  active_leases: number;
  cooldown_until: string | null;
  last_verified_at: string | null;
  last_used_at: string | null;
  failure_code: string | null;
  project_id: string | null;
  site_key: string | null;
  created_at: string;
  updated_at: string;
};

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    alias: row.alias,
    encryptedStorageState: row.encrypted_storage_state,
    status: row.status,
    activeLeases: row.active_leases,
    cooldownUntil: row.cooldown_until,
    lastVerifiedAt: row.last_verified_at,
    lastUsedAt: row.last_used_at,
    failureCode: row.failure_code,
    projectId: row.project_id,
    siteKey: row.site_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAccountRepository(db: BridgeDatabase) {
  return {
    list(): AccountRecord[] {
      const rows = db
        .prepare(`SELECT * FROM accounts ORDER BY alias ASC`)
        .all() as AccountRow[];
      return rows.map(mapAccount);
    },

    get(id: string): AccountRecord | null {
      const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as AccountRow | undefined;
      return row ? mapAccount(row) : null;
    },

    getByAlias(alias: string): AccountRecord | null {
      const row = db.prepare(`SELECT * FROM accounts WHERE alias = ?`).get(alias) as
        | AccountRow
        | undefined;
      return row ? mapAccount(row) : null;
    },

    insert(input: {
      id: string;
      alias: string;
      encryptedStorageState: string;
      status?: AccountStatus;
      projectId?: string | null;
      siteKey?: string | null;
    }): AccountRecord {
      const ts = nowIso();
      db.prepare(
        `INSERT INTO accounts (
          id, alias, encrypted_storage_state, status, active_leases,
          project_id, site_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.alias,
        input.encryptedStorageState,
        input.status ?? "healthy",
        input.projectId ?? null,
        input.siteKey ?? null,
        ts,
        ts,
      );
      return this.get(input.id)!;
    },

    updateStorageState(id: string, encryptedStorageState: string): void {
      db.prepare(
        `UPDATE accounts SET encrypted_storage_state = ?, updated_at = ? WHERE id = ?`,
      ).run(encryptedStorageState, nowIso(), id);
    },

    setStatus(
      id: string,
      status: AccountStatus,
      extra: { cooldownUntil?: string | null; failureCode?: string | null } = {},
    ): void {
      db.prepare(
        `UPDATE accounts
         SET status = ?, cooldown_until = COALESCE(?, cooldown_until),
             failure_code = COALESCE(?, failure_code), updated_at = ?
         WHERE id = ?`,
      ).run(status, extra.cooldownUntil ?? null, extra.failureCode ?? null, nowIso(), id);
    },

    setProjectMeta(id: string, projectId: string | null, siteKey: string | null): void {
      db.prepare(
        `UPDATE accounts SET project_id = ?, site_key = ?, updated_at = ? WHERE id = ?`,
      ).run(projectId, siteKey, nowIso(), id);
    },

    markVerified(id: string): void {
      const ts = nowIso();
      db.prepare(
        `UPDATE accounts SET last_verified_at = ?, status = CASE WHEN status = 'reauth_required' THEN 'healthy' ELSE status END, updated_at = ? WHERE id = ?`,
      ).run(ts, ts, id);
    },

    nextAlias(): string {
      const rows = db.prepare(`SELECT alias FROM accounts`).all() as Array<{ alias: string }>;
      let max = 0;
      for (const row of rows) {
        const m = row.alias.match(/^flow-(\d+)$/);
        if (m) max = Math.max(max, Number(m[1]));
      }
      return `flow-${String(max + 1).padStart(2, "0")}`;
    },

    delete(id: string): void {
      db.prepare(`DELETE FROM jobs WHERE account_id = ?`).run(id);
      db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
    },

    countByStatus(): Record<string, number> {
      const rows = db
        .prepare(`SELECT status, COUNT(*) AS c FROM accounts GROUP BY status`)
        .all() as Array<{ status: string; c: number }>;
      const out: Record<string, number> = {};
      for (const row of rows) out[row.status] = row.c;
      return out;
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
