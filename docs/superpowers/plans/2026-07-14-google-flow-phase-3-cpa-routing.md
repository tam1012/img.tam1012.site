# Google Flow Phase 3 CPA Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa ảnh Flow qua CPA chính và video Flow qua một CPA sidecar cô lập, với fallback direct nếu contract video không đạt, mà không thay đổi route Grok/xAI/provider hiện tại.

**Architecture:** Ảnh dùng tính năng chính thức `openai-compatibility.models[].image=true` của CPA chính. Video dùng một container CPA riêng, cùng binary/digest đã kiểm chứng, cấu hình một `xai-api-key.base-url` trỏ vào bridge; bridge giả lập contract xAI video nhưng thực thi Flow. Sidecar không mount auths/config của CPA chính.

**Tech Stack:** CLIProxyAPI v7.2.x image digest `sha256:fabcab6a7b66cd8c0d8eb42f44c149ca509a8753be871cfb663834861255673d`, Node.js provisioning scripts, Docker Compose, Vitest.

---

**Prerequisite:** Phase 2 phải có `decision: continue` và bridge live smoke G3 xanh.

### Task 1: Pure config builders và rollback-safe mutation

**Files:**
- Create: `ops/flow-cpa/config.ts`
- Create: `ops/flow-cpa/config.test.ts`
- Create: `ops/flow-cpa/render-sidecar.ts`
- Create: `ops/flow-cpa/render-sidecar.test.ts`

- [ ] **Step 1: Viết test đỏ cho image provider upsert**

`config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { removeFlowProvider, upsertFlowProvider } from "./config";

const existing = [{ name: "existing", "base-url": "https://example.invalid/v1", models: [{ name: "old" }] }];

it("adds one isolated image provider and preserves every existing entry", () => {
  const next = upsertFlowProvider(existing, "bridge-key");
  expect(next[0]).toEqual(existing[0]);
  expect(next.filter((item) => item.name === "google-flow-bridge")).toHaveLength(1);
  expect(next.at(-1)).toMatchObject({
    name: "google-flow-bridge",
    "base-url": "http://google-media-bridge:8460/v1",
    models: [{ name: "flow-nano-banana-2", alias: "flow-nano-banana-2", image: true }],
  });
});

it("is idempotent and rollback removes only Flow", () => {
  const once = upsertFlowProvider(existing, "bridge-key");
  const twice = upsertFlowProvider(once, "bridge-key-2");
  expect(twice.filter((item) => item.name === "google-flow-bridge")).toHaveLength(1);
  expect(removeFlowProvider(twice)).toEqual(existing);
});
```

- [ ] **Step 2: Viết test đỏ cho sidecar config**

`render-sidecar.test.ts` asserts:

```ts
const yaml = renderSidecarConfig({ clientKey: "client-key", bridgeKey: "bridge-key" });
expect(yaml).toContain("port: 8317");
expect(yaml).toContain("base-url: http://google-media-bridge:8460/v1");
expect(yaml).toContain("name: grok-imagine-video");
expect(yaml).not.toContain("auth-dir: /root/.cli-proxy-api");
expect(() => renderSidecarConfig({ clientKey: "bad\nkey", bridgeKey: "ok" })).toThrow();
```

- [ ] **Step 3: Chạy tests và xác nhận đỏ**

Run: `npx vitest run ops/flow-cpa/config.test.ts ops/flow-cpa/render-sidecar.test.ts`

Expected: `FAIL` because builders do not exist.

- [ ] **Step 4: Implement exact config builders**

Image entry:

```ts
export const FLOW_PROVIDER_NAME = "google-flow-bridge";

export function upsertFlowProvider(items: CompatProvider[], bridgeKey: string): CompatProvider[] {
  if (bridgeKey.length < 32 || /[\r\n]/.test(bridgeKey)) throw new Error("Invalid bridge key");
  const flow = {
    name: FLOW_PROVIDER_NAME,
    disabled: false,
    "base-url": "http://google-media-bridge:8460/v1",
    "api-key-entries": [{ "api-key": bridgeKey }],
    models: [{ name: "flow-nano-banana-2", alias: "flow-nano-banana-2", "display-name": "Google Flow Nano Banana 2", image: true }],
  };
  return [...items.filter((item) => item.name !== FLOW_PROVIDER_NAME), flow];
}

export function removeFlowProvider(items: CompatProvider[]) {
  return items.filter((item) => item.name !== FLOW_PROVIDER_NAME);
}
```

Sidecar YAML:

```ts
function yamlScalar(value: string) {
  if (!value || /[\r\n]/.test(value)) throw new Error("Invalid YAML scalar");
  return JSON.stringify(value);
}

export function renderSidecarConfig(input: { clientKey: string; bridgeKey: string }) {
  return [
    "host: 0.0.0.0",
    "port: 8317",
    "remote-management:",
    "  allow-remote: false",
    "  disable-control-panel: true",
    "logging-to-file: false",
    "usage-statistics-enabled: false",
    "request-retry: 0",
    "api-keys:",
    `  - ${yamlScalar(input.clientKey)}`,
    "xai-api-key:",
    `  - api-key: ${yamlScalar(input.bridgeKey)}`,
    "    base-url: http://google-media-bridge:8460/v1",
    "    disable-cooling: true",
    "    models:",
    "      - name: grok-imagine-video",
    "        alias: grok-imagine-video",
    "        display-name: Google Flow Video Gateway",
    "",
  ].join("\n");
}
```

The template strings above produce these exact YAML lines: `  - "<client-key>"` and `  - api-key: "<bridge-key>"`.

- [ ] **Step 5: Run tests green**

Run: `npx vitest run ops/flow-cpa/config.test.ts ops/flow-cpa/render-sidecar.test.ts`

Expected: both `PASS`.

### Task 2: Provision/rollback scripts for CPA image provider

**Files:**
- Create: `ops/flow-cpa/provision-image-provider.ts`
- Create: `ops/flow-cpa/rollback-image-provider.ts`
- Create: `ops/flow-cpa/provision-image-provider.test.ts`

- [ ] **Step 1: Write failing HTTP contract test**

Inject `fetch`; assert provision performs GET then PUT and sends the complete preserved array, while rollback sends the array without only `google-flow-bridge`. Assert management/API keys never appear in logger calls.

- [ ] **Step 2: Implement scripts with env-only secrets**

Required env:

```text
CPA_MANAGEMENT_URL=http://127.0.0.1:8317
CPA_MANAGEMENT_SECRET=<runtime secret>
FLOW_BRIDGE_API_KEY=<runtime secret>
```

Script behavior:

1. GET `/v0/management/openai-compatibility` using `Authorization: Bearer <management-secret>`.
2. Extract full `openai-compatibility` array.
3. Persist a local VPS backup of `/home/ubuntu/cliproxyapi/config.yaml` before mutation; backup is done by deployment shell, not by API response.
4. PUT full array after `upsertFlowProvider`.
5. GET again and assert exactly one Flow entry with `image=true`.
6. Log only provider count and success.

Rollback repeats GET/PUT with `removeFlowProvider`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run ops/flow-cpa/provision-image-provider.test.ts`

Expected: `PASS`.

### Task 3: CPA video sidecar Compose

**Files:**
- Create: `ops/flow-cpa/docker-compose.flow-sidecar.yml`
- Create: `ops/flow-cpa/.env.example`
- Create: `tests/google-flow-cpa-sidecar.test.ts`

- [ ] **Step 1: Write failing static test**

`tests/google-flow-cpa-sidecar.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Flow CPA sidecar", () => {
  it("is isolated, digest pinned and private", () => {
    const compose = readFileSync("ops/flow-cpa/docker-compose.flow-sidecar.yml", "utf8");
    expect(compose).toContain("eceasy/cli-proxy-api@sha256:fabcab6a7b66cd8c0d8eb42f44c149ca509a8753be871cfb663834861255673d");
    expect(compose).toContain("127.0.0.1:8320:8317");
    expect(compose).toContain("name: cliproxyapi_default");
    expect(compose).toContain("name: img-studio_default");
    expect(compose).not.toContain("/home/ubuntu/cliproxyapi/auths");
    expect(compose).not.toContain("cli-proxy-api:/");
  });
});
```

- [ ] **Step 2: Implement sidecar compose**

```yaml
services:
  flow-cpa-sidecar:
    image: eceasy/cli-proxy-api@sha256:fabcab6a7b66cd8c0d8eb42f44c149ca509a8753be871cfb663834861255673d
    container_name: flow-cpa-sidecar
    restart: unless-stopped
    command: ["-config", "/config/config.yaml"]
    ports:
      - "127.0.0.1:8320:8317"
    volumes:
      - ./runtime/config.yaml:/config/config.yaml:ro
    networks:
      - cpa
      - imgstudio

networks:
  cpa:
    external: true
    name: cliproxyapi_default
  imgstudio:
    external: true
    name: img-studio_default
```

`.env.example` lists names only, never example secret values:

```dotenv
FLOW_CPA_CLIENT_KEY=
FLOW_BRIDGE_API_KEY=
```

- [ ] **Step 3: Validate**

Run:

```powershell
npx vitest run tests/google-flow-cpa-sidecar.test.ts
docker compose -f ops/flow-cpa/docker-compose.flow-sidecar.yml config
```

Expected: `PASS`, config valid after non-tracked runtime config is rendered.

### Task 4: CPA image gate G4

**Files:**
- Create: `docs/flow-gates/phase-3-image-result.md`

- [ ] **Step 1: Snapshot current CPA state before mutation**

Requires explicit approval because this changes live CPA config. On VPS:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a /home/ubuntu/cliproxyapi/config.yaml "/home/ubuntu/cliproxyapi/backups/config.yaml.before-flow-$STAMP"
docker ps --filter name=cli-proxy-api --format '{{.Names}} {{.Status}}'
```

- [ ] **Step 2: Record baseline smoke for existing models**

Using secret-safe curl config files, smoke one existing image model and one existing chat model. Record HTTP status/model only. Do not print response bodies containing user content or keys.

- [ ] **Step 3: Provision Flow image entry**

Run provisioning script on VPS with env loaded from root-only file. CPA watches config; if restart is required, restart only `cli-proxy-api` after approval.

- [ ] **Step 4: Smoke Flow image through CPA public route**

Call `POST https://cli.tam1012.site/v1/images/generations` with model `flow-nano-banana-2`, `n=1`, response format base64. Validate HTTP 200 and decoded image magic/size; do not save response JSON containing image in logs.

- [ ] **Step 5: Re-run baseline smokes**

Both existing models must match baseline status. Check CPA logs for no provider-wide errors.

- [ ] **Step 6: Gate/rollback**

If any baseline regresses, run rollback script immediately and restore backup only if API rollback fails. Record:

```markdown
# Flow Gate G4 Result

- flow_image_via_main_cpa: pass|fail
- existing_image_regression: pass|fail
- existing_chat_regression: pass|fail
- rollback_tested: pass|fail
- decision: continue|direct_or_disabled
```

### Task 5: CPA video sidecar gate G5

**Files:**
- Create: `docs/flow-gates/phase-3-video-result.md`

- [ ] **Step 1: Render sidecar config from root-only env**

Create `ops/flow-cpa/runtime/config.yaml` on VPS with mode `600`; this path is gitignored. Config has one client key and one xAI key pointing to bridge. No auth directory from main CPA.

- [ ] **Step 2: Start sidecar after explicit approval**

```bash
cd /home/ubuntu/img-studio
docker compose -f ops/flow-cpa/docker-compose.flow-sidecar.yml up -d
curl -fsS http://127.0.0.1:8320/v1/models -H "Authorization: Bearer $FLOW_CPA_CLIENT_KEY" >/dev/null
```

- [ ] **Step 3: Contract smoke through sidecar**

1. POST `/v1/videos/generations` model `grok-imagine-video`; expect request ID.
2. GET `/v1/videos/<id>` until completed.
3. GET `/v1/videos/<id>/content`; validate MP4 magic and content length.
4. Repeat native `/v1/videos/edits` with one image and two images if CPA route accepts the bridge's JSON/multipart contract.
5. Confirm bridge receives the configured sidecar Bearer on create/poll/content.

- [ ] **Step 4: Decide route without patching CPA**

If create, poll or content differs from contract, set G5 fail and choose `FLOW_VIDEO_ROUTE=direct`. Do not modify CPA source/binary. If one/two-image native routes fail while text route passes, G5 is still fail for production because all required modes must share one route policy.

- [ ] **Step 5: Record result**

```markdown
# Flow Gate G5 Result

- cpa_sidecar_text_video: pass|fail
- cpa_sidecar_image_video: pass|fail
- cpa_sidecar_start_end_video: pass|fail
- cpa_sidecar_content_download: pass|fail
- main_cpa_unchanged: pass|fail
- selected_video_route: cpa|direct|disabled
```

### Task 6: Checkpoint and operational runbook

**Files:**
- Create: `docs/flow-cpa-operations.md`

- [ ] **Step 1: Document exact enable/disable commands**

Runbook includes status, logs, image config upsert/rollback, sidecar up/down, bridge health and model-specific feature flags. It must refer to env variable names, not values.

- [ ] **Step 2: Document rollback order**

1. Set IMG Studio Flow routes to `disabled`.
2. Stop sidecar.
3. Remove only `google-flow-bridge` image entry.
4. Verify baseline models.
5. Keep bridge volume for job/account forensics; do not delete automatically.

- [ ] **Step 3: Checkpoint Git only after approval**

Stage exact `ops/flow-cpa` source/templates/tests/runbook/gate docs. Exclude `runtime/`, keys and CPA config backups.
