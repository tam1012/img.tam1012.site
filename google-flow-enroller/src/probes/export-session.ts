import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { findChromePath } from "../chrome/find-chrome.js";
import { encryptEnrollment, type EnrollmentPayload } from "../security/enrollment.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const AISANDBOX_SCOPE = "https://www.googleapis.com/auth/aisandbox";
const OUTPUT_BUNDLE = "state/probe.flow-enrollment";

type SessionSummary = { authenticated: boolean; hasAisandbox: boolean; hasExpiry: boolean };

function log(message: string) {
  process.stderr.write(`${message}\n`);
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine free port")));
      }
    });
  });
}

function spawnChrome(chromePath: string, port: number, userDataDir: string): ChildProcess {
  return spawn(
    chromePath,
    [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      FLOW_URL,
    ],
    { stdio: "ignore", detached: false },
  );
}

// Runs inside the page. The access token never leaves the browser: scope is
// checked here against Google tokeninfo and only a redacted summary is returned.
async function readSessionSummary(page: import("playwright-core").Page): Promise<SessionSummary> {
  return page.evaluate(
    async ([endpoint, scope]) => {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) return { authenticated: false, hasAisandbox: false, hasExpiry: false };
      const session = (await res.json()) as { access_token?: string; expires?: unknown };
      const token = session?.access_token;
      if (!token) return { authenticated: false, hasAisandbox: false, hasExpiry: false };
      let hasAisandbox = false;
      try {
        const info = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
        );
        if (info.ok) {
          const data = (await info.json()) as { scope?: string };
          hasAisandbox = typeof data.scope === "string" && data.scope.split(" ").includes(scope);
        }
      } catch {
        hasAisandbox = false;
      }
      return { authenticated: true, hasAisandbox, hasExpiry: Boolean(session.expires) };
    },
    [SESSION_ENDPOINT, AISANDBOX_SCOPE] as const,
  );
}

async function waitForFlowSession(
  page: import("playwright-core").Page,
  timeoutMs: number,
): Promise<SessionSummary> {
  const deadline = Date.now() + timeoutMs;
  let announcedLogin = false;
  for (;;) {
    let summary: SessionSummary = { authenticated: false, hasAisandbox: false, hasExpiry: false };
    try {
      summary = await readSessionSummary(page);
    } catch {
      // page may be mid-navigation during login; retry until deadline
    }
    if (summary.authenticated && summary.hasAisandbox) return summary;
    if (summary.authenticated && !announcedLogin) {
      log("Đã đăng nhập Google nhưng chưa thấy scope aisandbox, đang chờ Flow cấp quyền...");
      announcedLogin = true;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for an authenticated Flow session with aisandbox scope");
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function main() {
  const publicKeyFile = process.env.FLOW_ENROLLMENT_PUBLIC_KEY_FILE;
  if (!publicKeyFile) throw new Error("FLOW_ENROLLMENT_PUBLIC_KEY_FILE is required");
  const chromePath = findChromePath();
  if (!chromePath) throw new Error("Could not locate Chrome. Set FLOW_CHROME_PATH.");

  const loginTimeoutMs = Number(process.env.FLOW_LOGIN_TIMEOUT_MS ?? 15 * 60_000);
  const userDataDir = await mkdtemp(join(tmpdir(), "flow-enroll-"));
  const port = await freeLoopbackPort();
  let chrome: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    log("Đang mở Chrome tại Google Flow. Hãy đăng nhập trong cửa sổ vừa mở.");
    chrome = spawnChrome(chromePath, port, userDataDir);

    // Give Chrome a moment to open its debugging port before connecting.
    let connected = false;
    const connectDeadline = Date.now() + 30_000;
    while (!connected) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        connected = true;
      } catch (error) {
        if (Date.now() > connectDeadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!browser) throw new Error("Failed to connect to Chrome over CDP");

    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    const summary = await waitForFlowSession(page, loginTimeoutMs);
    if (!summary.hasAisandbox) throw new Error("Session missing aisandbox scope");

    const storageState = await context.storageState({ indexedDB: true });
    const payload: EnrollmentPayload = {
      version: 1,
      issuedAt: new Date().toISOString(),
      storageState: { cookies: storageState.cookies, origins: storageState.origins },
    };
    const publicKeyPem = await readFile(publicKeyFile, "utf8");
    const encrypted = encryptEnrollment(payload, publicKeyPem);
    await writeFile(OUTPUT_BUNDLE, JSON.stringify(encrypted), { mode: 0o600 });

    process.stdout.write(`FLOW_SESSION_READY scope=aisandbox bundle=${OUTPUT_BUNDLE}\n`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (chrome && !chrome.killed) chrome.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  log(`FLOW_SESSION_FAILED ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
