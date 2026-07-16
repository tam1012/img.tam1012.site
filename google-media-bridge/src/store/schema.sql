PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  encrypted_storage_state TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('healthy','busy','cooldown','reauth_required','blocked','disabled')),
  active_leases INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_verified_at TEXT,
  last_used_at TEXT,
  failure_code TEXT,
  project_id TEXT,
  site_key TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('text_video','image_video','start_end_video')),
  status TEXT NOT NULL CHECK(status IN ('queued','scheduled','active','completed','failed')),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  encrypted_upstream_state TEXT,
  output_path TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_status_last_used ON accounts(status, last_used_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
