import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Request } from "playwright-core";
import { findChromePath } from "../chrome/find-chrome.js";
import { encryptEnrollment, type EnrollmentPayload } from "../security/enrollment.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const PROJECT_ID_OUT = "state/probe-project-id.txt";
const META_OUT = "state/flow-request-meta.json";
const BUNDLE_OUT = "state/probe.flow-enrollment";

// Broad match for Flow media generate calls. The official name used to be
// flowMedia:batchGenerateImages; keep alternatives in case Google renames.
const GENERATE_URL_RE =
  /aisandbox-pa\.googleapis\.com\/.*(?:batchGenerateImages|flowMedia|GenerateImage|generateImages|batchGenerate)/i;

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
        server.close(() => reject(new Error("no free port")));
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
    { stdio: "ignore" },
  );
}

// Force-close every Chrome process whose user-data-dir is our probe's temp dir.
// Chrome forks itself at startup, so the PID we spawned is not the one that
// owns the visible window. Matching on the temp dir name is deterministic and
// never touches the user's normal Chrome.
//
// PowerShell -like is wildcard matching (not regex): keep single backslashes.
// Only the unique mkdtemp suffix (flow-meta-XXXX) is required for a safe match.
function killChromeTree(userDataDir: string) {
  const base = userDataDir.replaceAll("/", "\\");
  const marker = base.includes("flow-meta-")
    ? base.slice(base.lastIndexOf("flow-meta-"))
    : base;
  const safe = marker.replaceAll("'", "''");
  const ps =
    `$m = '${safe}'; ` +
    `Get-CimInstance Win32_Process ` +
    `| Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*' + $m + '*') } ` +
    `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ` +
    `Start-Sleep -Milliseconds 300; ` +
    `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*' + $m + '*') } | Measure-Object | Select-Object -ExpandProperty Count`;
  try {
    const result = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      windowsHide: true,
    });
    const remaining = (result.stdout ?? "").trim();
    if (remaining !== "0") {
      log(`(still ${remaining || "?"} Chrome procs; trying again)`);
      spawnSync("powershell", ["-NoProfile", "-Command", ps], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
  } catch (error) {
    log(`killChromeTree: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

// Injected at document-start so it wraps grecaptcha before Flow runs.
// Fetch/XHR wrappers are a backup only — CDP request events are the source of truth.
const wrapperSource = `(${(() => {
  const w = window as unknown as {
    grecaptcha?: { enterprise?: { execute?: (k: string, o: { action: string }) => Promise<string> } };
  };
  const installRecaptcha = () => {
    const ent = w.grecaptcha?.enterprise;
    if (!ent?.execute) {
      setTimeout(installRecaptcha, 100);
      return;
    }
    const orig = ent.execute as { __w?: boolean } & typeof ent.execute;
    if (orig.__w) return;
    const wrapped = function (key: string, opts: { action: string }) {
      (window as unknown as { __flowMeta?: unknown }).__flowMeta = {
        siteKey: key,
        action: opts?.action,
      };
      return orig.call(ent, key, opts);
    } as { __w?: boolean } & typeof ent.execute;
    wrapped.__w = true;
    ent.execute = wrapped;
  };
  installRecaptcha();
}).toString()})()`;

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname.replace(/\/projects\/[^/]+/, "/projects/{projectId}")}`;
  } catch {
    return "(bad-url)";
  }
}

function bodyKeysOf(postData: string | null): string[] {
  if (!postData) return [];
  try {
    const parsed = JSON.parse(postData) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>).sort();
    }
  } catch {
    /* not JSON */
  }
  return [];
}

function projectIdFromUrl(raw: string): string {
  try {
    return new URL(raw).pathname.match(/projects\/([^/]+)\//)?.[1] ?? "";
  } catch {
    return "";
  }
}

function siteKeyFromRecaptchaUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/recaptcha/i.test(u.host + u.pathname)) return null;
    return u.searchParams.get("k");
  } catch {
    return null;
  }
}

type CapturedRequest = {
  url: string;
  method: string;
  bodyKeys: string[];
  hasRecaptchaKey: boolean;
};

async function main() {
  const publicKeyFile = process.env.FLOW_ENROLLMENT_PUBLIC_KEY_FILE;
  if (!publicKeyFile) throw new Error("FLOW_ENROLLMENT_PUBLIC_KEY_FILE is required");
  const chromePath = findChromePath();
  if (!chromePath) throw new Error("Chrome not found (set FLOW_CHROME_PATH)");

  const userDataDir = await mkdtemp(join(tmpdir(), "flow-meta-"));
  const port = await freeLoopbackPort();
  let chrome: ChildProcess | undefined;
  let browser: Browser | undefined;
  // Box avoids TS control-flow treating closure writes as unreachable.
  const captureBox: { current: CapturedRequest | null } = { current: null };
  let siteKeyFromNetwork: string | null = null;
  const seenAisandbox = new Set<string>();

  try {
    chrome = spawnChrome(chromePath, port, userDataDir);
    const connectDeadline = Date.now() + 30_000;
    while (!browser) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch (error) {
        if (Date.now() > connectDeadline) throw error;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const context = browser.contexts()[0] ?? (await browser.newContext());
    await context.addInitScript(wrapperSource);

    // CDP-level request capture cannot be wiped by page JS / SPA navigations.
    context.on("request", (req: Request) => {
      const url = req.url();
      const method = req.method();

      const sk = siteKeyFromRecaptchaUrl(url);
      if (sk) siteKeyFromNetwork = sk;

      if (/aisandbox-pa\.googleapis\.com/i.test(url) && method !== "OPTIONS") {
        const redacted = redactUrl(url);
        if (!seenAisandbox.has(redacted)) {
          seenAisandbox.add(redacted);
          // Only path template — never full URL (may contain project id).
          log(`aisandbox ${method} ${redacted}`);
        }
      }

      if (captureBox.current) return;
      if (method !== "POST") return;
      if (!GENERATE_URL_RE.test(url)) return;

      const bodyKeys = bodyKeysOf(req.postData());
      captureBox.current = {
        url,
        method,
        bodyKeys,
        hasRecaptchaKey: bodyKeys.some((k) => /recaptcha|captcha|token/i.test(k)),
      };
      log(`captured generate ${redactUrl(url)} bodyKeys=${JSON.stringify(bodyKeys)}`);
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.evaluate(wrapperSource).catch(() => undefined);
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    log("Đã mở Flow. Hãy ĐĂNG NHẬP (nếu cần) rồi TẠO 1 ẢNH (nút Generate ảnh). Cửa sổ tự đóng ngay khi bắt được.");
    log("Lưu ý: dùng đúng tạo ẢNH, không dùng chat agent nếu có.");

    const timeoutMs = Number(process.env.FLOW_META_TIMEOUT_MS ?? 15 * 60_000);
    const deadline = Date.now() + timeoutMs;
    let pageMeta: { siteKey: string; action: string } | null = null;

    while (!captureBox.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      // Reinstall grecaptcha wrapper periodically (SPA may replace it).
      await page.evaluate(wrapperSource).catch(() => undefined);
      pageMeta = await page
        .evaluate(() => {
          const w = window as unknown as { __flowMeta?: { siteKey: string; action: string } };
          return w.__flowMeta ?? null;
        })
        .catch(() => pageMeta);
    }

    const capturedRequest = captureBox.current;
    if (!capturedRequest) {
      const seen = [...seenAisandbox].slice(-20).join(" | ") || "(none)";
      throw new Error(
        `Không bắt được request generate trong ${Math.round(timeoutMs / 1000)}s. aisandbox đã thấy: ${seen}`,
      );
    }

    const projectId = projectIdFromUrl(capturedRequest.url);
    const siteKey = pageMeta?.siteKey ?? siteKeyFromNetwork;
    const action = pageMeta?.action ?? null;

    await writeFile(PROJECT_ID_OUT, projectId, { mode: 0o600 });
    await writeFile(
      META_OUT,
      JSON.stringify(
        {
          host: new URL(capturedRequest.url).host,
          pathTemplate: new URL(capturedRequest.url).pathname.replace(
            /projects\/[^/]+\//,
            "projects/{projectId}/",
          ),
          method: capturedRequest.method,
          bodyKeys: capturedRequest.bodyKeys,
          hasRecaptchaKey: capturedRequest.hasRecaptchaKey,
          siteKey: siteKey ?? null,
          action,
          seenAisandbox: [...seenAisandbox],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    let bundleSaved = false;
    try {
      const storageState = await context.storageState({ indexedDB: true });
      const payload: EnrollmentPayload = {
        version: 1,
        issuedAt: new Date().toISOString(),
        storageState: { cookies: storageState.cookies, origins: storageState.origins },
      };
      const publicKeyPem = await readFile(publicKeyFile, "utf8");
      await writeFile(BUNDLE_OUT, JSON.stringify(encryptEnrollment(payload, publicKeyPem)), {
        mode: 0o600,
      });
      bundleSaved = true;
    } catch {
      /* metadata already saved */
    }

    log("Đã bắt được. Đang đóng Chrome...");
    process.stdout.write(
      `FLOW_META_OK siteKey=${siteKey ? "captured" : "MISSING"} action=${action ?? "MISSING"} bodyKeys=${JSON.stringify(capturedRequest.bodyKeys)} projectId=<saved> bundle=${bundleSaved ? BUNDLE_OUT : "not-saved"}\n`,
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    killChromeTree(userDataDir);
    await new Promise((r) => setTimeout(r, 400));
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  log(`FLOW_META_FAILED ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
