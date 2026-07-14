# Google Flow Phase 5 Enroller and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện ứng dụng Windows một nút để thêm/cập nhật tài khoản Google Flow, đóng gói thành một file EXE dùng Chrome có sẵn, rồi chạy soak test và rollout có kiểm soát.

**Architecture:** EXE mở một UI cục bộ trên loopback, ghép cặp với IMG Studio bằng device-code + PKCE, mở Chrome profile tạm để anh đăng nhập Google, xuất storage state vào memory, mã hóa bằng public key enrollment và upload qua token một lần. Tool không chứa secret bridge/CPA; profile tạm và bundle plaintext bị xóa sau mỗi lượt.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Playwright Core 1.61.1, Fastify 5.10.0, esbuild 0.28.1, @yao-pkg/pkg 6.21.0, open 11.0.0, get-port 7.2.0, Vitest 4.1.10, Chrome hệ thống trên Windows.

---

**Prerequisite:** Phase 4 G6 phải đạt và Flow vẫn admin-only. Nếu G6 fail, không phát hành EXE.

### Task 1: Pairing client và PKCE

**Files:**
- Modify: `google-flow-enroller/package.json`
- Create: `google-flow-enroller/src/pairing/pkce.ts`
- Create: `google-flow-enroller/src/pairing/pkce.test.ts`
- Create: `google-flow-enroller/src/pairing/client.ts`
- Create: `google-flow-enroller/src/pairing/client.test.ts`

- [ ] **Step 1: Pin runtime/build dependencies**

Run:

```powershell
npm --prefix google-flow-enroller install --save-exact fastify@5.10.0 get-port@7.2.0 open@11.0.0
npm --prefix google-flow-enroller install --save-dev --save-exact esbuild@0.28.1 @yao-pkg/pkg@6.21.0
```

Add scripts:

```json
{
  "dev": "tsx src/main.ts",
  "build": "node scripts/build.mjs",
  "package:win": "node scripts/package-win.mjs",
  "test": "vitest run"
}
```

- [ ] **Step 2: Write failing PKCE tests**

`pkce.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPKCE } from "./pkce.js";

it("creates a RFC 7636 S256 verifier and challenge", () => {
  const { verifier, challenge } = createPKCE();
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  const expected = createHash("sha256").update(verifier).digest("base64url");
  expect(challenge).toBe(expected);
});
```

- [ ] **Step 3: Write failing pairing client tests**

Inject fetch, clock and wait. Assert exact sequence:

1. POST device with challenge.
2. Return user code and verification URL to UI.
3. Poll token every server-provided interval.
4. Treat HTTP 428 as pending, 410 as expired, 429 as bounded backoff.
5. Send verifier only to token endpoint.
6. Keep enrollment token in memory; never write it or include it in errors/logs.

- [ ] **Step 4: Implement PKCE and client**

`pkce.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function createPKCE() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
```

Client base URL is fixed at build-time default `https://imgstudio.site`, overridable only by a signed/configured command-line `--server` value for development. Require HTTPS except loopback. Reject redirects to another origin.

- [ ] **Step 5: Run tests**

Run: `npm --prefix google-flow-enroller test -- src/pairing/pkce.test.ts src/pairing/client.test.ts`.

Expected: `PASS`, no real network.

### Task 2: Enrollment orchestrator and cleanup guarantees

**Files:**
- Refactor: `google-flow-enroller/src/probes/export-session.ts`
- Create: `google-flow-enroller/src/enrollment/orchestrator.ts`
- Create: `google-flow-enroller/src/enrollment/orchestrator.test.ts`
- Create: `google-flow-enroller/src/enrollment/status.ts`

- [ ] **Step 1: Extract reusable Chrome enrollment function**

Move probe logic into:

```ts
export type EnrollmentProgress =
  | { state: "opening_chrome" }
  | { state: "waiting_google_login" }
  | { state: "verifying_flow" }
  | { state: "waiting_img_studio_approval"; userCode: string; verificationUrl: string }
  | { state: "uploading" }
  | { state: "completed"; alias: string }
  | { state: "manual_challenge"; message: string }
  | { state: "failed"; message: string };

export async function captureFlowStorageState(options: {
  chromePath: string;
  tempRoot: string;
  onProgress(progress: EnrollmentProgress): void;
}): Promise<{ cookies: unknown[]; origins: unknown[] }>;
```

Function must not return access token/email/project ID. It verifies them internally and returns storage state only.

- [ ] **Step 2: Write failing orchestrator tests**

Inject pairing client, Chrome capturer, encryptor and filesystem cleanup. Assert:

- pairing starts before Google capture so approval can happen in parallel;
- public key fetched only after approval;
- encrypted bundle uploaded exactly once;
- temp directory removed on success, login timeout, browser close, upload error and process abort;
- plaintext storage state is not written to disk;
- CAPTCHA/challenge stops with `manual_challenge`, never auto-clicks/solves it;
- retry upload reuses encrypted bytes only in memory before token expiry.

- [ ] **Step 3: Implement orchestrator**

Exact flow:

```text
create PKCE/device session
emit user code + open verification URL in default browser
launch isolated Chrome at Flow
wait for manual Google login
capture storage state in memory
poll admin approval/token
fetch enrollment public key
encrypt storage state
upload encrypted bundle once
zero/release plaintext references
close Chrome/CDP
remove temp profile
show returned alias/status
```

Timeouts: Google login 15 minutes, admin approval 10 minutes, upload 60 seconds. If device session expires while login remains open, stop and ask the user to start again; do not silently create another authorization request.

- [ ] **Step 4: Run tests**

Run: `npm --prefix google-flow-enroller test -- src/enrollment/orchestrator.test.ts`.

### Task 3: Loopback UI with one primary action

**Files:**
- Create: `google-flow-enroller/src/ui/server.ts`
- Create: `google-flow-enroller/src/ui/server.test.ts`
- Create: `google-flow-enroller/src/ui/page.ts`
- Create: `google-flow-enroller/src/main.ts`

- [ ] **Step 1: Write failing UI/API tests**

Use Fastify inject. Assert:

- GET `/` contains title `Thêm tài khoản Google Flow` and one primary button;
- POST `/api/start` starts at most one enrollment;
- GET `/api/status` returns only `EnrollmentProgress`;
- POST `/api/cancel` aborts and cleans up;
- server listens only on `127.0.0.1` and generates a random local CSRF token;
- mutation without matching CSRF header is 403;
- response/cache headers prevent storage and embedding;
- UI HTML contains no bridge/CPA secret or credential field.

- [ ] **Step 2: Implement restrained Vietnamese UI**

One page with:

- Primary button: `Thêm tài khoản`.
- During pairing: user code, `Mở IMG Studio để chấp thuận`.
- During Google login: `Hãy hoàn tất đăng nhập trong cửa sổ Chrome vừa mở`.
- Success: alias and `Tài khoản đã sẵn sàng trên VPS`.
- Retry button only after a terminal error.

Do not expose HAR/cookie/token terminology in the normal UI. Include a compact warning: `Không đóng cửa sổ Chrome đăng nhập cho đến khi tool báo hoàn tất.`

- [ ] **Step 3: Implement main process**

1. Discover Chrome.
2. Get a free loopback port.
3. Generate 32-byte CSRF token.
4. Start UI at `127.0.0.1`.
5. Open local URL with `open` package.
6. Handle one enrollment at a time.
7. On SIGINT/window exit, cancel work and remove temp state.

Write only sanitized structured logs to `%LOCALAPPDATA%\GoogleFlowEnroller\logs`; retention 7 files, 1 MB each. Default UI does not show raw logs.

- [ ] **Step 4: Run tests and manual local smoke**

Run:

```powershell
npm --prefix google-flow-enroller test -- src/ui/server.test.ts
npm --prefix google-flow-enroller run dev
```

Expected: local UI opens, one action works, cancellation cleans profile, no secret in log.

### Task 4: Single-file Windows packaging

**Files:**
- Create: `google-flow-enroller/scripts/build.mjs`
- Create: `google-flow-enroller/scripts/package-win.mjs`
- Create: `google-flow-enroller/pkg-entry.cjs`
- Create: `google-flow-enroller/tests/package.test.ts`
- Create: `google-flow-enroller/README.md`

- [ ] **Step 1: Write failing package contract test**

Assert package manifest pins `@yao-pkg/pkg=6.21.0` and `esbuild=0.28.1`; build scripts use target `node22-win-x64`; artifact name is `Google-Flow-Enroller.exe`; package excludes `state`, `secrets`, tests and source maps.

- [ ] **Step 2: Implement esbuild bundle**

`scripts/build.mjs` bundles `src/main.ts` for Node platform, CommonJS, Node 22, outfile `build/enroller.cjs`, minify false, sourcemap false. Keep `playwright-core` bundled; runtime browser is external Chrome.

- [ ] **Step 3: Implement pkg entry/package script**

`package-win.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
execFileSync(
  process.platform === "win32" ? "node_modules/.bin/pkg.cmd" : "node_modules/.bin/pkg",
  ["pkg-entry.cjs", "--targets", "node22-win-x64", "--output", "dist/Google-Flow-Enroller.exe"],
  { stdio: "inherit" },
);
```

If `pkg` cannot package bundled Playwright Core, do not silently switch to Electron. Record the failure and choose a signed ZIP containing EXE + internal JS as a reviewed fallback. The user-facing launcher remains one double-click.

- [ ] **Step 4: Build and inspect artifact**

Run:

```powershell
npm --prefix google-flow-enroller run package:win
Get-FileHash google-flow-enroller/dist/Google-Flow-Enroller.exe -Algorithm SHA256
Get-Item google-flow-enroller/dist/Google-Flow-Enroller.exe | Select-Object Name,Length
```

Expected: artifact exists, no adjacent credential/state files, hash recorded in release notes. Windows Defender scan must pass. If unsigned, UI/docs must say Windows may show SmartScreen; do not advise disabling security.

- [ ] **Step 5: Run clean-machine smoke**

On a Windows test user/profile with Chrome installed:

1. Copy only EXE.
2. Launch by double-click.
3. Pair/approve.
4. Log in one canary Google account.
5. Confirm bridge account appears healthy.
6. Close EXE and Windows machine.
7. Generate media from VPS/IMG Studio to prove 24/7 independence.
8. Verify no reusable bundle/profile remains under temp/tool state.

### Task 5: Update/re-auth and account lifecycle UX

**Files:**
- Modify: `google-flow-enroller/src/ui/page.ts`
- Modify: `google-flow-enroller/src/enrollment/orchestrator.ts`
- Modify: `src/app/settings/flow-accounts/page.tsx`
- Modify: `src/app/api/flow-enrollment/upload/route.ts`
- Create: `tests/flow-reauth-flow.test.ts`

- [ ] **Step 1: Write failing re-auth tests**

Account page issues an opaque `replaceAccountId` bound to enrollment session after admin confirmation. Tool never accepts arbitrary account IDs from command line. Upload route calls bridge replace endpoint and preserves alias/account ID. Wrong/expired/replayed replace session is rejected.

- [ ] **Step 2: Implement re-auth handoff**

Account card button `Cập nhật đăng nhập` creates a replace enrollment and displays user code/link. Tool normal flow can accept the server-provided mode after pairing; it still captures a new isolated Google session. Bridge verifies new storage state before atomically replacing encrypted state and invalidating old browser context.

- [ ] **Step 3: Implement visible state refresh**

After successful replace, settings page refetches immediately and shows `healthy` without F5. Failed verification leaves old encrypted state untouched and account status unchanged unless the old session independently fails.

- [ ] **Step 4: Run tests/build**

Run: `npx vitest run tests/flow-reauth-flow.test.ts && npm run build && npm --prefix google-flow-enroller test`.

### Task 6: 24-hour soak gate G7

**Files:**
- Create: `scripts/flow-soak-check.mjs`
- Create: `tests/flow-soak-check.test.ts`
- Create: `docs/flow-gates/phase-5-soak-result.md`

- [ ] **Step 1: Write failing parser/report tests**

The script receives sanitized JSON from health endpoints and outputs counters only. Test fails report when: any credential-pattern text, stuck active job >15 minutes, account pool empty, bridge/sidecar restart loop, image/video error rate >20%, or existing provider smoke fails.

- [ ] **Step 2: Implement non-mutating monitor**

Every 5 minutes for 24 hours:

- bridge health/account status counts;
- container restart counts;
- active job ages;
- selected route values;
- app/CPA/bridge HTTP health;
- disk free and bridge data volume size;
- sanitized error counters.

Do not automatically create media every interval. Run four scheduled canary suites during 24 hours (start, +6h, +12h, +24h), each one image + one 4s text video. Image/start-end canaries run only at start/end to limit credits.

- [ ] **Step 3: Inject controlled failures once**

During soak:

1. Disable one canary account, ensure new pre-accept request chooses another.
2. Restart bridge during one active video and verify same-account resume.
3. Stop CPA sidecar briefly only if selected video route is CPA; verify app fails/refunds, then recovers.
4. Set Flow route disabled and verify provider rejects before charge; restore selected route.

All mutations require explicit approval and a rollback command prepared immediately before action.

- [ ] **Step 4: Record G7**

`phase-5-soak-result.md`:

```markdown
# Flow Gate G7 Soak Result

- duration_hours: 24
- bridge_uptime: pass|fail
- session_refresh: pass|fail
- account_failover: pass|fail
- video_restart_resume_same_account: pass|fail
- cpa_route_health: pass|fail|not_selected
- existing_provider_regression: pass|fail
- secret_scan: pass|fail
- decision: keep_admin_only|open_gradually|disable
```

### Task 7: Gradual release, docs and final rollback drill

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/deployment.md`
- Create: `docs/google-flow-accounts.md`
- Create: `docs/flow-release-checklist.md`

- [ ] **Step 1: Write user/admin guide**

Guide contains only:

1. Download/open EXE.
2. Click `Thêm tài khoản`.
3. Approve code in IMG Studio.
4. Log in Google in opened Chrome.
5. Wait for healthy alias.
6. Re-auth from account page when required.

Do not instruct manual HAR/cookie/Bearer extraction in normal docs.

- [ ] **Step 2: Update architecture/current state**

Document selected G4/G5 routes, browser worker, account aliases, feature flags, secret locations by variable/path name, and remaining web-API/reCAPTCHA risks. Do not copy gate evidence containing identifiers.

- [ ] **Step 3: Final rollback drill**

With no active Flow job:

1. Set both routes disabled.
2. Verify Flow models disappear/reject before charge.
3. Stop sidecar if present.
4. Remove Flow image provider from CPA using rollback script.
5. Verify existing providers.
6. Re-enable selected routes/provider and verify one admin image.

Do not delete bridge volume/accounts during drill.

- [ ] **Step 4: Decide public exposure**

Only if G7 says `open_gradually`:

1. Set `FLOW_MODELS_PUBLIC=true` for a small user cohort/maintenance window.
2. Test one normal user billing/refund.
3. Monitor first 20 jobs.
4. If failure rate or policy/session errors exceed threshold, return admin-only/disabled.

- [ ] **Step 5: Final verification**

Run:

```powershell
npm test
npm run build
npm --prefix google-media-bridge test
npm --prefix google-media-bridge run build
npm --prefix google-flow-enroller test
npm --prefix google-flow-enroller run package:win
git status --short
```

Expected: all tests/builds pass; status contains only intended source/docs and no secret/runtime files.

- [ ] **Step 6: Checkpoint/PR/deploy only with explicit authorization**

Do not infer permission to commit, push, open PR or deploy from successful verification. Request/confirm the exact Git and production actions. Stage explicit paths only.

