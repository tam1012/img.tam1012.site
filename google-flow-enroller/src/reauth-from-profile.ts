/**
 * Reauth Flow account từ Chrome User Data RIÊNG (non-default).
 *
 * Chrome Windows cấm remote-debugging trên ...\Google\Chrome\User Data mặc định.
 * Vì vậy mỗi account Flow có 1 folder riêng, ví dụ:
 *   D:\flow-profiles\flow-02-babyinmyl0v3
 *
 * Lần đầu: chạy mo-profile-lan-dau.bat → login Google + Flow một lần.
 * Reauth:  chạy reauth-tu-profile.bat  → bắt session + đẩy VPS (không login lại).
 *
 *   npx tsx src/reauth-from-profile.ts --alias flow-02
 *   npx tsx src/reauth-from-profile.ts --user-data-dir "D:\flow-profiles\..." --expect-email a@b.com
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import { findChromePath } from "./chrome/find-chrome.js";
import {
  encryptEnrollment,
  type EnrollmentPayload,
  type EncryptedEnrollment,
} from "./security/enrollment.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const enrollerRoot = join(here, "..");
const repoRoot = join(enrollerRoot, "..");

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const AISANDBOX_SCOPE = "https://www.googleapis.com/auth/aisandbox";

type Config = {
  host: string;
  user: string;
  sshKey: string;
  container: string;
  publicKeyFile: string;
  applyScript: string;
};

type ProfileMap = {
  profilesRoot: string;
  accounts: Array<{ alias: string; email: string; folder: string }>;
};

function loadConfig(): Config {
  const defaults: Config = {
    host: "158.178.239.119",
    user: "ubuntu",
    sshKey: "C:\\Users\\Ha Tam\\.ssh\\ssh-key-2026-04-20_tamhvt.key",
    container: "google-media-bridge",
    publicKeyFile: join(enrollerRoot, "state", "probe-public.pem"),
    applyScript: join(repoRoot, "google-media-bridge", "scripts", "apply-enrollment.cjs"),
  };
  const cfgPath = join(enrollerRoot, "enroll.config.json");
  if (existsSync(cfgPath)) {
    try {
      return { ...defaults, ...(JSON.parse(readFileSync(cfgPath, "utf8")) as Partial<Config>) };
    } catch {
      /* defaults */
    }
  }
  return defaults;
}

function loadProfileMap(): ProfileMap {
  const path = join(enrollerRoot, "flow-profiles.json");
  if (!existsSync(path)) {
    throw new Error(`Thiếu ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as ProfileMap;
}

function log(message: string) {
  process.stderr.write(`${message}\n`);
}

function parseArgs(argv: string[]) {
  const out: {
    alias?: string;
    userDataDir?: string;
    expectEmail?: string;
    chromePath?: string;
    loginTimeoutMs?: number;
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--alias" && next) {
      out.alias = next.toLowerCase();
      i++;
    } else if (a === "--user-data-dir" && next) {
      out.userDataDir = next;
      i++;
    } else if (a === "--expect-email" && next) {
      out.expectEmail = next.toLowerCase();
      i++;
    } else if (a === "--chrome-path" && next) {
      out.chromePath = next;
      i++;
    } else if (a === "--timeout-ms" && next) {
      out.loginTimeoutMs = Number(next);
      i++;
    }
  }
  return out;
}

function isDefaultChromeUserData(dir: string): boolean {
  const n = dir.replace(/\//g, "\\").toLowerCase();
  return n.includes("\\google\\chrome\\user data") && !n.includes("\\flow-profiles\\");
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolvePort(port));
      } else {
        server.close(() => reject(new Error("Could not determine free port")));
      }
    });
  });
}

function spawnDedicatedChrome(chromePath: string, port: number, userDataDir: string): ChildProcess {
  // user-data-dir non-default → Chrome CHO PHÉP remote debugging.
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-features=ChromeWhatsNewUI",
    FLOW_URL,
  ];
  log(`Chrome args: ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
  return spawn(chromePath, args, { stdio: "ignore", detached: false, windowsHide: false });
}

type SessionSummary = { authenticated: boolean; hasAisandbox: boolean; hasExpiry: boolean };

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
  let announced = false;
  let lastLog = 0;
  for (;;) {
    let summary: SessionSummary = { authenticated: false, hasAisandbox: false, hasExpiry: false };
    try {
      summary = await readSessionSummary(page);
    } catch {
      /* mid navigation */
    }
    if (summary.authenticated && summary.hasAisandbox) return summary;
    if (summary.authenticated && !announced) {
      log("Đã thấy login Google nhưng chưa có scope aisandbox, đang chờ...");
      announced = true;
    }
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      log(
        `Đang chờ session... url=${page.url()} authenticated=${summary.authenticated} aisandbox=${summary.hasAisandbox}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Hết thời gian chờ session Flow (aisandbox). url=${page.url()} authenticated=${summary.authenticated}. ` +
          `Chạy mo-profile-lan-dau.bat với đúng account, login Google+Flow một lần, rồi chạy lại reauth.`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function captureFromDedicatedProfile(options: {
  publicKeyFile: string;
  chromePath: string;
  userDataDir: string;
  loginTimeoutMs: number;
}): Promise<{ encrypted: EncryptedEnrollment; email: string | null }> {
  if (isDefaultChromeUserData(options.userDataDir)) {
    throw new Error(
      "Không dùng Chrome User Data mặc định (multi-profile). " +
        "Dùng folder riêng trong D:\\flow-profiles\\... (xem flow-profiles.json).",
    );
  }
  mkdirSync(options.userDataDir, { recursive: true });

  const port = await freeLoopbackPort();
  let chrome: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    log(`Mở Chrome user-data-dir riêng: ${options.userDataDir}`);
    log("Profile này KHÔNG bị xoá. Cửa sổ sẽ đóng sau khi bắt session.");
    chrome = spawnDedicatedChrome(options.chromePath, port, options.userDataDir);

    let connected = false;
    const connectDeadline = Date.now() + 60_000;
    while (!connected) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        connected = true;
      } catch (error) {
        if (Date.now() > connectDeadline) {
          throw new Error(
            `Không kết nối được CDP. Tắt hết Chrome đang mở folder này rồi thử lại. Chi tiết: ${
              error instanceof Error ? error.message : "unknown"
            }`,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!browser) throw new Error("Failed to connect over CDP");

    const context = browser.contexts()[0] ?? (await browser.newContext());
    let page = context.pages().find((p) => p.url().includes("labs.google")) ?? context.pages()[0];
    if (!page) page = await context.newPage();
    log(`CDP connected, pages=${context.pages().length}, current=${page.url()}`);
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((err) => {
      log(`goto Flow warning: ${err instanceof Error ? err.message : "unknown"}`);
    });
    await new Promise((r) => setTimeout(r, 2500));
    log(`After goto: ${page.url()}`);

    const summary = await waitForFlowSession(page, options.loginTimeoutMs);
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
    log(
      `Bắt session OK (email: ${email ?? "không đọc được"}, cookies: ${storageState.cookies.length})`,
    );
    return { encrypted, email };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (chrome && !chrome.killed) {
      try {
        chrome.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

function sshBase(cfg: Config): string[] {
  return ["-i", cfg.sshKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20"];
}

async function scp(cfg: Config, localPath: string, remotePath: string): Promise<void> {
  await execFileAsync("scp", [...sshBase(cfg), localPath, `${cfg.user}@${cfg.host}:${remotePath}`], {
    windowsHide: true,
  });
}

async function ssh(cfg: Config, remoteCommand: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "ssh",
    [...sshBase(cfg), `${cfg.user}@${cfg.host}`, remoteCommand],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}

async function pushEncrypted(
  cfg: Config,
  encrypted: EncryptedEnrollment,
  email: string | null,
): Promise<void> {
  log(`Đang đẩy bundle reauth lên VPS (email: ${email ?? "?"})...`);
  const localTmp = await mkdtemp(join(tmpdir(), "flow-reauth-"));
  const localBundle = join(localTmp, "bundle.json");
  await writeFile(localBundle, JSON.stringify(encrypted), { mode: 0o600 });
  const tag = randomUUID();
  const remoteBundle = `/tmp/flow-enroll-${tag}.json`;
  const remoteApply = `/tmp/flow-apply-${tag}.cjs`;

  try {
    await scp(cfg, localBundle, remoteBundle);
    await scp(cfg, cfg.applyScript, remoteApply);
    const c = cfg.container;
    const remoteCmd =
      `docker cp ${remoteBundle} ${c}:${remoteBundle} >/dev/null 2>&1 || { echo '{"ok":false,"error":"docker cp bundle"}'; exit 1; }; ` +
      `docker cp ${remoteApply} ${c}:${remoteApply} >/dev/null 2>&1 || { echo '{"ok":false,"error":"docker cp apply"}'; exit 1; }; ` +
      `OUT=$(docker exec ${c} node ${remoteApply} ${remoteBundle}); RC=$?; ` +
      `docker exec ${c} rm -f ${remoteBundle} ${remoteApply} >/dev/null 2>&1 || true; ` +
      `rm -f ${remoteBundle} ${remoteApply}; ` +
      `echo "$OUT"; exit $RC`;
    const out = await ssh(cfg, remoteCmd);
    const line = out.trim().split("\n").pop() || "{}";
    let result: {
      ok?: boolean;
      action?: string;
      alias?: string;
      email?: string;
      status?: string;
      error?: string;
    } = {};
    try {
      result = JSON.parse(line);
    } catch {
      throw new Error(`Không phân tích được phản hồi VPS: ${line.slice(0, 200)}`);
    }
    if (!result.ok) throw new Error(result.error || "apply thất bại");
    const actionLabel = result.action === "reauth" ? "Đăng nhập lại" : "Thêm mới";
    process.stdout.write(
      `\nXONG — ${actionLabel}\n` +
        `  Email:   ${result.email ?? email ?? "(không có)"}\n` +
        `  Nhãn:    ${result.alias ?? "?"}\n` +
        `  Trạng thái: ${result.status ?? "?"}\n`,
    );
  } finally {
    await rm(localTmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  if (!existsSync(cfg.publicKeyFile)) throw new Error(`Thiếu public key: ${cfg.publicKeyFile}`);
  if (!existsSync(cfg.applyScript)) throw new Error(`Thiếu apply script: ${cfg.applyScript}`);

  let userDataDir = args.userDataDir;
  let expectEmail = args.expectEmail;

  if (args.alias) {
    const map = loadProfileMap();
    const acc = map.accounts.find(
      (a) => a.alias.toLowerCase() === args.alias || a.email.toLowerCase() === args.alias,
    );
    if (!acc) {
      throw new Error(
        `Không có alias ${args.alias} trong flow-profiles.json. Có: ${map.accounts
          .map((a) => a.alias)
          .join(", ")}`,
      );
    }
    userDataDir = resolve(map.profilesRoot, acc.folder);
    expectEmail = acc.email.toLowerCase();
    log(`Alias ${acc.alias} → ${userDataDir} (${acc.email})`);
  }

  if (!userDataDir) {
    throw new Error("Thiếu --alias flow-0X hoặc --user-data-dir");
  }

  const chromePath = args.chromePath || findChromePath();
  if (!chromePath) throw new Error("Không tìm thấy Chrome. Dùng --chrome-path.");

  const { encrypted, email } = await captureFromDedicatedProfile({
    publicKeyFile: cfg.publicKeyFile,
    chromePath,
    userDataDir,
    loginTimeoutMs: args.loginTimeoutMs ?? 3 * 60_000,
  });

  if (expectEmail) {
    if (!email) {
      throw new Error(`Kỳ vọng email ${expectEmail} nhưng không đọc được email từ session`);
    }
    if (email.toLowerCase() !== expectEmail) {
      throw new Error(
        `Email session là ${email}, khác kỳ vọng ${expectEmail} — dừng, không đẩy nhầm account`,
      );
    }
  }

  await pushEncrypted(cfg, encrypted, email);
}

main().catch((error) => {
  log(`THẤT BẠI: ${error instanceof Error ? error.message : "lỗi không rõ"}`);
  process.exitCode = 1;
});
