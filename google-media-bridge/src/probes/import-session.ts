import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright-core";
import { decryptEnrollment, type EncryptedEnrollment } from "../security/enrollment.js";
import { summarizeSession } from "../browser/session.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const AISANDBOX_SCOPE = "https://www.googleapis.com/auth/aisandbox";

function log(message: string) {
  process.stderr.write(`${message}\n`);
}

// Runs in the page. Token is checked against tokeninfo inside the browser and
// only a redacted summary + scope boolean cross back into Node.
async function readVpsSession(page: import("playwright-core").Page) {
  return page.evaluate(
    async ([endpoint, scope]) => {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) {
        return { access_token: undefined, expires: undefined, hasAisandbox: false };
      }
      const session = (await res.json()) as { access_token?: string; expires?: unknown };
      const token = session?.access_token;
      let hasAisandbox = false;
      if (token) {
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
      }
      // Redact: never return the raw token. Only the family marker survives.
      return {
        access_token: token ? (token.startsWith("ya29") ? "ya29" : "opaque") : undefined,
        expires: session.expires,
        hasAisandbox,
      };
    },
    [SESSION_ENDPOINT, AISANDBOX_SCOPE] as const,
  );
}

async function main() {
  const bundleFile = process.env.FLOW_ENROLLMENT_FILE;
  const privateKeyFile = process.env.FLOW_ENROLLMENT_PRIVATE_KEY_FILE;
  if (!bundleFile) throw new Error("FLOW_ENROLLMENT_FILE is required");
  if (!privateKeyFile) throw new Error("FLOW_ENROLLMENT_PRIVATE_KEY_FILE is required");

  const [bundleRaw, privateKeyPem] = await Promise.all([
    readFile(bundleFile, "utf8"),
    readFile(privateKeyFile, "utf8"),
  ]);
  const bundle = JSON.parse(bundleRaw) as EncryptedEnrollment;
  const payload = decryptEnrollment(bundle, privateKeyPem);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath: process.env.FLOW_CHROMIUM_PATH ?? "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      storageState: {
        cookies: payload.storageState.cookies as never,
        origins: payload.storageState.origins as never,
      },
    });
    const page = await context.newPage();
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" });

    const raw = await readVpsSession(page);
    const summary = summarizeSession({ access_token: raw.access_token, expires: raw.expires });
    if (!summary.authenticated) throw new Error("Imported session is not authenticated on VPS");
    if (!raw.hasAisandbox) throw new Error("Imported session missing aisandbox scope on VPS");

    process.stdout.write("FLOW_VPS_SESSION_READY scope=aisandbox browser=chromium-arm64\n");
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  log(`FLOW_VPS_SESSION_FAILED ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
