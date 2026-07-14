import type { BridgeDatabase } from "../store/database.js";
import { nowIso } from "../store/database.js";
import type { JobKind, JobRecord, JobStatus } from "../types.js";

type JobRow = {
  id: string;
  idempotency_key: string;
  kind: JobKind;
  status: JobStatus;
  account_id: string;
  encrypted_upstream_state: string | null;
  output_path: string | null;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    status: row.status,
    accountId: row.account_id,
    encryptedUpstreamState: row.encrypted_upstream_state,
    outputPath: row.output_path,
    progress: row.progress,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJobRepository(db: BridgeDatabase) {
  return {
    get(id: string): JobRecord | null {
      const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
      return row ? mapJob(row) : null;
    },

    getByIdempotencyKey(key: string): JobRecord | null {
      const row = db.prepare(`SELECT * FROM jobs WHERE idempotency_key = ?`).get(key) as
        | JobRow
        | undefined;
      return row ? mapJob(row) : null;
    },

    create(input: {
      id: string;
      idempotencyKey: string;
      kind: JobKind;
      accountId: string;
      encryptedUpstreamState?: string | null;
    }): JobRecord {
      const existing = this.getByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
      const ts = nowIso();
      db.prepare(
        `INSERT INTO jobs (
          id, idempotency_key, kind, status, account_id, encrypted_upstream_state,
          progress, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?)`,
      ).run(
        input.id,
        input.idempotencyKey,
        input.kind,
        input.accountId,
        input.encryptedUpstreamState ?? null,
        ts,
        ts,
      );
      return this.get(input.id)!;
    },

    update(
      id: string,
      patch: Partial<{
        status: JobStatus;
        encryptedUpstreamState: string | null;
        outputPath: string | null;
        progress: number;
        errorCode: string | null;
        errorMessage: string | null;
      }>,
    ): JobRecord {
      const current = this.get(id);
      if (!current) throw new Error(`job not found: ${id}`);
      // account_id is immutable after create/schedule.
      db.prepare(
        `UPDATE jobs SET
          status = ?,
          encrypted_upstream_state = ?,
          output_path = ?,
          progress = ?,
          error_code = ?,
          error_message = ?,
          updated_at = ?
         WHERE id = ?`,
      ).run(
        patch.status ?? current.status,
        patch.encryptedUpstreamState === undefined
          ? current.encryptedUpstreamState
          : patch.encryptedUpstreamState,
        patch.outputPath === undefined ? current.outputPath : patch.outputPath,
        patch.progress ?? current.progress,
        patch.errorCode === undefined ? current.errorCode : patch.errorCode,
        patch.errorMessage === undefined ? current.errorMessage : patch.errorMessage,
        nowIso(),
        id,
      );
      return this.get(id)!;
    },

    listResumable(): JobRecord[] {
      const rows = db
        .prepare(
          `SELECT * FROM jobs WHERE status IN ('queued','scheduled','active') ORDER BY created_at ASC`,
        )
        .all() as JobRow[];
      return rows.map(mapJob);
    },
  };
}

export type JobRepository = ReturnType<typeof createJobRepository>;
