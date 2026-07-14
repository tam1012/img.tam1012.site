# Google Flow Phase 1 Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chứng minh hoặc bác bỏ hai giả định nền tảng: session Flow đăng nhập trên Windows dùng được trong Chromium ARM64 VPS, và browser context VPS tạo được token runtime cần cho request ảnh/video mà không bypass CAPTCHA.

**Architecture:** Tạo hai probe nhỏ có code sẽ được tái sử dụng: exporter Windows xuất storage state trung lập và importer VPS nạp state vào Chromium. Bundle dùng RSA-OAEP-SHA256 + AES-256-GCM; probe chỉ in trạng thái/scope đã làm sạch, không in credential.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Vitest 4.1.10, Playwright Core 1.61.1, Chromium hệ thống trên Windows và `/usr/bin/chromium` trên Ubuntu ARM64.

---

### Task 1: Scaffold hai package với dependency pin cố định

**Files:**
- Create: `google-media-bridge/package.json`
- Create: `google-media-bridge/tsconfig.json`
- Create: `google-flow-enroller/package.json`
- Create: `google-flow-enroller/tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Thêm test cấu trúc package ở trạng thái đỏ**

Create `tests/google-flow-package-boundaries.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Google Flow package boundaries", () => {
  it("pin bridge/enroller dependencies and never track runtime state", () => {
    const bridge = JSON.parse(readFileSync("google-media-bridge/package.json", "utf8"));
    const enroller = JSON.parse(readFileSync("google-flow-enroller/package.json", "utf8"));
    const ignore = readFileSync(".gitignore", "utf8");

    expect(bridge.dependencies["playwright-core"]).toBe("1.61.1");
    expect(enroller.dependencies["playwright-core"]).toBe("1.61.1");
    expect(ignore).toContain("google-media-bridge/data/");
    expect(ignore).toContain("google-flow-enroller/state/");
    expect(ignore).toContain("*.flow-enrollment");
  });
});
```

- [ ] **Step 2: Chạy test và xác nhận đỏ đúng lý do**

Run:

```powershell
npx vitest run tests/google-flow-package-boundaries.test.ts
```

Expected: `FAIL` vì hai `package.json` chưa tồn tại.

- [ ] **Step 3: Tạo package manifests tối thiểu**

`google-media-bridge/package.json`:

```json
{
  "name": "google-media-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "probe:keys": "tsx src/probes/generate-keypair.ts",
    "probe:import": "tsx src/probes/import-session.ts"
  },
  "dependencies": {
    "playwright-core": "1.61.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "22.15.0",
    "tsx": "4.23.1",
    "typescript": "5.8.3",
    "vitest": "4.1.10"
  }
}
```

`google-flow-enroller/package.json`:

```json
{
  "name": "google-flow-enroller",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "probe:export": "tsx src/probes/export-session.ts"
  },
  "dependencies": {
    "playwright-core": "1.61.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "22.15.0",
    "tsx": "4.23.1",
    "typescript": "5.8.3",
    "vitest": "4.1.10"
  }
}
```

Both `tsconfig.json` files:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

Append to `.gitignore`:

```gitignore
# Google Flow bridge/enroller runtime state
google-media-bridge/data/
google-media-bridge/secrets/
google-flow-enroller/state/
*.flow-enrollment
```

- [ ] **Step 4: Cài đúng lockfile và chạy test xanh**

Run:

```powershell
npm --prefix google-media-bridge install --save-exact
npm --prefix google-flow-enroller install --save-exact
npx vitest run tests/google-flow-package-boundaries.test.ts
```

Expected: hai `package-lock.json` được tạo, test `PASS`.

- [ ] **Step 5: Checkpoint Git có điều kiện**

Chỉ khi anh đã cấp quyền commit:

```powershell
git add .gitignore tests/google-flow-package-boundaries.test.ts google-media-bridge/package.json google-media-bridge/package-lock.json google-media-bridge/tsconfig.json google-flow-enroller/package.json google-flow-enroller/package-lock.json google-flow-enroller/tsconfig.json
git commit -m "chore(flow): scaffold bridge and enroller probes"
```

### Task 2: Mã hóa enrollment bundle và redaction

**Files:**
- Create: `google-flow-enroller/src/security/enrollment.ts`
- Create: `google-flow-enroller/src/security/enrollment.test.ts`
- Create: `google-media-bridge/src/security/enrollment.ts`
- Create: `google-media-bridge/src/security/enrollment.test.ts`
- Create: `google-media-bridge/src/probes/generate-keypair.ts`

- [ ] **Step 1: Viết test đỏ cho hybrid encryption**

Test phải tạo RSA key pair tạm, gọi `encryptEnrollment`, giải bằng `decryptEnrollment`, và xác nhận ciphertext không chứa `ya29`, email hoặc cookie value. Contract chung:

```ts
export type EnrollmentPayload = {
  version: 1;
  issuedAt: string;
  storageState: { cookies: unknown[]; origins: unknown[] };
};

export type EncryptedEnrollment = {
  version: 1;
  encryptedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};
```

Run:

```powershell
npm --prefix google-flow-enroller test -- src/security/enrollment.test.ts
npm --prefix google-media-bridge test -- src/security/enrollment.test.ts
```

Expected: `FAIL` vì functions chưa tồn tại.

- [ ] **Step 2: Implement mã hóa phía Windows**

`encryptEnrollment` phải:

```ts
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();
const encryptedKey = publicEncrypt(
  { key: publicKeyPem, oaepHash: "sha256" },
  key,
);
```

Return all binary fields as base64. Không ghi plaintext ra disk.

- [ ] **Step 3: Implement giải mã phía bridge**

`decryptEnrollment` phải dùng `privateDecrypt({oaepHash: "sha256"})`, AES-GCM auth tag, parse JSON và validate bằng Zod:

```ts
const payloadSchema = z.object({
  version: z.literal(1),
  issuedAt: z.string().datetime(),
  storageState: z.object({
    cookies: z.array(z.unknown()),
    origins: z.array(z.unknown()),
  }),
});
```

Reject bundle quá 10 phút hoặc sai auth tag.

- [ ] **Step 4: Implement one-time keypair generator**

`generate-keypair.ts` uses Node `generateKeyPairSync("rsa", { modulusLength: 3072 })`. It writes the private key with mode `600` and public key with mode `644`, refusing to overwrite either file unless `--force` is explicitly supplied. Default probe paths:

```text
google-media-bridge/secrets/probe-private.pem
google-flow-enroller/state/probe-public.pem
```

Both directories are already gitignored. The exporter requires `FLOW_ENROLLMENT_PUBLIC_KEY_FILE`; the importer requires `FLOW_ENROLLMENT_PRIVATE_KEY_FILE`. Neither key is printed to stdout.

- [ ] **Step 5: Chạy test xanh và build**

```powershell
npm --prefix google-flow-enroller test -- src/security/enrollment.test.ts
npm --prefix google-media-bridge test -- src/security/enrollment.test.ts
npm --prefix google-flow-enroller run build
npm --prefix google-media-bridge run build
```

Expected: tất cả `PASS`, build exit `0`.

### Task 3: Export session từ Chrome Windows

**Files:**
- Create: `google-flow-enroller/src/chrome/find-chrome.ts`
- Create: `google-flow-enroller/src/chrome/find-chrome.test.ts`
- Create: `google-flow-enroller/src/probes/export-session.ts`

- [ ] **Step 1: Viết test đỏ cho Chrome discovery**

Test các path theo thứ tự:

```ts
const candidates = [
  process.env.FLOW_CHROME_PATH,
  `${process.env.PROGRAMFILES}\Google\Chrome\Application\chrome.exe`,
  `${process.env["PROGRAMFILES(X86)"]}\Google\Chrome\Application\chrome.exe`,
  `${process.env.LOCALAPPDATA}\Google\Chrome\Application\chrome.exe`,
].filter(Boolean);
```

Inject `existsSync` vào `findChromePath` để test không phụ thuộc máy thật. Expected đỏ vì module chưa tồn tại.

- [ ] **Step 2: Implement discovery và launch isolated profile**

`export-session.ts` phải:

1. Tạo thư mục tạm bằng `mkdtemp`.
2. Chọn port loopback tự do.
3. Spawn Chrome với `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=<port>`, `--user-data-dir=<temp>`, `--no-first-run`, URL `https://labs.google/fx/tools/flow`.
4. `chromium.connectOverCDP(http://127.0.0.1:<port>)`.
5. Chờ anh đăng nhập; không tự nhập mật khẩu/2FA/CAPTCHA.
6. Poll `fetch('/fx/api/auth/session')` trong page context cho tới khi response có `access_token`.
7. Xác minh token metadata có scope `https://www.googleapis.com/auth/aisandbox` nhưng không log token.
8. Export `context.storageState({ indexedDB: true })` vào memory.
9. Đọc public PEM từ `FLOW_ENROLLMENT_PUBLIC_KEY_FILE`, mã hóa và ghi đúng một file `state/probe.flow-enrollment`.
10. Đóng CDP/Chrome và xóa user-data-dir tạm.

- [ ] **Step 3: Chạy test và local probe**

```powershell
npm --prefix google-flow-enroller test
npm --prefix google-media-bridge run probe:keys -- --private-out ../google-media-bridge/secrets/probe-private.pem --public-out ../google-flow-enroller/state/probe-public.pem
$env:FLOW_ENROLLMENT_PUBLIC_KEY_FILE = "google-flow-enroller/state/probe-public.pem"
npm --prefix google-flow-enroller run probe:export
```

Expected probe output chỉ gồm:

```text
FLOW_SESSION_READY scope=aisandbox bundle=state/probe.flow-enrollment
```

Không được có `ya29`, email, Cookie hoặc project ID trong stdout/stderr.

### Task 4: Import session trong Chromium VPS

**Files:**
- Create: `google-media-bridge/src/browser/session.ts`
- Create: `google-media-bridge/src/browser/session.test.ts`
- Create: `google-media-bridge/src/probes/import-session.ts`

- [ ] **Step 1: Viết test đỏ cho session metadata sanitizer**

```ts
expect(summarizeSession({ access_token: "ya29.secret", expires: "..." })).toEqual({
  authenticated: true,
  tokenFamily: "ya29",
  hasExpiry: true,
});
expect(JSON.stringify(summarizeSession({ access_token: "ya29.secret" }))).not.toContain("secret");
```

- [ ] **Step 2: Implement importer**

Launch:

```ts
const browser = await chromium.launch({
  executablePath: process.env.FLOW_CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ storageState });
const page = await context.newPage();
await page.goto("https://labs.google/fx/tools/flow", { waitUntil: "domcontentloaded" });
```

Sau đó gọi `/fx/api/auth/session` trong page context, kiểm tra tokeninfo scope và trả summary đã redacted.

- [ ] **Step 3: Upload bundle bằng SSH vào thư mục tạm và chạy probe**

Không đưa bundle vào repo. Dùng path `/home/ubuntu/flow-probe/probe.flow-enrollment`, mode `600`, xóa ngay sau gate.

```powershell
scp -i "$HOME\.ssh\ssh-key-2026-04-20_tamhvt.key" google-flow-enroller/state/probe.flow-enrollment ubuntu@158.178.239.119:/home/ubuntu/flow-probe/
scp -i "$HOME\.ssh\ssh-key-2026-04-20_tamhvt.key" google-media-bridge/secrets/probe-private.pem ubuntu@158.178.239.119:/home/ubuntu/flow-probe/
ssh -i "$HOME\.ssh\ssh-key-2026-04-20_tamhvt.key" ubuntu@158.178.239.119 "chmod 600 /home/ubuntu/flow-probe/probe.flow-enrollment /home/ubuntu/flow-probe/probe-private.pem && cd /home/ubuntu/img-studio/google-media-bridge && FLOW_ENROLLMENT_FILE=/home/ubuntu/flow-probe/probe.flow-enrollment FLOW_ENROLLMENT_PRIVATE_KEY_FILE=/home/ubuntu/flow-probe/probe-private.pem FLOW_CHROMIUM_PATH=/usr/bin/chromium npm run probe:import"
```

Expected:

```text
FLOW_VPS_SESSION_READY scope=aisandbox browser=chromium-arm64
```

### Task 5: Chứng minh token factory và một request ảnh không qua UI

**Files:**
- Create: `google-media-bridge/src/flow/token-factory.ts`
- Create: `google-media-bridge/src/flow/token-factory.test.ts`
- Create: `google-media-bridge/src/probes/direct-image.ts`
- Create: `google-media-bridge/fixtures/image-request-shape.json`
- Create: `google-media-bridge/fixtures/image-response-shape.json`

- [ ] **Step 1: Capture site key/action an toàn bằng instrumentation**

Trong browser VPS, wrap `grecaptcha.enterprise.execute` trước một lượt tạo ảnh admin thủ công để ghi duy nhất `{siteKeyHash, action}`; không ghi token. Nếu challenge/CAPTCHA hiện ra, dừng và đánh dấu `manual_challenge`; không tự xử lý.

- [ ] **Step 2: Viết test đỏ cho token factory**

Inject page adapter:

```ts
type RecaptchaPage = {
  evaluate<T>(fn: string | ((arg: unknown) => T), arg?: unknown): Promise<T>;
};

const result = await createRecaptchaToken(fakePage, { siteKey: "site-key", action: "FLOW_GENERATE" });
expect(result).toMatch(/^token-/);
```

Test phải reject token rỗng và không retry quá một lần.

- [ ] **Step 3: Implement direct-image probe**

Probe lấy Bearer từ session endpoint, reCAPTCHA token từ page, dựng payload với:

```ts
{
  imageModelName: "NARWHAL",
  imageAspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
  structuredPrompt: { parts: [{ text: "A RED APPLE ON WHITE BACKGROUND" }] },
  imageInputs: [],
}
```

Gọi upstream, xác nhận HTTP 200 và ít nhất một `fifeUrl`. Chỉ log byte length, HTTP status và số ảnh.

- [ ] **Step 4: Chạy live gate G1/G2**

```bash
FLOW_ENROLLMENT_FILE=/home/ubuntu/flow-probe/probe.flow-enrollment npm run probe:import
FLOW_ENROLLMENT_FILE=/home/ubuntu/flow-probe/probe.flow-enrollment npm exec tsx src/probes/direct-image.ts
```

Pass criteria:

```text
FLOW_VPS_SESSION_READY scope=aisandbox browser=chromium-arm64
FLOW_DIRECT_IMAGE_OK count=1 status=200
```

Sau đó xóa bundle/private key tạm trên VPS và keypair probe local, rồi xác minh không có secret trong log.

- [ ] **Step 5: Ghi quyết định gate**

Create `docs/flow-gates/phase-1-result.md` chỉ chứa:

```markdown
# Flow Gate G1/G2 Result

- session_transfer: pass|fail
- aisandbox_scope: pass|fail
- recaptcha_factory: pass|fail|manual_challenge
- direct_image: pass|fail
- decision: continue|stop_and_redesign_remote_login
- evidence: command names, HTTP status, redacted log path
```

Không đi tiếp nếu `decision` khác `continue`.

- [ ] **Step 6: Checkpoint Git có điều kiện**

Chỉ commit code/fixture đã redacted và result không nhạy cảm sau khi anh cho phép. Không stage `state/`, bundle hoặc key.
