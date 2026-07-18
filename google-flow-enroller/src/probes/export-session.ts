import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { findChromePath } from "../chrome/find-chrome.js";
import { encryptEnrollment, type EnrollmentPayload, type EncryptedEnrollment } from "../security/enrollment.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const AISANDBOX_SCOPE = "https://www.googleapis.com/auth/aisandbox";
const OUTPUT_BUNDLE = "state/probe.flow-enrollment";

type SessionSummary = { authenticated: boolean; hasAisandbox: boolean; hasExpiry: boolean };

function log(message: string) {
  process.stderr.write(`${message}\n`);
}

// parseProxyUrl: tách proxy URL dạng http://user:pass@host:port
// thành { server, username, password } cho Playwright.
// Chrome --proxy-server KHÔNG hỗ trợ auth trong URL nên phải
// dùng Playwright launch với proxy option (có xử lý auth sẵn).
function parseProxyUrl(raw?: string): { server: string; username?: string; password?: string } | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(https?):\/\/(?:([^:]*):([^@]*)@)?(.+)$/);
  if (!m) return undefined;
  const [, scheme, user, pass, hostPort] = m;
  const server = `${scheme}://${hostPort}`;
  if (user && pass) return { server, username: user, password: pass };
  return { server };
}

// Runs inside the page. The access token never leaves the browser: scope is
// checked here against Google tokeninfo and only a redacted summary is returned.
async function readSessionSummary(page: Page): Promise<SessionSummary> {
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

// Reads the Google account email so the bridge can label accounts by email
// instead of flow-01/flow-02. Runs in-page; the access token never leaves the
// browser. Tries the Flow session first, then Google userinfo as fallback.
async function readAccountEmail(page: Page): Promise<string | null> {
  return page
    .evaluate(async ([endpoint]) => {
      try {
        const res = await fetch(endpoint, { credentials: "include" });
        if (!res.ok) return null;
        const session = (await res.json()) as {
          access_token?: string;
          user?: { email?: string };
          email?: string;
        };
        if (session?.user?.email) return session.user.email;
        if (session?.email) return session.email;
        const token = session?.access_token;
        if (token) {
          const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (info.ok) {
            const data = (await info.json()) as { email?: string };
            if (data?.email) return data.email;
          }
        }
      } catch {
        return null;
      }
      return null;
    }, [SESSION_ENDPOINT] as const)
    .catch(() => null);
}

async function waitForFlowSession(page: Page, timeoutMs: number): Promise<SessionSummary> {
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

// Opens an isolated Chrome at Flow, waits for the user to log in, then captures
// the storage state + account email and returns an encrypted enrollment bundle.
// Plaintext storage state / token never touch disk. Reused by the probe entry
// point and the one-click enroll-and-push orchestrator.
//
// Dùng Playwright chromium.launch (không spawn + CDP như trước) để Playwright
// tự xử lý proxy auth. Chrome --proxy-server không hỗ trợ user:pass trong URL.
export async function captureFlowSession(options: {
  publicKeyFile: string;
  chromePath?: string;
  loginTimeoutMs?: number;
  onLog?: (message: string) => void;
}): Promise<{ encrypted: EncryptedEnrollment; email: string | null }> {
  const emit = options.onLog ?? log;
  const chromePath = options.chromePath ?? findChromePath();
  if (!chromePath) throw new Error("Could not locate Chrome. Set FLOW_CHROME_PATH.");
  const loginTimeoutMs = options.loginTimeoutMs ?? Number(process.env.FLOW_LOGIN_TIMEOUT_MS ?? 15 * 60_000);
  const proxy = parseProxyUrl(process.env.FLOW_PROXY_URL || undefined);
  if (proxy) emit(`Sử dụng proxy: ${proxy.server}${proxy.username ? ' (có auth)' : ''}`);

  const userDataDir = await mkdtemp(join(tmpdir(), "flow-enroll-"));
  let browser: Browser | undefined;
  try {
    emit("Đang mở Chrome tại Google Flow. Hãy đăng nhập trong cửa sổ vừa mở.");
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: false,
      args: [
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
      ...(proxy ? { proxy } : {}),
    });

    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    const summary = await waitForFlowSession(page, loginTimeoutMs);
    if (!summary.hasAisandbox) throw new Error("Session missing aisandbox scope");

    const email = await readAccountEmail(page);
    const storageState = await context.storageState({ indexedDB: true });
    const payload: EnrollmentPayload = {
      version: 1,
      issuedAt: new Date().toISOString(),
      storageState: { cookies: storageState.cookies, origins: storageState.origins },
      ...(email ? { email } : {}),
    };
    const publicKeyPem = await readFile(options.publicKeyFile, "utf8");
    const encrypted = encryptEnrollment(payload, publicKeyPem);
    return { encrypted, email };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const publicKeyFile = process.env.FLOW_ENROLLMENT_PUBLIC_KEY_FILE;
  if (!publicKeyFile) throw new Error("FLOW_ENROLLMENT_PUBLIC_KEY_FILE is required");

  const { encrypted, email } = await captureFlowSession({ publicKeyFile });
  await writeFile(OUTPUT_BUNDLE, JSON.stringify(encrypted), { mode: 0o600 });

  process.stdout.write(
    `FLOW_SESSION_READY scope=aisandbox email=${email ? "captured" : "MISSING"} bundle=${OUTPUT_BUNDLE}\n`,
  );
}

// Only run the probe when executed directly, not when imported by the orchestrator.
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("export-session.ts") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("export-session.js");
if (invokedDirectly) {
  main().catch((error) => {
    log(`FLOW_SESSION_FAILED ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
