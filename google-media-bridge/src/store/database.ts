import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BridgeDatabase = Database.Database;

function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Prefer sibling schema.sql (src or dist after copy).
  return join(here, "schema.sql");
}

export function openDatabase(dbPath: string): BridgeDatabase {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const sql = readFileSync(schemaPath(), "utf8");
  db.exec(sql);
  migrate(db);
  // Restart process → mọi lease in-memory chết; active_leases/busy trong DB phải reset
  // nếu không account sẽ kẹt busy mãi, pool tưởng đang bận.
  db.prepare(
    `UPDATE accounts
     SET active_leases = 0,
         status = CASE WHEN status = 'busy' THEN 'healthy' ELSE status END,
         updated_at = ?
     WHERE active_leases > 0 OR status = 'busy'`,
  ).run(nowIso());
  return db;
}

// CREATE TABLE IF NOT EXISTS không thêm cột mới vào DB đã tồn tại, nên phải ALTER.
// Idempotent: nuốt lỗi "duplicate column" để chạy lại nhiều lần vẫn an toàn.
function migrate(db: BridgeDatabase): void {
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN email TEXT`);
  } catch (error) {
    if (!/duplicate column/i.test(error instanceof Error ? error.message : "")) throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
