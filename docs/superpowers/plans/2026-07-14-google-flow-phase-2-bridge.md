# Google Flow Phase 2 Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây Google Media Bridge chạy 24/7, quản lý pool tài khoản Flow, tạo ảnh và ba mode video, resume job sau restart, đồng thời không làm lộ credential.

**Architecture:** Một Fastify service giữ account/job state trong SQLite, mã hóa storage state và upstream state bằng AES-256-GCM, mở Chromium context riêng theo tài khoản, và chỉ cấp lease qua scheduler. API media tương thích OpenAI image và xAI video để CPA có thể proxy mà không biết payload Flow.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Fastify 5.10.0, @fastify/multipart 10.1.0, Playwright Core 1.61.1, better-sqlite3 12.11.1, Zod 4.4.3, Vitest 4.1.10, Chromium ARM64.

---

**Prerequisite:** `docs/flow-gates/phase-1-result.md` phải có `decision: continue`. Nếu không, dừng phase này.

### Task 1: Pin runtime dependencies và cấu hình service

**Files:**
- Modify: `google-media-bridge/package.json`
- Create: `google-media-bridge/src/config.ts`
- Create: `google-media-bridge/src/config.test.ts`
- Create: `google-media-bridge/src/types.ts`

- [ ] **Step 1: Viết test đỏ cho cấu hình bắt buộc**

Create `src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = {
  FLOW_BRIDGE_API_KEY: "b".repeat(32),
  FLOW_BRIDGE_ADMIN_KEY: "a".repeat(32),
  FLOW_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  FLOW_ENROLLMENT_PRIVATE_KEY_FILE: "/run/secrets/flow-enrollment-private.pem",
  FLOW_CHROMIUM_PATH: "/usr/bin/chromium",
  FLOW_DATA_DIR: "/data",
};

it("loads valid production config", () => {
  expect(loadConfig(valid)).toMatchObject({ port: 8460, dataDir: "/data" });
});

it("rejects short keys and invalid vault key", () => {
  expect(() => loadConfig({ ...valid, FLOW_BRIDGE_API_KEY: "short" })).toThrow();
  expect(() => loadConfig({ ...valid, FLOW_VAULT_KEY: "bad" })).toThrow();
});
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm --prefix google-media-bridge test -- src/config.test.ts`

Expected: `FAIL` vì `config.ts` chưa tồn tại.

- [ ] **Step 3: Pin dependencies và implement config**

Run:

```powershell
npm --prefix google-media-bridge install --save-exact fastify@5.10.0 @fastify/multipart@10.1.0 better-sqlite3@12.11.1 pino@10.3.1
npm --prefix google-media-bridge install --save-dev --save-exact @types/better-sqlite3@7.6.13
```

Add scripts `start`, `dev`, `build`, `test`. Implement `loadConfig` with Zod. Required fields and exact constraints:

```ts
const schema = z.object({
  FLOW_BRIDGE_HOST: z.string().default("0.0.0.0"),
  FLOW_BRIDGE_PORT: z.coerce.number().int().min(1).max(65535).default(8460),
  FLOW_BRIDGE_API_KEY: z.string().min(32),
  FLOW_BRIDGE_ADMIN_KEY: z.string().min(32),
  FLOW_VAULT_KEY: z.string().refine((value) => Buffer.from(value, "base64").length === 32),
  FLOW_ENROLLMENT_PRIVATE_KEY_FILE: z.string().min(1),
  FLOW_CHROMIUM_PATH: z.string().default("/usr/bin/chromium"),
  FLOW_DATA_DIR: z.string().default("/data"),
  FLOW_MAX_ACCOUNT_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
});
```

Create exact states in `types.ts`:

```ts
export type AccountStatus = "healthy" | "busy" | "cooldown" | "reauth_required" | "blocked" | "disabled";
export type JobStatus = "queued" | "scheduled" | "active" | "completed" | "failed";
export type JobKind = "text_video" | "image_video" | "start_end_video";
export type FlowErrorCode =
  | "FLOW_POOL_UNAVAILABLE"
  | "FLOW_REAUTH_REQUIRED"
  | "FLOW_QUOTA_EXCEEDED"
  | "FLOW_RECAPTCHA_FAILED"
  | "FLOW_UPSTREAM_REJECTED"
  | "FLOW_JOB_TIMEOUT";
```

- [ ] **Step 4: Chạy test/build xanh**

Run:

```powershell
npm --prefix google-media-bridge test -- src/config.test.ts
npm --prefix google-media-bridge run build
```

Expected: test `PASS`, build exit `0`.

### Task 2: Vault, redacted logger và SQLite schema

**Files:**
- Create: `google-media-bridge/src/security/vault.ts`
- Create: `google-media-bridge/src/security/vault.test.ts`
- Create: `google-media-bridge/src/logging/redact.ts`
- Create: `google-media-bridge/src/logging/redact.test.ts`
- Create: `google-media-bridge/src/store/schema.sql`
- Create: `google-media-bridge/src/store/database.ts`
- Create: `google-media-bridge/src/store/database.test.ts`

- [ ] **Step 1: Viết test đỏ cho vault và logger**

`vault.test.ts` phải round-trip object chứa `ya29.secret` và `SID=secret`, đồng thời assert ciphertext không chứa plaintext. `redact.test.ts` phải assert output không còn Authorization, Cookie, reCAPTCHA token, email hoặc signed URL.

- [ ] **Step 2: Chạy test và xác nhận đỏ**

Run: `npm --prefix google-media-bridge test -- src/security/vault.test.ts src/logging/redact.test.ts`

Expected: `FAIL` vì modules chưa tồn tại.

- [ ] **Step 3: Implement AES-GCM vault và recursive sanitizer**

Vault envelope:

```ts
type VaultEnvelope = { version: 1; iv: string; tag: string; ciphertext: string };

export function encryptJSON(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  } satisfies VaultEnvelope);
}
```

`decryptJSON` must reject bad version/auth tag. Sanitizer must redact by key name and value pattern:

```ts
const secretKey = /authorization|cookie|token|recaptcha|email|signed|fifeurl|refresh/i;
const secretValue = /ya29\.|Bearer\s+|SID=|@|[?&](token|signature|key)=/i;
```

- [ ] **Step 4: Viết schema SQL và database test đỏ**

Schema:

```sql
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
```

Test opens a temp DB, inserts one account/job, closes/reopens, expects persistence and unique idempotency key.

- [ ] **Step 5: Implement database initializer and build copy**

Use `better-sqlite3`; build script must copy `src/store/schema.sql` to `dist/store/schema.sql` after `tsc`.

- [ ] **Step 6: Chạy tests xanh**

Run:

```powershell
npm --prefix google-media-bridge test -- src/security/vault.test.ts src/logging/redact.test.ts src/store/database.test.ts
npm --prefix google-media-bridge run build
```

Expected: all `PASS`.

### Task 3: Account repository, scheduler và video lease

**Files:**
- Create: `google-media-bridge/src/accounts/repository.ts`
- Create: `google-media-bridge/src/accounts/scheduler.ts`
- Create: `google-media-bridge/src/accounts/scheduler.test.ts`
- Create: `google-media-bridge/src/jobs/repository.ts`
- Create: `google-media-bridge/src/jobs/repository.test.ts`

- [ ] **Step 1: Viết test đỏ cho state machine**

Cover exact behavior:

```ts
it("round robins only healthy accounts", () => {
  const scheduler = createScheduler(fakeRepo([healthy("a"), cooldown("b"), healthy("c")]));
  expect(scheduler.acquire("image").accountId).toBe("a");
  scheduler.release("a");
  expect(scheduler.acquire("image").accountId).toBe("c");
});

it("pins a video job to one account until terminal", () => {
  const lease = scheduler.acquire("video");
  scheduler.bindJob("job-1", lease.accountId);
  expect(scheduler.accountForJob("job-1")).toBe(lease.accountId);
  scheduler.markJobTerminal("job-1");
  expect(scheduler.accountForJob("job-1")).toBeNull();
});
```

Also test `401/403 -> reauth_required`, `429 -> cooldown`, second reCAPTCHA failure -> blocked, and no healthy account -> `FLOW_POOL_UNAVAILABLE`.

- [ ] **Step 2: Implement transactional lease and repositories**

Use `BEGIN IMMEDIATE`. Account selection filters `status IN ('healthy','busy')` and `active_leases < max`; ordering is `last_used_at IS NOT NULL`, oldest `last_used_at`, then alias. The same transaction increments `active_leases`, sets `last_used_at=now`, and sets status to `busy` only when the increment reaches max concurrency. Release decrements exactly once and returns `busy -> healthy` only when no cooldown/reauth/disabled transition superseded it. Job repository stores account ID at create and exposes no reassignment after status `scheduled`.

- [ ] **Step 3: Implement bounded transitions**

```ts
export function nextAccountStatus(httpStatus: number, recaptchaFailures: number) {
  if (httpStatus === 401 || httpStatus === 403) return { status: "reauth_required" as const };
  if (httpStatus === 429) return { status: "cooldown" as const, cooldownMs: 15 * 60_000 };
  if (recaptchaFailures >= 2) return { status: "blocked" as const };
  return { status: "healthy" as const };
}
```

- [ ] **Step 4: Chạy tests xanh**

Run: `npm --prefix google-media-bridge test -- src/accounts/scheduler.test.ts src/jobs/repository.test.ts`

Expected: `PASS`, no leaked timers.

### Task 4: Browser worker, session broker và token factory

**Files:**
- Create: `google-media-bridge/src/browser/worker.ts`
- Create: `google-media-bridge/src/browser/worker.test.ts`
- Modify: `google-media-bridge/src/flow/token-factory.ts`
- Create: `google-media-bridge/src/flow/session-broker.ts`
- Create: `google-media-bridge/src/flow/session-broker.test.ts`

- [ ] **Step 1: Viết tests đỏ**

Assert different accounts get different contexts, repeated calls reuse one context per account, invalidate closes only one account, missing `aisandbox` becomes `FLOW_REAUTH_REQUIRED`, and returned/logged metadata never contains the token.

- [ ] **Step 2: Implement lazy worker pool**

Interface:

```ts
export type AccountBrowser = {
  page: import("playwright-core").Page;
  persist(): Promise<void>;
  close(): Promise<void>;
};

export interface BrowserWorkerPool {
  forAccount(accountId: string): Promise<AccountBrowser>;
  invalidate(accountId: string): Promise<void>;
  close(): Promise<void>;
}
```

Launch with `--no-sandbox`, `--disable-dev-shm-usage`, `--disable-background-networking`. Do not add stealth/fingerprint spoofing. `persist()` exports IndexedDB storage state, encrypts it and updates only that account.

- [ ] **Step 3: Implement session broker**

Call `/fx/api/auth/session` in page origin, validate response, then Google tokeninfo scope. Return token only to the adapter call scope; never expose it in Fastify response.

- [ ] **Step 4: Implement token factory from Phase 1 evidence**

Use the verified site-key/action contract. One refresh/retry maximum. If CAPTCHA/challenge is visible or execute fails twice, return `FLOW_RECAPTCHA_FAILED`; do not bypass it.

- [ ] **Step 5: Tests/build xanh**

Run:

```powershell
npm --prefix google-media-bridge test -- src/browser/worker.test.ts src/flow/session-broker.test.ts src/flow/token-factory.test.ts
npm --prefix google-media-bridge run build
```

### Task 5: Image adapter và OpenAI-compatible route

**Files:**
- Create: `google-media-bridge/src/flow/image.ts`
- Create: `google-media-bridge/src/flow/image.test.ts`
- Create: `google-media-bridge/src/http/auth.ts`
- Create: `google-media-bridge/src/http/image-routes.ts`
- Create: `google-media-bridge/src/http/image-routes.test.ts`

- [ ] **Step 1: Viết test đỏ cho mapping**

Assert `flow-nano-banana-2 -> NARWHAL`, size maps to landscape/portrait/square, count max 4, empty prompt rejected, upstream 401/429 maps to sanitized codes, and two upstream media items produce two outputs.

- [ ] **Step 2: Implement adapter with injected fetch**

Order is scheduler lease -> account browser -> session -> reCAPTCHA -> project ID -> upstream. Retry once only for pre-accept reCAPTCHA failure. HTTP 200 is never retried.

- [ ] **Step 3: Implement service auth and image route**

Require timing-safe Bearer comparison. Request schema:

```ts
const imageRequest = z.object({
  model: z.enum(["flow-nano-banana-2", "NARWHAL"]),
  prompt: z.string().min(1).max(20_000),
  size: z.string().default("1024x1024"),
  n: z.number().int().min(1).max(4).default(1),
  response_format: z.enum(["b64_json", "url"]).default("b64_json"),
});
```

Download `fifeUrl` server-side and return only `b64_json`. Never expose signed URL. Total response cap 40 MB.

- [ ] **Step 4: Chạy tests xanh**

Run: `npm --prefix google-media-bridge test -- src/flow/image.test.ts src/http/image-routes.test.ts`

Expected OpenAI shape `{created,data:[{b64_json}]}`.

### Task 6: Video adapter, durable poller và xAI-compatible routes

**Files:**
- Create: `google-media-bridge/src/flow/video.ts`
- Create: `google-media-bridge/src/flow/video.test.ts`
- Create: `google-media-bridge/src/jobs/poller.ts`
- Create: `google-media-bridge/src/jobs/poller.test.ts`
- Create: `google-media-bridge/src/http/video-routes.ts`
- Create: `google-media-bridge/src/http/video-routes.test.ts`
- Create: `google-media-bridge/fixtures/video-text-request-shape.json`
- Create: `google-media-bridge/fixtures/video-image-request-shape.json`
- Create: `google-media-bridge/fixtures/video-start-end-request-shape.json`
- Create: `google-media-bridge/fixtures/video-status-response-shape.json`

- [ ] **Step 1: Capture sanitized fixtures before implementation**

Use browser network metadata for text, one-image and start/end modes. The verified Flow endpoints are `batchAsyncGenerateVideoText`, `batchAsyncGenerateVideoStartImage` and `batchAsyncGenerateVideoStartAndEndImage`. The one-image payload must contain a synthetic `firstFrameImageMediaId`; the two-frame payload must contain synthetic `firstFrameImageMediaId` and `lastFrameImageMediaId`. Capture the media-upload/register request shape separately because raw image bytes must first become account-bound media IDs. Fixture scanner must reject `ya29`, email, cookies, reCAPTCHA values, signed URLs, and UUIDs copied from live project/account. Preserve only field names, enums and synthetic values.

- [ ] **Step 2: Viết tests đỏ cho three modes and lease**

Normalized input:

```ts
export type CreateVideoInput = {
  prompt: string;
  duration: 4 | 6 | 8 | 10;
  aspectRatio: "16:9" | "9:16";
  startImage?: { data: Buffer; mimeType: string };
  endImage?: { data: Buffer; mimeType: string };
};
```

Test no image -> text endpoint/key `abra_t2v_4s`; start only -> `batchAsyncGenerateVideoStartImage` with the uploaded first-frame media ID; start+end -> `batchAsyncGenerateVideoStartAndEndImage` with both uploaded media IDs; end only rejected; same account through upload/create/poll/download; restart resumes `scheduled|active`; terminal releases once.

- [ ] **Step 3: Implement durable create/poll/download**

Create returns `{"request_id":"flow-job-uuid"}`. Poll returns xAI-compatible `pending|done|failed`. On success save MP4 to `/data/videos/<jobId>.mp4`; content URL points to bridge internal route. Poll every 5 seconds, timeout 10 minutes to match the current IMG Studio request budget, always use persisted `account_id`.

- [ ] **Step 4: Implement routes**

```text
POST /v1/videos/generations
POST /v1/videos/edits
GET  /v1/videos/:id
GET  /v1/videos/:id/content
```

Accept client model `flow-video-fast-4s` and compatibility model `grok-imagine-video`; normalize both to Flow internally. Require bridge key on every route. Max two files, each 9.5 MB.

- [ ] **Step 5: Chạy tests/build xanh**

Run:

```powershell
npm --prefix google-media-bridge test -- src/flow/video.test.ts src/jobs/poller.test.ts src/http/video-routes.test.ts
npm --prefix google-media-bridge run build
```

### Task 7: Admin API, health API và server assembly

**Files:**
- Create: `google-media-bridge/src/http/admin-routes.ts`
- Create: `google-media-bridge/src/http/admin-routes.test.ts`
- Create: `google-media-bridge/src/http/health-routes.ts`
- Create: `google-media-bridge/src/app.ts`
- Create: `google-media-bridge/src/app.test.ts`
- Create: `google-media-bridge/src/server.ts`

- [ ] **Step 1: Viết route tests đỏ**

Assert media key cannot call admin; admin/media keys must differ; enrollment creates alias `flow-01` and stores no email; replace preserves account ID; disable removes account from scheduler; health exposes counts only.

- [ ] **Step 2: Implement admin routes**

```text
POST   /admin/v1/enrollments
PUT    /admin/v1/accounts/:id/enrollment
POST   /admin/v1/accounts/:id/verify
POST   /admin/v1/accounts/:id/disable
POST   /admin/v1/accounts/:id/enable
DELETE /admin/v1/accounts/:id
GET    /admin/v1/accounts
```

Enrollment decrypts RSA/AES bundle, immediately reencrypts storage state with vault key, verifies session, then discards plaintext. Response contains only ID, alias and status.

- [ ] **Step 3: Assemble app and graceful shutdown**

Fastify body limit 12 MB; multipart limit two files. Logger redacts authorization, cookie and body. SIGTERM stops new requests, waits max 30 seconds, persists browser state, closes contexts/database.

- [ ] **Step 4: Tests/build xanh**

Run:

```powershell
npm --prefix google-media-bridge test
npm --prefix google-media-bridge run build
```

### Task 8: Docker service, dual private networks và live gate G3

**Files:**
- Create: `google-media-bridge/Dockerfile`
- Create: `google-media-bridge/docker-compose.bridge.yml`
- Create: `google-media-bridge/.dockerignore`
- Create: `tests/google-flow-bridge-compose.test.ts`
- Create: `docs/flow-gates/phase-2-result.md`

- [ ] **Step 1: Viết compose test đỏ**

Test must require loopback `127.0.0.1:8460:8460`, external networks `cliproxyapi_default` and `img-studio_default`, read-only private PEM mount, and reject literal secret patterns.

- [ ] **Step 2: Implement Dockerfile**

Use `node:22-bookworm-slim`; build with full deps, runtime installs `chromium ca-certificates fonts-noto-color-emoji`, runs as UID 1002, stores state in `/data`.

- [ ] **Step 3: Implement compose**

Bridge service joins both external networks with DNS alias `google-media-bridge`, mounts named volume `flow-bridge-data` and private key read-only, and publishes only loopback port 8460.

- [ ] **Step 4: Static validation**

Run:

```powershell
npx vitest run tests/google-flow-bridge-compose.test.ts
docker compose -f google-media-bridge/docker-compose.bridge.yml config
```

Expected: pass/valid with non-tracked dummy env.

- [ ] **Step 5: Deploy bridge canary after explicit approval**

This creates a persistent VPS service. Explain rollback and obtain approval immediately before running:

```bash
cd /home/ubuntu/img-studio/google-media-bridge
docker compose -f docker-compose.bridge.yml build --no-cache
docker compose -f docker-compose.bridge.yml up -d
curl -fsS http://127.0.0.1:8460/health
```

- [ ] **Step 6: Live G3 smoke**

With one canary account: image, text video, image video, start/end video, bridge restart during active video, one account forced reauth, and log redaction. Use key files/env with suppressed output; never place keys in command history/log.

- [ ] **Step 7: Record gate**

Create `docs/flow-gates/phase-2-result.md` with pass/fail for direct image, three video modes, restart-resume-same-account, log redaction and `decision: continue|stop`.

- [ ] **Step 8: Checkpoint Git có điều kiện**

Only after approval, stage exact bridge source/tests/compose/gate document. Exclude `.env`, `secrets/`, `data/`, live bundles and raw captures.
