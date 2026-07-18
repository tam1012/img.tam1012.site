import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium, type Browser, type Request } from "playwright-core";
import { findChromePath } from "../chrome/find-chrome.js";
import {
  classifyAisandboxRequest,
  redactUrl,
  type ClassifiedRequest,
} from "./image-edit-shape.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const META_OUT = "state/flow-image-edit-request-meta.json";

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

type Captured = ClassifiedRequest & {
  method: string;
  capturedAt: string;
};

async function main() {
  const chromePath = findChromePath();
  if (!chromePath) throw new Error("Chrome not found (set FLOW_CHROME_PATH)");

  const userDataDir = await mkdtemp(join(tmpdir(), "flow-meta-"));
  const port = await freeLoopbackPort();
  let browser: Browser | undefined;

  const uploads: Captured[] = [];
  const textGenerates: Captured[] = [];
  let editGenerate: Captured | null = null;
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

      if (!/aisandbox-pa\.googleapis\.com/i.test(url) || method === "OPTIONS") return;

      const redacted = `${method} ${redactUrl(url)}`;
      if (!seen.has(redacted)) {
        seen.add(redacted);
        log(`aisandbox ${redacted}`);
      }

      // Already have the main prize
      if (editGenerate) return;

      let headers: Record<string, string> | null = null;
      try {
        headers = req.headers();
      } catch {
        headers = null;
      }

      const classified = classifyAisandboxRequest(url, method, req.postData(), headers);
      const captured: Captured = {
        ...classified,
        method,
        capturedAt: new Date().toISOString(),
      };

      if (classified.kind === "upload") {
        // Keep a few distinct upload path templates
        if (!uploads.some((u) => u.pathTemplate === classified.pathTemplate)) {
          uploads.push(captured);
          log(
            `captured UPLOAD path=${classified.pathTemplate} contentType=${classified.contentTypeHint}`,
          );
        }
        return;
      }

      if (classified.kind === "text_generate") {
        if (textGenerates.length < 3) textGenerates.push(captured);
        log(
          `bỏ qua text→image (imageInputs rỗng) model=${classified.imageModelName ?? "?"} — cần EDIT / upload ảnh + prompt`,
        );
        return;
      }

      if (classified.kind === "image_edit_generate") {
        editGenerate = captured;
        log(
          `captured EDIT generate path=${classified.pathTemplate} imageInputs=${classified.imageInputsCount} model=${classified.imageModelName ?? "?"} fields=${JSON.stringify(classified.requestFieldKeys)}`,
        );
      }
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.evaluate(wrapperSource).catch(() => undefined);
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    log("================================================");
    log("PROBE EDIT ẢNH FLOW (Nano Banana Pro / GEM_PIX_2)");
    log("================================================");
    log("1) Đăng nhập Google Flow nếu cửa sổ yêu cầu.");
    log("2) Chọn model Nano Banana Pro (Precise) nếu có.");
    log("3) Làm ĐÚNG thao tác EDIT / image-to-image:");
    log("   - Upload hoặc chọn 1 ảnh có sẵn");
    log("   - Gõ prompt chỉnh sửa (vd: đổi nền xanh)");
    log("   - Bấm Generate / Create");
    log("4) KHÔNG chỉ text→image (sẽ bị bỏ qua).");
    log("Cửa sổ tự đóng khi bắt được request edit (imageInputs khác rỗng).");
    log(`Kết quả (đã che secret) sẽ ghi: ${META_OUT}`);
    log("================================================");

    const timeoutMs = Number(process.env.FLOW_META_TIMEOUT_MS ?? 15 * 60_000);
    const deadline = Date.now() + timeoutMs;
    while (!editGenerate && Date.now() < deadline) {
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

    await mkdir(dirname(META_OUT), { recursive: true });

    if (!editGenerate) {
      // Save partial evidence (uploads / text generates) for debugging, then fail.
      const partial = {
        ok: false,
        reason: "timeout_without_image_edit_generate",
        siteKey: siteKey ? "captured" : null,
        action,
        uploads: uploads.map(publicCapture),
        textGeneratesSeen: textGenerates.map(publicCapture),
        seen: [...seen],
        hint: "Cần thao tác EDIT (ảnh + prompt), không chỉ tạo ảnh từ text. Nếu Flow upload ảnh trước, log uploads ở trên sẽ gợi ý endpoint.",
      };
      await writeFile(META_OUT, JSON.stringify(partial, null, 2), { mode: 0o600 });
      throw new Error(
        `Không bắt được generate có imageInputs trong ${Math.round(timeoutMs / 1000)}s. ` +
          `uploads=${uploads.length} textGenerates=${textGenerates.length}. ` +
          `Xem ${META_OUT}. seen=${[...seen].slice(-12).join(" | ") || "(none)"}`,
      );
    }

    const result = {
      ok: true,
      host: "aisandbox-pa.googleapis.com",
      pathTemplate: editGenerate.pathTemplate,
      method: editGenerate.method,
      imageModelName: editGenerate.imageModelName,
      imageInputsCount: editGenerate.imageInputsCount,
      requestFieldKeys: editGenerate.requestFieldKeys,
      bodyKeys: editGenerate.bodyKeys,
      nestedShape: editGenerate.nestedShape,
      hasRecaptcha: editGenerate.hasRecaptcha,
      siteKey: siteKey ? "captured" : null,
      action,
      uploads: uploads.map(publicCapture),
      textGeneratesSeen: textGenerates.map(publicCapture),
      seen: [...seen],
      capturedAt: editGenerate.capturedAt,
      notes: [
        "File này chỉ chứa shape (keys + kiểu), không chứa token/base64 đầy đủ.",
        "Dùng nestedShape.requests[].imageInputs để implement bridge edit.",
        uploads.length > 0
          ? "Có bước upload trước generate — cần implement upload + mediaId."
          : "Không thấy upload riêng — có thể imageInputs mang bytes/inline trực tiếp.",
      ],
    };

    await writeFile(META_OUT, JSON.stringify(result, null, 2), { mode: 0o600 });

    process.stdout.write(
      `FLOW_IMAGE_EDIT_META_OK path=${editGenerate.pathTemplate} model=${editGenerate.imageModelName ?? "?"} imageInputs=${editGenerate.imageInputsCount} uploads=${uploads.length} action=${action ?? "MISSING"} siteKey=${siteKey ? "captured" : "MISSING"} out=${META_OUT}\n`,
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    killChromeTree(userDataDir);
    await new Promise((r) => setTimeout(r, 400));
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function publicCapture(c: Captured) {
  return {
    kind: c.kind,
    pathTemplate: c.pathTemplate,
    method: c.method,
    bodyKeys: c.bodyKeys,
    nestedShape: c.nestedShape,
    imageInputsCount: c.imageInputsCount,
    imageModelName: c.imageModelName,
    contentTypeHint: c.contentTypeHint,
    requestFieldKeys: c.requestFieldKeys,
    hasRecaptcha: c.hasRecaptcha,
    reason: c.reason,
    capturedAt: c.capturedAt,
  };
}

main().catch((error) => {
  log(`FLOW_IMAGE_EDIT_META_FAILED ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
