import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Request } from "playwright-core";
import { findChromePath } from "../chrome/find-chrome.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const META_OUT = "state/flow-video-request-meta.json";

// Capture text/image/start-end video create + status poll.
const VIDEO_URL_RE =
  /aisandbox-pa\.googleapis\.com\/.*(?:batchAsyncGenerateVideo|batchCheckAsyncVideo|video:)/i;

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
    spawnSync("powershell", ["-NoProfile", "-Command", ps], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    log(`killChromeTree: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname.replace(/\/projects\/[^/]+/, "/projects/{projectId}")}`;
  } catch {
    return "(bad-url)";
  }
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return typeof value;
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 80) return `string(len=${value.length})`;
    if (/ya29\.|Bearer\s+/i.test(value)) return "[redacted]";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [summarizeValue(value[0], depth + 1), value.length > 1 ? `…(+${value.length - 1})` : undefined].filter(
      (x) => x !== undefined,
    );
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|authorization|cookie|email|fifeurl|signed/i.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = summarizeValue(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

function bodyShape(postData: string | null): {
  bodyKeys: string[];
  nested: Record<string, unknown>;
  hasRecaptcha: boolean;
} {
  if (!postData) return { bodyKeys: [], nested: {}, hasRecaptcha: false };
  try {
    const parsed = JSON.parse(postData) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { bodyKeys: [], nested: {}, hasRecaptcha: false };
    }
    const obj = parsed as Record<string, unknown>;
    const bodyKeys = Object.keys(obj).sort();
    const nested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      nested[k] = summarizeValue(v);
    }
    const raw = JSON.stringify(obj);
    const hasRecaptcha = /recaptcha|captcha/i.test(raw);
    return { bodyKeys, nested, hasRecaptcha };
  } catch {
    return { bodyKeys: [], nested: {}, hasRecaptcha: false };
  }
}

type Captured = {
  url: string;
  method: string;
  bodyKeys: string[];
  nested: Record<string, unknown>;
  hasRecaptcha: boolean;
};

async function main() {
  const chromePath = findChromePath();
  if (!chromePath) throw new Error("Chrome not found (set FLOW_CHROME_PATH)");

  const userDataDir = await mkdtemp(join(tmpdir(), "flow-meta-"));
  const port = await freeLoopbackPort();
  let browser: Browser | undefined;
  const captureBox: { current: Captured | null } = { current: null };
  let siteKey: string | null = null;
  let action: string | null = null;
  const seen = new Set<string>();

  const wrapperSource = `(${(() => {
    const w = window as unknown as {
      grecaptcha?: { enterprise?: { execute?: (k: string, o: { action: string }) => Promise<string> } };
    };
    const install = () => {
      const ent = w.grecaptcha?.enterprise;
      if (!ent?.execute) {
        setTimeout(install, 100);
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
    install();
  }).toString()})()`;

  try {
    spawnChrome(chromePath, port, userDataDir);
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

    context.on("request", (req: Request) => {
      const url = req.url();
      const method = req.method();
      if (/recaptcha/i.test(url)) {
        try {
          const k = new URL(url).searchParams.get("k");
          if (k) siteKey = k;
        } catch {
          /* ignore */
        }
      }
      if (/aisandbox-pa\.googleapis\.com/i.test(url) && method !== "OPTIONS") {
        const redacted = redactUrl(url);
        if (!seen.has(`${method} ${redacted}`)) {
          seen.add(`${method} ${redacted}`);
          log(`aisandbox ${method} ${redacted}`);
        }
      }
      if (captureBox.current) return;
      if (method !== "POST") return;
      if (!VIDEO_URL_RE.test(url)) return;
      // Prefer create endpoints over status poll.
      if (/batchCheckAsyncVideo/i.test(url)) return;
      const shape = bodyShape(req.postData());
      captureBox.current = {
        url,
        method,
        bodyKeys: shape.bodyKeys,
        nested: shape.nested,
        hasRecaptcha: shape.hasRecaptcha,
      };
      log(`captured video ${redactUrl(url)} bodyKeys=${JSON.stringify(shape.bodyKeys)}`);
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.evaluate(wrapperSource).catch(() => undefined);
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    log("Đã mở Flow. Hãy ĐĂNG NHẬP (nếu cần) rồi TẠO 1 VIDEO (text→video là đủ).");
    log("Cửa sổ tự đóng ngay khi bắt được request video create.");

    const timeoutMs = Number(process.env.FLOW_META_TIMEOUT_MS ?? 15 * 60_000);
    const deadline = Date.now() + timeoutMs;
    while (!captureBox.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      await page.evaluate(wrapperSource).catch(() => undefined);
      const meta = await page
        .evaluate(() => {
          const w = window as unknown as { __flowMeta?: { siteKey: string; action: string } };
          return w.__flowMeta ?? null;
        })
        .catch(() => null);
      if (meta?.siteKey) siteKey = meta.siteKey;
      if (meta?.action) action = meta.action;
    }

    const captured = captureBox.current;
    if (!captured) {
      throw new Error(
        `Không bắt được request video trong ${Math.round(timeoutMs / 1000)}s. seen=${[...seen].slice(-15).join(" | ") || "(none)"}`,
      );
    }

    const pathTemplate = new URL(captured.url).pathname.replace(
      /projects\/[^/]+\//,
      "projects/{projectId}/",
    );
    await writeFile(
      META_OUT,
      JSON.stringify(
        {
          host: new URL(captured.url).host,
          pathTemplate,
          method: captured.method,
          bodyKeys: captured.bodyKeys,
          nestedShape: captured.nested,
          hasRecaptcha: captured.hasRecaptcha,
          siteKey: siteKey ? "captured" : null,
          action,
          seen: [...seen],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    process.stdout.write(
      `FLOW_VIDEO_META_OK path=${pathTemplate} action=${action ?? "MISSING"} bodyKeys=${JSON.stringify(captured.bodyKeys)} siteKey=${siteKey ? "captured" : "MISSING"}\n`,
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    killChromeTree(userDataDir);
    await new Promise((r) => setTimeout(r, 400));
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  log(`FLOW_VIDEO_META_FAILED ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
