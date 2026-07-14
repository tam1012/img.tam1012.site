# Google Flow Phase 4 IMG Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tích hợp ảnh/video Flow vào pipeline billing, storage và UI hiện tại của IMG Studio; bổ sung gateway ghép cặp cho tool Windows mà không đưa secret bridge/CPA xuống máy người dùng.

**Architecture:** Flow là provider type riêng nhưng credential dịch vụ chỉ đến từ env. `flow-routing.ts` chọn `cpa|direct|disabled` độc lập cho ảnh/video và fail closed khi thiếu config. Enrollment tool dùng device-code + PKCE qua IMG Studio; sau khi admin phê duyệt, một token một lần cho phép lấy public key và upload bundle mã hóa, IMG Studio proxy sang Admin API của bridge.

**Tech Stack:** Next.js 15, TypeScript 5.8, Vitest 4.1.10, Prisma/PostgreSQL, existing wallet/ledger/storage pipeline, Google Media Bridge.

---

**Prerequisite:** Phase 3 đã ghi G4/G5 và chọn route thực tế. Không tự giả định CPA video đạt.

### Task 1: Feature flags và endpoint resolution fail-closed

**Files:**
- Create: `src/lib/flow-routing.ts`
- Create: `tests/flow-routing.test.ts`
- Modify: `.env.example`
- Modify: `scripts/check-env.js`

- [ ] **Step 1: Viết test đỏ cho routing matrix**

`tests/flow-routing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveFlowImageRoute, resolveFlowVideoRoute } from "@/lib/flow-routing";

it("routes image through main CPA", () => {
  expect(resolveFlowImageRoute({
    FLOW_IMAGE_ROUTE: "cpa",
    FLOW_CPA_IMAGE_BASE_URL: "https://cli.example/v1",
    FLOW_CPA_IMAGE_API_KEY: "k".repeat(32),
  })).toEqual({ route: "cpa", baseUrl: "https://cli.example/v1", apiKey: "k".repeat(32), model: "flow-nano-banana-2" });
});

it("routes video through sidecar when G5 selected cpa", () => {
  expect(resolveFlowVideoRoute({
    FLOW_VIDEO_ROUTE: "cpa",
    FLOW_CPA_VIDEO_BASE_URL: "http://flow-cpa-sidecar:8317/v1",
    FLOW_CPA_VIDEO_API_KEY: "v".repeat(32),
  })).toMatchObject({ route: "cpa", model: "grok-imagine-video" });
});

it("fails closed for missing, invalid or disabled config", () => {
  expect(resolveFlowImageRoute({})).toEqual({ route: "disabled" });
  expect(resolveFlowVideoRoute({ FLOW_VIDEO_ROUTE: "cpa" })).toEqual({ route: "disabled" });
  expect(resolveFlowVideoRoute({ FLOW_VIDEO_ROUTE: "disabled" })).toEqual({ route: "disabled" });
});
```

- [ ] **Step 2: Chạy test và xác nhận đỏ**

Run: `npx vitest run tests/flow-routing.test.ts`

Expected: `FAIL` because module does not exist.

- [ ] **Step 3: Implement exact resolver contract**

`src/lib/flow-routing.ts`:

```ts
export type FlowRoute =
  | { route: "disabled" }
  | { route: "cpa" | "direct"; baseUrl: string; apiKey: string; model: string };

function endpoint(route: string | undefined, baseUrl: string | undefined, apiKey: string | undefined, model: string): FlowRoute {
  if (route !== "cpa" && route !== "direct") return { route: "disabled" };
  const normalized = baseUrl?.trim().replace(/\/$/, "");
  if (!normalized || !apiKey || apiKey.length < 32) return { route: "disabled" };
  return { route, baseUrl: normalized, apiKey, model };
}

export function resolveFlowImageRoute(env: Record<string, string | undefined>): FlowRoute {
  const route = env.FLOW_IMAGE_ROUTE;
  return route === "cpa"
    ? endpoint(route, env.FLOW_CPA_IMAGE_BASE_URL, env.FLOW_CPA_IMAGE_API_KEY, "flow-nano-banana-2")
    : endpoint(route, env.FLOW_BRIDGE_BASE_URL, env.FLOW_BRIDGE_API_KEY, "flow-nano-banana-2");
}

export function resolveFlowVideoRoute(env: Record<string, string | undefined>): FlowRoute {
  const route = env.FLOW_VIDEO_ROUTE;
  return route === "cpa"
    ? endpoint(route, env.FLOW_CPA_VIDEO_BASE_URL, env.FLOW_CPA_VIDEO_API_KEY, "grok-imagine-video")
    : endpoint(route, env.FLOW_BRIDGE_BASE_URL, env.FLOW_BRIDGE_API_KEY, "flow-video-fast-4s");
}

export function flowModelsPublic(env: Record<string, string | undefined>) {
  return env.FLOW_MODELS_PUBLIC === "true";
}
```

- [ ] **Step 4: Document env and validate paired fields**

Append names/defaults to `.env.example`; no real values:

```dotenv
FLOW_IMAGE_ROUTE=disabled
FLOW_VIDEO_ROUTE=disabled
FLOW_MODELS_PUBLIC=false
FLOW_CPA_IMAGE_BASE_URL=
FLOW_CPA_IMAGE_API_KEY=
FLOW_CPA_VIDEO_BASE_URL=http://flow-cpa-sidecar:8317/v1
FLOW_CPA_VIDEO_API_KEY=
FLOW_BRIDGE_BASE_URL=http://google-media-bridge:8460/v1
FLOW_BRIDGE_API_KEY=
FLOW_BRIDGE_ADMIN_BASE_URL=http://google-media-bridge:8460
FLOW_BRIDGE_ADMIN_KEY=
```

`check-env.js` accepts disabled routes without keys. If route is `cpa` or `direct`, validate the corresponding base URL/key pair and admin base/key for enrollment gateway. Do not print values.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/flow-routing.test.ts && node scripts/check-env.js` with a temporary valid env.

Expected: tests pass; invalid enabled configuration exits nonzero with variable names only.

### Task 2: Flow image provider adapter and provider model

**Files:**
- Create: `src/lib/providers/flow.ts`
- Create: `tests/flow-image-provider.test.ts`
- Modify: `src/lib/providers/custom.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/image-options.ts`
- Modify: `src/app/api/providers/route.ts`
- Modify: `src/app/api/providers/[id]/route.ts`
- Modify: `src/app/settings/page.tsx`
- Create: `scripts/seed-flow-provider.js`
- Create: `tests/flow-provider-config.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Inject fetch and env resolver. Assert CPA/direct endpoints receive OpenAI image body, returned base64 becomes `GeneratedImage`, disabled returns `FLOW_PROVIDER_DISABLED`, and response with URL is downloaded server-side. Assert error text never includes Authorization.

- [ ] **Step 2: Implement flow image adapter**

`src/lib/providers/flow.ts` exports:

```ts
export async function flowGenerate(params: GenerateParams, deps = defaultDeps): Promise<GeneratedImage[]> {
  const target = resolveFlowImageRoute(process.env);
  if (target.route === "disabled") throw new Error("FLOW_PROVIDER_DISABLED");
  const response = await deps.fetch(`${target.baseUrl}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({
      model: target.model,
      prompt: params.prompt,
      size: `${params.width}x${params.height}`,
      n: params.count ?? 1,
      response_format: "b64_json",
    }),
  });
  return normalizeFlowImages(response, target.model);
}
```

The generated URL is `<baseUrl>/images/generations`; never concatenate a user-controlled host.

- [ ] **Step 3: Add provider type without Prisma migration**

`Provider.apiType` is already a string column. Extend TypeScript union to `"flow"`, normalization and API validation. Rules:

- Flow provider needs no DB API key/base URL; service credentials come from env.
- Flow edit is unsupported in v1; `maxEditImagesForProvider` returns 0.
- `maxResolutionForProvider` returns 2K.
- Non-admin users see Flow only when `FLOW_MODELS_PUBLIC=true`; admins see it when route is enabled.
- Settings labels it `Google Flow Bridge` and shows `Credential do hệ thống quản lý`.

- [ ] **Step 4: Wire adapter in custom provider dispatch**

Before generic OpenAI branch:

```ts
if (config.api_type === "flow") return flowGenerate(params);
```

Edit dispatch throws `Google Flow v1 chưa hỗ trợ chỉnh sửa ảnh`.

- [ ] **Step 5: Add idempotent provider seeder**

Seeder upserts fixed ID `google-flow-image`, name `Google Flow · Nano Banana 2`, type `flow`, model `flow-nano-banana-2`, not default. It does nothing when image route is disabled. Add startup call after existing admin seed, and test that repeated execution does not duplicate or change user-selected default.

- [ ] **Step 6: Run targeted tests**

Run:

```powershell
npx vitest run tests/flow-image-provider.test.ts tests/flow-provider-config.test.ts
npm run build
```

Expected: pass/build exit 0.

### Task 3: Flow video client with one/two images

**Files:**
- Create: `src/lib/flow-video-client.ts`
- Create: `tests/flow-video-client.test.ts`
- Modify: `src/lib/video.ts`
- Modify: `src/app/api/video/generate/route.ts`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write failing client tests**

Test exact sequence create -> poll -> content for direct and CPA. Use fake fetch; no sleeps by injecting `wait`. Assert:

- direct create model is `flow-video-fast-4s`;
- CPA create model is `grok-imagine-video`;
- text uses `/videos/generations`;
- one/two images use `/videos/edits` with JSON data URLs;
- same request ID is polled until done;
- failed/timeout surfaces sanitized error;
- MP4 bytes are written only after successful content response.

- [ ] **Step 2: Implement client**

`generateFlowVideo` accepts:

```ts
type FlowVideoInput = {
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  duration: 4;
  startImage?: { data: string; mimeType: string };
  endImage?: { data: string; mimeType: string };
};
```

Create body:

```ts
const body = {
  model: target.model,
  prompt: input.prompt,
  duration: 4,
  aspect_ratio: input.aspectRatio,
  ...(input.startImage ? { image: { url: `data:${input.startImage.mimeType};base64,${input.startImage.data}` } } : {}),
  ...(input.endImage ? { end_image: { url: `data:${input.endImage.mimeType};base64,${input.endImage.data}` } } : {}),
};
```

Poll every 5 seconds for max 10 minutes, matching the existing `maxDuration = 600`, then GET content using the same service key.

- [ ] **Step 3: Extend video types and route validation**

Add `FLOW_VIDEO_MODELS = ["flow-video-fast-4s"]`; include in model lists only for admin until public flag true. Extend mode to `"text" | "image" | "start_end"`, and `GenerateVideoInput` with `endImage`.

API route reads `image` and `endImage`, max 9.5 MB each, image MIME only. Validation:

- end without start -> 400;
- start/end only accepted for Flow model;
- Flow duration forced to 4;
- Flow account field ignored because bridge schedules account;
- Flow route disabled -> 503 before charge;
- existing Vertex/xAI validation unchanged.

Prisma `Video.mode` is already String; update documentation comment only, no migration required.

- [ ] **Step 4: Wire Flow generation into existing billing pipeline**

`generateVideo` calls `generateFlowVideo` for Flow models, writes output to existing video path and returns account alias from response header/body when present, otherwise `flow-pool`. Charge/refund and record ownership stay in current API route.

- [ ] **Step 5: Run targeted regression**

Run:

```powershell
npx vitest run tests/flow-video-client.test.ts tests/xai-video-pool.test.ts
npm run build
```

Expected: Flow and existing xAI tests pass.

### Task 4: Video UI for text, one image and start/end

**Files:**
- Modify: `src/app/video/page.tsx`
- Create: `tests/flow-video-ui.test.ts`

- [ ] **Step 1: Write failing source contract test**

Assert page contains Flow model metadata, mode `start_end`, field `endImage`, text labels `Khung bắt đầu` and `Khung kết thúc`, Flow duration option only 4 seconds, and sends both multipart fields.

- [ ] **Step 2: Implement UI**

Mode choices become three buttons:

```text
Từ mô tả
Từ một ảnh
Khung đầu → cuối
```

Only show third mode when selected model supports it; switching to existing models moves back to text/image. For start/end, require both previews. Keep restrained current styling; no redesign.

- [ ] **Step 3: Immediate visible state**

Loading copy must not expose queue internals:

`Video đang được tạo. Có thể mất vài phút; trạng thái sẽ tự cập nhật.`

Keep current synchronous request for v1; no manual F5. On success update wallet and show video immediately.

- [ ] **Step 4: Tests/build**

Run: `npx vitest run tests/flow-video-ui.test.ts tests/prompt-refine-pages.test.ts && npm run build`.

### Task 5: Device-code + PKCE enrollment state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260714_add_flow_enrollment_session/migration.sql`
- Create: `src/lib/flow-enrollment.ts`
- Create: `tests/flow-enrollment.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

Cover create, approve, token exchange, one-time upload, expiry, PKCE mismatch, replay rejection and hashing. Raw device/user/access codes must never be stored.

- [ ] **Step 2: Add schema**

```prisma
model FlowEnrollmentSession {
  id               String   @id @default(uuid())
  deviceCodeHash   String   @unique
  userCodeHash     String   @unique
  pkceChallenge    String
  status           String   @default("pending")
  enrollmentHash   String?  @unique
  approvedBy       String?
  expiresAt        DateTime
  approvedAt       DateTime?
  consumedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([status, expiresAt])
}
```

Migration creates table and indexes only; no existing data change.

- [ ] **Step 3: Implement cryptographic helpers and transactions**

- device code: 32 random bytes, base64url;
- user code: 8 characters from unambiguous alphabet, displayed `XXXX-XXXX`;
- hash: SHA-256 with domain prefixes `device:`, `user:`, `token:`;
- PKCE: S256 verifier/challenge;
- expiry: 10 minutes;
- polling interval: 3 seconds;
- enrollment token: 32 random bytes, stored only as hash;
- approval and consume use Prisma transaction + status predicate.

- [ ] **Step 4: Run migration/unit tests locally**

Run:

```powershell
npx prisma generate
npx vitest run tests/flow-enrollment.test.ts
```

Expected: pass; migration review shows no DROP/ALTER existing tables.

### Task 6: Enrollment gateway APIs and bridge admin client

**Files:**
- Create: `src/lib/flow-bridge-admin.ts`
- Create: `tests/flow-bridge-admin.test.ts`
- Create: `src/app/api/flow-enrollment/device/route.ts`
- Create: `src/app/api/flow-enrollment/token/route.ts`
- Create: `src/app/api/flow-enrollment/public-key/route.ts`
- Create: `src/app/api/flow-enrollment/upload/route.ts`
- Create: `src/app/api/admin/flow-enrollment/approve/route.ts`
- Create: `src/app/api/admin/flow-accounts/route.ts`
- Create: `src/app/api/admin/flow-accounts/[id]/route.ts`
- Modify: `src/middleware.ts`
- Create: `tests/flow-enrollment-routes.test.ts`

- [ ] **Step 1: Write failing bridge admin client tests**

Assert admin key goes only to internal bridge URL, never response/log; public key/accounts/enrollment/verify/enable/disable/delete are mapped; timeouts abort at 15 seconds.

- [ ] **Step 2: Implement bridge admin client**

Functions:

```ts
getEnrollmentPublicKey()
uploadEnrollment(bundle)
listFlowAccounts()
verifyFlowAccount(id)
setFlowAccountEnabled(id, enabled)
deleteFlowAccount(id)
```

Use `FLOW_BRIDGE_ADMIN_BASE_URL` and `FLOW_BRIDGE_ADMIN_KEY`; reject non-http(s) URL and do not follow redirects to another origin.

- [ ] **Step 3: Write route tests before implementation**

Use mocked Prisma/client. Exact protocol:

1. `POST /api/flow-enrollment/device` body `{code_challenge}` -> device/user codes, verification URL, 600 seconds, interval 3.
2. Admin opens verification URL and `POST /api/admin/flow-enrollment/approve` with user code.
3. Tool polls `POST /api/flow-enrollment/token` with device code + verifier -> pending 428 or one-time token.
4. `GET /api/flow-enrollment/public-key` with token -> PEM.
5. `POST /api/flow-enrollment/upload` with token + encrypted bundle -> forwards once, marks consumed only after bridge success.

Test expired, replay, wrong verifier, non-admin approval, oversized bundle (>5 MB), and bridge failure keeps token retryable until expiry.

- [ ] **Step 4: Implement routes and middleware exceptions**

Only device/token/public-key/upload paths bypass cookie middleware; each route enforces its own protocol. Admin paths remain session-protected. Add rate limits: device 5/min/IP, token 30/min/device, upload 3/session.

- [ ] **Step 5: Implement account proxy routes**

Admin-only GET/PATCH/DELETE. Return alias/status/timestamps/job counters only. No credential fields accepted or returned.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/flow-bridge-admin.test.ts tests/flow-enrollment-routes.test.ts`.

### Task 7: Admin verification and account management UI

**Files:**
- Create: `src/app/admin/flow-enrollment/page.tsx`
- Create: `src/app/settings/flow-accounts/page.tsx`
- Modify: `src/app/settings/page.tsx`
- Create: `tests/flow-account-admin-ui.test.ts`

- [ ] **Step 1: Write failing UI source tests**

Assert verify page displays user code and explicit approve/reject; account page has add/update instructions, Verify, Pause/Enable and Delete confirmation; statuses translated; no email/token wording.

- [ ] **Step 2: Implement verification page**

Read `user_code` from query, require admin session via layout/API. Show:

`Tool Google Flow đang yêu cầu quyền thêm một tài khoản vào hệ thống. Chỉ chấp thuận nếu chính anh vừa mở tool trên máy này.`

Approval button calls API and shows visible success without F5.

- [ ] **Step 3: Implement account page**

Cards show alias, status, last verified, active jobs and sanitized failure code. Actions immediately refetch state. `Thêm tài khoản` instructs downloading/opening Windows tool; no manual HAR/cookie instructions in normal flow.

- [ ] **Step 4: Tests/build**

Run: `npx vitest run tests/flow-account-admin-ui.test.ts && npm run build`.

### Task 8: Compose/deployment wiring and admin-only canary G6

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `Dockerfile`
- Create: `tests/flow-img-studio-deploy.test.ts`
- Create: `docs/flow-gates/phase-4-result.md`

- [ ] **Step 1: Write failing deployment tests**

Assert app has both private DNS endpoints in env, no bridge secrets hard-coded, migration deploy remains before server start, bridge/sidecar compose commands are conditional, and existing backup steps remain.

- [ ] **Step 2: Wire app to services**

App already joins `img-studio_default`. Bridge and sidecar join it externally. Add env passthrough names only. Do not add static container IPs. Dockerfile copies new scripts but never secret files.

- [ ] **Step 3: Extend deployment safely**

Workflow order after source reset and backups:

1. Build/start bridge only when root-only `google-media-bridge/.env` and private key exist.
2. Start sidecar only when root-only runtime config exists and `FLOW_VIDEO_ROUTE=cpa` in app env.
3. Build/start app.
4. Health-check bridge/sidecar/app; failure stops deployment without pruning running old containers first.

Do not auto-create credentials in GitHub Actions.

- [ ] **Step 4: Full local validation**

Run:

```powershell
npm test
npm run build
npx vitest run tests/flow-img-studio-deploy.test.ts
docker compose config
```

- [ ] **Step 5: Deploy admin-only canary after explicit approval**

Set `FLOW_MODELS_PUBLIC=false`; chosen image/video routes from G4/G5. Push/deploy only after explicit permission. Verify GitHub Actions and runtime.

- [ ] **Step 6: End-to-end G6**

As admin:

1. Add/update one Flow account via enrollment protocol.
2. Create Flow image; verify storage/thumbnail/request log.
3. Create text video, one-image video, start/end video; verify files/playback.
4. Force one upstream error; verify failed record and no admin charge.
5. Test a funded normal user only if public flag remains false through direct API: must get 403/not listed.
6. Verify existing GPT/Gemini/Grok/Vertex smoke.
7. Verify no token/email/signed URL in app/bridge/CPA logs.

- [ ] **Step 7: Record result/rollback**

`docs/flow-gates/phase-4-result.md` records all four functions, billing/refund, provider regressions, visibility and selected routes. On failure set both routes disabled first; do not delete jobs/accounts.

- [ ] **Step 8: Checkpoint Git only after approval**

Stage exact source/migration/tests/docs. Never stage env, keys, bundles, data or logs.
